import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../app_state.dart';
import '../launch.dart';
import '../models.dart';
import '../widgets/trip_card.dart';

const _cancelReasons = [
  'Клиент не вышел',
  'Клиент отказался от поездки',
  'Не дозвонился',
];

class TripScreen extends StatefulWidget {
  const TripScreen({super.key, required this.state, required this.tripId});

  final AppState state;
  final String tripId;

  @override
  State<TripScreen> createState() => _TripScreenState();
}

class _TripScreenState extends State<TripScreen> {
  bool _busy = false;
  bool _closing = false;

  AppState get state => widget.state;

  @override
  void initState() {
    super.initState();
    state.addListener(_onState);
    // Открыл заказ — значит, видел.
    final trip = state.tripById(widget.tripId);
    if (trip != null && trip.needsAck) state.ack([trip.id]);
  }

  @override
  void dispose() {
    state.removeListener(_onState);
    super.dispose();
  }

  void _onState() {
    if (!mounted || _closing) return;
    if (state.tripById(widget.tripId) == null) {
      // Заказ сняли с машины, пока экран был открыт.
      _closing = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) Navigator.of(context).maybePop();
      });
    } else {
      setState(() {});
    }
  }

  // ───────────── действия ─────────────

  Future<void> _setStatus(TripStatus status, {String? reason}) async {
    final trip = state.tripById(widget.tripId);
    if (trip == null || _busy) return;
    setState(() => _busy = true);
    final error = await state.setStatus(trip, status, reason: reason);
    if (!mounted) return;
    setState(() => _busy = false);
    final messenger = ScaffoldMessenger.of(context)..hideCurrentSnackBar();
    if (error != null) {
      messenger.showSnackBar(
        SnackBar(
          duration: const Duration(seconds: 10),
          persist: false,
          content: Text(error, style: const TextStyle(fontSize: 17)),
          action: SnackBarAction(
            label: 'Повторить',
            onPressed: () => _setStatus(status, reason: reason),
          ),
        ),
      );
    }
  }

  Future<void> _advance(Trip trip) async {
    final next = trip.status.next;
    if (next == null) return;
    if (trip.status == TripStatus.planned && trip.date != AppState.isoDay(0)) {
      final ok = await _confirm(
        title: 'Поездка не на сегодня',
        text: 'Эта поездка запланирована на завтра. Всё равно начать?',
        action: 'Начать',
      );
      if (!ok) return;
    }
    await _setStatus(next);
  }

  Future<void> _undo(Trip trip) async {
    final previous = trip.status.previous;
    if (previous == null) return;
    final ok = await _confirm(
      title: 'Вернуть предыдущий статус?',
      text: 'Статус снова станет «${previous.label}».',
      action: 'Вернуть',
    );
    if (ok) await _setStatus(previous);
  }

  Future<void> _cancel() async {
    final reason = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) => const _CancelSheet(),
    );
    if (reason != null) await _setStatus(TripStatus.cancelled, reason: reason);
  }

  Future<bool> _confirm({
    required String title,
    required String text,
    required String action,
  }) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: Text(text, style: const TextStyle(fontSize: 18)),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Отмена'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(action),
          ),
        ],
      ),
    );
    return ok == true;
  }

  // ───────────── экран ─────────────

  @override
  Widget build(BuildContext context) {
    final trip = state.tripById(widget.tripId);
    if (trip == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Заказ')),
        body: const Center(
          child: Padding(
            padding: EdgeInsets.all(24),
            child: Text(
              'Заказ снят с вашей машины',
              style: TextStyle(fontSize: 20),
            ),
          ),
        ),
      );
    }

    final status = trip.status;
    final client = trip.client;
    final pair = state.pairOf(trip);
    final isToday = trip.date == AppState.isoDay(0);
    final dayLabel = isToday
        ? 'сегодня'
        : 'завтра, ${DateFormat('d MMMM', 'ru').format(DateTime.parse(trip.date))}';

    return Scaffold(
      appBar: AppBar(
        title: Text(
          '${trip.directionLabel} · $dayLabel',
          style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
        ),
      ),
      bottomNavigationBar: _bottomBar(trip),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(12, 12, 12, 24),
        children: [
          if (trip.needsAck) ...[
            _AckStrip(trip: trip, onAck: () => state.ack([trip.id])),
            const SizedBox(height: 10),
          ],

          // Время и статус
          _Section(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Wrap: на узком экране статус переносится под время, а не наезжает.
                SizedBox(
                  width: double.infinity,
                  child: Wrap(
                    alignment: WrapAlignment.spaceBetween,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    spacing: 10,
                    runSpacing: 8,
                    children: [
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            trip.pickupTime,
                            style: const TextStyle(
                              fontSize: 52,
                              height: 1,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          const SizedBox(width: 10),
                          const Text(
                            'подача',
                            style: TextStyle(
                              fontSize: 16,
                              color: Colors.black54,
                            ),
                          ),
                        ],
                      ),
                      StatusChip(status, large: true),
                    ],
                  ),
                ),
                if (trip.arriveBy != null) ...[
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      const Icon(Icons.alarm, color: Color(0xFFC62828)),
                      const SizedBox(width: 8),
                      Text(
                        'Быть на месте к ${trip.arriveBy}',
                        style: const TextStyle(
                          fontSize: 21,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ],
                  ),
                ],
                if (pair != null) ...[
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      const Icon(Icons.sync_alt, color: Colors.black54),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          '${pair.directionLabel} в ${pair.pickupTime}'
                          '${pair.status == TripStatus.cancelled ? ' (отменено)' : ''}',
                          style: const TextStyle(
                            fontSize: 17,
                            color: Colors.black87,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
                if (status == TripStatus.cancelled) ...[
                  const SizedBox(height: 10),
                  Text(
                    'Отменён${trip.cancelReason == null ? '' : ': ${trip.cancelReason}'}',
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                      color: Color(0xFFC62828),
                    ),
                  ),
                ],
              ],
            ),
          ),

          // Комментарий диспетчера
          if (trip.note != null) ...[
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: const Color(0xFFFFF3CD),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: const Color(0xFFE0B400), width: 2),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const _Label(
                    'Комментарий диспетчера',
                    icon: Icons.sticky_note_2,
                  ),
                  const SizedBox(height: 4),
                  Text(
                    trip.note!,
                    style: const TextStyle(
                      fontSize: 19,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
          ],

          // Клиент
          const SizedBox(height: 10),
          _Section(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const _Label('Клиент', icon: Icons.person),
                const SizedBox(height: 4),
                Text(
                  client.fullName,
                  style: const TextStyle(
                    fontSize: 23,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 8),
                Wrap(spacing: 6, runSpacing: 6, children: clientTags(trip)),
                if (client.diagnosis != null) ...[
                  const SizedBox(height: 12),
                  const _Label('Диагноз'),
                  Text(client.diagnosis!, style: const TextStyle(fontSize: 19)),
                ],
                if (client.notes != null) ...[
                  const SizedBox(height: 12),
                  const _Label('Важно знать'),
                  Text(client.notes!, style: const TextStyle(fontSize: 19)),
                ],
                const SizedBox(height: 14),
                if (client.phone != null)
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: () => callPhone(context, client.phone!),
                      style: FilledButton.styleFrom(
                        backgroundColor: const Color(0xFF2E7D32),
                      ),
                      icon: const Icon(Icons.phone),
                      label: Text('Позвонить  ${client.phone}'),
                    ),
                  )
                else
                  const Text(
                    'Телефон клиента не указан',
                    style: TextStyle(fontSize: 17, color: Colors.black54),
                  ),
                if (client.extraPhone != null) ...[
                  const SizedBox(height: 8),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton.icon(
                      onPressed: () => callPhone(context, client.extraPhone!),
                      icon: const Icon(Icons.phone_forwarded),
                      label: Text(
                        '${client.extraContact ?? 'Доп. контакт'}:  ${client.extraPhone}',
                        textAlign: TextAlign.center,
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),

          // Адреса
          const SizedBox(height: 10),
          _Section(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _Address(
                  label: 'Откуда забрать',
                  icon: Icons.trip_origin,
                  color: const Color(0xFF2E7D32),
                  address: trip.fromAddress,
                ),
                const Divider(height: 28),
                _Address(
                  label: 'Куда отвезти',
                  icon: Icons.flag,
                  color: const Color(0xFFC62828),
                  address: trip.toAddress,
                ),
              ],
            ),
          ),

          // Редкие действия
          const SizedBox(height: 16),
          if (!status.isFinal)
            OutlinedButton.icon(
              onPressed: _busy ? null : _cancel,
              style: OutlinedButton.styleFrom(
                foregroundColor: const Color(0xFFC62828),
                side: const BorderSide(color: Color(0xFFC62828)),
              ),
              icon: const Icon(Icons.person_off),
              label: const Text('Клиент не вышел / отмена'),
            ),
          if (status.previous != null)
            TextButton.icon(
              onPressed: _busy ? null : () => _undo(trip),
              icon: const Icon(Icons.undo),
              label: const Text('Вернуть предыдущий статус'),
            ),
          if (status == TripStatus.cancelled)
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 4),
              child: Text(
                'Если заказ отменён по ошибке — позвоните диспетчеру, '
                'он восстановит его.',
                style: TextStyle(fontSize: 16, color: Colors.black54),
              ),
            ),
        ],
      ),
    );
  }

  /// Одна большая кнопка следующего шага.
  Widget _bottomBar(Trip trip) {
    final status = trip.status;
    final next = status.next;

    final Widget child;
    if (next != null) {
      child = FilledButton(
        onPressed: _busy ? null : () => _advance(trip),
        style: FilledButton.styleFrom(
          backgroundColor: next.color,
          minimumSize: const Size(64, 68),
          textStyle: const TextStyle(fontSize: 23, fontWeight: FontWeight.w800),
        ),
        child: _busy
            ? const SizedBox(
                width: 28,
                height: 28,
                child: CircularProgressIndicator(
                  strokeWidth: 3,
                  color: Colors.white,
                ),
              )
            : Text(status.nextLabel!),
      );
    } else {
      child = FilledButton.tonalIcon(
        onPressed: () => Navigator.of(context).maybePop(),
        style: FilledButton.styleFrom(minimumSize: const Size(64, 64)),
        icon: Icon(
          status == TripStatus.completed ? Icons.check_circle : Icons.cancel,
          color: status.color,
        ),
        label: Text(
          status == TripStatus.completed
              ? 'Выполнено · к списку заказов'
              : 'Отменён · к списку заказов',
        ),
      );
    }

    return Material(
      color: Colors.white,
      elevation: 12,
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
          child: SizedBox(width: double.infinity, child: child),
        ),
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(14),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(16),
      border: Border.all(color: const Color(0xFFD5DAE1)),
    ),
    child: child,
  );
}

class _Label extends StatelessWidget {
  const _Label(this.text, {this.icon});

  final String text;
  final IconData? icon;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      if (icon != null) ...[
        Icon(icon, size: 18, color: Colors.black54),
        const SizedBox(width: 6),
      ],
      Text(
        text.toUpperCase(),
        style: const TextStyle(
          fontSize: 13.5,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.6,
          color: Colors.black54,
        ),
      ),
    ],
  );
}

class _Address extends StatelessWidget {
  const _Address({
    required this.label,
    required this.icon,
    required this.color,
    required this.address,
  });

  final String label;
  final IconData icon;
  final Color color;
  final String address;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Row(
        children: [
          Icon(icon, size: 20, color: color),
          const SizedBox(width: 6),
          Text(
            label.toUpperCase(),
            style: const TextStyle(
              fontSize: 13.5,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.6,
              color: Colors.black54,
            ),
          ),
        ],
      ),
      const SizedBox(height: 4),
      Text(
        address,
        style: const TextStyle(
          fontSize: 20,
          height: 1.25,
          fontWeight: FontWeight.w600,
        ),
      ),
      const SizedBox(height: 10),
      SizedBox(
        width: double.infinity,
        child: OutlinedButton.icon(
          onPressed: () => openRoute(context, address),
          icon: const Icon(Icons.navigation),
          label: const Text('Маршрут'),
        ),
      ),
    ],
  );
}

/// Диспетчер изменил заказ, пока экран открыт.
class _AckStrip extends StatelessWidget {
  const _AckStrip({required this.trip, required this.onAck});

  final Trip trip;
  final VoidCallback onAck;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.fromLTRB(14, 8, 8, 8),
    decoration: BoxDecoration(
      color: ackColor,
      borderRadius: BorderRadius.circular(14),
    ),
    child: Row(
      children: [
        const Icon(Icons.notifications_active, color: Colors.white),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            trip.status == TripStatus.cancelled
                ? 'Диспетчер отменил заказ'
                : 'Диспетчер изменил заказ — проверьте данные',
            style: const TextStyle(
              color: Colors.white,
              fontSize: 17,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        FilledButton(
          onPressed: onAck,
          style: FilledButton.styleFrom(
            backgroundColor: Colors.white,
            foregroundColor: ackColor,
            minimumSize: const Size(64, 46),
          ),
          child: const Text('Принял'),
        ),
      ],
    ),
  );
}

/// Выбор причины отмены.
class _CancelSheet extends StatefulWidget {
  const _CancelSheet();

  @override
  State<_CancelSheet> createState() => _CancelSheetState();
}

class _CancelSheetState extends State<_CancelSheet> {
  static const _other = 'Другое';
  final _text = TextEditingController();
  String? _selected;

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  String? get _reason {
    if (_selected == null) return null;
    if (_selected != _other) return _selected;
    final text = _text.text.trim();
    return text.isEmpty ? null : text;
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(
          16,
          0,
          16,
          16 + MediaQuery.viewInsetsOf(context).bottom,
        ),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'Почему поездка не состоится?',
                style: TextStyle(fontSize: 21, fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 12),
              for (final reason in [..._cancelReasons, _other]) ...[
                Material(
                  color: _selected == reason
                      ? scheme.primaryContainer
                      : Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                    side: BorderSide(
                      color: _selected == reason
                          ? scheme.primary
                          : const Color(0xFFC3C9D2),
                    ),
                  ),
                  clipBehavior: Clip.antiAlias,
                  child: InkWell(
                    onTap: () => setState(() => _selected = reason),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 15,
                      ),
                      child: Row(
                        children: [
                          Icon(
                            _selected == reason
                                ? Icons.radio_button_checked
                                : Icons.radio_button_unchecked,
                            color: _selected == reason
                                ? scheme.primary
                                : Colors.black45,
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Text(
                              reason,
                              style: const TextStyle(
                                fontSize: 19,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 8),
              ],
              if (_selected == _other) ...[
                TextField(
                  controller: _text,
                  autofocus: true,
                  maxLines: 2,
                  textCapitalization: TextCapitalization.sentences,
                  style: const TextStyle(fontSize: 19),
                  decoration: const InputDecoration(
                    hintText: 'Напишите причину',
                  ),
                  onChanged: (_) => setState(() {}),
                ),
                const SizedBox(height: 8),
              ],
              const SizedBox(height: 4),
              FilledButton(
                onPressed: _reason == null
                    ? null
                    : () => Navigator.pop(context, _reason),
                style: FilledButton.styleFrom(
                  backgroundColor: const Color(0xFFC62828),
                  minimumSize: const Size(64, 60),
                ),
                child: const Text('Отменить поездку'),
              ),
              const SizedBox(height: 4),
              TextButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('Назад'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
