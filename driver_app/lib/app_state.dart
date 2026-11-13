import 'dart:async';
import 'dart:convert';

import 'package:flutter/widgets.dart';
import 'package:intl/intl.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'config.dart';
import 'location.dart';
import 'models.dart';
import 'notify.dart';

enum Stage { loading, notDriver, noVehicle, ready, failed }

/// Всё состояние приложения водителя: машина, заказы на сегодня и завтра,
/// обновления (Realtime + опрос), кэш на случай плохой связи.
class AppState extends ChangeNotifier with WidgetsBindingObserver {
  static const _cacheKey = 'driver_cache_v1';
  static const networkError = 'Нет связи. Проверьте интернет и повторите.';

  final SupabaseClient _db = Supabase.instance.client;

  /// Передача положения машины диспетчеру («На линии»).
  final LocationTracker location = LocationTracker();

  Stage stage = Stage.loading;
  Vehicle? vehicle;
  String? driverName;
  String? dispatcherPhone;
  List<Trip> trips = [];

  /// Последняя загрузка не удалась — на экране данные из кэша.
  bool offline = false;
  DateTime? loadedAt;

  /// Сообщения об изменениях от диспетчера, пока водитель не нажал «Понятно».
  List<String> notices = [];

  bool _hasBaseline =
      false; // есть список с сервера, с которым можно сравнивать
  bool _refreshing = false;
  bool _refreshAgain = false;
  bool _disposed = false;
  Timer? _timer;
  RealtimeChannel? _channel;
  String? _channelVehicleId;

  // ───────────── даты ─────────────

  static String isoDay(int offset) => DateFormat(
    'yyyy-MM-dd',
  ).format(DateTime.now().add(Duration(days: offset)));

  /// Заказы на день: 0 — сегодня, 1 — завтра.
  List<Trip> tripsFor(int dayOffset) {
    final day = isoDay(dayOffset);
    return trips.where((t) => t.date == day).toList();
  }

  int unackedFor(int dayOffset) =>
      tripsFor(dayOffset).where((t) => t.needsAck).length;

  Trip? tripById(String id) {
    for (final t in trips) {
      if (t.id == id) return t;
    }
    return null;
  }

  /// Вторая половина поездки «туда-обратно».
  Trip? pairOf(Trip trip) {
    if (trip.pairId == null) return null;
    for (final t in trips) {
      if (t.pairId == trip.pairId && t.id != trip.id) return t;
    }
    return null;
  }

  // ───────────── запуск и остановка ─────────────

  Future<void> start() async {
    WidgetsBinding.instance.addObserver(this);
    await location.restore();
    await _restoreCache();
    await refresh();
    if (_disposed) return;
    _timer = Timer.periodic(Config.pollInterval, (_) => refresh());
    Notify.requestPermission();
  }

  @override
  void dispose() {
    _disposed = true;
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel();
    _unsubscribe();
    location.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      refresh();
      location.recheck(); // разрешение могли дать в настройках
    }
  }

  Future<void> signOut() async {
    // Пока сессия жива — сообщить диспетчеру, что машина не на линии.
    await location.stop(reportOffDuty: location.onDuty);
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_cacheKey);
    } catch (_) {}
    try {
      await _db.auth.signOut();
    } catch (_) {
      // Без сети достаточно забыть сессию на устройстве.
      await _db.auth.signOut(scope: SignOutScope.local);
    }
  }

  void _changed() {
    if (!_disposed) notifyListeners();
  }

  // ───────────── загрузка ─────────────

  /// Перечитать всё с сервера. Параллельные вызовы склеиваются.
  Future<void> refresh() async {
    if (_disposed) return;
    if (_refreshing) {
      _refreshAgain = true;
      return;
    }
    _refreshing = true;
    try {
      do {
        _refreshAgain = false;
        await _load();
      } while (_refreshAgain && !_disposed);
    } finally {
      _refreshing = false;
    }
  }

  Future<void> _load() async {
    final uid = _db.auth.currentUser?.id;
    if (uid == null) return;

    try {
      final profile = await _db
          .from('profiles')
          .select()
          .eq('id', uid)
          .maybeSingle();
      if (_disposed) return;
      if (profile == null ||
          profile['role'] != 'driver' ||
          profile['is_active'] != true) {
        stage = Stage.notDriver;
        _changed();
        return;
      }
      driverName = profile['full_name'] as String?;

      final settings = await _db
          .from('app_settings')
          .select()
          .eq('id', 1)
          .maybeSingle();
      final phone = (settings?['dispatcher_phone'] as String?)?.trim();
      dispatcherPhone = phone == null || phone.isEmpty ? null : phone;

      final vehicleRow = await _db
          .from('vehicles')
          .select()
          .eq('driver_id', uid)
          .eq('is_active', true)
          .maybeSingle();
      if (_disposed) return;

      if (vehicleRow == null) {
        if (vehicle != null && _hasBaseline) {
          _announce(['Вас сняли с машины ${vehicle!.name}']);
        }
        vehicle = null;
        trips = [];
        offline = false;
        _hasBaseline = true;
        stage = Stage.noVehicle;
        _unsubscribe();
        location.stop();
        _changed();
        _saveCache(uid);
        return;
      }

      final rows = await _db
          .from('trips')
          .select('*, client:clients(*)')
          .eq('vehicle_id', vehicleRow['id'] as String)
          .gte('trip_date', isoDay(0))
          .lte('trip_date', isoDay(1))
          .order('trip_date', ascending: true)
          .order('pickup_time', ascending: true)
          .order(
            'direction',
            ascending: false,
          ); // при равном времени «туда» раньше
      if (_disposed) return;

      final fresh = [for (final r in rows) Trip(Map<String, dynamic>.from(r))];
      final sameVehicle = vehicle?.id == vehicleRow['id'];
      final lines = <String>[];
      if (_hasBaseline) {
        if (sameVehicle) {
          lines.addAll(_diff(trips, fresh));
        } else {
          lines.add('Вам назначена машина ${Vehicle(vehicleRow).name}');
        }
      }

      vehicle = Vehicle(vehicleRow);
      trips = fresh;
      offline = false;
      loadedAt = DateTime.now();
      _hasBaseline = true;
      stage = Stage.ready;
      _subscribe(vehicle!.id);
      _changed();
      _announce(lines);
      location.recheck();
      _saveCache(uid);
    } catch (e) {
      debugPrint('Ошибка загрузки: $e');
      if (_disposed) return;
      if (stage == Stage.loading || stage == Stage.failed) {
        stage = Stage.failed;
      } else {
        offline = true;
      }
      _changed();
    }
  }

  /// Что изменилось по сравнению с прошлым списком — строки для водителя.
  List<String> _diff(List<Trip> before, List<Trip> after) {
    final today = isoDay(0);
    final window = {today, isoDay(1)};
    final old = {for (final t in before) t.id: t};
    final nowIds = {for (final t in after) t.id};
    final lines = <String>[];

    String title(Trip t) =>
        t.date == today ? t.shortTitle : 'завтра ${t.shortTitle}';

    for (final t in after) {
      if (!t.needsAck) continue;
      final prev = old[t.id];
      if (prev == null) {
        if (t.status != TripStatus.cancelled) {
          lines.add('Новый заказ: ${title(t)}');
        }
      } else if (prev.changedAt != t.changedAt) {
        final cancelledNow =
            t.status == TripStatus.cancelled &&
            prev.status != TripStatus.cancelled;
        lines.add(
          cancelledNow
              ? 'Заказ отменён: ${title(t)}'
              : 'Заказ изменён: ${title(t)}',
        );
      }
    }
    for (final t in before) {
      if (!nowIds.contains(t.id) &&
          window.contains(t.date) &&
          !t.status.isFinal) {
        lines.add('Заказ ${title(t)} снят с вашей машины');
      }
    }
    return lines;
  }

  void _announce(List<String> lines) {
    if (lines.isEmpty) return;
    notices = [...lines, ...notices].take(8).toList();
    _changed();
    Notify.changes(lines);
  }

  void dismissNotices() {
    notices = [];
    _changed();
  }

  // ───────────── действия водителя ─────────────

  /// Сменить статус. Возвращает текст ошибки или null.
  Future<String?> setStatus(
    Trip trip,
    TripStatus status, {
    String? reason,
  }) async {
    try {
      final row = await _db.rpc(
        'driver_set_status',
        params: {
          'p_trip': trip.id,
          'p_status': status.code,
          'p_reason': reason,
        },
      );
      final current = tripById(trip.id) ?? trip;
      _replace(current.merged(Map<String, dynamic>.from(row as Map)));
      return null;
    } on PostgrestException catch (e) {
      refresh(); // заказ могли отменить или передать — покажем актуальное
      return e.message;
    } catch (e) {
      debugPrint('Ошибка смены статуса: $e');
      return networkError;
    }
  }

  /// «Принял»: водитель видел новый/изменённый заказ.
  Future<String?> ack(List<String> ids) async {
    if (ids.isEmpty) return null;
    try {
      await _db.rpc('driver_ack', params: {'p_trips': ids});
      final now = DateTime.now().toUtc().toIso8601String();
      trips = [
        for (final t in trips)
          ids.contains(t.id) ? t.merged({'driver_seen_at': now}) : t,
      ];
      _changed();
      refresh();
      return null;
    } on PostgrestException catch (e) {
      return e.message;
    } catch (e) {
      debugPrint('Ошибка подтверждения: $e');
      return networkError;
    }
  }

  void _replace(Trip updated) {
    trips = [for (final t in trips) t.id == updated.id ? updated : t];
    _changed();
    final uid = _db.auth.currentUser?.id;
    if (uid != null) _saveCache(uid);
  }

  // ───────────── realtime ─────────────

  void _subscribe(String vehicleId) {
    if (_channelVehicleId == vehicleId) return;
    _unsubscribe();
    _channelVehicleId = vehicleId;
    _channel = _db
        .channel('driver-$vehicleId')
        .onPostgresChanges(
          event: PostgresChangeEvent.all,
          schema: 'public',
          table: 'vehicle_feed',
          filter: PostgresChangeFilter(
            type: PostgresChangeFilterType.eq,
            column: 'vehicle_id',
            value: vehicleId,
          ),
          callback: (_) => refresh(),
        )
        .onPostgresChanges(
          event: PostgresChangeEvent.all,
          schema: 'public',
          table: 'vehicles',
          callback: (_) => refresh(),
        )
        .subscribe();
  }

  void _unsubscribe() {
    final channel = _channel;
    _channel = null;
    _channelVehicleId = null;
    if (channel != null) _db.removeChannel(channel);
  }

  // ───────────── кэш ─────────────

  Future<void> _saveCache(String uid) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        _cacheKey,
        jsonEncode({
          'uid': uid,
          'at': (loadedAt ?? DateTime.now()).toIso8601String(),
          'driver_name': driverName,
          'dispatcher_phone': dispatcherPhone,
          'vehicle': vehicle?.raw,
          'trips': [for (final t in trips) t.raw],
        }),
      );
    } catch (e) {
      debugPrint('Не удалось сохранить кэш: $e');
    }
  }

  Future<void> _restoreCache() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final text = prefs.getString(_cacheKey);
      if (text == null) return;
      final data = jsonDecode(text) as Map<String, dynamic>;
      if (data['uid'] != _db.auth.currentUser?.id) return;
      final vehicleRaw = data['vehicle'] as Map<String, dynamic>?;
      if (vehicleRaw == null) return;
      vehicle = Vehicle(vehicleRaw);
      driverName = data['driver_name'] as String?;
      dispatcherPhone = data['dispatcher_phone'] as String?;
      trips = [
        for (final r in data['trips'] as List)
          Trip(Map<String, dynamic>.from(r as Map)),
      ];
      loadedAt = DateTime.tryParse(data['at'] as String? ?? '');
      stage = Stage.ready;
      _changed();
    } catch (e) {
      debugPrint('Не удалось прочитать кэш: $e');
    }
  }
}
