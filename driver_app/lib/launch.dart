import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

/// Открыть набор номера.
Future<void> callPhone(BuildContext context, String phone) async {
  final number = phone.replaceAll(RegExp(r'[^0-9+]'), '');
  final messenger = ScaffoldMessenger.of(context);
  var ok = false;
  try {
    ok = await launchUrl(Uri(scheme: 'tel', path: number));
  } catch (_) {}
  if (!ok) {
    messenger.showSnackBar(
      SnackBar(content: Text('Не удалось открыть звонок. Номер: $phone')),
    );
  }
}

/// Открыть адрес в навигаторе: сначала любое установленное приложение карт,
/// если его нет — Яндекс Карты в браузере.
Future<void> openRoute(BuildContext context, String address) async {
  final messenger = ScaffoldMessenger.of(context);
  final query = Uri.encodeComponent(address);
  if (!kIsWeb) {
    try {
      if (await launchUrl(Uri.parse('geo:0,0?q=$query'))) return;
    } catch (_) {}
  }
  var ok = false;
  try {
    ok = await launchUrl(
      Uri.parse('https://yandex.ru/maps/?text=$query'),
      mode: LaunchMode.externalApplication,
    );
  } catch (_) {}
  if (!ok) {
    messenger.showSnackBar(
      const SnackBar(content: Text('Не удалось открыть карту')),
    );
  }
}
