import { Ban } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { RefusalDialog } from '../components/RefusalDialog'
import { Button, Card, Chip, Empty, PageHeader, Spinner } from '../components/ui'
import { useDirectory, useRealtime } from '../lib/data'
import {
  addDays,
  fmtDateShort,
  fmtStamp,
  fmtTime,
  fmtWeekday,
  plural,
  REFUSAL_REASON_SHORT,
  shortAddress,
  shortName,
  todayISO,
} from '../lib/format'
import { supabase } from '../lib/supabase'
import type { Refusal } from '../lib/types'

export function RefusalsPage() {
  const { profileById } = useDirectory()
  const [from, setFrom] = useState(addDays(todayISO(), -30))
  const [to, setTo] = useState(addDays(todayISO(), 7))
  const [rows, setRows] = useState<Refusal[] | null>(null)
  const [dialog, setDialog] = useState<null | { refusal?: Refusal }>(null)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('refusals')
      .select('*')
      .gte('req_date', from)
      .lte('req_date', to)
      .order('req_date', { ascending: false })
      .order('req_time', { ascending: false })
      .limit(1000)
    setRows((data ?? []) as Refusal[])
  }, [from, to])

  useEffect(() => {
    void load()
  }, [load])
  useRealtime(['refusals'], load)

  const count = rows?.length ?? 0

  return (
    <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6">
      <PageHeader
        title="Отказы"
        subtitle="Обращения, которые не смогли выполнить. По ним видно, сколько машин не хватает."
        actions={
          <Button variant="dangerSolid" icon={<Ban className="size-4" />} onClick={() => setDialog({})}>
            Зафиксировать отказ
          </Button>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-slate-700">
        <span>Период:</span>
        <input type="date" className="input w-auto py-1.5" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        <span>—</span>
        <input type="date" className="input w-auto py-1.5" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
        {rows && (
          <span className="ml-2 font-medium">
            {count} {plural(count, 'отказ', 'отказа', 'отказов')}
          </span>
        )}
      </div>

      <Card className="overflow-x-auto">
        {!rows ? (
          <Spinner />
        ) : (
          <>
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs tracking-wide text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-2.5 font-medium">На когда</th>
                  <th className="px-4 py-2.5 font-medium">Кто</th>
                  <th className="px-4 py-2.5 font-medium">Маршрут</th>
                  <th className="px-4 py-2.5 font-medium">Причина</th>
                  <th className="px-4 py-2.5 font-medium">Записал</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setDialog({ refusal: r })}>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span className="font-medium text-slate-900">
                        {fmtDateShort(r.req_date)}, {fmtWeekday(r.req_date)}
                      </span>
                      <span className="ml-2 text-slate-600 tabular-nums">{fmtTime(r.req_time)}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-900">{r.client_name ?? 'Без имени'}</div>
                      <div className="text-xs text-slate-500">{r.phone}</div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">
                      {shortAddress(r.from_address)} → {shortAddress(r.to_address)}
                      {r.with_return && <span className="text-slate-500"> и обратно</span>}
                      {r.comment && <div className="text-xs text-slate-500">{r.comment}</div>}
                    </td>
                    <td className="px-4 py-2.5">
                      <Chip tone="rose">{REFUSAL_REASON_SHORT[r.reason]}</Chip>
                    </td>
                    <td className="px-4 py-2.5 text-xs whitespace-nowrap text-slate-500">
                      {shortName(profileById(r.created_by)?.full_name ?? '—')}
                      <div>{fmtStamp(r.created_at)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && <Empty>За этот период отказов нет</Empty>}
          </>
        )}
      </Card>

      {dialog && (
        <RefusalDialog
          refusal={dialog.refusal}
          defaultDate={todayISO()}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null)
            void load()
          }}
        />
      )}
    </div>
  )
}
