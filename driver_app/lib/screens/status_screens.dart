import 'package:flutter/material.dart';

import '../app_state.dart';
import '../launch.dart';

class LoadingScreen extends StatelessWidget {
  const LoadingScreen({super.key});

  @override
  Widget build(BuildContext context) =>
      const Scaffold(body: Center(child: CircularProgressIndicator()));
}

/// Первый запуск без связи: показать нечего.
class FailedScreen extends StatelessWidget {
  const FailedScreen({super.key, required this.state});

  final AppState state;

  @override
  Widget build(BuildContext context) => _MessageScreen(
    icon: Icons.wifi_off,
    title: 'Нет связи с сервером',
    text: 'Проверьте интернет и попробуйте ещё раз.',
    actions: [
      FilledButton.icon(
        onPressed: state.refresh,
        icon: const Icon(Icons.refresh),
        label: const Text('Повторить'),
      ),
      TextButton(onPressed: state.signOut, child: const Text('Выйти')),
    ],
  );
}

class NoVehicleScreen extends StatelessWidget {
  const NoVehicleScreen({super.key, required this.state});

  final AppState state;

  @override
  Widget build(BuildContext context) {
    final phone = state.dispatcherPhone;
    return _MessageScreen(
      icon: Icons.no_transfer,
      title: 'За вами не закреплена машина',
      text:
          'Заказы появятся, когда диспетчер назначит вас на машину. '
          'Экран обновится сам.',
      actions: [
        if (phone != null)
          FilledButton.icon(
            onPressed: () => callPhone(context, phone),
            icon: const Icon(Icons.phone),
            label: const Text('Позвонить диспетчеру'),
          ),
        OutlinedButton.icon(
          onPressed: state.refresh,
          icon: const Icon(Icons.refresh),
          label: const Text('Обновить'),
        ),
        TextButton(onPressed: state.signOut, child: const Text('Выйти')),
      ],
    );
  }
}

class _MessageScreen extends StatelessWidget {
  const _MessageScreen({
    required this.icon,
    required this.title,
    required this.text,
    required this.actions,
  });

  final IconData icon;
  final String title;
  final String text;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Icon(icon, size: 72, color: scheme.onSurfaceVariant),
                  const SizedBox(height: 16),
                  Text(
                    title,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: 24,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    text,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 18,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(height: 24),
                  for (final action in actions) ...[
                    action,
                    const SizedBox(height: 10),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
