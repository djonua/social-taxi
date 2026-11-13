import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'config.dart';

/// С каким сервером работает приложение: боевым или демо.
///
/// Демо — отдельная база с вымышленными клиентами и заказами: в неё входят одной
/// кнопкой с экрана входа, чтобы показать приложение, не трогая настоящие данные.
class Server {
  static const _prefKey = 'demo_mode';

  static bool _demo = false;
  static bool _switching = false;

  /// Сейчас подключена демо-база.
  static bool get demo => _demo;

  /// Демо-база задана при сборке (см. env.example.json).
  static bool get demoAvailable =>
      Config.demoUrl.isNotEmpty && Config.demoAnonKey.isNotEmpty;

  /// Растёт при каждом переподключении — по нему заново строятся экраны.
  static final revision = ValueNotifier<int>(0);

  static Future<void> init() async {
    final prefs = await SharedPreferences.getInstance();
    _demo = demoAvailable && (prefs.getBool(_prefKey) ?? false);
    await _connect();
  }

  static Future<void> _connect() => Supabase.initialize(
    url: _demo ? Config.demoUrl : Config.supabaseUrl,
    publishableKey: _demo ? Config.demoAnonKey : Config.supabaseAnonKey,
    // Соединение Realtime не рвём при сворачивании: пока водитель на линии,
    // приложение живёт в фоне и должно получать изменения заказов.
    realtimeLifecycleOptions: const RealtimeLifecycleOptions.manual(),
  );

  static Future<void> _switch(bool demo) async {
    try {
      await Supabase.instance.client.auth.signOut(scope: SignOutScope.local);
    } catch (_) {
      // сессии могло и не быть
    }
    await Supabase.instance.dispose();
    _demo = demo;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_prefKey, demo);
    await _connect();
  }

  /// Переключиться на демо-базу и войти демо-водителем. При ошибке возвращает
  /// приложение к боевому серверу и пробрасывает её дальше.
  static Future<void> enterDemo() async {
    if (_switching || !demoAvailable) return;
    _switching = true;
    try {
      await _switch(true);
      try {
        await Supabase.instance.client.auth.signInWithPassword(
          email: '${Config.demoLogin}@${Config.emailDomain}',
          password: Config.demoPassword,
        );
      } catch (_) {
        await _switch(false);
        rethrow;
      }
    } finally {
      _switching = false;
      revision.value++;
    }
  }

  /// Вернуться к боевому серверу (на экран входа).
  static Future<void> exitDemo() async {
    if (_switching || !_demo) return;
    _switching = true;
    try {
      await _switch(false);
    } finally {
      _switching = false;
      revision.value++;
    }
  }
}
