-- Местоположение машин: приложение водителя передаёт координаты,
-- диспетчер видит машины на карте. Хранится только последняя точка.

create table public.vehicle_locations (
  vehicle_id uuid primary key references public.vehicles (id) on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  accuracy real,        -- точность, м
  speed real,           -- скорость, м/с
  heading real,         -- направление, градусы
  on_duty boolean not null default true,  -- водитель «на линии»
  recorded_at timestamptz not null default now()
);

alter table public.vehicle_locations enable row level security;
revoke all on public.vehicle_locations from anon;
grant select on public.vehicle_locations to authenticated;
grant all on public.vehicle_locations to service_role;

create policy vehicle_locations_staff_select on public.vehicle_locations
  for select to authenticated
  using ((select public.is_staff()));

-- Водитель сообщает координаты своей машины.
create or replace function public.driver_report_location(
  p_lat double precision,
  p_lng double precision,
  p_accuracy real default null,
  p_speed real default null,
  p_heading real default null
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v uuid := public.my_vehicle_id();
begin
  if v is null then
    return;
  end if;
  insert into public.vehicle_locations (vehicle_id, lat, lng, accuracy, speed, heading, on_duty, recorded_at)
  values (v, p_lat, p_lng, p_accuracy, p_speed, p_heading, true, clock_timestamp())
  on conflict (vehicle_id) do update
    set lat = excluded.lat, lng = excluded.lng, accuracy = excluded.accuracy,
        speed = excluded.speed, heading = excluded.heading,
        on_duty = true, recorded_at = excluded.recorded_at;
end
$$;

-- Водитель завершил смену: точка остаётся, но помечается «не на линии».
create or replace function public.driver_set_off_duty()
returns void
language sql security definer set search_path = ''
as $$
  update public.vehicle_locations
  set on_duty = false
  where vehicle_id = public.my_vehicle_id()
$$;

revoke all on function public.driver_report_location(double precision, double precision, real, real, real) from anon, public;
revoke all on function public.driver_set_off_duty() from anon, public;
grant execute on function public.driver_report_location(double precision, double precision, real, real, real) to authenticated, service_role;
grant execute on function public.driver_set_off_duty() to authenticated, service_role;

alter publication supabase_realtime add table public.vehicle_locations;
