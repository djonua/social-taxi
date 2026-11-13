export type Role = 'admin' | 'dispatcher' | 'driver'

export type TripStatus =
  | 'planned'
  | 'en_route'
  | 'arrived'
  | 'in_progress'
  | 'completed'
  | 'cancelled'

export type Mobility = 'walks' | 'assist' | 'wheelchair'

export type RefusalReason = 'no_cars' | 'out_of_hours' | 'out_of_area' | 'other'

export interface Profile {
  id: string
  login: string
  full_name: string
  phone: string | null
  role: Role
  is_active: boolean
  created_at: string
}

export interface Vehicle {
  id: string
  name: string
  plate: string | null
  driver_id: string | null
  daily_limit: number
  seats: number
  is_active: boolean
  sort: number
}

export interface Client {
  id: string
  full_name: string
  phone: string | null
  extra_phone: string | null
  extra_contact: string | null
  address: string | null
  diagnosis: string | null
  mobility: Mobility
  escort: boolean
  notes: string | null
  is_active: boolean
  created_at: string
}

export interface Place {
  id: string
  name: string
  address: string | null
  is_active: boolean
}

export interface Trip {
  id: string
  trip_date: string
  pickup_time: string
  arrive_by: string | null
  client_id: string
  from_address: string
  to_address: string
  direction: 'there' | 'back'
  pair_id: string | null
  vehicle_id: string | null
  status: TripStatus
  note: string | null
  cancel_reason: string | null
  started_at: string | null
  arrived_at: string | null
  picked_up_at: string | null
  completed_at: string | null
  cancelled_at: string | null
  changed_at: string
  driver_seen_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  client?: Client
}

export interface TripEvent {
  id: number
  trip_id: string
  at: string
  actor_id: string | null
  kind: 'created' | 'status' | 'vehicle' | 'time' | 'edited' | 'seen'
  details: string | null
}

export interface Refusal {
  id: string
  req_date: string
  req_time: string | null
  client_id: string | null
  client_name: string | null
  phone: string | null
  from_address: string | null
  to_address: string | null
  with_return: boolean
  reason: RefusalReason
  comment: string | null
  created_by: string | null
  created_at: string
}

export interface VehicleLocation {
  vehicle_id: string
  lat: number
  lng: number
  accuracy: number | null
  speed: number | null
  heading: number | null
  on_duty: boolean
  recorded_at: string
}

export interface AppSettings {
  id: number
  org_name: string
  dispatcher_phone: string | null
}

export interface StatsReport {
  days: {
    date: string
    completed: number
    cancelled: number
    pending: number
    refusals: number
    refused_trips: number
  }[]
  hours: { hour: number; trips: number; refusals: number }[]
  cancel_reasons: { reason: string; count: number }[]
  refusal_reasons: { reason: RefusalReason; count: number }[]
  vehicles: {
    id: string
    name: string
    daily_limit: number
    is_active: boolean
    completed: number
    total: number
    work_days: number
  }[]
  active_vehicles: number
  avg_limit: number
}
