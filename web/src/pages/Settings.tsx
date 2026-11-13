import { KeyRound, Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Button, Card, Chip, cx, Empty, ErrorNote, Field, Modal, PageHeader } from '../components/ui'
import { useAuth } from '../lib/auth'
import { useDirectory } from '../lib/data'
import { errorText, ROLE_LABEL } from '../lib/format'
import { adminUsers, supabase } from '../lib/supabase'
import type { Place, Profile, Role, Vehicle } from '../lib/types'

type Tab = 'vehicles' | 'staff' | 'places' | 'general'

/** Установочный файл приложения водителя лежит рядом с сайтом. */
const DRIVER_APK_URL = '/app/soctaxi-driver.apk'

const TABS: [Tab, string][] = [
  ['vehicles', 'Машины'],
  ['staff', 'Сотрудники'],
  ['places', 'Места'],
  ['general', 'Общее'],
]

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('vehicles')
  return (
    <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6">
      <PageHeader title="Настройки" />
      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {TABS.map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cx(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium',
              tab === t ? 'border-brand-700 text-brand-800' : 'border-transparent text-slate-600 hover:text-slate-900',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'vehicles' && <VehiclesTab />}
      {tab === 'staff' && <StaffTab />}
      {tab === 'places' && <PlacesTab />}
      {tab === 'general' && <GeneralTab />}
    </div>
  )
}

function SectionHead({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3">
      <p className="min-w-0 flex-1 text-sm text-slate-600">{children}</p>
      {action}
    </div>
  )
}

// ───────────── Машины ─────────────

function VehiclesTab() {
  const { vehicles, profiles, profileById, reload } = useDirectory()
  const [dialog, setDialog] = useState<null | { vehicle?: Vehicle }>(null)
  const drivers = profiles.filter((p) => p.role === 'driver' && p.is_active)

  return (
    <>
      <SectionHead
        action={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setDialog({})}>
            Добавить машину
          </Button>
        }
      >
        Водитель видит в приложении заказы той машины, за которой закреплён. Заболел водитель —
        просто поменяйте его здесь.
      </SectionHead>
      <Card className="divide-y divide-slate-100">
        {vehicles.map((v) => {
          const driver = profileById(v.driver_id)
          return (
            <button
              key={v.id}
              onClick={() => setDialog({ vehicle: v })}
              className={cx('flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-slate-50', !v.is_active && 'opacity-60')}
            >
              <div className="min-w-40">
                <div className="font-semibold text-slate-900">{v.name}</div>
                <div className="text-sm text-slate-500">{v.plate ?? 'без номера'}</div>
              </div>
              <div className="min-w-0 flex-1 text-sm">
                {driver ? (
                  <span className="text-slate-800">
                    {driver.full_name}
                    <span className="text-slate-500"> · {driver.phone ?? 'без телефона'}</span>
                  </span>
                ) : (
                  <span className="text-amber-700">водитель не назначен</span>
                )}
              </div>
              <div className="text-sm text-slate-500">
                мест: {v.seats} · ориентир: {v.daily_limit} поездок/день
              </div>
              {!v.is_active && <Chip tone="amber">отключена</Chip>}
              <Pencil className="size-4 text-slate-400" />
            </button>
          )
        })}
        {vehicles.length === 0 && <Empty>Машин пока нет</Empty>}
      </Card>
      {dialog && (
        <VehicleDialog
          vehicle={dialog.vehicle}
          drivers={drivers}
          vehicles={vehicles}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null)
            void reload()
          }}
        />
      )}
    </>
  )
}

function VehicleDialog({
  vehicle,
  drivers,
  vehicles,
  onClose,
  onSaved,
}: {
  vehicle?: Vehicle
  drivers: Profile[]
  vehicles: Vehicle[]
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(vehicle?.name ?? `Машина ${vehicles.length + 1}`)
  const [plate, setPlate] = useState(vehicle?.plate ?? '')
  const [driverId, setDriverId] = useState(vehicle?.driver_id ?? '')
  const [seats, setSeats] = useState(String(vehicle?.seats ?? 3))
  const [limit, setLimit] = useState(String(vehicle?.daily_limit ?? 16))
  const [active, setActive] = useState(vehicle?.is_active ?? true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError('Укажите название')
    const seatsN = Number(seats)
    const limitN = Number(limit)
    if (!(seatsN >= 1) || !(limitN >= 1)) return setError('Места и ориентир — положительные числа')
    setBusy(true)
    setError('')
    try {
      // Водитель может быть закреплён только за одной машиной — снимаем с прежней.
      if (driverId) {
        const other = vehicles.find((v) => v.driver_id === driverId && v.id !== vehicle?.id)
        if (other) {
          const res = await supabase.from('vehicles').update({ driver_id: null }).eq('id', other.id)
          if (res.error) throw res.error
        }
      }
      const row = {
        name: name.trim(),
        plate: plate.trim() || null,
        driver_id: driverId || null,
        seats: Math.round(seatsN),
        daily_limit: Math.round(limitN),
        is_active: active,
      }
      const res = vehicle
        ? await supabase.from('vehicles').update(row).eq('id', vehicle.id)
        : await supabase.from('vehicles').insert({ ...row, sort: vehicles.length + 1 })
      if (res.error) throw res.error
      onSaved()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!vehicle || !window.confirm(`Удалить «${vehicle.name}»?`)) return
    setBusy(true)
    const { error } = await supabase.from('vehicles').delete().eq('id', vehicle.id)
    setBusy(false)
    if (error) {
      setError(
        /foreign key/i.test(error.message)
          ? 'У машины есть поездки, удалить нельзя. Снимите галочку «Работает» — машина исчезнет с доски, история сохранится.'
          : errorText(error),
      )
    } else onSaved()
  }

  return (
    <Modal
      size="sm"
      title={vehicle ? 'Машина' : 'Новая машина'}
      onClose={onClose}
      footer={
        <>
          {vehicle && (
            <Button variant="ghost" className="mr-auto" onClick={remove} disabled={busy}>
              Удалить
            </Button>
          )}
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" type="submit" form="vehicle-form" busy={busy}>
            Сохранить
          </Button>
        </>
      }
    >
      <form id="vehicle-form" onSubmit={submit} className="space-y-4">
        <Field label="Название" required>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Гос. номер">
          <input className="input" value={plate} onChange={(e) => setPlate(e.target.value)} />
        </Field>
        <Field label="Водитель" hint={drivers.length === 0 ? 'Сначала добавьте водителя во вкладке «Сотрудники».' : undefined}>
          <select className="input" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
            <option value="">— не назначен —</option>
            {drivers.map((d) => {
              const other = vehicles.find((v) => v.driver_id === d.id && v.id !== vehicle?.id)
              return (
                <option key={d.id} value={d.id}>
                  {d.full_name}
                  {other ? ` (сейчас на «${other.name}»)` : ''}
                </option>
              )
            })}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Мест для клиентов" hint="Сколько клиентов везёт одновременно.">
            <input className="input" type="number" min={1} max={20} value={seats} onChange={(e) => setSeats(e.target.value)} />
          </Field>
          <Field label="Ориентир, поездок в день" hint="Только для статистики, ничего не запрещает.">
            <input className="input" type="number" min={1} max={99} value={limit} onChange={(e) => setLimit(e.target.value)} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
          <input type="checkbox" className="size-4 accent-teal-700" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Работает (показывать на доске заказов)
        </label>
        <ErrorNote>{error}</ErrorNote>
      </form>
    </Modal>
  )
}

// ───────────── Сотрудники ─────────────

function StaffTab() {
  const { profiles, vehicles, reload } = useDirectory()
  const { profile: me } = useAuth()
  const isAdmin = me?.role === 'admin'
  const [dialog, setDialog] = useState<null | { profile?: Profile }>(null)
  const [passwordFor, setPasswordFor] = useState<Profile | null>(null)

  const order: Role[] = ['driver', 'dispatcher', 'admin']
  const sorted = [...profiles].sort(
    (a, b) =>
      Number(b.is_active) - Number(a.is_active) ||
      order.indexOf(a.role) - order.indexOf(b.role) ||
      a.full_name.localeCompare(b.full_name, 'ru'),
  )

  return (
    <>
      <SectionHead
        action={
          isAdmin && (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setDialog({})}>
              Добавить сотрудника
            </Button>
          )
        }
      >
        {isAdmin
          ? 'Водители входят в мобильное приложение, диспетчеры — на этот сайт. Логин и пароль задаёте вы.'
          : 'Добавлять сотрудников и менять пароли может только администратор.'}{' '}
        <a href={DRIVER_APK_URL} className="font-medium whitespace-nowrap text-brand-800 underline-offset-2 hover:underline">
          Скачать приложение водителя (Android)
        </a>
      </SectionHead>
      <Card className="divide-y divide-slate-100">
        {sorted.map((p) => {
          const vehicle = vehicles.find((v) => v.driver_id === p.id)
          return (
            <div key={p.id} className={cx('flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3', !p.is_active && 'opacity-60')}>
              <div className="min-w-48 flex-1">
                <div className="font-semibold text-slate-900">{p.full_name}</div>
                <div className="text-sm text-slate-500">
                  логин: <span className="font-mono text-slate-700">{p.login}</span>
                  {p.phone && ` · ${p.phone}`}
                </div>
              </div>
              <Chip tone={p.role === 'driver' ? 'sky' : p.role === 'admin' ? 'brand' : 'slate'}>{ROLE_LABEL[p.role]}</Chip>
              {p.role === 'driver' && p.is_active && (
                <span className={cx('text-sm', vehicle ? 'text-slate-600' : 'text-amber-700')}>
                  {vehicle ? vehicle.name : 'без машины'}
                </span>
              )}
              {!p.is_active && <Chip tone="amber">отключён</Chip>}
              {isAdmin && (
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" icon={<KeyRound className="size-4" />} onClick={() => setPasswordFor(p)}>
                    Пароль
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Pencil className="size-4" />} onClick={() => setDialog({ profile: p })}>
                    Изменить
                  </Button>
                </div>
              )}
            </div>
          )
        })}
      </Card>
      {dialog && (
        <StaffDialog
          profile={dialog.profile}
          isSelf={dialog.profile?.id === me?.id}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null)
            void reload()
          }}
        />
      )}
      {passwordFor && <PasswordDialog profile={passwordFor} onClose={() => setPasswordFor(null)} />}
    </>
  )
}

function randomPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

function StaffDialog({
  profile,
  isSelf,
  onClose,
  onSaved,
}: {
  profile?: Profile
  isSelf: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [fullName, setFullName] = useState(profile?.full_name ?? '')
  const [phone, setPhone] = useState(profile?.phone ?? '')
  const [role, setRole] = useState<Role>(profile?.role ?? 'driver')
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [active, setActive] = useState(profile?.is_active ?? true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (profile) {
        await adminUsers({ action: 'update', id: profile.id, full_name: fullName, phone, role, is_active: active })
      } else {
        await adminUsers({ action: 'create', login, password, full_name: fullName, phone, role })
      }
      onSaved()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      size="sm"
      title={profile ? 'Сотрудник' : 'Новый сотрудник'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" type="submit" form="staff-form" busy={busy}>
            {profile ? 'Сохранить' : 'Создать'}
          </Button>
        </>
      }
    >
      <form id="staff-form" onSubmit={submit} className="space-y-4">
        <Field label="Имя и фамилия" required>
          <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus />
        </Field>
        <Field label="Телефон">
          <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
        </Field>
        <Field label="Роль">
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={isSelf}>
            <option value="driver">Водитель — мобильное приложение</option>
            <option value="dispatcher">Диспетчер — сайт</option>
            <option value="admin">Администратор — сайт + управление сотрудниками</option>
          </select>
        </Field>
        {!profile && (
          <>
            <Field label="Логин" required hint="Латинские буквы и цифры, например ivanov или 9401234567.">
              <input className="input font-mono" value={login} onChange={(e) => setLogin(e.target.value)} autoCapitalize="none" autoComplete="off" />
            </Field>
            <Field label="Пароль" required hint="Минимум 6 символов. Запишите и передайте сотруднику.">
              <div className="flex gap-2">
                <input className="input font-mono" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
                <Button onClick={() => setPassword(randomPassword())}>Придумать</Button>
              </div>
            </Field>
          </>
        )}
        {profile && !isSelf && (
          <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
            <input type="checkbox" className="size-4 accent-teal-700" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Учётная запись активна (может входить)
          </label>
        )}
        <ErrorNote>{error}</ErrorNote>
      </form>
    </Modal>
  )
}

function PasswordDialog({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await adminUsers({ action: 'set_password', id: profile.id, password })
      setDone(true)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      size="sm"
      title="Новый пароль"
      subtitle={`${profile.full_name} · логин ${profile.login}`}
      onClose={onClose}
      footer={
        done ? (
          <Button variant="primary" onClick={onClose}>
            Готово
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>Отмена</Button>
            <Button variant="primary" type="submit" form="password-form" busy={busy}>
              Сменить пароль
            </Button>
          </>
        )
      }
    >
      {done ? (
        <p className="text-slate-700">
          Пароль изменён. Передайте сотруднику новый пароль:{' '}
          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono font-semibold">{password}</span>
        </p>
      ) : (
        <form id="password-form" onSubmit={submit} className="space-y-4">
          <Field label="Новый пароль" hint="Минимум 6 символов.">
            <div className="flex gap-2">
              <input className="input font-mono" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="off" />
              <Button onClick={() => setPassword(randomPassword())}>Придумать</Button>
            </div>
          </Field>
          <ErrorNote>{error}</ErrorNote>
        </form>
      )}
    </Modal>
  )
}

// ───────────── Места ─────────────

function PlacesTab() {
  const { places, reload } = useDirectory()
  const [dialog, setDialog] = useState<null | { place?: Place }>(null)
  return (
    <>
      <SectionHead
        action={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setDialog({})}>
            Добавить место
          </Button>
        }
      >
        Частые пункты назначения: поликлиники, реабилитационные центры. Они подсказываются при вводе
        адреса в заказе.
      </SectionHead>
      <Card className="divide-y divide-slate-100">
        {places.map((p) => (
          <button
            key={p.id}
            onClick={() => setDialog({ place: p })}
            className={cx('flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-slate-50', !p.is_active && 'opacity-60')}
          >
            <div className="min-w-0 flex-1">
              <div className="font-medium text-slate-900">{p.name}</div>
              <div className="text-sm text-slate-500">{p.address ?? 'адрес не указан'}</div>
            </div>
            {!p.is_active && <Chip tone="amber">скрыто</Chip>}
            <Pencil className="size-4 text-slate-400" />
          </button>
        ))}
        {places.length === 0 && <Empty>Мест пока нет</Empty>}
      </Card>
      {dialog && (
        <PlaceDialog
          place={dialog.place}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null)
            void reload()
          }}
        />
      )}
    </>
  )
}

function PlaceDialog({ place, onClose, onSaved }: { place?: Place; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(place?.name ?? '')
  const [address, setAddress] = useState(place?.address ?? '')
  const [active, setActive] = useState(place?.is_active ?? true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError('Укажите название')
    setBusy(true)
    const row = { name: name.trim(), address: address.trim() || null, is_active: active }
    const { error } = place
      ? await supabase.from('places').update(row).eq('id', place.id)
      : await supabase.from('places').insert(row)
    setBusy(false)
    if (error) setError(errorText(error))
    else onSaved()
  }

  async function remove() {
    if (!place || !window.confirm(`Удалить «${place.name}» из списка мест?`)) return
    setBusy(true)
    const { error } = await supabase.from('places').delete().eq('id', place.id)
    setBusy(false)
    if (error) setError(errorText(error))
    else onSaved()
  }

  return (
    <Modal
      size="sm"
      title={place ? 'Место' : 'Новое место'}
      onClose={onClose}
      footer={
        <>
          {place && (
            <Button variant="ghost" className="mr-auto" onClick={remove} disabled={busy}>
              Удалить
            </Button>
          )}
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" type="submit" form="place-form" busy={busy}>
            Сохранить
          </Button>
        </>
      }
    >
      <form id="place-form" onSubmit={submit} className="space-y-4">
        <Field label="Название" required>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Например: Поликлиника №1, физиотерапия" />
        </Field>
        <Field label="Адрес">
          <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        {place && (
          <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
            <input type="checkbox" className="size-4 accent-teal-700" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Подсказывать при вводе адреса
          </label>
        )}
        <ErrorNote>{error}</ErrorNote>
      </form>
    </Modal>
  )
}

// ───────────── Общее ─────────────

function GeneralTab() {
  const { settings, reload } = useDirectory()
  const [orgName, setOrgName] = useState(settings?.org_name ?? '')
  const [phone, setPhone] = useState(settings?.dispatcher_phone ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setSaved(false)
    const { error } = await supabase
      .from('app_settings')
      .update({ org_name: orgName.trim() || 'Социальное такси', dispatcher_phone: phone.trim() || null })
      .eq('id', 1)
    setBusy(false)
    if (error) setError(errorText(error))
    else {
      setSaved(true)
      void reload()
    }
  }

  return (
    <Card className="max-w-md p-5">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Название службы">
          <input className="input" value={orgName} onChange={(e) => setOrgName(e.target.value)} />
        </Field>
        <Field label="Телефон диспетчерской" hint="Кнопка «Позвонить диспетчеру» в приложении водителя.">
          <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
        </Field>
        <ErrorNote>{error}</ErrorNote>
        <div className="flex items-center gap-3">
          <Button variant="primary" type="submit" busy={busy}>
            Сохранить
          </Button>
          {saved && <span className="text-sm text-emerald-700">Сохранено</span>}
        </div>
      </form>
    </Card>
  )
}
