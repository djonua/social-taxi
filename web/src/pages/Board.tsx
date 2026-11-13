import {
  Accessibility,
  Ban,
  Check,
  ChevronLeft,
  ChevronRight,
  EyeOff,
  MessageSquareText,
  Phone,
  Plus,
  UserRound,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { RefusalDialog } from '../components/RefusalDialog'
import { TripDialog } from '../components/TripDialog'
import type { RefusalPrefill, TripPrefill } from '../components/TripDialog'
import { Button, Chip, cx, Spinner, StatusBadge } from '../components/ui'
import { useDirectory, useRealtime } from '../lib/data'
import {
  addDays,
  fmtClock,
  fmtDateLong,
  fmtTime,
  isActiveStatus,
  MOBILITY_SHORT,
  plural,
  REFUSAL_REASON_SHORT,
  relativeDayLabel,
  seenState,
  shortAddress,
  STATUS_BAR,
  todayISO,
} from '../lib/format'
import { supabase } from '../lib/supabase'
import type { Refusal, Trip, Vehicle } from '../lib/types'

type Dialog =
  | { kind: 'trip'; key: number; trip?: Trip; prefill?: TripPrefill }
  | { kind: 'refusal'; key: number; refusal?: Refusal; prefill?: RefusalPrefill }
  | null

let dialogKey = 0

export function BoardPage() {
  const { vehicles, clients, profileById, ready } = useDirectory()
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()

  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('d') ?? '') ? params.get('d')! : todayISO()
  const setDate = (d: string) => setParams(d === todayISO() ? {} : { d }, { replace: true })

  const [trips, setTrips] = useState<Trip[]>([])
  const [refusals, setRefusals] = useState<Refusal[]>([])
  const [loadedDate, setLoadedDate] = useState('')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [toast, setToast] = useState('')

  const load = useCallback(async () => {
    const [t, r] = await Promise.all([
      supabase
        .from('trips')
        .select('*, client:clients(*)')
        .eq('trip_date', date)
        .order('pickup_time')
        .order('created_at'),
      supabase.from('refusals').select('*').eq('req_date', date).order('req_time'),
    ])
    if (t.error || r.error) {
      setToast('Не удалось загрузить данные. Проверьте связь.')
      return
    }
    setTrips((t.data ?? []) as Trip[])
    setRefusals((r.data ?? []) as Refusal[])
    setLoadedDate(date)
  }, [date])

  useEffect(() => {
    void load()
  }, [load])
  useRealtime(['trips', 'refusals'], load)

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 5000)
    return () => clearTimeout(t)
  }, [toast])

  // Переход из карточки клиента: «Создать заказ»
  const newTripFor = (location.state as { newTripFor?: string } | null)?.newTripFor
  useEffect(() => {
    if (!newTripFor || !ready) return
    const client = clients.find((c) => c.id === newTripFor)
    navigate(location.pathname + location.search, { replace: true, state: null })
    if (client) setDialog({ kind: 'trip', key: ++dialogKey, prefill: { client } })
  }, [newTripFor, ready, clients, navigate, location.pathname, location.search])

  const columns = useMemo(() => {
    const used = new Set(trips.map((t) => t.vehicle_id).filter(Boolean))
    return vehicles.filter((v) => v.is_active || used.has(v.id))
  }, [vehicles, trips])

  const unassigned = trips.filter((t) => !t.vehicle_id)

  // Поездки, у которых парная («туда» или «обратно») отменена, а сама ещё в плане:
  // диспетчеру стоит решить, нужна ли она.
  const orphaned = useMemo(() => {
    const cancelledPairs = new Set(
      trips.filter((t) => t.pair_id && t.status === 'cancelled').map((t) => t.pair_id),
    )
    return new Set(
      trips
        .filter((t) => t.pair_id && cancelledPairs.has(t.pair_id) && t.status === 'planned')
        .map((t) => t.id),
    )
  }, [trips])

  const stats = useMemo(() => {
    const s = { total: 0, completed: 0, active: 0, planned: 0, cancelled: 0, unseen: 0 }
    for (const t of trips) {
      if (t.status === 'cancelled') s.cancelled++
      else s.total++
      if (t.status === 'completed') s.completed++
      else if (isActiveStatus(t.status)) s.active++
      else if (t.status === 'planned') s.planned++
      if (seenState(t) === 'unseen') s.unseen++
    }
    return s
  }, [trips])

  async function moveTrip(tripId: string, vehicleId: string | null) {
    const trip = trips.find((t) => t.id === tripId)
    if (!trip || trip.vehicle_id === vehicleId) return
    setTrips((list) => list.map((t) => (t.id === tripId ? { ...t, vehicle_id: vehicleId } : t)))
    const { error } = await supabase.from('trips').update({ vehicle_id: vehicleId }).eq('id', tripId)
    if (error) {
      setToast('Не удалось переназначить поездку')
      void load()
    }
  }

  async function openTripById(id: string) {
    const { data } = await supabase.from('trips').select('*, client:clients(*)').eq('id', id).maybeSingle()
    if (data) setDialog({ kind: 'trip', key: ++dialogKey, trip: data as Trip })
  }

  const closeAndReload = () => {
    setDialog(null)
    void load()
  }

  const rel = relativeDayLabel(date)
  const loading = loadedDate !== date
  const isPast = date < todayISO()

  function dropProps(id: string, vehicleId: string | null) {
    return {
      onDragOver: (e: React.DragEvent) => {
        if (!dragId) return
        e.preventDefault()
        setDropTarget(id)
      },
      onDragLeave: (e: React.DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget(null)
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault()
        const tripId = e.dataTransfer.getData('text/trip') || dragId
        setDropTarget(null)
        setDragId(null)
        if (tripId) void moveTrip(tripId, vehicleId)
      },
    }
  }

  const cardProps = (t: Trip) => ({
    trip: t,
    onOpen: () => setDialog({ kind: 'trip', key: ++dialogKey, trip: t }),
    onDragStart: () => setDragId(t.id),
    onDragEnd: () => {
      setDragId(null)
      setDropTarget(null)
    },
    dragging: dragId === t.id,
    pairCancelled: orphaned.has(t.id),
  })

  return (
    <div className="flex h-full flex-col">
      {/* Панель дня */}
      <div className="border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="flex items-center gap-1">
            <button
              aria-label="Предыдущий день"
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
              onClick={() => setDate(addDays(date, -1))}
            >
              <ChevronLeft className="size-5" />
            </button>
            <label className="relative cursor-pointer rounded-lg px-2 py-1 hover:bg-slate-100">
              <span className="block text-lg leading-tight font-semibold text-slate-900 first-letter:uppercase">
                {rel ? `${rel}, ` : ''}
                {fmtDateLong(date)}
              </span>
              <input
                type="date"
                aria-label="Выбрать дату"
                className="absolute inset-0 cursor-pointer opacity-0"
                value={date}
                onChange={(e) => e.target.value && setDate(e.target.value)}
                onClick={(e) => (e.currentTarget as HTMLInputElement).showPicker?.()}
              />
            </label>
            <button
              aria-label="Следующий день"
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
              onClick={() => setDate(addDays(date, 1))}
            >
              <ChevronRight className="size-5" />
            </button>
            <div className="ml-1 flex gap-1">
              {[
                ['Сегодня', todayISO()],
                ['Завтра', addDays(todayISO(), 1)],
              ].map(([label, d]) => (
                <button
                  key={label}
                  onClick={() => setDate(d)}
                  className={cx(
                    'rounded-lg px-2.5 py-1.5 text-sm font-medium',
                    d === date ? 'bg-brand-700 text-white' : 'text-slate-700 ring-1 ring-slate-300 ring-inset hover:bg-slate-50',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <Chip className="px-2 py-1 text-sm">
              {stats.total} {plural(stats.total, 'поездка', 'поездки', 'поездок')}
            </Chip>
            {stats.completed > 0 && (
              <Chip tone="emerald" className="px-2 py-1 text-sm">
                выполнено {stats.completed}
              </Chip>
            )}
            {stats.active > 0 && (
              <Chip tone="sky" className="px-2 py-1 text-sm">
                в работе {stats.active}
              </Chip>
            )}
            {stats.cancelled > 0 && (
              <Chip tone="rose" className="px-2 py-1 text-sm">
                отменено {stats.cancelled}
              </Chip>
            )}
            {refusals.length > 0 && (
              <Chip tone="rose" className="px-2 py-1 text-sm">
                <Ban className="size-3.5" /> отказов {refusals.length}
              </Chip>
            )}
            {stats.unseen > 0 && !isPast && (
              <Chip tone="amber" className="px-2 py-1 text-sm" title="Водители ещё не подтвердили эти заказы в приложении">
                <EyeOff className="size-3.5" /> не принято водителями {stats.unseen}
              </Chip>
            )}
          </div>

          <div className="ml-auto flex gap-2">
            <Button
              variant="danger"
              icon={<Ban className="size-4" />}
              onClick={() => setDialog({ kind: 'refusal', key: ++dialogKey })}
            >
              Отказ
            </Button>
            <Button
              variant="primary"
              icon={<Plus className="size-4" />}
              onClick={() => setDialog({ kind: 'trip', key: ++dialogKey })}
            >
              Новый заказ
            </Button>
          </div>
        </div>
      </div>

      {/* Колонки машин */}
      <div className="min-h-0 flex-1 overflow-auto px-4 py-4 sm:px-6">
        {loading ? (
          <Spinner />
        ) : (
          <>
            <div className="flex items-start gap-4">
              {columns.map((v) => (
                <VehicleColumn
                  key={v.id}
                  vehicle={v}
                  driverName={profileById(v.driver_id)?.full_name}
                  driverPhone={profileById(v.driver_id)?.phone}
                  trips={trips.filter((t) => t.vehicle_id === v.id)}
                  highlight={dropTarget === v.id}
                  dropProps={dropProps(v.id, v.id)}
                  cardProps={cardProps}
                />
              ))}

              {(unassigned.length > 0 || dragId) && (
                <div
                  className={cx(
                    'w-[340px] shrink-0 rounded-xl p-2 ring-1 transition-colors',
                    dropTarget === 'none' ? 'bg-brand-50 ring-2 ring-brand-500' : 'bg-amber-50 ring-amber-200',
                  )}
                  {...dropProps('none', null)}
                >
                  <div className="px-2 py-1.5">
                    <div className="font-semibold text-amber-900">Без машины</div>
                    <div className="text-sm text-amber-800">
                      {unassigned.length
                        ? 'Перетащите на машину или откройте заказ'
                        : 'Перетащите сюда, чтобы снять с машины'}
                    </div>
                  </div>
                  <div className="mt-1 space-y-2">
                    {unassigned.map((t) => (
                      <TripCard key={t.id} {...cardProps(t)} />
                    ))}
                  </div>
                </div>
              )}

              {columns.length === 0 && unassigned.length === 0 && (
                <div className="rounded-xl bg-white p-6 text-slate-600 ring-1 ring-slate-200">
                  Пока нет ни одной машины. Добавьте машины и водителей в разделе «Настройки».
                </div>
              )}
            </div>

            {refusals.length > 0 && (
              <section className="mt-6 max-w-4xl">
                <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold tracking-wide text-rose-800 uppercase">
                  <Ban className="size-4" /> Отказы на этот день — {refusals.length}
                </h2>
                <div className="divide-y divide-slate-100 rounded-xl bg-white ring-1 ring-slate-200">
                  {refusals.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setDialog({ kind: 'refusal', key: ++dialogKey, refusal: r })}
                      className="flex w-full flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-2.5 text-left text-sm hover:bg-slate-50"
                    >
                      <span className="w-12 font-semibold text-slate-900 tabular-nums">
                        {fmtTime(r.req_time) || '—'}
                      </span>
                      <span className="font-medium text-slate-900">{r.client_name ?? 'Без имени'}</span>
                      <span className="text-slate-500">{r.phone}</span>
                      <span className="text-slate-600">
                        {shortAddress(r.from_address)} → {shortAddress(r.to_address)}
                      </span>
                      <Chip tone="rose" className="ml-auto">
                        {REFUSAL_REASON_SHORT[r.reason]}
                      </Chip>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}

      {dialog?.kind === 'trip' && (
        <TripDialog
          key={dialog.key}
          trip={dialog.trip}
          prefill={dialog.prefill}
          defaultDate={date}
          onClose={() => setDialog(null)}
          onSaved={closeAndReload}
          onRefuse={(prefill) => setDialog({ kind: 'refusal', key: ++dialogKey, prefill })}
          onRepeat={(prefill) => setDialog({ kind: 'trip', key: ++dialogKey, prefill })}
          onOpenTrip={openTripById}
        />
      )}
      {dialog?.kind === 'refusal' && (
        <RefusalDialog
          key={dialog.key}
          refusal={dialog.refusal}
          prefill={dialog.prefill}
          defaultDate={date}
          onClose={() => setDialog(null)}
          onSaved={closeAndReload}
        />
      )}
    </div>
  )
}

interface CardProps {
  trip: Trip
  onOpen: () => void
  onDragStart: () => void
  onDragEnd: () => void
  dragging: boolean
  pairCancelled: boolean
}

function VehicleColumn({
  vehicle,
  driverName,
  driverPhone,
  trips,
  highlight,
  dropProps,
  cardProps,
}: {
  vehicle: Vehicle
  driverName?: string
  driverPhone?: string | null
  trips: Trip[]
  highlight: boolean
  dropProps: object
  cardProps: (t: Trip) => CardProps
}) {
  const live = trips.filter((t) => t.status !== 'cancelled')
  const done = live.filter((t) => t.status === 'completed').length
  const inCar = live.filter((t) => t.status === 'in_progress').length
  const share = Math.min(100, Math.round((live.length / vehicle.daily_limit) * 100))

  return (
    <div
      className={cx(
        'w-[340px] shrink-0 rounded-xl p-2 ring-1 transition-colors',
        highlight ? 'bg-brand-50 ring-2 ring-brand-500' : 'bg-slate-200/60 ring-slate-200',
      )}
      {...dropProps}
    >
      <div className="rounded-lg bg-white px-3 py-2.5 shadow-sm ring-1 ring-slate-200">
        <div className="flex items-baseline gap-2">
          <span className="text-base font-semibold text-slate-900">{vehicle.name}</span>
          {vehicle.plate && <span className="text-sm text-slate-500">{vehicle.plate}</span>}
          {!vehicle.is_active && <Chip tone="slate">отключена</Chip>}
          <span className="ml-auto text-sm font-semibold text-slate-700 tabular-nums" title="Выполнено / всего поездок за день">
            {done} / {live.length}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-sm text-slate-600">
          <UserRound className="size-3.5 shrink-0" />
          {driverName ? (
            <>
              <span className="truncate">{driverName}</span>
              {driverPhone && (
                <a href={`tel:${driverPhone}`} className="ml-auto inline-flex shrink-0 items-center gap-1 text-brand-800 hover:underline">
                  <Phone className="size-3.5" />
                  {driverPhone}
                </a>
              )}
            </>
          ) : (
            <span className="text-amber-700">водитель не назначен</span>
          )}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <div
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200"
            title={`Загрузка относительно ориентира ${vehicle.daily_limit} поездок в день`}
          >
            <div className="h-full rounded-full bg-brand-600" style={{ width: `${share}%` }} />
          </div>
          {inCar > 0 && (
            <Chip tone="sky">
              <Users className="size-3.5" /> в машине {inCar}
            </Chip>
          )}
        </div>
      </div>

      <div className="mt-2 space-y-2">
        {trips.map((t) => (
          <TripCard key={t.id} {...cardProps(t)} />
        ))}
        {trips.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-500">
            Поездок нет
          </div>
        )}
      </div>
    </div>
  )
}

function TripCard({ trip, onOpen, onDragStart, onDragEnd, dragging, pairCancelled }: CardProps) {
  const c = trip.client
  const cancelled = trip.status === 'cancelled'
  const done = trip.status === 'completed'
  const seen = seenState(trip)
  const stamp =
    trip.status === 'completed'
      ? trip.completed_at
      : trip.status === 'in_progress'
        ? trip.picked_up_at
        : trip.status === 'arrived'
          ? trip.arrived_at
          : trip.status === 'en_route'
            ? trip.started_at
            : null

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/trip', trip.id)
        e.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      className={cx(
        'relative cursor-pointer overflow-hidden rounded-lg bg-white py-2.5 pr-3 pl-4 text-left shadow-sm ring-1 ring-slate-200 transition',
        'hover:shadow-md hover:ring-slate-300 focus-visible:outline-2 focus-visible:outline-brand-600',
        isActiveStatus(trip.status) && 'ring-2 ring-sky-400',
        (cancelled || done) && 'opacity-70',
        dragging && 'opacity-40',
      )}
    >
      <span className={cx('absolute inset-y-0 left-0 w-1.5', STATUS_BAR[trip.status])} />

      <div className="flex items-start gap-2">
        <div className={cx('text-xl leading-none font-bold text-slate-900 tabular-nums', cancelled && 'line-through')}>
          {fmtTime(trip.pickup_time)}
        </div>
        {trip.arrive_by && (
          <div className="pt-0.5 text-xs text-slate-500">
            быть к <b className="text-slate-700">{fmtTime(trip.arrive_by)}</b>
          </div>
        )}
        <StatusBadge status={trip.status} className="ml-auto shrink-0" />
      </div>

      <div className={cx('mt-1.5 font-semibold text-slate-900', cancelled && 'line-through')}>
        {c?.full_name ?? 'Клиент удалён'}
      </div>

      <div className="mt-0.5 text-sm text-slate-600">
        {shortAddress(trip.from_address)} <span className="text-slate-400">→</span>{' '}
        {shortAddress(trip.to_address)}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Chip tone={trip.direction === 'back' ? 'slate' : 'brand'}>
          {trip.direction === 'back' ? 'Обратно' : 'Туда'}
        </Chip>
        {c && c.mobility !== 'walks' && (
          <Chip tone={c.mobility === 'wheelchair' ? 'sky' : 'slate'}>
            {c.mobility === 'wheelchair' && <Accessibility className="size-3.5" />}
            {MOBILITY_SHORT[c.mobility]}
          </Chip>
        )}
        {c?.escort && <Chip>+ сопр.</Chip>}
        {trip.note && (
          <Chip tone="amber" title={trip.note}>
            <MessageSquareText className="size-3.5" />
          </Chip>
        )}
        <span className="ml-auto inline-flex items-center gap-2 text-xs">
          {stamp && !cancelled && <span className="text-slate-500">{fmtClock(stamp)}</span>}
          {!stamp && seen === 'seen' && (
            <span className="inline-flex items-center gap-0.5 text-emerald-700" title="Водитель принял заказ">
              <Check className="size-3.5" /> принял
            </span>
          )}
          {seen === 'unseen' && (
            <span className="inline-flex items-center gap-0.5 font-medium text-amber-700" title="Водитель ещё не подтвердил заказ в приложении">
              <EyeOff className="size-3.5" /> не видел
            </span>
          )}
        </span>
      </div>

      {pairCancelled && (
        <div className="mt-1.5 rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900 ring-1 ring-amber-200 ring-inset">
          Поездка «{trip.direction === 'back' ? 'туда' : 'обратно'}» отменена — проверьте, нужна ли эта
        </div>
      )}

      {cancelled && trip.cancel_reason && (
        <div className="mt-1.5 text-xs font-medium text-rose-700">Причина: {trip.cancel_reason}</div>
      )}
    </div>
  )
}
