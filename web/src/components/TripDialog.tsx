import { ArrowDown, CalendarPlus, Check, Clock, Copy, History, PhoneOff, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useDirectory } from '../lib/data'
import {
  addDays,
  CANCEL_REASONS,
  errorText,
  fmtDateLong,
  fmtDateShort,
  fmtStamp,
  fmtTime,
  fmtWeekday,
  fromISO,
  plural,
  seenState,
  shortName,
  STATUS_LABEL,
  STATUS_ORDER,
  tripInterval,
} from '../lib/format'
import { supabase } from '../lib/supabase'
import type { Client, Trip, TripEvent, TripStatus, Vehicle } from '../lib/types'
import { ClientPicker } from './ClientPicker'
import { Button, Chip, cx, ErrorNote, Field, Modal, StatusBadge } from './ui'

export interface TripPrefill {
  client?: Client | null
  date?: string
  pickup?: string
  arriveBy?: string
  from?: string
  to?: string
  vehicleId?: string
  note?: string
  withReturn?: boolean
  returnTime?: string
}

export interface RefusalPrefill {
  req_date?: string
  req_time?: string
  client?: Client | null
  from_address?: string
  to_address?: string
  with_return?: boolean
}

type DayTrip = Pick<
  Trip,
  'id' | 'vehicle_id' | 'pickup_time' | 'arrive_by' | 'status' | 'pair_id' | 'direction' | 'trip_date' | 'client_id'
> & { client: { full_name: string } | null }

const EVENT_LABEL: Record<TripEvent['kind'], string> = {
  created: 'Заказ создан',
  status: 'Статус',
  vehicle: 'Машина',
  time: 'Время',
  edited: 'Изменены данные',
  seen: 'Водитель принял заказ',
}

function eventText(e: TripEvent): string {
  if (e.kind === 'status' && e.details) {
    const [code, ...rest] = e.details.split(': ')
    const label = STATUS_LABEL[code as TripStatus] ?? code
    return `Статус: ${label}${rest.length ? ` (${rest.join(': ')})` : ''}`
  }
  if ((e.kind === 'vehicle' || e.kind === 'time') && e.details) {
    return `${EVENT_LABEL[e.kind]}: ${e.details}`
  }
  return EVENT_LABEL[e.kind] ?? e.kind
}

export function TripDialog({
  trip,
  prefill,
  defaultDate,
  onClose,
  onSaved,
  onRefuse,
  onRepeat,
  onOpenTrip,
}: {
  trip?: Trip
  prefill?: TripPrefill
  defaultDate: string
  onClose: () => void
  onSaved: () => void
  onRefuse: (p: RefusalPrefill) => void
  onRepeat: (p: TripPrefill) => void
  onOpenTrip: (id: string) => void
}) {
  const { vehicles, activeVehicles, places, profileById, vehicleById } = useDirectory()
  const editing = !!trip

  const [client, setClient] = useState<Client | null>(trip?.client ?? prefill?.client ?? null)
  const [date, setDate] = useState(trip?.trip_date ?? prefill?.date ?? defaultDate)
  const [pickup, setPickup] = useState(fmtTime(trip?.pickup_time) || prefill?.pickup || '')
  const [arriveBy, setArriveBy] = useState(fmtTime(trip?.arrive_by) || prefill?.arriveBy || '')
  const [from, setFrom] = useState(
    trip?.from_address ?? prefill?.from ?? prefill?.client?.address ?? '',
  )
  const [to, setTo] = useState(trip?.to_address ?? prefill?.to ?? '')
  const [vehicleId, setVehicleId] = useState(trip?.vehicle_id ?? prefill?.vehicleId ?? '')
  const [note, setNote] = useState(trip?.note ?? prefill?.note ?? '')

  // только при создании
  const [withReturn, setWithReturn] = useState(prefill?.withReturn ?? true)
  const [returnTime, setReturnTime] = useState(prefill?.returnTime ?? '')
  const [returnVehicle, setReturnVehicle] = useState('same')
  const [extraDates, setExtraDates] = useState<string[]>([])
  const [extraDateInput, setExtraDateInput] = useState('')

  // только при редактировании
  const [status, setStatus] = useState<TripStatus>(trip?.status ?? 'planned')
  const [reasonPreset, setReasonPreset] = useState(() => {
    if (!trip?.cancel_reason) return CANCEL_REASONS[0]
    return CANCEL_REASONS.includes(trip.cancel_reason) ? trip.cancel_reason : 'Другое'
  })
  const [reasonText, setReasonText] = useState(
    trip?.cancel_reason && !CANCEL_REASONS.includes(trip.cancel_reason) ? trip.cancel_reason : '',
  )
  const [alsoPair, setAlsoPair] = useState(true)
  const [pair, setPair] = useState<DayTrip | null>(null)
  const [events, setEvents] = useState<TripEvent[] | null>(null)
  const [showHistory, setShowHistory] = useState(false)

  const [dayTrips, setDayTrips] = useState<DayTrip[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Загруженность машин на выбранную дату
  useEffect(() => {
    let cancelled = false
    supabase
      .from('trips')
      .select('id, vehicle_id, pickup_time, arrive_by, status, pair_id, direction, trip_date, client_id, client:clients(full_name)')
      .eq('trip_date', date)
      .then(({ data }) => {
        if (!cancelled) setDayTrips((data ?? []) as unknown as DayTrip[])
      })
    return () => {
      cancelled = true
    }
  }, [date])

  // Парная поездка и история
  useEffect(() => {
    if (!trip) return
    let cancelled = false
    if (trip.pair_id) {
      supabase
        .from('trips')
        .select('id, vehicle_id, pickup_time, arrive_by, status, pair_id, direction, trip_date, client_id, client:clients(full_name)')
        .eq('pair_id', trip.pair_id)
        .neq('id', trip.id)
        .limit(1)
        .then(({ data }) => {
          if (!cancelled) setPair(((data ?? [])[0] as unknown as DayTrip) ?? null)
        })
    }
    supabase
      .from('trip_events')
      .select('*')
      .eq('trip_id', trip.id)
      .order('at', { ascending: false })
      .then(({ data }) => {
        if (!cancelled) setEvents((data ?? []) as TripEvent[])
      })
    return () => {
      cancelled = true
    }
  }, [trip])

  function pickClient(c: Client | null) {
    const prevAddress = client?.address ?? ''
    setClient(c)
    if (c?.address && (!from.trim() || from === prevAddress)) setFrom(c.address)
  }

  const vehicleChoices = useMemo(() => {
    const list: Vehicle[] = [...activeVehicles]
    const current = vehicleById(trip?.vehicle_id)
    if (current && !list.some((v) => v.id === current.id)) list.push(current)
    return list
  }, [activeVehicles, vehicleById, trip?.vehicle_id])

  function loadOf(v: Vehicle, time: string, until: string) {
    const mine = dayTrips.filter(
      (t) => t.vehicle_id === v.id && t.status !== 'cancelled' && t.id !== trip?.id,
    )
    let overlap: DayTrip[] = []
    if (time) {
      const [s, e] = tripInterval({ pickup_time: time, arrive_by: until || null })
      overlap = mine
        .filter((t) => {
          const [a, b] = tripInterval(t)
          return a < e && s < b
        })
        .sort((a, b) => a.pickup_time.localeCompare(b.pickup_time))
    }
    return { count: mine.length, overlap, full: overlap.length >= v.seats }
  }

  // Другие поездки этого клиента в тот же день — чтобы не завести заказ дважды.
  const clientSameDay = client
    ? dayTrips
        .filter(
          (t) =>
            t.client_id === client.id &&
            t.status !== 'cancelled' &&
            t.id !== trip?.id &&
            t.id !== pair?.id,
        )
        .sort((a, b) => a.pickup_time.localeCompare(b.pickup_time))
    : []

  const loads = vehicleChoices.map((v) => ({ v, ...loadOf(v, pickup, arriveBy) }))
  const noRoom = !!pickup && (loads.length === 0 || loads.every((l) => l.full))

  const refusalPrefill = (): RefusalPrefill => ({
    req_date: date,
    req_time: pickup,
    client,
    from_address: from,
    to_address: to,
    with_return: editing ? false : withReturn,
  })

  function addExtraDate(d: string) {
    if (!d || d === date) return
    setExtraDates((list) => (list.includes(d) ? list : [...list, d].sort()))
  }

  function addNextWeekdays() {
    const out: string[] = []
    let d = date
    while (out.length < 5) {
      d = addDays(d, 1)
      const dow = fromISO(d).getDay()
      if (dow !== 0 && dow !== 6) out.push(d)
    }
    setExtraDates((list) => [...new Set([...list, ...out])].sort())
  }

  function validate(): string {
    if (!client) return 'Выберите клиента'
    if (!date) return 'Укажите дату'
    if (!pickup) return 'Укажите время подачи'
    if (arriveBy && arriveBy <= pickup) return '«Быть на месте к» должно быть позже времени подачи'
    if (!from.trim()) return 'Укажите адрес «Откуда»'
    if (!to.trim()) return 'Укажите адрес «Куда»'
    if (!editing && withReturn) {
      if (!returnTime) return 'Укажите время обратной поездки или снимите галочку'
      if (returnTime <= pickup) return 'Обратная поездка должна быть позже поездки «туда»'
    }
    if (editing && status === 'cancelled' && reasonPreset === 'Другое' && !reasonText.trim()) {
      return 'Укажите причину отмены'
    }
    return ''
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const problem = validate()
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    setError('')
    try {
      if (editing) await saveEdit()
      else await create()
      onSaved()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  async function create() {
    const rows: Record<string, unknown>[] = []
    for (const d of [date, ...extraDates]) {
      const pair_id = withReturn ? crypto.randomUUID() : null
      rows.push({
        trip_date: d,
        pickup_time: pickup,
        arrive_by: arriveBy || null,
        client_id: client!.id,
        from_address: from.trim(),
        to_address: to.trim(),
        direction: 'there',
        pair_id,
        vehicle_id: vehicleId || null,
        note: note.trim() || null,
      })
      if (withReturn) {
        rows.push({
          trip_date: d,
          pickup_time: returnTime,
          arrive_by: null,
          client_id: client!.id,
          from_address: to.trim(),
          to_address: from.trim(),
          direction: 'back',
          pair_id,
          vehicle_id: (returnVehicle === 'same' ? vehicleId : returnVehicle) || null,
          note: note.trim() || null,
        })
      }
    }
    const { error } = await supabase.from('trips').insert(rows)
    if (error) throw error
  }

  const cancelReason = reasonPreset === 'Другое' ? reasonText.trim() : reasonPreset
  const dateChanged = editing && date !== trip!.trip_date
  const cancelling = editing && status === 'cancelled' && trip!.status !== 'cancelled'
  const pairOpen = !!pair && pair.status !== 'cancelled' && pair.status !== 'completed'

  async function saveEdit() {
    const patch: Record<string, unknown> = {
      trip_date: date,
      pickup_time: pickup,
      arrive_by: arriveBy || null,
      client_id: client!.id,
      from_address: from.trim(),
      to_address: to.trim(),
      vehicle_id: vehicleId || null,
      note: note.trim() || null,
    }
    if (status !== trip!.status) patch.status = status
    if (status === 'cancelled') patch.cancel_reason = cancelReason

    const { error } = await supabase.from('trips').update(patch).eq('id', trip!.id)
    if (error) throw error

    if (pair && pairOpen && alsoPair && (cancelling || dateChanged)) {
      const pairPatch: Record<string, unknown> = {}
      if (dateChanged) pairPatch.trip_date = date
      if (cancelling) {
        pairPatch.status = 'cancelled'
        pairPatch.cancel_reason = cancelReason
      }
      const res = await supabase.from('trips').update(pairPatch).eq('id', pair.id)
      if (res.error) throw res.error
    }
  }

  async function remove() {
    if (!trip) return
    const withPair = pair && pairOpen
    const question = withPair
      ? 'Удалить поездку? Парная поездка останется — её можно удалить отдельно.\n\nОбычно лучше не удалять, а отменить: так сохранится история.'
      : 'Удалить поездку без следа?\n\nОбычно лучше не удалять, а отменить: так сохранится история.'
    if (!window.confirm(question)) return
    setBusy(true)
    const { error } = await supabase.from('trips').delete().eq('id', trip.id)
    setBusy(false)
    if (error) setError(errorText(error))
    else onSaved()
  }

  function repeat() {
    const isBack = trip!.direction === 'back'
    onRepeat({
      client,
      date: addDays(trip!.trip_date, 1),
      pickup: isBack && pair ? fmtTime(pair.pickup_time) : pickup,
      arriveBy: isBack ? '' : arriveBy,
      from: isBack ? to : from,
      to: isBack ? from : to,
      vehicleId,
      note,
      withReturn: !!pair,
      returnTime: isBack ? pickup : pair ? fmtTime(pair.pickup_time) : '',
    })
  }

  const seen = trip ? seenState(trip) : 'none'
  const tripsToCreate = (1 + extraDates.length) * (withReturn ? 2 : 1)

  return (
    <Modal
      size="lg"
      onClose={onClose}
      title={
        editing ? (
          <span className="flex flex-wrap items-center gap-2">
            Поездка {trip!.direction === 'back' ? '«обратно»' : '«туда»'}
            <StatusBadge status={trip!.status} />
          </span>
        ) : (
          'Новый заказ'
        )
      }
      subtitle={
        editing ? (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{fmtDateLong(trip!.trip_date)}</span>
            {seen === 'seen' && (
              <span className="inline-flex items-center gap-1 text-emerald-700">
                <Check className="size-3.5" /> водитель принял
              </span>
            )}
            {seen === 'unseen' && (
              <span className="inline-flex items-center gap-1 text-amber-700">
                <PhoneOff className="size-3.5" /> водитель ещё не видел изменений
              </span>
            )}
          </span>
        ) : (
          'Заполните и сохраните. Если машин нет — оформите отказ, он попадёт в статистику.'
        )
      }
      footer={
        <>
          <div className="mr-auto flex flex-wrap gap-2">
            {editing ? (
              <>
                <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={remove} disabled={busy}>
                  Удалить
                </Button>
                <Button variant="ghost" icon={<Copy className="size-4" />} onClick={repeat} disabled={busy}>
                  Повторить на другой день
                </Button>
              </>
            ) : (
              <Button variant="danger" onClick={() => onRefuse(refusalPrefill())} disabled={busy}>
                Оформить отказ
              </Button>
            )}
          </div>
          <Button onClick={onClose}>Закрыть</Button>
          <Button variant="primary" type="submit" form="trip-form" busy={busy}>
            {editing
              ? 'Сохранить'
              : `Создать ${tripsToCreate} ${plural(tripsToCreate, 'поездку', 'поездки', 'поездок')}`}
          </Button>
        </>
      }
    >
      <form id="trip-form" onSubmit={submit} className="space-y-5">
        <datalist id="trip-places">
          {client?.address && <option value={client.address} />}
          {places
            .filter((p) => p.is_active)
            .map((p) => (
              <option key={p.id} value={p.address ? `${p.name}, ${p.address}` : p.name} />
            ))}
        </datalist>

        <section>
          <div className="mb-1 text-sm font-medium text-slate-700">
            Клиент <span className="text-rose-600">*</span>
          </div>
          <ClientPicker value={client} onChange={pickClient} autoFocus={!editing && !client} />
          {clientSameDay.length > 0 && (
            <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200 ring-inset">
              У клиента в этот день уже есть {plural(clientSameDay.length, 'поездка', 'поездки', 'поездки')}:{' '}
              {clientSameDay
                .map((t) => `${fmtTime(t.pickup_time)} ${t.direction === 'back' ? 'обратно' : 'туда'}`)
                .join(', ')}
            </div>
          )}
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          <Field label="Дата" required>
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Забрать в" required>
            <input type="time" className="input" value={pickup} onChange={(e) => setPickup(e.target.value)} />
          </Field>
          <Field label="Быть на месте к">
            <input type="time" className="input" value={arriveBy} onChange={(e) => setArriveBy(e.target.value)} />
          </Field>
        </section>

        <section className="grid gap-2">
          <Field label="Откуда" required>
            <input
              className="input"
              list="trip-places"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              placeholder="Адрес, где забрать"
            />
          </Field>
          <div className="flex justify-center text-slate-400">
            <ArrowDown className="size-4" />
          </div>
          <Field label="Куда" required>
            <input
              className="input"
              list="trip-places"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="Начните вводить — подскажем из списка мест"
            />
          </Field>
        </section>

        {!editing && (
          <section className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200 ring-inset">
            <label className="flex items-center gap-2 font-medium text-slate-800">
              <input
                type="checkbox"
                className="size-4 accent-teal-700"
                checked={withReturn}
                onChange={(e) => setWithReturn(e.target.checked)}
              />
              Нужна обратная поездка
            </label>
            {withReturn && (
              <div className="mt-3 grid gap-4 sm:grid-cols-3">
                <Field label="Забрать обратно в" required>
                  <input
                    type="time"
                    className="input"
                    value={returnTime}
                    onChange={(e) => setReturnTime(e.target.value)}
                  />
                </Field>
                <Field label="Машина обратно" className="sm:col-span-2">
                  <select
                    className="input"
                    value={returnVehicle}
                    onChange={(e) => setReturnVehicle(e.target.value)}
                  >
                    <option value="same">Та же, что «туда»</option>
                    {vehicleChoices.map((v) => {
                      const l = returnTime ? loadOf(v, returnTime, '') : null
                      return (
                        <option key={v.id} value={v.id}>
                          {v.name}
                          {l ? ` — в это время клиентов: ${l.overlap.length}` : ''}
                        </option>
                      )
                    })}
                    <option value="">Без машины (распределить позже)</option>
                  </select>
                </Field>
              </div>
            )}
          </section>
        )}

        <section>
          <div className="mb-1 text-sm font-medium text-slate-700">Машина</div>
          <div className="grid gap-2">
            {loads.map(({ v, count, overlap, full }) => {
              const driver = profileById(v.driver_id)
              const selected = vehicleId === v.id
              return (
                <button
                  type="button"
                  key={v.id}
                  onClick={() => setVehicleId(v.id)}
                  className={cx(
                    'flex items-start gap-3 rounded-lg p-3 text-left ring-1 ring-inset transition-colors',
                    selected ? 'bg-brand-50 ring-2 ring-brand-600' : 'bg-white ring-slate-300 hover:bg-slate-50',
                  )}
                >
                  <span
                    className={cx(
                      'mt-1 flex size-4 shrink-0 items-center justify-center rounded-full ring-1 ring-inset',
                      selected ? 'bg-brand-700 ring-brand-700' : 'ring-slate-400',
                    )}
                  >
                    {selected && <span className="size-1.5 rounded-full bg-white" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-semibold text-slate-900">{v.name}</span>
                      {v.plate && <span className="text-sm text-slate-500">{v.plate}</span>}
                      <span className="text-sm text-slate-600">
                        {driver ? shortName(driver.full_name) : 'водитель не назначен'}
                      </span>
                    </span>
                    {pickup ? (
                      overlap.length === 0 ? (
                        <span className="mt-0.5 block text-sm text-emerald-700">В это время свободна</span>
                      ) : (
                        <span className={cx('mt-0.5 block text-sm', full ? 'text-amber-700' : 'text-slate-600')}>
                          {full ? `Мест нет (${overlap.length} из ${v.seats}): ` : `Попутно, уже ${overlap.length} из ${v.seats}: `}
                          {overlap
                            .map((t) => `${fmtTime(t.pickup_time)} ${shortName(t.client?.full_name ?? '—')}`)
                            .join(', ')}
                        </span>
                      )
                    ) : (
                      <span className="mt-0.5 block text-sm text-slate-400">Укажите время, чтобы увидеть занятость</span>
                    )}
                  </span>
                  <span className="shrink-0 text-right text-sm text-slate-500">
                    {count} {plural(count, 'поездка', 'поездки', 'поездок')}
                    <br />
                    за день
                  </span>
                </button>
              )
            })}
            <button
              type="button"
              onClick={() => setVehicleId('')}
              className={cx(
                'flex items-center gap-3 rounded-lg p-3 text-left text-sm ring-1 ring-inset',
                vehicleId === '' ? 'bg-brand-50 ring-2 ring-brand-600' : 'bg-white ring-slate-300 hover:bg-slate-50',
              )}
            >
              <span
                className={cx(
                  'flex size-4 shrink-0 items-center justify-center rounded-full ring-1 ring-inset',
                  vehicleId === '' ? 'bg-brand-700 ring-brand-700' : 'ring-slate-400',
                )}
              >
                {vehicleId === '' && <span className="size-1.5 rounded-full bg-white" />}
              </span>
              Без машины — распределить позже
            </button>
          </div>
          {noRoom && !editing && (
            <div className="mt-2 flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200 ring-inset">
              <span className="flex-1">
                На это время свободных мест в машинах нет. Если взять клиента не получается — оформите
                отказ.
              </span>
              <Button size="sm" variant="danger" onClick={() => onRefuse(refusalPrefill())}>
                Оформить отказ
              </Button>
            </div>
          )}
        </section>

        <Field label="Комментарий водителю">
          <textarea
            className="input"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Например: позвонить за 10 минут, подъезд со двора"
          />
        </Field>

        {!editing && (
          <section>
            <div className="mb-1 flex flex-wrap items-center gap-2 text-sm font-medium text-slate-700">
              <CalendarPlus className="size-4" /> Повторить этот же заказ в другие дни
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {extraDates.map((d) => (
                <Chip key={d} tone="brand" className="py-1 text-sm">
                  {fmtWeekday(d)}, {fmtDateShort(d)}
                  <button
                    type="button"
                    aria-label="Убрать дату"
                    onClick={() => setExtraDates((l) => l.filter((x) => x !== d))}
                  >
                    <X className="size-3.5" />
                  </button>
                </Chip>
              ))}
              <input
                type="date"
                className="input w-auto py-1.5 text-sm"
                value={extraDateInput}
                min={date}
                onChange={(e) => {
                  addExtraDate(e.target.value)
                  setExtraDateInput('')
                }}
              />
              <Button size="sm" variant="ghost" onClick={addNextWeekdays}>
                + 5 будних дней подряд
              </Button>
            </div>
          </section>
        )}

        {editing && (
          <section className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200 ring-inset">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Статус" hint="Обычно статус меняет водитель в приложении.">
                <select
                  className="input"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as TripStatus)}
                >
                  {STATUS_ORDER.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </Field>
              {status === 'cancelled' && (
                <Field label="Причина отмены" required>
                  <select
                    className="input"
                    value={reasonPreset}
                    onChange={(e) => setReasonPreset(e.target.value)}
                  >
                    {CANCEL_REASONS.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                  {reasonPreset === 'Другое' && (
                    <input
                      className="input mt-2"
                      value={reasonText}
                      onChange={(e) => setReasonText(e.target.value)}
                      placeholder="Опишите причину"
                    />
                  )}
                </Field>
              )}
            </div>
            {status !== 'cancelled' && trip!.status !== 'cancelled' && (
              <Button
                size="sm"
                variant="danger"
                className="mt-3"
                onClick={() => setStatus('cancelled')}
              >
                Отменить поездку…
              </Button>
            )}

            {pair && (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3 text-sm text-slate-700">
                <Clock className="size-4 text-slate-500" />
                Парная поездка «{pair.direction === 'back' ? 'обратно' : 'туда'}»:{' '}
                <b>
                  {pair.trip_date !== trip!.trip_date && `${fmtDateShort(pair.trip_date)}, `}
                  {fmtTime(pair.pickup_time)}
                </b>
                <StatusBadge status={pair.status} />
                <button
                  type="button"
                  className="font-medium text-brand-800 underline-offset-2 hover:underline"
                  onClick={() => onOpenTrip(pair.id)}
                >
                  открыть
                </button>
                {pairOpen && (cancelling || dateChanged) && (
                  <label className="ml-auto flex items-center gap-2 font-medium">
                    <input
                      type="checkbox"
                      className="size-4 accent-teal-700"
                      checked={alsoPair}
                      onChange={(e) => setAlsoPair(e.target.checked)}
                    />
                    {cancelling ? 'Отменить и её' : 'Перенести и её на ту же дату'}
                  </label>
                )}
              </div>
            )}
          </section>
        )}

        {editing && (
          <section>
            <button
              type="button"
              className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900"
              onClick={() => setShowHistory((v) => !v)}
            >
              <History className="size-4" />
              История изменений {events ? `(${events.length})` : ''}
            </button>
            {showHistory && events && (
              <ul className="mt-2 space-y-1 text-sm">
                {events.map((e) => (
                  <li key={e.id} className="flex gap-3">
                    <span className="w-24 shrink-0 text-slate-500 tabular-nums">{fmtStamp(e.at)}</span>
                    <span className="flex-1 text-slate-800">{eventText(e)}</span>
                    <span className="text-slate-500">
                      {profileById(e.actor_id)?.full_name ?? (e.actor_id ? '—' : 'система')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <ErrorNote>{error}</ErrorNote>
        {vehicles.length === 0 && (
          <p className="text-sm text-slate-500">
            Машины ещё не добавлены — это делается в разделе «Настройки».
          </p>
        )}
      </form>
    </Modal>
  )
}
