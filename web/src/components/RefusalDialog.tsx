import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useDirectory } from '../lib/data'
import { errorText, fmtTime, REFUSAL_REASON_LABEL } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { Client, Refusal, RefusalReason } from '../lib/types'
import { ClientPicker } from './ClientPicker'
import type { RefusalPrefill } from './TripDialog'
import { Button, cx, ErrorNote, Field, Modal } from './ui'

const REASONS: RefusalReason[] = ['no_cars', 'out_of_hours', 'out_of_area', 'other']

export function RefusalDialog({
  refusal,
  prefill,
  defaultDate,
  onClose,
  onSaved,
}: {
  refusal?: Refusal
  prefill?: RefusalPrefill
  defaultDate: string
  onClose: () => void
  onSaved: () => void
}) {
  const { clients, places } = useDirectory()
  const [client, setClient] = useState<Client | null>(
    () => prefill?.client ?? clients.find((c) => c.id === refusal?.client_id) ?? null,
  )
  const [name, setName] = useState(refusal?.client_name ?? '')
  const [phone, setPhone] = useState(refusal?.phone ?? '')
  const [date, setDate] = useState(refusal?.req_date ?? prefill?.req_date ?? defaultDate)
  const [time, setTime] = useState(fmtTime(refusal?.req_time) || prefill?.req_time || '')
  const [from, setFrom] = useState(refusal?.from_address ?? prefill?.from_address ?? '')
  const [to, setTo] = useState(refusal?.to_address ?? prefill?.to_address ?? '')
  const [withReturn, setWithReturn] = useState(refusal?.with_return ?? prefill?.with_return ?? true)
  const [reason, setReason] = useState<RefusalReason>(refusal?.reason ?? 'no_cars')
  const [comment, setComment] = useState(refusal?.comment ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!date) {
      setError('Укажите, на какой день просили машину')
      return
    }
    if (reason === 'other' && !comment.trim()) {
      setError('Для причины «Другое» напишите комментарий')
      return
    }
    setBusy(true)
    setError('')
    const row = {
      req_date: date,
      req_time: time || null,
      client_id: client?.id ?? null,
      client_name: client?.full_name ?? (name.trim() || null),
      phone: client?.phone ?? (phone.trim() || null),
      from_address: from.trim() || client?.address || null,
      to_address: to.trim() || null,
      with_return: withReturn,
      reason,
      comment: comment.trim() || null,
    }
    const { error } = refusal
      ? await supabase.from('refusals').update(row).eq('id', refusal.id)
      : await supabase.from('refusals').insert(row)
    setBusy(false)
    if (error) setError(errorText(error))
    else onSaved()
  }

  async function remove() {
    if (!refusal || !window.confirm('Удалить запись об отказе? Она исчезнет из статистики.')) return
    setBusy(true)
    const { error } = await supabase.from('refusals').delete().eq('id', refusal.id)
    setBusy(false)
    if (error) setError(errorText(error))
    else onSaved()
  }

  return (
    <Modal
      title={refusal ? 'Отказ' : 'Зафиксировать отказ'}
      subtitle="Клиент обратился, но поездку выполнить не можем. Запись нужна для статистики спроса."
      onClose={onClose}
      footer={
        <>
          {refusal && (
            <Button
              variant="ghost"
              className="mr-auto"
              icon={<Trash2 className="size-4" />}
              onClick={remove}
              disabled={busy}
            >
              Удалить
            </Button>
          )}
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="dangerSolid" type="submit" form="refusal-form" busy={busy}>
            {refusal ? 'Сохранить' : 'Записать отказ'}
          </Button>
        </>
      }
    >
      <form id="refusal-form" onSubmit={submit} className="space-y-4">
        <datalist id="refusal-places">
          {places
            .filter((p) => p.is_active)
            .map((p) => (
              <option key={p.id} value={p.address ? `${p.name}, ${p.address}` : p.name} />
            ))}
        </datalist>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="На какой день просили" required>
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="На какое время">
            <input type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>

        <div>
          <div className="mb-1 text-sm font-medium text-slate-700">Кто обращался</div>
          <ClientPicker value={client} onChange={setClient} optional />
          {!client && (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <input
                className="input"
                placeholder="или просто имя"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <input
                className="input"
                placeholder="телефон"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Откуда">
            <input
              className="input"
              list="refusal-places"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              placeholder={client?.address ?? ''}
            />
          </Field>
          <Field label="Куда">
            <input className="input" list="refusal-places" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
          <input
            type="checkbox"
            className="size-4 accent-teal-700"
            checked={withReturn}
            onChange={(e) => setWithReturn(e.target.checked)}
          />
          Нужна была и обратная дорога (в статистике считается как 2 поездки)
        </label>

        <div>
          <div className="mb-1 text-sm font-medium text-slate-700">Причина отказа</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(r)}
                className={cx(
                  'rounded-lg px-3 py-2 text-left text-sm font-medium ring-1 ring-inset',
                  reason === r
                    ? 'bg-rose-600 text-white ring-rose-600'
                    : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50',
                )}
              >
                {REFUSAL_REASON_LABEL[r]}
              </button>
            ))}
          </div>
        </div>

        <Field label="Комментарий">
          <textarea
            className="input"
            rows={2}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Например: просили перезвонить, если появится время"
          />
        </Field>
        <ErrorNote>{error}</ErrorNote>
      </form>
    </Modal>
  )
}
