import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../config.dart';
import '../server.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, this.message});

  /// Пояснение, почему пользователя вернули на вход.
  final String? message;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _login = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  bool _hidden = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    // Экран входа при включённом демо значит, что демо-сессия закончилась:
    // возвращаемся к обычному входу.
    if (Server.demo) {
      WidgetsBinding.instance.addPostFrameCallback((_) => Server.exitDemo());
    }
  }

  Future<void> _enterDemo() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await Server.enterDemo();
      // Дальше экран сменит AuthGate.
    } catch (_) {
      _fail('Не удалось войти в демо-режим. Проверьте интернет.');
    }
  }

  @override
  void dispose() {
    _login.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final login = _login.text.trim().toLowerCase();
    final password = _password.text;
    if (login.isEmpty || password.isEmpty) {
      setState(() => _error = 'Введите логин и пароль');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await Supabase.instance.client.auth.signInWithPassword(
        email: '$login@${Config.emailDomain}',
        password: password,
      );
      // Дальше экран сменит AuthGate.
    } on AuthApiException catch (e) {
      _fail(
        e.code == 'user_banned'
            ? 'Учётная запись отключена. Обратитесь к диспетчеру.'
            : 'Неверный логин или пароль',
      );
    } catch (_) {
      _fail('Нет связи с сервером. Проверьте интернет.');
    }
  }

  void _fail(String text) {
    if (!mounted) return;
    setState(() {
      _busy = false;
      _error = text;
    });
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final notice = _error ?? widget.message;

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: AutofillGroup(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Icon(
                      Icons.accessible_forward,
                      size: 72,
                      color: scheme.primary,
                    ),
                    const SizedBox(height: 12),
                    const Text(
                      'Социальное такси',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 28,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Вход для водителей',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 18,
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(height: 28),
                    TextField(
                      controller: _login,
                      enabled: !_busy,
                      autocorrect: false,
                      enableSuggestions: false,
                      textInputAction: TextInputAction.next,
                      autofillHints: const [AutofillHints.username],
                      style: const TextStyle(fontSize: 20),
                      decoration: const InputDecoration(
                        labelText: 'Логин',
                        prefixIcon: Icon(Icons.person),
                      ),
                    ),
                    const SizedBox(height: 14),
                    TextField(
                      controller: _password,
                      enabled: !_busy,
                      obscureText: _hidden,
                      textInputAction: TextInputAction.done,
                      autofillHints: const [AutofillHints.password],
                      onSubmitted: (_) => _submit(),
                      style: const TextStyle(fontSize: 20),
                      decoration: InputDecoration(
                        labelText: 'Пароль',
                        prefixIcon: const Icon(Icons.lock),
                        suffixIcon: IconButton(
                          tooltip: _hidden
                              ? 'Показать пароль'
                              : 'Скрыть пароль',
                          icon: Icon(
                            _hidden ? Icons.visibility : Icons.visibility_off,
                          ),
                          onPressed: () => setState(() => _hidden = !_hidden),
                        ),
                      ),
                    ),
                    if (notice != null) ...[
                      const SizedBox(height: 14),
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: scheme.errorContainer,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Text(
                          notice,
                          style: TextStyle(
                            fontSize: 17,
                            color: scheme.onErrorContainer,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ],
                    const SizedBox(height: 20),
                    FilledButton(
                      onPressed: _busy ? null : _submit,
                      style: FilledButton.styleFrom(
                        minimumSize: const Size(64, 60),
                      ),
                      child: _busy
                          ? const SizedBox(
                              width: 26,
                              height: 26,
                              child: CircularProgressIndicator(strokeWidth: 3),
                            )
                          : const Text('Войти'),
                    ),
                    const SizedBox(height: 16),
                    Text(
                      'Логин и пароль выдаёт диспетчер.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 15,
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                    if (Server.demoAvailable) ...[
                      const SizedBox(height: 28),
                      const Divider(),
                      const SizedBox(height: 12),
                      OutlinedButton.icon(
                        onPressed: _busy ? null : _enterDemo,
                        icon: const Icon(Icons.science_outlined),
                        label: const Text('Демо-режим'),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        'Посмотреть приложение на вымышленных заказах — без пароля.',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 14,
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
