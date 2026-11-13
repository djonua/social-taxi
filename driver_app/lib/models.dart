import 'package:flutter/material.dart';

enum TripStatus {
  planned('planned', 'Запланирован', Color(0xFF546E7A)),
  enRoute('en_route', 'Еду к клиенту', Color(0xFF1565C0)),
  arrived('arrived', 'На месте', Color(0xFFE65100)),
  inProgress('in_progress', 'Везу клиента', Color(0xFF6A1B9A)),
  completed('completed', 'Выполнен', Color(0xFF2E7D32)),
  cancelled('cancelled', 'Отменён', Color(0xFFC62828));

  const TripStatus(this.code, this.label, this.color);

  final String code;
  final String label;
  final Color color;

  static TripStatus parse(String? code) => values.firstWhere(
    (s) => s.code == code,
    orElse: () => TripStatus.planned,
  );

  bool get isActive => this == enRoute || this == arrived || this == inProgress;
  bool get isFinal => this == completed || this == cancelled;

  /// Следующий шаг водителя и подпись на большой кнопке.
  TripStatus? get next => switch (this) {
    planned => enRoute,
    enRoute => arrived,
    arrived => inProgress,
    inProgress => completed,
    _ => null,
  };

  String? get nextLabel => switch (this) {
    planned => 'Выехал к клиенту',
    enRoute => 'Я на месте',
    arrived => 'Клиент в машине',
    inProgress => 'Доставил',
    _ => null,
  };

  /// Шаг назад (исправить случайное нажатие).
  TripStatus? get previous => switch (this) {
    enRoute => planned,
    arrived => enRoute,
    inProgress => arrived,
    completed => inProgress,
    _ => null,
  };
}

class Client {
  Client(this.raw);

  final Map<String, dynamic> raw;

  String get fullName => _text(raw['full_name']) ?? 'Клиент';
  String? get phone => _text(raw['phone']);
  String? get extraPhone => _text(raw['extra_phone']);
  String? get extraContact => _text(raw['extra_contact']);
  String? get diagnosis => _text(raw['diagnosis']);
  String? get notes => _text(raw['notes']);
  bool get escort => raw['escort'] == true;
  String get mobility => raw['mobility'] as String? ?? 'assist';

  String get mobilityLabel => switch (mobility) {
    'wheelchair' => 'Коляска',
    'walks' => 'Ходит сам',
    _ => 'Нужна помощь',
  };

  IconData get mobilityIcon => switch (mobility) {
    'wheelchair' => Icons.accessible,
    'walks' => Icons.directions_walk,
    _ => Icons.volunteer_activism,
  };

  /// «Иванов И. П.» — для коротких сообщений.
  String get shortName {
    final parts = fullName.split(RegExp(r'\s+'));
    if (parts.length < 2) return fullName;
    final initials = parts
        .skip(1)
        .where((p) => p.isNotEmpty)
        .map((p) => '${p[0]}.')
        .join(' ');
    return '${parts.first} $initials';
  }
}

class Trip {
  Trip(this.raw)
    : client = Client(
        (raw['client'] as Map?)?.cast<String, dynamic>() ?? const {},
      );

  /// Строка из базы как есть — её же кладём в кэш.
  final Map<String, dynamic> raw;
  final Client client;

  String get id => raw['id'] as String;
  String get date => raw['trip_date'] as String; // yyyy-MM-dd
  String get pickupTime => _hhmm(raw['pickup_time'])!;
  String? get arriveBy => _hhmm(raw['arrive_by']);
  String get fromAddress => _text(raw['from_address']) ?? '—';
  String get toAddress => _text(raw['to_address']) ?? '—';
  bool get isBack => raw['direction'] == 'back';
  String get directionLabel => isBack ? 'Обратно' : 'Туда';
  TripStatus get status => TripStatus.parse(raw['status'] as String?);
  String? get note => _text(raw['note']);
  String? get cancelReason => _text(raw['cancel_reason']);
  String? get pairId => raw['pair_id'] as String?;
  DateTime get changedAt =>
      DateTime.tryParse(raw['changed_at'] as String? ?? '') ??
      DateTime.fromMillisecondsSinceEpoch(0);
  DateTime? get seenAt =>
      DateTime.tryParse(raw['driver_seen_at'] as String? ?? '');

  /// Диспетчер добавил или изменил заказ, а водитель ещё не подтвердил.
  bool get needsAck {
    if (status == TripStatus.completed) return false;
    final seen = seenAt;
    return seen == null || seen.isBefore(changedAt);
  }

  String get ackLabel {
    if (status == TripStatus.cancelled) return 'ОТМЕНЁН';
    return seenAt == null ? 'НОВЫЙ' : 'ИЗМЕНЁН';
  }

  /// «10:30 Иванов И. П.»
  String get shortTitle => '$pickupTime ${client.shortName}';

  /// Новая версия строки из RPC (без вложенного клиента) — клиента сохраняем.
  Trip merged(Map<String, dynamic> row) =>
      Trip({...raw, ...row, 'client': raw['client']});
}

class Vehicle {
  Vehicle(this.raw);

  final Map<String, dynamic> raw;

  String get id => raw['id'] as String;
  String get name => _text(raw['name']) ?? 'Машина';
  String? get plate => _text(raw['plate']);
}

String? _text(Object? value) {
  final s = value?.toString().trim();
  return s == null || s.isEmpty ? null : s;
}

/// '09:30:00' → '09:30'
String? _hhmm(Object? value) {
  final s = _text(value);
  if (s == null) return null;
  return s.length >= 5 ? s.substring(0, 5) : s;
}
