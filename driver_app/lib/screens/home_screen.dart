import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../server.dart';
import '../app_state.dart';
import '../launch.dart';
import '../location.dart';
import '../models.dart';
import '../widgets/trip_card.dart';
import 'trip_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.state});

  final AppState state;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _day = 0; // 0 — сегодня, 1 — завтра
  bool _locationAsked = false;

  AppState get state => widget.state;

  @override
  void initState() {
    super.initState();
    state.location.addListener(_onLocation);
    WidgetsBinding.instance.addPostFrameCallback((_) => _onLocation());
  }

  @override
  void didUpdateWidget(HomeScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.state != widget.state) {
      oldWidget.state.location.removeListener(_onLocation);
      widget.state.location.addListener(_onLocation);
    }
  }

  @override
  void dispose() {
    state.location.removeListener(_onLocation);
    super.dispose();
  }

  // ───────────── «На линии» и геолокация ─────────────

  /// Один раз за запуск объясняем, зачем нужна геолокация, и просим разрешение.
  void _onLocation() {
    final location = state.location;
    if (!mounted ||
        _locationAsked ||
        !location.onDuty ||
        location.issue != LocationIssue.denied) {
      return;
    }
    _locationAsked = true;
    WidgetsBinding.instance.addPostFrameCallback((_) => _explainAndAsk());
  }

  Future<void> _explainAndAsk() async {
    if (!mounted) return;
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        icon: const Icon(Icons.location_on, size: 40),
        title: const Text('Доступ к местоположению'),
        content: const Text(
          'Диспетчер будет видеть положение машины на карте, пока вы на линии. '
          'Когда вы завершаете смену, передача прекращается.',
          style: TextStyle(fontSize: 18),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Не сейчас'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Разрешить'),
          ),
        ],
      ),
    );
    if (ok == true) await state.location.start(ask: true);
  }

  Future<void> _fixLocation() async {
    if (!await state.location.openFix()) await _explainAndAsk();
  }

  Future<void> _toggleDuty(bool value) async {
    if (value) {
      _locationAsked = false; // при отказе в разрешении объясним ещё раз
      await state.location.setOnDuty(true);
      return;
    }
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Завершить смену?'),
        content: const Text(
          'Диспетчер перестанет видеть машину на карте. '
          'Заказы в приложении останутся.',
          style: TextStyle(fontSize: 18),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Отмена'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Завершить смену'),
          ),
        ],
      ),
    );
    if (ok == true) await state.location.setOnDuty(false);
  }

  // ───────────── действия ─────────────

  void _open(Trip trip) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => TripScreen(state: state, tripId: trip.id),
      ),
    );
  }

  Future<void> _ack(Trip trip) async {
    final error = await state.ack([trip.id]);
    if (error != null && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(error),
          persist: false,
          action: SnackBarAction(
            label: 'Повторить',
            onPressed: () => _ack(trip),
          ),
        ),
      );
    }
  }

  /// «Принять все» — обычно вечером, когда диспетчер прислал план на завтра.
  Future<void> _ackAll() async {
    final ids = [
      for (final t in state.tripsFor(_day))
        if (t.needsAck) t.id,
    ];
    if (ids.isEmpty) return;
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Принять все (${ids.length})?'),
        content: Text(
          'Вы подтверждаете, что просмотрели все новые и изменённые заказы '
          'на ${_day == 0 ? 'сегодня' : 'завтра'}.',
          style: const TextStyle(fontSize: 18),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Отмена'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Принять все'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    final error = await state.ack(ids);
    if (error != null && mounted) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(error)));
    }
  }

  Future<void> _signOut() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(
          Server.demo ? 'Выйти из демо-режима?' : 'Выйти из приложения?',
        ),
        content: Text(
          Server.demo
              ? 'Вы вернётесь на экран входа.'
              : 'Чтобы снова увидеть заказы, нужно будет ввести логин и пароль.',
          style: const TextStyle(fontSize: 18),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Отмена'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Выйти'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    final wasDemo = Server.demo;
    await state.signOut();
    if (wasDemo) await Server.exitDemo();
  }

  void _callDispatcher() {
    final phone = state.dispatcherPhone;
    if (phone == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Телефон диспетчера не указан')),
      );
    } else {
      callPhone(context, phone);
    }
  }

  // ───────────── экран ─────────────

  @override
  Widget build(BuildContext context) {
    final vehicle = state.vehicle;
    final subtitle = [?vehicle?.plate, ?state.driverName].join(' · ');

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 16,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              vehicle?.name ?? 'Машина',
              style: const TextStyle(fontSize: 21, fontWeight: FontWeight.w800),
            ),
            if (subtitle.isNotEmpty)
              Text(
                subtitle,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 14.5),
              ),
          ],
        ),
        actions: [
          PopupMenuButton<String>(
            tooltip: 'Меню',
            icon: const Icon(Icons.menu, size: 30),
            onSelected: (value) => switch (value) {
              'call' => _callDispatcher(),
              'refresh' => state.refresh(),
              _ => _signOut(),
            },
            itemBuilder: (context) => const [
              PopupMenuItem(
                value: 'call',
                child: _MenuRow(Icons.phone, 'Позвонить диспетчеру'),
              ),
              PopupMenuItem(
                value: 'refresh',
                child: _MenuRow(Icons.refresh, 'Обновить'),
              ),
              PopupMenuItem(
                value: 'logout',
                child: _MenuRow(Icons.logout, 'Выйти'),
              ),
            ],
          ),
        ],
      ),
      body: Column(
        children: [
          if (Server.demo) const _DemoStrip(),
          ListenableBuilder(
            listenable: state.location,
            builder: (context, _) => _DutyBar(
              location: state.location,
              onToggle: _toggleDuty,
              onFix: _fixLocation,
            ),
          ),
          if (state.offline) _OfflineStrip(state.loadedAt),
          Expanded(
            child: RefreshIndicator(
              onRefresh: state.refresh,
              child: _list(context),
            ),
          ),
        ],
      ),
    );
  }

  Widget _list(BuildContext context) {
    final trips = state.tripsFor(_day);
    final unackedToday = state.unackedFor(0);
    final unackedTomorrow = state.unackedFor(1);
    final unacked = unackedToday + unackedTomorrow;
    final done = trips.where((t) => t.status == TripStatus.completed).length;
    final cancelled = trips
        .where((t) => t.status == TripStatus.cancelled)
        .length;
    final total = trips.length - cancelled;
    final onBoard = state.trips
        .where((t) => t.status == TripStatus.inProgress)
        .toList();
    final dayTitle = toBeginningOfSentenceCase(
      DateFormat(
        'EEEE, d MMMM',
        'ru',
      ).format(DateTime.now().add(Duration(days: _day))),
    );

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 32),
      children: [
        if (state.notices.isNotEmpty) ...[
          _NoticesPanel(lines: state.notices, onDismiss: state.dismissNotices),
          const SizedBox(height: 10),
        ],
        if (unacked > 0) ...[
          _UnackedBanner(
            today: unackedToday,
            tomorrow: unackedTomorrow,
            currentDay: _day,
            onShow: (day) => setState(() => _day = day),
            onAckAll: _ackAll,
          ),
          const SizedBox(height: 10),
        ],
        if (onBoard.isNotEmpty) ...[
          _OnBoardStrip(onBoard),
          const SizedBox(height: 10),
        ],
        SegmentedButton<int>(
          showSelectedIcon: false,
          style: SegmentedButton.styleFrom(
            minimumSize: const Size(64, 54),
            textStyle: const TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w700,
            ),
            backgroundColor: Colors.white,
          ),
          segments: [
            ButtonSegment(
              value: 0,
              label: Text('Сегодня · ${state.tripsFor(0).length}'),
            ),
            ButtonSegment(
              value: 1,
              label: Text('Завтра · ${state.tripsFor(1).length}'),
            ),
          ],
          selected: {_day},
          onSelectionChanged: (value) => setState(() => _day = value.first),
        ),
        const SizedBox(height: 12),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  dayTitle,
                  style: const TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w600,
                    color: Color(0xFF455A64),
                  ),
                ),
              ),
              if (trips.isNotEmpty)
                Text(
                  'Выполнено $done из $total',
                  style: const TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w800,
                  ),
                ),
            ],
          ),
        ),
        if (trips.isNotEmpty) ...[
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(6),
            child: LinearProgressIndicator(
              value: total == 0 ? 0 : done / total,
              minHeight: 8,
              backgroundColor: const Color(0xFFD5DAE1),
              color: TripStatus.completed.color,
            ),
          ),
        ],
        const SizedBox(height: 12),
        if (trips.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 56),
            child: Column(
              children: [
                const Icon(
                  Icons.event_available,
                  size: 64,
                  color: Colors.black26,
                ),
                const SizedBox(height: 12),
                Text(
                  _day == 0
                      ? 'На сегодня заказов нет'
                      : 'На завтра заказов пока нет',
                  style: const TextStyle(fontSize: 19, color: Colors.black54),
                ),
              ],
            ),
          ),
        for (final trip in trips) ...[
          TripCard(
            key: ValueKey(trip.id),
            trip: trip,
            onTap: () => _open(trip),
            onAck: () => _ack(trip),
          ),
          const SizedBox(height: 10),
        ],
      ],
    );
  }
}

class _MenuRow extends StatelessWidget {
  const _MenuRow(this.icon, this.text);

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Icon(icon, color: Colors.black87),
      const SizedBox(width: 12),
      Text(text, style: const TextStyle(fontSize: 18)),
    ],
  );
}

/// Переключатель «На линии» + строка о проблеме с геолокацией.
class _DutyBar extends StatelessWidget {
  const _DutyBar({
    required this.location,
    required this.onToggle,
    required this.onFix,
  });

  final LocationTracker location;
  final ValueChanged<bool> onToggle;
  final VoidCallback onFix;

  @override
  Widget build(BuildContext context) {
    final on = location.onDuty;
    final issue = on ? location.issue : LocationIssue.none;
    const green = Color(0xFF2E7D32);
    final issueText = switch (issue) {
      LocationIssue.serviceOff =>
        'Местоположение не передаётся: выключена геолокация',
      LocationIssue.denied || LocationIssue.deniedForever =>
        'Местоположение не передаётся: нет разрешения',
      LocationIssue.failed => 'Местоположение не передаётся',
      LocationIssue.none => null,
    };

    return Material(
      color: on ? const Color(0xFFE6F4EA) : const Color(0xFFE3E6EA),
      child: Column(
        children: [
          InkWell(
            onTap: () => onToggle(!on),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 6, 12, 6),
              child: Row(
                children: [
                  Icon(
                    on ? Icons.wifi_tethering : Icons.wifi_tethering_off,
                    color: on ? green : Colors.black54,
                    size: 28,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          on ? 'На линии' : 'Не на линии',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w800,
                            color: on ? green : Colors.black87,
                          ),
                        ),
                        Text(
                          !on
                              ? 'Смена завершена — машина на карте не видна'
                              : issue == LocationIssue.none
                              ? 'Диспетчер видит машину на карте'
                              : 'Заказы приходят, но машина на карте не видна',
                          style: const TextStyle(
                            fontSize: 14.5,
                            color: Colors.black54,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Switch(
                    value: on,
                    onChanged: onToggle,
                    activeTrackColor: green,
                  ),
                ],
              ),
            ),
          ),
          if (issueText != null)
            Container(
              color: const Color(0xFFFFF3CD),
              padding: const EdgeInsets.only(left: 16, right: 4),
              child: Row(
                children: [
                  const Icon(Icons.location_off, color: Color(0xFF8D6E00)),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      issueText,
                      style: const TextStyle(
                        fontSize: 15,
                        color: Color(0xFF5C4700),
                      ),
                    ),
                  ),
                  TextButton(onPressed: onFix, child: const Text('Включить')),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _OfflineStrip extends StatelessWidget {
  const _OfflineStrip(this.loadedAt);

  final DateTime? loadedAt;

  @override
  Widget build(BuildContext context) {
    final at = loadedAt;
    final when = at == null
        ? ''
        : DateUtils.isSameDay(at, DateTime.now())
        ? ', данные от ${DateFormat('HH:mm').format(at)}'
        : ', данные от ${DateFormat('d MMM HH:mm', 'ru').format(at)}';
    return Container(
      width: double.infinity,
      color: const Color(0xFFB71C1C),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 9),
      child: Row(
        children: [
          const Icon(Icons.wifi_off, color: Colors.white, size: 22),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              'Нет связи$when',
              style: const TextStyle(
                color: Colors.white,
                fontSize: 16,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Что поменял диспетчер (в том числе снятые заказы, которых уже нет в списке).
class _NoticesPanel extends StatelessWidget {
  const _NoticesPanel({required this.lines, required this.onDismiss});

  final List<String> lines;
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.fromLTRB(14, 12, 8, 6),
    decoration: BoxDecoration(
      color: const Color(0xFFFFF3E0),
      borderRadius: BorderRadius.circular(16),
      border: Border.all(color: ackColor, width: 2),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Row(
          children: [
            Icon(Icons.campaign, color: ackColor),
            SizedBox(width: 8),
            Text(
              'Диспетчер изменил заказы',
              style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
            ),
          ],
        ),
        const SizedBox(height: 6),
        for (final line in lines)
          Padding(
            padding: const EdgeInsets.only(bottom: 4, right: 6),
            child: Text('• $line', style: const TextStyle(fontSize: 17)),
          ),
        Align(
          alignment: Alignment.centerRight,
          child: TextButton(onPressed: onDismiss, child: const Text('Понятно')),
        ),
      ],
    ),
  );
}

class _UnackedBanner extends StatelessWidget {
  const _UnackedBanner({
    required this.today,
    required this.tomorrow,
    required this.currentDay,
    required this.onShow,
    required this.onAckAll,
  });

  final int today;
  final int tomorrow;
  final int currentDay;
  final ValueChanged<int> onShow;
  final VoidCallback onAckAll;

  @override
  Widget build(BuildContext context) {
    final otherDay = currentDay == 0 ? 1 : 0;
    final here = currentDay == 0 ? today : tomorrow;
    final there = currentDay == 0 ? tomorrow : today;
    final parts = [
      if (today > 0) 'сегодня — $today',
      if (tomorrow > 0) 'завтра — $tomorrow',
    ];

    return Material(
      color: ackColor,
      borderRadius: BorderRadius.circular(14),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: there > 0 && here == 0 ? () => onShow(otherDay) : null,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          child: Row(
            children: [
              const Icon(Icons.notifications_active, color: Colors.white),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Есть изменения: ${today + tomorrow}',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    Text(
                      '${parts.join(', ')}. Откройте заказ или нажмите «Принял».',
                      style: const TextStyle(color: Colors.white, fontSize: 15),
                    ),
                  ],
                ),
              ),
              if (there > 0 && here == 0)
                const Icon(Icons.chevron_right, color: Colors.white, size: 30),
              if (here > 1)
                TextButton(
                  onPressed: onAckAll,
                  style: TextButton.styleFrom(
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                  ),
                  child: const Text(
                    'Принять\nвсе',
                    textAlign: TextAlign.center,
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Машина может везти сразу нескольких клиентов.
class _OnBoardStrip extends StatelessWidget {
  const _OnBoardStrip(this.trips);

  final List<Trip> trips;

  @override
  Widget build(BuildContext context) {
    final color = TripStatus.inProgress.color;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: color.withValues(alpha: 0.5)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.airline_seat_recline_normal, color: color),
          const SizedBox(width: 10),
          Expanded(
            child: Text.rich(
              TextSpan(
                children: [
                  TextSpan(
                    text: 'Сейчас в машине: ${trips.length}',
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                  TextSpan(
                    text:
                        '\n${trips.map((t) => t.client.shortName).join(', ')}',
                  ),
                ],
              ),
              style: TextStyle(fontSize: 17, color: color, height: 1.3),
            ),
          ),
        ],
      ),
    );
  }
}

/// Напоминание, что приложение подключено к демо-базе.
class _DemoStrip extends StatelessWidget {
  const _DemoStrip();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: const Color(0xFFFFD54F),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: const Row(
        children: [
          Icon(Icons.science_outlined, size: 22, color: Color(0xFF4E3B00)),
          SizedBox(width: 10),
          Expanded(
            child: Text(
              'Демо-режим: клиенты и заказы вымышлены',
              style: TextStyle(
                fontSize: 15.5,
                fontWeight: FontWeight.w700,
                color: Color(0xFF4E3B00),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
