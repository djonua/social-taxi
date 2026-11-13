import { Accessibility, CalendarPlus, Plus, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClientDialog } from '../components/ClientDialog'
import { Button, Card, Chip, cx, Empty, PageHeader } from '../components/ui'
import { useDirectory } from '../lib/data'
import { MOBILITY_SHORT, plural } from '../lib/format'
import type { Client } from '../lib/types'

export function ClientsPage() {
  const { clients, reload } = useDirectory()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [dialog, setDialog] = useState<null | { client?: Client }>(null)

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    const qd = q.replace(/\D/g, '')
    return clients.filter((c) => {
      if (!showArchived && !c.is_active) return false
      if (!q) return true
      return (
        c.full_name.toLowerCase().includes(q) ||
        (c.address ?? '').toLowerCase().includes(q) ||
        (c.diagnosis ?? '').toLowerCase().includes(q) ||
        (qd.length >= 3 && (c.phone ?? '').replace(/\D/g, '').includes(qd))
      )
    })
  }, [clients, query, showArchived])

  const activeCount = clients.filter((c) => c.is_active).length

  return (
    <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6">
      <PageHeader
        title="Клиенты"
        subtitle={`${activeCount} ${plural(activeCount, 'человек', 'человека', 'человек')} в базе`}
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setDialog({})}>
            Новый клиент
          </Button>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative min-w-64 flex-1">
          <Search className="pointer-events-none absolute top-2.5 left-3 size-4.5 text-slate-400" />
          <input
            className="input pl-9"
            placeholder="Поиск: фамилия, телефон, адрес, диагноз"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="size-4 accent-teal-700"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Показывать архив
        </label>
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs tracking-wide text-slate-500 uppercase">
            <tr>
              <th className="px-4 py-2.5 font-medium">Клиент</th>
              <th className="px-4 py-2.5 font-medium">Телефон</th>
              <th className="px-4 py-2.5 font-medium">Адрес</th>
              <th className="px-4 py-2.5 font-medium">Диагноз</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.map((c) => (
              <tr
                key={c.id}
                onClick={() => setDialog({ client: c })}
                className={cx('cursor-pointer hover:bg-slate-50', !c.is_active && 'opacity-60')}
              >
                <td className="px-4 py-2.5">
                  <div className="font-medium text-slate-900">{c.full_name}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Chip tone={c.mobility === 'wheelchair' ? 'sky' : 'slate'}>
                      {c.mobility === 'wheelchair' && <Accessibility className="size-3.5" />}
                      {MOBILITY_SHORT[c.mobility]}
                    </Chip>
                    {c.escort && <Chip>+ сопровождающий</Chip>}
                    {!c.is_active && <Chip tone="amber">в архиве</Chip>}
                  </div>
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap text-slate-700">
                  {c.phone ?? '—'}
                  {c.extra_phone && (
                    <div className="text-xs text-slate-500">
                      {c.extra_contact ? `${c.extra_contact}: ` : ''}
                      {c.extra_phone}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2.5 text-slate-700">{c.address ?? '—'}</td>
                <td className="max-w-xs px-4 py-2.5 text-slate-700">{c.diagnosis ?? '—'}</td>
                <td className="px-4 py-2.5 text-right">
                  {c.is_active && (
                    <Button
                      size="sm"
                      icon={<CalendarPlus className="size-4" />}
                      onClick={(e) => {
                        e.stopPropagation()
                        navigate('/', { state: { newTripFor: c.id } })
                      }}
                    >
                      Заказ
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.length === 0 && (
          <Empty>{clients.length ? 'Никого не нашлось' : 'Клиентов пока нет — добавьте первого'}</Empty>
        )}
      </Card>

      {dialog && (
        <ClientDialog
          client={dialog.client}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null)
            void reload()
          }}
        />
      )}
    </div>
  )
}
