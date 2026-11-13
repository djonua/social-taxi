import { Accessibility, Pencil, Phone, Plus, Search, UserRound, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useDirectory } from '../lib/data'
import { MOBILITY_SHORT } from '../lib/format'
import type { Client } from '../lib/types'
import { ClientDialog } from './ClientDialog'
import { Chip, cx } from './ui'

const digits = (s: string) => s.replace(/\D/g, '')

export function ClientPicker({
  value,
  onChange,
  autoFocus,
  optional,
}: {
  value: Client | null
  onChange: (client: Client | null) => void
  autoFocus?: boolean
  optional?: boolean
}) {
  const { clients, reload } = useDirectory()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [dialog, setDialog] = useState<null | { client?: Client; name?: string }>(null)

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    const qd = digits(q)
    const active = clients.filter((c) => c.is_active)
    if (!q) return active.slice(0, 8)
    return active
      .filter(
        (c) =>
          c.full_name.toLowerCase().includes(q) ||
          (qd.length >= 3 && digits(c.phone ?? '').includes(qd)),
      )
      .slice(0, 8)
  }, [clients, query])

  function pick(c: Client) {
    onChange(c)
    setQuery('')
    setOpen(false)
  }

  const dialogEl = dialog && (
    <ClientDialog
      client={dialog.client}
      initialName={dialog.name}
      onClose={() => setDialog(null)}
      onSaved={(c) => {
        setDialog(null)
        void reload()
        pick(c)
      }}
    />
  )

  if (value) {
    return (
      <>
        <div className="flex items-start gap-3 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200 ring-inset">
          <div className="mt-0.5 rounded-full bg-brand-100 p-2 text-brand-800">
            <UserRound className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-slate-900">{value.full_name}</div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
              {value.phone && (
                <span className="inline-flex items-center gap-1">
                  <Phone className="size-3.5" />
                  {value.phone}
                </span>
              )}
              <Chip tone={value.mobility === 'wheelchair' ? 'sky' : 'slate'}>
                {value.mobility === 'wheelchair' && <Accessibility className="size-3.5" />}
                {MOBILITY_SHORT[value.mobility]}
              </Chip>
              {value.escort && <Chip>+ сопровождающий</Chip>}
            </div>
            {value.diagnosis && <div className="mt-1 text-sm text-slate-600">{value.diagnosis}</div>}
            {value.notes && <div className="mt-1 text-sm text-slate-500">{value.notes}</div>}
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              title="Изменить карточку клиента"
              onClick={() => setDialog({ client: value })}
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-200 hover:text-slate-800"
            >
              <Pencil className="size-4" />
            </button>
            <button
              type="button"
              title="Выбрать другого клиента"
              onClick={() => onChange(null)}
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-200 hover:text-slate-800"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
        {dialogEl}
      </>
    )
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-2.5 left-3 size-4.5 text-slate-400" />
      <input
        className="input pl-9"
        placeholder={
          optional ? 'Найти клиента в базе (необязательно)…' : 'Начните вводить фамилию или телефон…'
        }
        value={query}
        autoFocus={autoFocus}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
          setHighlight(0)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setHighlight((h) => Math.min(h + 1, matches.length))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setHighlight((h) => Math.max(h - 1, 0))
          } else if (e.key === 'Enter' && open) {
            e.preventDefault()
            if (matches[highlight]) pick(matches[highlight])
            else setDialog({ name: query.trim() })
          }
        }}
      />
      {open && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg bg-white shadow-lg ring-1 ring-slate-200">
          {matches.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(c)}
              onMouseEnter={() => setHighlight(i)}
              className={cx(
                'flex w-full items-baseline gap-3 px-3 py-2 text-left text-sm',
                i === highlight ? 'bg-brand-50' : 'hover:bg-slate-50',
              )}
            >
              <span className="font-medium text-slate-900">{c.full_name}</span>
              <span className="text-slate-500">{c.phone}</span>
              <span className="ml-auto truncate text-xs text-slate-400">{c.address}</span>
            </button>
          ))}
          {matches.length === 0 && (
            <div className="px-3 py-2 text-sm text-slate-500">В базе не найдено</div>
          )}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setDialog({ name: query.trim() })}
            onMouseEnter={() => setHighlight(matches.length)}
            className={cx(
              'flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2 text-left text-sm font-medium text-brand-800',
              highlight === matches.length ? 'bg-brand-50' : 'hover:bg-slate-50',
            )}
          >
            <Plus className="size-4" />
            Новый клиент{query.trim() ? ` «${query.trim()}»` : ''}
          </button>
        </div>
      )}
      {dialogEl}
    </div>
  )
}
