import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'app_state.dart';
import 'notify.dart';
import 'screens/home_screen.dart';
import 'screens/login_screen.dart';
import 'screens/status_screens.dart';
import 'server.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initializeDateFormatting('ru');
  await Server.init();
  await Notify.init();
  runApp(const DriverApp());
}

class DriverApp extends StatelessWidget {
  const DriverApp({super.key});

  @override
  Widget build(BuildContext context) {
    final scheme = ColorScheme.fromSeed(
      seedColor: const Color(0xFF0D5C8C),
      brightness: Brightness.light,
    ).copyWith(primary: const Color(0xFF0D5C8C));
    final base = ThemeData(colorScheme: scheme, useMaterial3: true);
    final buttonShape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(14),
    );
    const buttonText = TextStyle(fontSize: 18, fontWeight: FontWeight.w700);

    return MaterialApp(
      title: 'Соцтакси Водитель',
      debugShowCheckedModeBanner: false,
      locale: const Locale('ru'),
      supportedLocales: const [Locale('ru')],
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      theme: base.copyWith(
        scaffoldBackgroundColor: const Color(0xFFF1F3F6),
        textTheme: base.textTheme.apply(
          fontSizeFactor: 1.1,
          bodyColor: const Color(0xFF14181F),
          displayColor: const Color(0xFF14181F),
        ),
        appBarTheme: AppBarTheme(
          backgroundColor: scheme.primary,
          foregroundColor: scheme.onPrimary,
          centerTitle: false,
        ),
        filledButtonTheme: FilledButtonThemeData(
          style: FilledButton.styleFrom(
            minimumSize: const Size(64, 56),
            textStyle: buttonText,
            shape: buttonShape,
          ),
        ),
        outlinedButtonTheme: OutlinedButtonThemeData(
          style: OutlinedButton.styleFrom(
            minimumSize: const Size(64, 52),
            textStyle: buttonText.copyWith(fontSize: 17),
            shape: buttonShape,
            side: BorderSide(color: scheme.outline),
          ),
        ),
        textButtonTheme: TextButtonThemeData(
          style: TextButton.styleFrom(
            minimumSize: const Size(64, 48),
            textStyle: buttonText.copyWith(fontSize: 16),
          ),
        ),
        inputDecorationTheme: const InputDecorationTheme(
          border: OutlineInputBorder(),
          filled: true,
          fillColor: Colors.white,
        ),
        cardTheme: CardThemeData(
          color: Colors.white,
          elevation: 0,
          margin: EdgeInsets.zero,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
        ),
      ),
      // При переключении боевой ↔ демо клиент сервера создаётся заново —
      // вместе с ним заново строим и экраны.
      home: ValueListenableBuilder<int>(
        valueListenable: Server.revision,
        builder: (context, revision, _) => AuthGate(key: ValueKey(revision)),
      ),
    );
  }
}

/// Решает, какой экран показать: вход, заказы или служебное сообщение.
class AuthGate extends StatefulWidget {
  const AuthGate({super.key});

  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> {
  final _auth = Supabase.instance.client.auth;
  StreamSubscription<AuthState>? _sub;
  AppState? _state;
  String? _userId;
  String? _loginMessage;

  @override
  void initState() {
    super.initState();
    _apply(_auth.currentSession, initial: true);
    _sub = _auth.onAuthStateChange.listen((data) => _apply(data.session));
  }

  void _apply(Session? session, {bool initial = false}) {
    final uid = session?.user.id;
    if (uid == _userId) return;
    _state?.removeListener(_onState);
    _state?.dispose();
    _state = null;
    _userId = uid;
    if (uid != null) {
      _loginMessage = null;
      _state = AppState()
        ..addListener(_onState)
        ..start();
    }
    if (mounted && !initial) {
      // Экран поездки мог остаться поверх — возвращаемся к корню.
      Navigator.of(context).popUntil((route) => route.isFirst);
      setState(() {});
    }
  }

  void _onState() {
    final state = _state;
    if (state != null && state.stage == Stage.notDriver) {
      _loginMessage =
          'Приложение только для водителей. '
          'Диспетчеры работают на сайте.';
      state.signOut();
    }
  }

  @override
  void dispose() {
    _sub?.cancel();
    _state?.removeListener(_onState);
    _state?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = _state;
    if (state == null) return LoginScreen(message: _loginMessage);
    return ListenableBuilder(
      listenable: state,
      builder: (context, _) => switch (state.stage) {
        Stage.loading || Stage.notDriver => const LoadingScreen(),
        Stage.failed => FailedScreen(state: state),
        Stage.noVehicle => NoVehicleScreen(state: state),
        Stage.ready => HomeScreen(state: state),
      },
    );
  }
}
