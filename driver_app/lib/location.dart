import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// Почему координаты сейчас не передаются.
enum LocationIssue {
  none,
  serviceOff, // геолокация выключена на телефоне
  denied, // разрешение не дано (можно спросить)
  deniedForever, // разрешение запрещено — только через настройки
  failed, // не удалось запустить (например, из фона) — попробуем ещё раз
}

/// Передача положения машины диспетчеру, пока водитель «на линии».
///
/// На Android поток координат идёт через foreground-сервис geolocator
/// (постоянное уведомление «вы на линии»), поэтому работает и при свёрнутом
/// приложении. Фоновое разрешение (ACCESS_BACKGROUND_LOCATION) не нужно.
class LocationTracker extends ChangeNotifier {
  static const _prefKey = 'on_duty';
  static const _minGap = Duration(seconds: 10); // не чаще
  static const _maxGap = Duration(seconds: 30); // не реже

  final SupabaseClient _db = Supabase.instance.client;

  /// Водитель хочет быть на линии (переключатель).
  bool onDuty = true;
  LocationIssue issue = LocationIssue.none;

  /// Поток координат запущен.
  bool get tracking => _sub != null;

  /// Когда координаты последний раз дошли до сервера.
  DateTime? lastSentAt;

  StreamSubscription<Position>? _sub;
  Timer? _ticker;
  Position? _last;
  bool _dirty = false;
  bool _sending = false;
  bool _starting = false;
  bool _disposed = false;

  Future<void> restore() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      onDuty = prefs.getBool(_prefKey) ?? true;
    } catch (_) {}
  }

  Future<void> _remember() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(_prefKey, onDuty);
    } catch (_) {}
  }

  void _changed() {
    if (!_disposed) notifyListeners();
  }

  /// Переключатель «На линии».
  Future<void> setOnDuty(bool value, {bool ask = true}) async {
    onDuty = value;
    _changed();
    await _remember();
    if (value) {
      await start(ask: ask);
    } else {
      await stop(reportOffDuty: true);
    }
  }

  /// Запустить передачу. [ask] — можно ли показывать системный запрос
  /// разрешения (перед ним экран сам объясняет, зачем оно нужно).
  Future<void> start({bool ask = false}) async {
    if (_disposed || !onDuty || tracking || _starting) return;
    _starting = true;
    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        _setIssue(LocationIssue.serviceOff);
        return;
      }
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied && ask) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied) {
        _setIssue(LocationIssue.denied);
        return;
      }
      if (permission == LocationPermission.deniedForever) {
        _setIssue(LocationIssue.deniedForever);
        return;
      }
      if (_disposed || !onDuty) return;

      final LocationSettings settings =
          !kIsWeb && defaultTargetPlatform == TargetPlatform.android
          ? AndroidSettings(
              accuracy: LocationAccuracy.high,
              distanceFilter: 30,
              intervalDuration: _minGap,
              foregroundNotificationConfig: const ForegroundNotificationConfig(
                notificationTitle: 'Соцтакси: вы на линии',
                notificationText: 'Диспетчер видит положение машины',
                notificationChannelName: 'Передача местоположения',
                enableWakeLock: true,
                setOngoing: true,
              ),
            )
          : const LocationSettings(
              accuracy: LocationAccuracy.high,
              distanceFilter: 30,
            );

      _sub = Geolocator.getPositionStream(locationSettings: settings).listen(
        _onPosition,
        onError: (Object e) {
          debugPrint('Геолокация: $e');
          _stopStream();
          // Чаще всего — отозвали разрешение или выключили GPS.
          recheck();
        },
      );
      _ticker = Timer.periodic(const Duration(seconds: 5), (_) => _tick());
      _setIssue(LocationIssue.none);
    } catch (e) {
      debugPrint('Не удалось запустить геолокацию: $e');
      _stopStream();
      _setIssue(LocationIssue.failed);
    } finally {
      _starting = false;
    }
  }

  /// Остановить передачу. [reportOffDuty] — сообщить диспетчеру «не на линии».
  Future<void> stop({bool reportOffDuty = false}) async {
    _stopStream();
    issue = LocationIssue.none;
    _changed();
    if (reportOffDuty) {
      try {
        await _db.rpc('driver_set_off_duty');
      } catch (e) {
        debugPrint('Не удалось отметить «не на линии»: $e');
      }
    }
  }

  /// Разрешение или GPS могли включить в настройках — попробовать ещё раз
  /// (без системного диалога).
  Future<void> recheck() async {
    if (onDuty && !tracking) await start();
  }

  /// Кнопка «Включить» в строке «Местоположение не передаётся».
  /// Возвращает false, если нужно сначала показать объяснение и вызвать
  /// [start] с ask: true.
  Future<bool> openFix() async {
    try {
      switch (issue) {
        case LocationIssue.serviceOff:
          await Geolocator.openLocationSettings();
          return true;
        case LocationIssue.deniedForever:
          await Geolocator.openAppSettings();
          return true;
        case LocationIssue.failed:
          await start(ask: true);
          return true;
        case LocationIssue.denied:
        case LocationIssue.none:
          return false;
      }
    } catch (e) {
      debugPrint('Не удалось открыть настройки: $e');
      return true;
    }
  }

  void _setIssue(LocationIssue value) {
    if (issue == value) {
      _changed();
      return;
    }
    issue = value;
    _changed();
  }

  void _stopStream() {
    _sub?.cancel();
    _sub = null;
    _ticker?.cancel();
    _ticker = null;
    _last = null;
    _dirty = false;
  }

  void _onPosition(Position position) {
    _last = position;
    _dirty = true;
    _tick();
  }

  /// Новая точка уходит не чаще раза в 10 с; если машина стоит —
  /// последняя точка повторяется раз в 30 с, чтобы диспетчер видел «на связи».
  void _tick() {
    final position = _last;
    if (position == null || _sending) return;
    final sent = lastSentAt;
    final age = sent == null ? _maxGap : DateTime.now().difference(sent);
    if ((_dirty && age >= _minGap) || age >= _maxGap) _send(position);
  }

  Future<void> _send(Position p) async {
    _sending = true;
    _dirty = false;
    try {
      await _db.rpc(
        'driver_report_location',
        params: {
          'p_lat': p.latitude,
          'p_lng': p.longitude,
          'p_accuracy': _finite(p.accuracy),
          'p_speed': _finite(p.speed),
          'p_heading': _finite(p.heading),
        },
      );
      lastSentAt = DateTime.now();
    } catch (e) {
      // Молча: следующая попытка — через несколько секунд.
      debugPrint('Координаты не отправлены: $e');
      _dirty = true;
    } finally {
      _sending = false;
    }
  }

  static double? _finite(double value) => value.isFinite ? value : null;

  @override
  void dispose() {
    _disposed = true;
    _stopStream();
    super.dispose();
  }
}
