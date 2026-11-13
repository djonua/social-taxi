import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Card, cx, ErrorNote, PageHeader, Spinner } from '../components/ui'
import {
  addDays,
  errorText,
  fmtDateShort,
  fmtDayMonth,
  fmtWeekday,
  plural,
  REFUSAL_REASON_LABEL,
  todayISO,
  toISO,
} from '../lib/format'
import { supabase } from '../lib/supabase'
import type { StatsReport } from '../lib/types'

// Цвета рядов: фиксированы за сущностью (принятые поездки / отказы) на всех графиках.
const VIZ = {
  '--viz-accepted': '#2a78d6',
  '--viz-refused': '#eb6834',
  '--viz-neutral': '#64748b',
} as CSSProperties

const SERIES = [
  { name: 'Принятые поездки', color: 'var(--viz-accepted)' },
  { name: 'Отказы', color: 'var(--viz-refused)' },
]

type Preset = '7' | '14' | '30' | 'month' | 'custom'

function presetRange(p: Preset): [string, string] {
  const today = todayISO()
  if (p === 'month') {
    const d = new Date()
    return [toISO(new Date(d.getFullYear(), d.getMonth(), 1)), today]
  }
  return [addDays(today, -(Number(p) - 1)), today]
}

export function StatsPage() {
  const [preset, setPreset] = useState<Preset>('14')
  const [from, setFrom] = useState(() => presetRange('14')[0])
  const [to, setTo] = useState(() => presetRange('14')[1])
  const [report, setReport] = useState<StatsReport | null>(null)
  const [error, setError] = useState('')
  const [showTable, setShowTable] = useState(false)

  useEffect(() => {
    let cancelled = false
    setError('')
    supabase.rpc('stats_report', { p_from: from, p_to: to }).then(({ data, error }) => {
      if (cancelled) return
      if (error) setError(errorText(error))
      else setReport(data as StatsReport)
    })
    return () => {
      cancelled = true
    }
  }, [from, to])

  function choose(p: Preset) {
    setPreset(p)
    if (p !== 'custom') {
      const [a, b] = presetRange(p)
      setFrom(a)
      setTo(b)
    }
  }

  const totals = useMemo(() => {
    if (!report) return null
    const days = report.days
    const sum = (f: (d: StatsReport['days'][number]) => number) => days.reduce((a, d) => a + f(d), 0)
    const completed = sum((d) => d.completed)
    const pending = sum((d) => d.pending)
    const cancelled = sum((d) => d.cancelled)
    const refusals = sum((d) => d.refusals)
    const refusedTrips = sum((d) => d.refused_trips)
    const demand = completed + pending + refusedTrips
    const perDay = days.map((d) => d.completed + d.pending + d.refused_trips).filter((n) => n > 0)
    const avgDemand = perDay.length ? perDay.reduce((a, b) => a + b, 0) / perDay.length : 0
    const peakDemand = perDay.length ? Math.max(...perDay) : 0
    const limit = report.avg_limit || 16
    return {
      completed,
      pending,
      cancelled,
      refusals,
      refusedTrips,
      demand,
      unmetShare: demand ? refusedTrips / demand : 0,
      avgDemand,
      peakDemand,
      limit,
      needAvg: Math.ceil(avgDemand / limit),
      needPeak: Math.ceil(peakDemand / limit),
      workDays: perDay.length,
    }
  }, [report])

  const dayCols = useMemo(() => {
    if (!report) return []
    return report.days.map((d) => ({
      id: d.date,
      label: fmtDateShort(d.date),
      title: `${fmtWeekday(d.date)}, ${fmtDayMonth(d.date)}`,
      values: [d.completed + d.pending, d.refused_trips],
    }))
  }, [report])

  const hourCols = useMemo(() => {
    if (!report) return []
    const withData = report.hours.filter((h) => h.trips + h.refusals > 0).map((h) => h.hour)
    const lo = Math.min(8, ...withData)
    const hi = Math.max(18, ...withData)
    return report.hours
      .filter((h) => h.hour >= lo && h.hour <= hi)
      .map((h) => ({
        id: String(h.hour),
        label: String(h.hour).padStart(2, '0'),
        title: `${String(h.hour).padStart(2, '0')}:00–${String(h.hour).padStart(2, '0')}:59`,
        values: [h.trips, h.refusals],
      }))
  }, [report])

  const capacity = report ? report.active_vehicles * (report.avg_limit || 16) : 0

  return (
    <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6" style={VIZ}>
      <PageHeader
        title="Статистика"
        subtitle="Спрос = принятые поездки + отказы. Отсюда видно, сколько машин нужно на самом деле."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        {(
          [
            ['7', '7 дней'],
            ['14', '14 дней'],
            ['30', '30 дней'],
            ['month', 'Этот месяц'],
            ['custom', 'Свой период'],
          ] as [Preset, string][]
        ).map(([p, label]) => (
          <button
            key={p}
            onClick={() => choose(p)}
            className={cx(
              'rounded-lg px-3 py-1.5 font-medium',
              preset === p ? 'bg-brand-700 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-300 ring-inset hover:bg-slate-50',
            )}
          >
            {label}
          </button>
        ))}
        {preset === 'custom' && (
          <>
            <input type="date" className="input w-auto py-1.5" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
            <span>—</span>
            <input type="date" className="input w-auto py-1.5" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
          </>
        )}
      </div>

      <ErrorNote>{error}</ErrorNote>
      {!report || !totals ? (
        !error && <Spinner />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile
              label="Нужно машин"
              value={totals.workDays ? String(totals.needAvg) : '—'}
              note={
                totals.workDays
                  ? `в пиковый день — ${totals.needPeak} · сейчас работает ${report.active_vehicles}`
                  : 'за период нет данных'
              }
              tone={totals.needAvg > report.active_vehicles ? 'warn' : 'plain'}
            />
            <Tile
              label="Отказов"
              value={String(totals.refusals)}
              note={`это ${totals.refusedTrips} ${plural(totals.refusedTrips, 'несостоявшаяся поездка', 'несостоявшиеся поездки', 'несостоявшихся поездок')} · ${Math.round(totals.unmetShare * 100)}% спроса`}
            />
            <Tile
              label="Выполнено поездок"
              value={String(totals.completed)}
              note={totals.pending ? `ещё запланировано ${totals.pending}` : 'в одну сторону'}
            />
            <Tile label="Отменено" value={String(totals.cancelled)} note="причины — ниже" />
          </div>

          <Card className="p-4">
            <ChartHeader
              title="Спрос по дням"
              subtitle={`Поездки в одну сторону. Пунктир — ориентир загрузки: ${report.active_vehicles} ${plural(report.active_vehicles, 'машина', 'машины', 'машин')} × ${totals.limit} поездок в день.`}
            />
            <StackedColumns cols={dayCols} refLine={capacity ? { value: capacity, label: `ориентир ${capacity}` } : undefined} unit={['поездка', 'поездки', 'поездок']} />
            <button className="mt-3 text-sm font-medium text-brand-800 hover:underline" onClick={() => setShowTable((v) => !v)}>
              {showTable ? 'Скрыть таблицу' : 'Показать таблицей'}
            </button>
            {showTable && (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-right text-sm tabular-nums">
                  <thead className="border-b border-slate-200 text-xs text-slate-500">
                    <tr>
                      <th className="py-1.5 text-left font-medium">День</th>
                      <th className="px-2 font-medium">Выполнено</th>
                      <th className="px-2 font-medium">Запланировано</th>
                      <th className="px-2 font-medium">Отменено</th>
                      <th className="px-2 font-medium">Отказов</th>
                      <th className="px-2 font-medium">Отказано поездок</th>
                      <th className="pl-2 font-medium">Нужно машин</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {report.days.map((d) => {
                      const demand = d.completed + d.pending + d.refused_trips
                      return (
                        <tr key={d.date}>
                          <td className="py-1.5 text-left text-slate-700">
                            {fmtDateShort(d.date)}, {fmtWeekday(d.date)}
                          </td>
                          <td className="px-2">{d.completed}</td>
                          <td className="px-2">{d.pending}</td>
                          <td className="px-2">{d.cancelled}</td>
                          <td className="px-2">{d.refusals}</td>
                          <td className="px-2">{d.refused_trips}</td>
                          <td className="pl-2 font-medium">{demand ? Math.ceil(demand / totals.limit) : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card className="p-4">
            <ChartHeader
              title="В какие часы не хватает машин"
              subtitle="Принятые поездки и отказы (обращения) по времени подачи, за весь период."
            />
            <StackedColumns cols={hourCols} unit={['', '', '']} height={180} />
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <ChartHeader title="Причины отказов" />
              <HBars
                color="var(--viz-refused)"
                rows={report.refusal_reasons.map((r) => ({
                  label: REFUSAL_REASON_LABEL[r.reason] ?? r.reason,
                  value: r.count,
                }))}
                empty="Отказов за период нет"
              />
            </Card>
            <Card className="p-4">
              <ChartHeader title="Причины отмен" />
              <HBars
                color="var(--viz-neutral)"
                rows={report.cancel_reasons.map((r) => ({ label: r.reason, value: r.count }))}
                empty="Отмен за период нет"
              />
            </Card>
          </div>

          <Card className="p-4">
            <ChartHeader title="Нагрузка по машинам" />
            <table className="w-full text-right text-sm tabular-nums">
              <thead className="border-b border-slate-200 text-xs text-slate-500">
                <tr>
                  <th className="py-1.5 text-left font-medium">Машина</th>
                  <th className="px-2 font-medium">Поездок</th>
                  <th className="px-2 font-medium">Выполнено</th>
                  <th className="px-2 font-medium">Рабочих дней</th>
                  <th className="pl-2 font-medium">В среднем за день</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.vehicles
                  .filter((v) => v.is_active || v.total > 0)
                  .map((v) => (
                    <tr key={v.id}>
                      <td className="py-1.5 text-left font-medium text-slate-800">{v.name}</td>
                      <td className="px-2">{v.total}</td>
                      <td className="px-2">{v.completed}</td>
                      <td className="px-2">{v.work_days}</td>
                      <td className="pl-2">{v.work_days ? (v.total / v.work_days).toFixed(1) : '—'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </Card>

          <p className="text-xs text-slate-500">
            Как считается «Нужно машин»: средний дневной спрос (принятые поездки + отказы, в поездках в
            одну сторону) делится на ориентир нагрузки одной машины — {totals.limit} поездок в день.
            Ориентир меняется в «Настройках» у каждой машины.
          </p>
        </div>
      )}
    </div>
  )
}

function Tile({
  label,
  value,
  note,
  tone = 'plain',
}: {
  label: string
  value: string
  note?: string
  tone?: 'plain' | 'warn'
}) {
  return (
    <Card className={cx('p-4', tone === 'warn' && 'ring-2 ring-amber-400')}>
      <div className="text-sm font-medium text-slate-600">{label}</div>
      <div className="mt-1 text-4xl font-semibold tracking-tight text-slate-900 tabular-nums">{value}</div>
      {note && <div className="mt-1 text-sm text-slate-500">{note}</div>}
    </Card>
  )
}

function ChartHeader({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <div className="mb-3">
      <h2 className="font-semibold text-slate-900">{title}</h2>
      {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
    </div>
  )
}

function niceMax(v: number): { max: number; step: number } {
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000]
  const step = steps.find((s) => s * 4 >= v) ?? Math.ceil(v / 4)
  return { max: step * 4, step }
}

interface Col {
  id: string
  label: string
  title: string
  values: number[]
}

function StackedColumns({
  cols,
  refLine,
  height = 220,
  unit,
}: {
  cols: Col[]
  refLine?: { value: number; label: string }
  height?: number
  unit: [string, string, string]
}) {
  const [hover, setHover] = useState<number | null>(null)
  const peak = Math.max(1, refLine?.value ?? 0, ...cols.map((c) => c.values.reduce((a, b) => a + b, 0)))
  const { max, step } = niceMax(peak)
  const ticks = [0, 1, 2, 3, 4].map((i) => i * step)
  const labelEvery = Math.ceil(cols.length / 16)
  const px = (v: number) => (v / max) * height
  const peakTotal = Math.max(...cols.map((c) => c.values.reduce((a, b) => a + b, 0)), 0)

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-700">
        {SERIES.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <span className="size-3 rounded-sm" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
      <div className="flex">
        <div className="relative w-8 shrink-0 text-right text-xs text-slate-500 tabular-nums" style={{ height }}>
          {ticks.map((t) => (
            <span key={t} className="absolute right-1.5 -translate-y-1/2" style={{ top: height - px(t) }}>
              {t}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative" style={{ height }} onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <div
                key={t}
                className={cx('absolute inset-x-0 border-t', t === 0 ? 'border-slate-400' : 'border-slate-200')}
                style={{ top: height - px(t) }}
              />
            ))}
            {refLine && (
              <div
                className="absolute inset-x-0 border-t-2 border-dashed border-slate-500"
                style={{ top: height - px(refLine.value) }}
              >
                <span className="absolute right-0 -top-5 bg-white/90 px-1 text-xs font-medium text-slate-600">
                  {refLine.label}
                </span>
              </div>
            )}
            <div className="absolute inset-0 flex">
              {cols.map((c, i) => {
                const total = c.values.reduce((a, b) => a + b, 0)
                const top = c.values.reduce((last, v, k) => (v > 0 ? k : last), -1)
                return (
                  <div
                    key={c.id}
                    className={cx('relative flex flex-1 flex-col items-center justify-end', hover === i && 'bg-slate-100/80')}
                    onMouseEnter={() => setHover(i)}
                  >
                    {total > 0 && total === peakTotal && hover === null && (
                      <span className="mb-0.5 text-xs font-medium text-slate-700 tabular-nums">{total}</span>
                    )}
                    <div className="flex w-[60%] max-w-7 min-w-1.5 flex-col-reverse gap-0.5">
                      {c.values.map((v, k) =>
                        v > 0 ? (
                          <div
                            key={k}
                            className={cx(k === top && 'rounded-t-[4px]')}
                            style={{ height: Math.max(2, px(v) - (k > 0 ? 2 : 0)), background: SERIES[k].color }}
                          />
                        ) : null,
                      )}
                    </div>
                    {hover === i && (
                      <div
                        className={cx(
                          'pointer-events-none absolute bottom-full z-10 mb-1 w-max rounded-lg bg-white px-3 py-2 text-left text-sm shadow-lg ring-1 ring-slate-200',
                          i < cols.length / 2 ? 'left-0' : 'right-0',
                        )}
                        style={{ bottom: Math.min(height - 70, px(total) + 6) }}
                      >
                        <div className="mb-1 font-medium text-slate-900">{c.title}</div>
                        {SERIES.map((s, k) => (
                          <div key={s.name} className="flex items-center gap-2 text-slate-700">
                            <span className="size-2.5 rounded-sm" style={{ background: s.color }} />
                            {s.name}
                            <span className="ml-auto pl-4 font-medium text-slate-900 tabular-nums">{c.values[k]}</span>
                          </div>
                        ))}
                        <div className="mt-1 border-t border-slate-100 pt-1 text-slate-600">
                          Всего: <b className="text-slate-900">{total}</b> {unit[0] && plural(total, ...unit)}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
          <div className="mt-1 flex text-xs text-slate-500 tabular-nums">
            {cols.map((c, i) => (
              <div key={c.id} className="flex-1 overflow-visible text-center whitespace-nowrap">
                {i % labelEvery === 0 ? c.label : ''}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function HBars({
  rows,
  color,
  empty,
}: {
  rows: { label: string; value: number }[]
  color: string
  empty: string
}) {
  if (rows.length === 0) return <div className="py-4 text-sm text-slate-500">{empty}</div>
  const max = Math.max(...rows.map((r) => r.value))
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="mb-1 text-sm text-slate-700">{r.label}</div>
          <div className="flex items-center gap-2">
            <div
              className="h-3 rounded-r-[4px]"
              style={{ width: `calc(${(r.value / max) * 100}% - 2.5rem)`, minWidth: 4, background: color }}
            />
            <span className="text-sm font-medium text-slate-900 tabular-nums">{r.value}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
