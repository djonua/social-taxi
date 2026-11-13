import type { Mobility, RefusalReason, Role, Trip, TripStatus } from './types'

// ───── Даты и время (всё — местное время устройства) ─────

const pad = (n: number) => String(n).padStart(2, '0')

export function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function fromISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function todayISO(): string {
  return toISO(new Date())
}

export function addDays(iso: string, n: number): string {
  const d = fromISO(iso)
  d.setDate(d.getDate() + n)
  return toISO(d)
}

export function nowHHMM(): string {
  const d = new Date()
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const longFmt = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })
const shortFmt = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' })
const dayMonthFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' })
const weekdayFmt = new Intl.DateTimeFormat('ru-RU', { weekday: 'short' })
const stampFmt = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})
const clockFmt = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' })

/** «вторник, 10 ноября» */
export const fmtDateLong = (iso: string) => longFmt.format(fromISO(iso))
/** «10.11» */
export const fmtDateShort = (iso: string) => shortFmt.format(fromISO(iso))
/** «10 нояб.» */
export const fmtDayMonth = (iso: string) => dayMonthFmt.format(fromISO(iso))
/** «вт» */
export const fmtWeekday = (iso: string) => weekdayFmt.format(fromISO(iso))
/** timestamptz → «10.11, 14:05» */
export const fmtStamp = (ts: string) => stampFmt.format(new Date(ts))
/** timestamptz → «14:05» */
export const fmtClock = (ts: string) => clockFmt.format(new Date(ts))

export function relativeDayLabel(iso: string): string | null {
  const today = todayISO()
  if (iso === today) return 'Сегодня'
  if (iso === addDays(today, 1)) return 'Завтра'
  if (iso === addDays(today, -1)) return 'Вчера'
  return null
}

/** '09:00:00' → '09:00' */
export function fmtTime(t: string | null | undefined): string {
  return t ? t.slice(0, 5) : ''
}

export function timeToMin(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + (m || 0)
}

export function minToTime(min: number): string {
  const m = ((min % 1440) + 1440) % 1440
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
}

// ───── Справочники ─────

export const STATUS_LABEL: Record<TripStatus, string> = {
  planned: 'Запланирована',
  en_route: 'Едет к клиенту',
  arrived: 'На месте, ждёт',
  in_progress: 'Везёт клиента',
  completed: 'Выполнена',
  cancelled: 'Отменена',
}

export const STATUS_ORDER: TripStatus[] = [
  'planned',
  'en_route',
  'arrived',
  'in_progress',
  'completed',
  'cancelled',
]

/** Классы Tailwind для значка статуса */
export const STATUS_STYLE: Record<TripStatus, string> = {
  planned: 'bg-slate-100 text-slate-700 ring-slate-300',
  en_route: 'bg-amber-100 text-amber-900 ring-amber-300',
  arrived: 'bg-violet-100 text-violet-900 ring-violet-300',
  in_progress: 'bg-sky-100 text-sky-900 ring-sky-300',
  completed: 'bg-emerald-100 text-emerald-900 ring-emerald-300',
  cancelled: 'bg-rose-100 text-rose-900 ring-rose-300',
}

/** Цвет полоски слева на карточке */
export const STATUS_BAR: Record<TripStatus, string> = {
  planned: 'bg-slate-300',
  en_route: 'bg-amber-400',
  arrived: 'bg-violet-500',
  in_progress: 'bg-sky-500',
  completed: 'bg-emerald-500',
  cancelled: 'bg-rose-400',
}

export const MOBILITY_LABEL: Record<Mobility, string> = {
  walks: 'Ходит сам',
  assist: 'Нужна помощь',
  wheelchair: 'Инвалидная коляска',
}

export const MOBILITY_SHORT: Record<Mobility, string> = {
  walks: 'Ходит сам',
  assist: 'Помощь',
  wheelchair: 'Коляска',
}

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Администратор',
  dispatcher: 'Диспетчер',
  driver: 'Водитель',
}

export const REFUSAL_REASON_LABEL: Record<RefusalReason, string> = {
  no_cars: 'Нет свободной машины на это время',
  out_of_hours: 'Нерабочее время',
  out_of_area: 'Вне зоны обслуживания',
  other: 'Другое',
}

export const REFUSAL_REASON_SHORT: Record<RefusalReason, string> = {
  no_cars: 'Нет свободной машины',
  out_of_hours: 'Нерабочее время',
  out_of_area: 'Вне зоны',
  other: 'Другое',
}

export const CANCEL_REASONS = [
  'Клиент отменил',
  'Клиент заболел',
  'Клиент не вышел',
  'Занятие перенесли',
  'Поломка машины',
  'Другое',
]

// ───── Поездки ─────

/** Сколько минут закладываем на поездку, если не указано «быть к». */
export const DEFAULT_TRIP_MIN = 30

export function tripInterval(t: Pick<Trip, 'pickup_time' | 'arrive_by'>): [number, number] {
  const start = timeToMin(t.pickup_time)
  const end = t.arrive_by ? timeToMin(t.arrive_by) : start + DEFAULT_TRIP_MIN
  return [start, Math.max(end, start + 10)]
}

export function isActiveStatus(s: TripStatus): boolean {
  return s === 'en_route' || s === 'arrived' || s === 'in_progress'
}

export type SeenState = 'none' | 'seen' | 'unseen'

/** Видел ли водитель актуальную версию заказа. */
export function seenState(t: Trip): SeenState {
  if (!t.vehicle_id || t.status === 'completed') return 'none'
  if (!t.driver_seen_at) return 'unseen'
  return new Date(t.driver_seen_at) >= new Date(t.changed_at) ? 'seen' : 'unseen'
}

/** Короткая запись адреса для карточки: убираем название города. */
export function shortAddress(a: string | null | undefined): string {
  if (!a) return '—'
  const short = a
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part && !/^(г\.?\s*)?Сухуми?$/i.test(part))
    .join(', ')
  return short || a
}

/** «Агрба Ахра Русланович» → «Агрба А.Р.» */
export function shortName(full: string): string {
  const parts = full.trim().split(/\s+/)
  const initials = parts
    .slice(1, 3)
    .filter((p) => /^\p{L}/u.test(p))
    .map((p) => p[0].toUpperCase() + '.')
    .join('')
  return initials ? `${parts[0]} ${initials}` : parts[0]
}

export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

export function errorText(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e && typeof e.message === 'string') {
    const m = e.message
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Нет связи с сервером. Проверьте интернет.'
    if (/violates foreign key/i.test(m)) return 'Нельзя удалить: есть связанные записи.'
    if (/row-level security/i.test(m)) return 'Недостаточно прав для этого действия.'
    return m
  }
  return 'Что-то пошло не так'
}
