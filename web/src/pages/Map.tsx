import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Phone, UserRound } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cx, StatusBadge } from '../components/ui'
import { useDirectory, useRealtime } from '../lib/data'
import { fmtClock, fmtTime, isActiveStatus, shortAddress, shortName, todayISO } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { Trip, VehicleLocation } from '../lib/types'

/** Центр карты по умолчанию — Сухум. */
const DEFAULT_CENTER: L.LatLngTuple = [43.0015, 41.0234]
/** Через сколько минут без обновлений считаем, что связи с машиной нет. */
const STALE_MIN = 3
const BASEMAP_KEY = 'staxi.basemap'

type Presence = 'online' | 'stale' | 'off' | 'none'

function presenceOf(loc: VehicleLocation | undefined, now: number): { state: Presence; text: string } {
  if (!loc) return { state: 'none', text: 'Местоположение ещё не передавалось' }
  const ageMin = Math.max(0, Math.floor((now - new Date(loc.recorded_at).getTime()) / 60000))
  if (!loc.on_duty) return { state: 'off', text: `Не на линии · был в ${fmtClock(loc.recorded_at)}` }
  if (ageMin >= STALE_MIN) {
    const age = ageMin < 60 ? `${ageMin} мин` : ageMin < 1440 ? `${Math.floor(ageMin / 60)} ч` : 'больше суток'
    return { state: 'stale', text: `Нет связи ${age} · последняя точка в ${fmtClock(loc.recorded_at)}` }
  }
  const speed = loc.speed != null && loc.speed > 1 ? ` · ${Math.round(loc.speed * 3.6)} км/ч` : ''
  return { state: 'online', text: `На линии · обновлено ${ageMin === 0 ? 'только что' : `${ageMin} мин назад`}${speed}` }
}

const DOT: Record<Presence, string> = {
  online: 'bg-emerald-500',
  stale: 'bg-amber-500',
  off: 'bg-slate-400',
  none: 'bg-slate-300',
}

function markerIcon(name: string, state: Presence): L.DivIcon {
  const color = state === 'online' ? '#0f766e' : state === 'stale' ? '#b45309' : '#64748b'
  const safe = name.replace(/[<>&]/g, '')
  return L.divIcon({
    className: '',
    iconSize: [0, 0],
    html: `<div style="position:absolute;transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center;pointer-events:auto">
      <div style="background:${color};color:#fff;font:600 13px/1 system-ui,sans-serif;padding:6px 10px;border-radius:999px;white-space:nowrap;box-shadow:0 2px 6px rgba(15,23,42,.35);border:2px solid #fff">${safe}</div>
      <div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid ${color};margin-top:-2px"></div>
    </div>`,
  })
}

export function MapPage() {
  const { activeVehicles, profileById } = useDirectory()
  const [locations, setLocations] = useState<VehicleLocation[]>([])
  const [trips, setTrips] = useState<Trip[]>([])
  const [now, setNow] = useState(() => Date.now())
  const [selected, setSelected] = useState<string | null>(null)

  const mapEl = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const markers = useRef(new Map<string, L.Marker>())
  const fitted = useRef(false)

  const load = useCallback(async () => {
    const [l, t] = await Promise.all([
      supabase.from('vehicle_locations').select('*'),
      supabase
        .from('trips')
        .select('*, client:clients(*)')
        .eq('trip_date', todayISO())
        .in('status', ['planned', 'en_route', 'arrived', 'in_progress'])
        .not('vehicle_id', 'is', null)
        .order('pickup_time'),
    ])
    setLocations((l.data ?? []) as VehicleLocation[])
    setTrips((t.data ?? []) as Trip[])
    setNow(Date.now())
  }, [])

  useEffect(() => {
    void load()
  }, [load])
  useRealtime(['vehicle_locations', 'trips'], load)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20000)
    return () => clearInterval(t)
  }, [])

  // Создание карты
  useEffect(() => {
    if (!mapEl.current || map.current) return
    const m = L.map(mapEl.current, { zoomControl: true }).setView(DEFAULT_CENTER, 13)
    // Две подложки на выбор: если одна недоступна (блокировка, сбой), диспетчер
    // переключается на другую. Выбор запоминается в браузере.
    // referrerPolicy: OpenStreetMap не отдаёт плитки запросам без Referer.
    const layers: Record<string, L.TileLayer> = {
      OpenStreetMap: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        referrerPolicy: 'strict-origin-when-cross-origin',
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }),
      'Carto (запасная)': L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        maxZoom: 20,
        subdomains: 'abcd',
        referrerPolicy: 'strict-origin-when-cross-origin',
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>',
      }),
    }
    let saved: string | null = null
    try {
      saved = localStorage.getItem(BASEMAP_KEY)
    } catch {
      /* хранилище недоступно — берём подложку по умолчанию */
    }
    ;(layers[saved ?? ''] ?? layers.OpenStreetMap).addTo(m)
    L.control.layers(layers, undefined, { position: 'topright', collapsed: false }).addTo(m)
    m.on('baselayerchange', (e) => {
      try {
        localStorage.setItem(BASEMAP_KEY, e.name)
      } catch {
        /* не страшно */
      }
    })
    map.current = m
    // Размер области карты меняется (боковая панель, полоса демо-режима, окно) —
    // без пересчёта Leaflet оставляет серые участки без плиток.
    const resize = new ResizeObserver(() => m.invalidateSize())
    resize.observe(mapEl.current)
    const known = markers.current
    return () => {
      resize.disconnect()
      m.remove()
      map.current = null
      known.clear()
      fitted.current = false
    }
  }, [])

  const locByVehicle = useMemo(() => new Map(locations.map((l) => [l.vehicle_id, l])), [locations])

  // Маркеры
  useEffect(() => {
    const m = map.current
    if (!m) return
    const seen = new Set<string>()
    for (const v of activeVehicles) {
      const loc = locByVehicle.get(v.id)
      if (!loc) continue
      seen.add(v.id)
      const icon = markerIcon(v.name, presenceOf(loc, now).state)
      const existing = markers.current.get(v.id)
      if (existing) {
        existing.setLatLng([loc.lat, loc.lng]).setIcon(icon)
      } else {
        const marker = L.marker([loc.lat, loc.lng], { icon }).addTo(m)
        marker.on('click', () => setSelected(v.id))
        markers.current.set(v.id, marker)
      }
    }
    for (const [id, marker] of markers.current) {
      if (!seen.has(id)) {
        marker.remove()
        markers.current.delete(id)
      }
    }
    if (!fitted.current && seen.size > 0) {
      fitted.current = true
      const points = [...markers.current.values()].map((x) => x.getLatLng())
      if (points.length === 1) m.setView(points[0], 14)
      else m.fitBounds(L.latLngBounds(points).pad(0.3), { maxZoom: 15 })
    }
  }, [activeVehicles, locByVehicle, now])

  function focus(vehicleId: string) {
    setSelected(vehicleId)
    const loc = locByVehicle.get(vehicleId)
    if (loc && map.current) map.current.flyTo([loc.lat, loc.lng], Math.max(map.current.getZoom(), 15))
  }

  return (
    <div className="flex h-full flex-col md:flex-row">
      <aside className="max-h-[45%] shrink-0 overflow-y-auto border-b border-slate-200 bg-white md:max-h-none md:w-88 md:border-r md:border-b-0">
        <div className="border-b border-slate-100 px-4 py-3">
          <h1 className="text-lg font-semibold text-slate-900">Машины на карте</h1>
          <p className="text-sm text-slate-500">
            Положение передаёт приложение водителя, пока он «на линии».
          </p>
        </div>
        {activeVehicles.map((v) => {
          const loc = locByVehicle.get(v.id)
          const p = presenceOf(loc, now)
          const driver = profileById(v.driver_id)
          const mine = trips.filter((t) => t.vehicle_id === v.id)
          const active = mine.filter((t) => isActiveStatus(t.status))
          const next = mine.find((t) => t.status === 'planned')
          return (
            <div
              key={v.id}
              role="button"
              tabIndex={0}
              onClick={() => focus(v.id)}
              onKeyDown={(e) => e.key === 'Enter' && focus(v.id)}
              className={cx(
                'cursor-pointer border-b border-slate-100 px-4 py-3 hover:bg-slate-50',
                selected === v.id && 'bg-brand-50 hover:bg-brand-50',
              )}
            >
              <div className="flex items-center gap-2">
                <span className={cx('size-2.5 shrink-0 rounded-full', DOT[p.state])} />
                <span className="font-semibold text-slate-900">{v.name}</span>
                {v.plate && <span className="text-sm text-slate-500">{v.plate}</span>}
              </div>
              <div
                className={cx(
                  'mt-0.5 text-sm',
                  p.state === 'online' ? 'text-emerald-700' : p.state === 'stale' ? 'text-amber-700' : 'text-slate-500',
                )}
              >
                {p.text}
              </div>
              <div className="mt-1 flex items-center gap-2 text-sm text-slate-600">
                <UserRound className="size-3.5" />
                {driver ? shortName(driver.full_name) : 'водитель не назначен'}
                {driver?.phone && (
                  <a
                    href={`tel:${driver.phone}`}
                    onClick={(e) => e.stopPropagation()}
                    className="ml-auto inline-flex items-center gap-1 text-brand-800 hover:underline"
                  >
                    <Phone className="size-3.5" />
                    {driver.phone}
                  </a>
                )}
              </div>
              {active.map((t) => (
                <div key={t.id} className="mt-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-sm ring-1 ring-slate-200 ring-inset">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-900">{shortName(t.client?.full_name ?? '—')}</span>
                    <StatusBadge status={t.status} className="ml-auto" />
                  </div>
                  <div className="text-slate-600">
                    {shortAddress(t.from_address)} → {shortAddress(t.to_address)}
                  </div>
                </div>
              ))}
              {next && (
                <div className="mt-1.5 text-sm text-slate-600">
                  Далее: <b className="text-slate-800 tabular-nums">{fmtTime(next.pickup_time)}</b>{' '}
                  {shortName(next.client?.full_name ?? '—')}
                </div>
              )}
            </div>
          )
        })}
        {activeVehicles.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-slate-500">Машины ещё не добавлены</div>
        )}
      </aside>
      <div ref={mapEl} className="z-0 min-h-64 flex-1" />
    </div>
  )
}
