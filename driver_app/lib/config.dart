import 'package:flutter/foundation.dart';

/// Адрес и ключ сервера.
///
/// Для боевой сборки значения передаются при сборке:
///   flutter build apk --dart-define-from-file=env.json
/// (образец — env.example.json). Без них приложение ходит на локальный Supabase.
class Config {
  static const _url = String.fromEnvironment('SUPABASE_URL');
  static const _anonKey = String.fromEnvironment('SUPABASE_ANON_KEY');

  /// Порт локального стека — см. supabase/config.toml.
  static const _localPort = 56421;

  /// Общеизвестный демо-ключ локального Supabase (одинаков на всех машинах,
  /// в облаке не действует).
  static const _localAnonKey =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

  static String get supabaseUrl {
    if (_url.isNotEmpty) return _url;
    // Из Android-эмулятора компьютер разработчика доступен как 10.0.2.2.
    final host = !kIsWeb && defaultTargetPlatform == TargetPlatform.android
        ? '10.0.2.2'
        : '127.0.0.1';
    return 'http://$host:$_localPort';
  }

  static String get supabaseAnonKey =>
      _anonKey.isNotEmpty ? _anonKey : _localAnonKey;

  /// Демо-база (вымышленные данные) — кнопка «Демо-режим» на экране входа.
  /// Если адрес не задан при сборке, кнопки нет.
  static const demoUrl = String.fromEnvironment('DEMO_SUPABASE_URL');
  static const demoAnonKey = String.fromEnvironment('DEMO_SUPABASE_ANON_KEY');

  /// Общеизвестная учётная запись демо-водителя («Машина 1»).
  static const demoLogin = 'driver1';
  static const demoPassword = 'demo-2026';

  /// Логин превращается в служебный e-mail — так же, как на сайте диспетчера.
  static const emailDomain = 'soctaxi.local';

  /// Как часто перечитывать заказы, даже если Realtime молчит.
  static const pollInterval = Duration(seconds: 45);
}
