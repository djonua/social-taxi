import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

/// Локальные уведомления об изменениях в заказах (звук + вибрация).
/// В браузере (отладочная сборка) ничего не делает.
class Notify {
  static final _plugin = FlutterLocalNotificationsPlugin();
  static bool _ready = false;

  static Future<void> init() async {
    if (kIsWeb || _ready) return;
    try {
      await _plugin.initialize(
        settings: const InitializationSettings(
          android: AndroidInitializationSettings('@mipmap/ic_launcher'),
        ),
      );
      _ready = true;
    } catch (e) {
      debugPrint('Уведомления недоступны: $e');
    }
  }

  /// Android 13+: спросить разрешение на показ уведомлений.
  static Future<void> requestPermission() async {
    if (kIsWeb || !_ready) return;
    try {
      await _plugin
          .resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin
          >()
          ?.requestNotificationsPermission();
    } catch (e) {
      debugPrint('Не удалось запросить разрешение на уведомления: $e');
    }
  }

  static Future<void> changes(List<String> lines) async {
    if (lines.isEmpty) return;
    HapticFeedback.heavyImpact();
    if (kIsWeb || !_ready) return;
    final body = lines.join('\n');
    try {
      await _plugin.show(
        id: DateTime.now().millisecondsSinceEpoch.remainder(1 << 31),
        title: 'Изменения в заказах',
        body: body,
        notificationDetails: NotificationDetails(
          android: AndroidNotificationDetails(
            'trip_changes',
            'Изменения в заказах',
            channelDescription:
                'Новые, изменённые и отменённые диспетчером заказы',
            importance: Importance.max,
            priority: Priority.high,
            category: AndroidNotificationCategory.message,
            styleInformation: BigTextStyleInformation(body),
          ),
        ),
      );
    } catch (e) {
      debugPrint('Не удалось показать уведомление: $e');
    }
  }
}
