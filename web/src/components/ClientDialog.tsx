import { useState } from 'react'
import type { FormEvent } from 'react'
import { errorText, MOBILITY_LABEL } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { Client, Mobility } from '../lib/types'
import { Button, cx, ErrorNote, Field, Modal } from './ui'

const MOBILITIES: Mobility[] = ['wheelchair', 'assist', 'walks']

export function ClientDialog({
  client,
  initialName,
  onClose,
  onSaved,
}: {
  client?: Client
  initialName?: string
  onClose: () => void
  onSaved: (client: Client) => void
}) {
  const [fullName, setFullName] = useState(client?.full_name ?? initialName ?? '')
  const [phone, setPhone] = useState(client?.phone ?? '')
  const [address, setAddress] = useState(client?.address ?? '')
  const [diagnosis, setDiagnosis] = useState(client?.diagnosis ?? '')
  const [mobility, setMobility] = useState<Mobility>(client?.mobility ?? 'wheelchair')
  const [escort, setEscort] = useState(client?.escort ?? false)
  const [extraContact, setExtraContact] = useState(client?.extra_contact ?? '')
  const [extraPhone, setExtraPhone] = useState(client?.extra_phone ?? '')
  const [notes, setNotes] = useState(client?.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save(patch?: Partial<Client>) {
    if (!fullName.trim()) {
      setError('Укажите ФИО клиента')
      return
    }
    setBusy(true)
    setError('')
    const row = {
      full_name: fullName.trim(),
      phone: phone.trim() || null,
      address: address.trim() || null,
      diagnosis: diagnosis.trim() || null,
      mobility,
      escort,
      extra_contact: extraContact.trim() || null,
      extra_phone: extraPhone.trim() || null,
      notes: notes.trim() || null,
      ...patch,
    }
    const query = client
      ? supabase.from('clients').update(row).eq('id', client.id).select().single()
      : supabase.from('clients').insert(row).select().single()
    const { data, error } = await query
    setBusy(false)
    if (error) {
      setError(errorText(error))
      return
    }
    onSaved(data as Client)
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    e.stopPropagation()
    void save()
  }

  return (
    <Modal
      title={client ? 'Карточка клиента' : 'Новый клиент'}
      onClose={onClose}
      footer={
        <>
          {client && (
            <Button
              variant="ghost"
              className="mr-auto"
              disabled={busy}
              onClick={() => save({ is_active: !client.is_active })}
            >
              {client.is_active ? 'В архив' : 'Вернуть из архива'}
            </Button>
          )}
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" busy={busy} type="submit" form="client-form">
            Сохранить
          </Button>
        </>
      }
    >
      <form id="client-form" onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
        <Field label="ФИО" required className="sm:col-span-2">
          <input
            className="input"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoFocus
            placeholder="Фамилия Имя Отчество"
          />
        </Field>
        <Field label="Телефон">
          <input
            className="input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            placeholder="+7 940 …"
          />
        </Field>
        <Field label="Домашний адрес">
          <input
            className="input"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Город, улица, дом, квартира"
          />
        </Field>
        <Field label="Диагноз" className="sm:col-span-2" hint="Виден водителю в приложении.">
          <input className="input" value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} />
        </Field>

        <div className="sm:col-span-2">
          <span className="mb-1 block text-sm font-medium text-slate-700">Передвижение</span>
          <div className="flex flex-wrap gap-2">
            {MOBILITIES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMobility(m)}
                className={cx(
                  'rounded-lg px-3 py-2 text-sm font-medium ring-1 ring-inset',
                  mobility === m
                    ? 'bg-brand-700 text-white ring-brand-700'
                    : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50',
                )}
              >
                {MOBILITY_LABEL[m]}
              </button>
            ))}
            <label className="ml-auto flex items-center gap-2 rounded-lg px-3 py-2 text-sm ring-1 ring-slate-300 ring-inset">
              <input
                type="checkbox"
                className="size-4 accent-teal-700"
                checked={escort}
                onChange={(e) => setEscort(e.target.checked)}
              />
              Ездит с сопровождающим
            </label>
          </div>
        </div>

        <Field label="Доп. контакт — кто">
          <input
            className="input"
            value={extraContact}
            onChange={(e) => setExtraContact(e.target.value)}
            placeholder="мама, сын, соседка…"
          />
        </Field>
        <Field label="Доп. контакт — телефон">
          <input
            className="input"
            value={extraPhone}
            onChange={(e) => setExtraPhone(e.target.value)}
            inputMode="tel"
          />
        </Field>
        <Field label="Заметки" className="sm:col-span-2" hint="Этаж, лифт, особенности посадки и т. п.">
          <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {error && (
          <div className="sm:col-span-2">
            <ErrorNote>{error}</ErrorNote>
          </div>
        )}
      </form>
    </Modal>
  )
}
