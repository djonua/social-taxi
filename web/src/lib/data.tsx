import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from './supabase'
import type { AppSettings, Client, Place, Profile, Vehicle } from './types'

/**
 * Подписка на изменения таблиц. При любом изменении вызывает onChange
 * (с небольшой задержкой, чтобы пачка изменений дала одну перезагрузку).
 */
export function useRealtime(tables: string[], onChange: () => void) {
  const cb = useRef(onChange)
  cb.current = onChange
  const key = tables.join(',')

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const fire = () => {
      clearTimeout(timer)
      timer = setTimeout(() => cb.current(), 250)
    }
    let channel = supabase.channel(`rt-${key}-${Math.random().toString(36).slice(2)}`)
    for (const table of key.split(',')) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, fire)
    }
    channel.subscribe()

    // Страховка: вкладка вернулась из фона или сеть восстановилась.
    const onVisible = () => {
      if (document.visibilityState === 'visible') fire()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', fire)
    // И редкий опрос — на случай, если соединение realtime молча оборвалось.
    const poll = setInterval(onVisible, 60000)

    return () => {
      clearTimeout(timer)
      clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', fire)
      supabase.removeChannel(channel)
    }
  }, [key])
}

/** Справочники, которые нужны почти на каждом экране. */
interface Directory {
  ready: boolean
  vehicles: Vehicle[]
  activeVehicles: Vehicle[]
  profiles: Profile[]
  clients: Client[]
  places: Place[]
  settings: AppSettings | null
  profileById: (id: string | null | undefined) => Profile | undefined
  vehicleById: (id: string | null | undefined) => Vehicle | undefined
  reload: () => Promise<void>
}

const DirectoryContext = createContext<Directory | null>(null)

async function fetchAll<T>(table: string, order: string): Promise<T[]> {
  const out: T[] = []
  const page = 1000
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .order(order)
      .range(from, from + page - 1)
    if (error) throw error
    out.push(...((data ?? []) as T[]))
    if (!data || data.length < page) break
  }
  return out
}

export function DirectoryProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [places, setPlaces] = useState<Place[]>([])
  const [settings, setSettings] = useState<AppSettings | null>(null)

  const reload = useCallback(async () => {
    try {
      const [v, p, c, pl, s] = await Promise.all([
        fetchAll<Vehicle>('vehicles', 'sort'),
        fetchAll<Profile>('profiles', 'full_name'),
        fetchAll<Client>('clients', 'full_name'),
        fetchAll<Place>('places', 'name'),
        supabase.from('app_settings').select('*').eq('id', 1).maybeSingle(),
      ])
      setVehicles(v.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'ru')))
      setProfiles(p)
      setClients(c)
      setPlaces(pl)
      setSettings((s.data as AppSettings | null) ?? null)
    } catch (e) {
      console.error('Не удалось загрузить справочники', e)
    } finally {
      setReady(true)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  useRealtime(['vehicles', 'clients'], reload)

  const value = useMemo<Directory>(() => {
    const pMap = new Map(profiles.map((p) => [p.id, p]))
    const vMap = new Map(vehicles.map((v) => [v.id, v]))
    return {
      ready,
      vehicles,
      activeVehicles: vehicles.filter((v) => v.is_active),
      profiles,
      clients,
      places,
      settings,
      profileById: (id) => (id ? pMap.get(id) : undefined),
      vehicleById: (id) => (id ? vMap.get(id) : undefined),
      reload,
    }
  }, [ready, vehicles, profiles, clients, places, settings, reload])

  return <DirectoryContext.Provider value={value}>{children}</DirectoryContext.Provider>
}

export function useDirectory(): Directory {
  const ctx = useContext(DirectoryContext)
  if (!ctx) throw new Error('useDirectory вне DirectoryProvider')
  return ctx
}
