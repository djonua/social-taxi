import 'package:flutter/material.dart';

import '../models.dart';

const ackColor = Color(0xFFE65100);

/// Цветная плашка статуса.
class StatusChip extends StatelessWidget {
  const StatusChip(this.status, {super.key, this.large = false});

  final TripStatus status;
  final bool large;

  @override
  Widget build(BuildContext context) => Container(
    padding: EdgeInsets.symmetric(
      horizontal: large ? 14 : 10,
      vertical: large ? 7 : 5,
    ),
    decoration: BoxDecoration(
      color: status.color,
      borderRadius: BorderRadius.circular(20),
    ),
    child: Text(
      status.label,
      style: TextStyle(
        color: Colors.white,
        fontSize: large ? 17 : 14,
        fontWeight: FontWeight.w700,
      ),
    ),
  );
}

/// Небольшая метка: мобильность, сопровождающий, направление.
class Tag extends StatelessWidget {
  const Tag(this.text, {super.key, this.icon, this.color});

  final String text;
  final IconData? icon;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final c = color ?? const Color(0xFF37474F);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
        color: c.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: c.withValues(alpha: 0.35)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 18, color: c),
            const SizedBox(width: 4),
          ],
          Text(
            text,
            style: TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w600,
              color: c,
            ),
          ),
        ],
      ),
    );
  }
}

/// Метки клиента — общие для карточки и экрана поездки.
List<Widget> clientTags(Trip trip) {
  final client = trip.client;
  return [
    Tag(
      client.mobilityLabel,
      icon: client.mobilityIcon,
      color: client.mobility == 'wheelchair' ? const Color(0xFF1565C0) : null,
    ),
    if (client.escort) const Tag('+ сопровождающий', icon: Icons.group),
    Tag(
      trip.directionLabel,
      icon: trip.isBack ? Icons.keyboard_return : Icons.arrow_forward,
    ),
  ];
}

/// Две строки «откуда → куда».
class RouteLines extends StatelessWidget {
  const RouteLines(this.trip, {super.key, this.muted = false});

  final Trip trip;
  final bool muted;

  @override
  Widget build(BuildContext context) {
    final color = muted ? Colors.black45 : const Color(0xFF14181F);
    Widget line(IconData icon, Color iconColor, String text) => Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 2),
          child: Icon(
            icon,
            size: 20,
            color: muted ? Colors.black38 : iconColor,
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            text,
            style: TextStyle(fontSize: 16.5, height: 1.25, color: color),
          ),
        ),
      ],
    );
    return Column(
      children: [
        line(Icons.trip_origin, const Color(0xFF2E7D32), trip.fromAddress),
        const SizedBox(height: 6),
        line(Icons.flag, const Color(0xFFC62828), trip.toAddress),
      ],
    );
  }
}

class TripCard extends StatelessWidget {
  const TripCard({
    super.key,
    required this.trip,
    required this.onTap,
    required this.onAck,
  });

  final Trip trip;
  final VoidCallback onTap;
  final VoidCallback onAck;

  @override
  Widget build(BuildContext context) {
    final status = trip.status;
    final cancelled = status == TripStatus.cancelled;
    final muted = status.isFinal;
    final needsAck = trip.needsAck;
    final active = status.isActive;

    final borderColor = needsAck
        ? ackColor
        : active
        ? status.color
        : const Color(0xFFD5DAE1);
    final strike = cancelled ? TextDecoration.lineThrough : null;
    final textColor = muted ? Colors.black45 : const Color(0xFF14181F);

    return Material(
      color: active
          ? Color.alphaBlend(status.color.withValues(alpha: 0.07), Colors.white)
          : muted && !needsAck
          ? const Color(0xFFF7F8FA)
          : Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: borderColor, width: needsAck || active ? 3 : 1),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (needsAck)
              Container(
                color: ackColor,
                padding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 6,
                ),
                child: Row(
                  children: [
                    const Icon(
                      Icons.notifications_active,
                      color: Colors.white,
                      size: 20,
                    ),
                    const SizedBox(width: 8),
                    Text(
                      trip.ackLabel,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 0.5,
                      ),
                    ),
                  ],
                ),
              ),
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        trip.pickupTime,
                        style: TextStyle(
                          fontSize: 34,
                          height: 1,
                          fontWeight: FontWeight.w800,
                          color: textColor,
                          decoration: strike,
                        ),
                      ),
                      const SizedBox(width: 10),
                      if (trip.arriveBy != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 10),
                          child: Text(
                            'быть к ${trip.arriveBy}',
                            style: TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.w600,
                              color: muted
                                  ? Colors.black38
                                  : const Color(0xFF455A64),
                            ),
                          ),
                        ),
                      const Spacer(),
                      StatusChip(status),
                    ],
                  ),
                  const SizedBox(height: 10),
                  Text(
                    trip.client.fullName,
                    style: TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w700,
                      color: textColor,
                      decoration: strike,
                    ),
                  ),
                  if (cancelled && trip.cancelReason != null) ...[
                    const SizedBox(height: 4),
                    Text(
                      'Причина: ${trip.cancelReason}',
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                        color: Color(0xFFC62828),
                      ),
                    ),
                  ],
                  if (!muted) ...[
                    const SizedBox(height: 8),
                    Wrap(spacing: 6, runSpacing: 6, children: clientTags(trip)),
                  ],
                  const SizedBox(height: 10),
                  RouteLines(trip, muted: muted),
                  if (!muted && trip.note != null) ...[
                    const SizedBox(height: 8),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Icon(
                          Icons.sticky_note_2,
                          size: 20,
                          color: Color(0xFF8D6E00),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            trip.note!,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.w600,
                              color: Color(0xFF6B5300),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                  if (needsAck) ...[
                    const SizedBox(height: 12),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton.icon(
                        onPressed: onAck,
                        style: FilledButton.styleFrom(
                          backgroundColor: ackColor,
                        ),
                        icon: const Icon(Icons.check),
                        label: const Text('Принял'),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
