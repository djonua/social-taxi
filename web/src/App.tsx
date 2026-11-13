import { Ban, BarChart3, CalendarDays, FlaskConical, LogOut, MapPinned, RotateCcw, Settings, Users } from 'lucide-react'
import { useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { Button, cx, Spinner } from './components/ui'
import { useAuth } from './lib/auth'
import { DirectoryProvider, useDirectory } from './lib/data'
import { errorText, ROLE_LABEL } from './lib/format'
import { exitDemo, isDemo, supabase } from './lib/supabase'
import { BoardPage } from './pages/Board'
import { ClientsPage } from './pages/Clients'
import { LoginPage } from './pages/Login'
import { MapPage } from './pages/Map'
import { RefusalsPage } from './pages/Refusals'
import { SettingsPage } from './pages/Settings'
import { StatsPage } from './pages/Stats'

const NAV = [
  { to: '/', label: 'Заказы', icon: CalendarDays },
  { to: '/map', label: 'Карта', icon: MapPinned },
  { to: '/clients', label: 'Клиенты', icon: Users },
  { to: '/refusals', label: 'Отказы', icon: Ban },
  { to: '/stats', label: 'Статистика', icon: BarChart3 },
  { to: '/settings', label: 'Настройки', icon: Settings },
]

export default function App() {
  const { loading, session, profile, denied, signOut } = useAuth()

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    )
  }
  if (!session) return <LoginPage />
  if (denied || !profile) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-sm rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
          <h1 className="text-lg font-semibold">Нет доступа к диспетчерской</h1>
          <p className="mt-2 text-sm text-slate-600">
            Этот сайт — для диспетчеров. Водители работают в мобильном приложении. Если доступ должен
            быть — обратитесь к администратору.
          </p>
          <Button className="mt-4" onClick={signOut}>
            Выйти
          </Button>
        </div>
      </div>
    )
  }

  return (
    <DirectoryProvider>
      <Shell />
    </DirectoryProvider>
  )
}

function Shell() {
  const { profile, signOut } = useAuth()
  const { settings, ready } = useDirectory()

  return (
    <div className="flex h-full flex-col">
      {isDemo && <DemoBar />}
      <header className="flex shrink-0 items-center gap-2 bg-brand-900 px-3 text-white sm:px-5">
        <div className="flex items-center gap-2 py-2.5 pr-3">
          <img src="/favicon.svg" alt="" className="size-7 rounded-md ring-1 ring-white/20" />
          <span className="hidden text-[15px] font-semibold lg:block">
            {settings?.org_name ?? 'Социальное такси'}
          </span>
        </div>
        <nav className="flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cx(
                  'flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium whitespace-nowrap transition-colors',
                  isActive
                    ? 'border-white text-white'
                    : 'border-transparent text-brand-100/80 hover:text-white',
                )
              }
            >
              <Icon className="size-4.5" />
              <span className="hidden sm:inline">{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-2 pl-2 text-sm">
          <div className="hidden text-right leading-tight md:block">
            <div className="font-medium">{profile?.full_name}</div>
            <div className="text-xs text-brand-100/70">{profile && ROLE_LABEL[profile.role]}</div>
          </div>
          <button
            onClick={isDemo ? exitDemo : signOut}
            title={isDemo ? 'Выйти из демо' : 'Выйти'}
            aria-label="Выйти"
            className="rounded-lg p-2 text-brand-100/80 hover:bg-white/10 hover:text-white"
          >
            <LogOut className="size-4.5" />
          </button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-auto">
        {!ready ? (
          <Spinner />
        ) : (
          <Routes>
            <Route path="/" element={<BoardPage />} />
            <Route path="/map" element={<MapPage />} />
            <Route path="/clients" element={<ClientsPage />} />
            <Route path="/refusals" element={<RefusalsPage />} />
            <Route path="/stats" element={<StatsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )}
      </main>
    </div>
  )
}

/** Полоса демо-режима: напоминание, что данные вымышленные, сброс и выход. */
function DemoBar() {
  const [busy, setBusy] = useState(false)

  async function restart() {
    if (!window.confirm('Начать демо заново? Все изменения в демо-базе будут стёрты, расписание пересоздано вокруг текущего времени.')) {
      return
    }
    setBusy(true)
    const { error } = await supabase.rpc('demo_reset')
    if (error) {
      setBusy(false)
      window.alert(errorText(error))
      return
    }
    window.location.reload()
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 bg-amber-300 px-3 py-1.5 text-sm text-amber-950 sm:px-5">
      <span className="inline-flex items-center gap-1.5 font-semibold">
        <FlaskConical className="size-4" /> Демо-режим
      </span>
      <span className="min-w-0 flex-1">
        Все клиенты и заказы вымышлены. «Машина 2» ездит и меняет статусы сама, «Машину 1» ведёт
        водитель в приложении (кнопка «Демо-режим» на экране входа).
      </span>
      <button
        onClick={restart}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-md bg-amber-950/10 px-2.5 py-1 font-medium hover:bg-amber-950/20 disabled:opacity-60"
      >
        <RotateCcw className={busy ? 'size-4 animate-spin' : 'size-4'} />
        {busy ? 'Пересоздаю…' : 'Начать демо заново'}
      </button>
      <button onClick={exitDemo} className="rounded-md bg-amber-950 px-2.5 py-1 font-medium text-amber-50 hover:bg-amber-900">
        Выйти из демо
      </button>
    </div>
  )
}
