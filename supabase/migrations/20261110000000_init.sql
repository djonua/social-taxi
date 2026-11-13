-- Социальное такси: схема данных, статусы, права доступа.
--
-- Роли:   admin (администратор), dispatcher (диспетчер), driver (водитель)
-- Поездка (trip) — одна «нога»: забрать клиента в pickup_time и отвезти в to_address.
-- Обратная дорога — отдельная поездка с тем же pair_id.
-- Даты и время хранятся как местные (date + time), без часовых поясов.

create extension if not exists pgcrypto;

create type public.user_role as enum ('admin', 'dispatcher', 'driver');
create type public.trip_status as enum (
  'planned',      -- запланирована (ждёт выезда)
  'en_route',     -- водитель едет к клиенту
  'arrived',      -- водитель на месте, ждёт клиента
  'in_progress',  -- клиент в машине, едут
  'completed',    -- доставлен
  'cancelled'     -- отменена
);

-- ───────────────────────── Таблицы ─────────────────────────

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  login text not null unique,
  full_name text not null,
  phone text,
  role public.user_role not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plate text,
  driver_id uuid unique references public.profiles (id) on delete set null,
  -- Ориентир нагрузки (поездок в одну сторону за день). Ничего не блокирует:
  -- используется для подсказок и расчёта «сколько машин нужно».
  daily_limit int not null default 16 check (daily_limit > 0),
  -- Сколько клиентов машина берёт одновременно (попутные поездки). Тоже только подсказка.
  seats int not null default 3 check (seats > 0),
  is_active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text,
  extra_phone text,           -- телефон родственника / сопровождающего
  extra_contact text,         -- кто это (мама, сын…)
  address text,               -- домашний адрес
  diagnosis text,
  mobility text not null default 'assist'
    check (mobility in ('walks', 'assist', 'wheelchair')),
  escort boolean not null default false,  -- ездит с сопровождающим
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index clients_name_idx on public.clients (lower(full_name));

-- Частые пункты назначения (поликлиники, реабилитационные центры…)
create table public.places (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  trip_date date not null,
  pickup_time time not null,          -- во сколько забрать
  arrive_by time,                     -- во сколько нужно быть на месте
  client_id uuid not null references public.clients (id) on delete restrict,
  from_address text not null,
  to_address text not null,
  direction text not null default 'there' check (direction in ('there', 'back')),
  pair_id uuid,                       -- связывает «туда» и «обратно»
  vehicle_id uuid references public.vehicles (id) on delete restrict,
  status public.trip_status not null default 'planned',
  note text,                          -- комментарий диспетчера водителю
  cancel_reason text,
  started_at timestamptz,             -- выехал к клиенту
  arrived_at timestamptz,             -- на месте
  picked_up_at timestamptz,           -- клиент в машине
  completed_at timestamptz,
  cancelled_at timestamptz,
  changed_at timestamptz not null default now(),  -- последнее изменение диспетчером
  driver_seen_at timestamptz,                     -- водитель подтвердил, что видел
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index trips_date_vehicle_idx on public.trips (trip_date, vehicle_id);
create index trips_client_idx on public.trips (client_id);
create index trips_pair_idx on public.trips (pair_id) where pair_id is not null;

create table public.trip_events (
  id bigint generated always as identity primary key,
  trip_id uuid not null references public.trips (id) on delete cascade,
  at timestamptz not null default now(),
  actor_id uuid references public.profiles (id) on delete set null,
  kind text not null,     -- created | status | vehicle | time | edited | seen
  details text
);
create index trip_events_trip_idx on public.trip_events (trip_id, at);

-- Отказы: клиент обратился, но поездку выполнить не смогли.
create table public.refusals (
  id uuid primary key default gen_random_uuid(),
  req_date date not null,             -- на какой день просили
  req_time time,                      -- на какое время
  client_id uuid references public.clients (id) on delete set null,
  client_name text,
  phone text,
  from_address text,
  to_address text,
  with_return boolean not null default true,  -- нужна была и обратная дорога
  reason text not null default 'no_cars'
    check (reason in ('no_cars', 'out_of_hours', 'out_of_area', 'other')),
  comment text,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index refusals_date_idx on public.refusals (req_date);

-- «Маячок» для приложения водителя: меняется при любом изменении заказов машины
-- (в том числе когда заказ у машины забрали).
create table public.vehicle_feed (
  vehicle_id uuid primary key references public.vehicles (id) on delete cascade,
  changed_at timestamptz not null default now()
);

create table public.app_settings (
  id int primary key default 1 check (id = 1),
  org_name text not null default 'Социальное такси',
  dispatcher_phone text
);
insert into public.app_settings (id) values (1);

-- ───────────────────────── Вспомогательные функции ─────────────────────────

create or replace function public.my_role()
returns public.user_role
language sql stable security definer set search_path = ''
as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(public.my_role() in ('admin', 'dispatcher'), false)
$$;

create or replace function public.my_vehicle_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select v.id
  from public.vehicles v
  join public.profiles p on p.id = v.driver_id
  where v.driver_id = auth.uid() and p.is_active and p.role = 'driver' and v.is_active
  limit 1
$$;

-- ───────────────────────── Триггеры поездок ─────────────────────────

create or replace function public.trips_before_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.changed_at := clock_timestamp();
    new.updated_at := clock_timestamp();
    new.driver_seen_at := null;
    return new;
  end if;

  new.updated_at := clock_timestamp();

  -- Изменения, сделанные диспетчером, водитель должен увидеть и подтвердить.
  if public.my_vehicle_id() is null then
    if (new.trip_date, new.pickup_time, new.arrive_by, new.client_id,
        new.from_address, new.to_address, new.vehicle_id, new.note)
       is distinct from
       (old.trip_date, old.pickup_time, old.arrive_by, old.client_id,
        old.from_address, old.to_address, old.vehicle_id, old.note)
       or ((new.status = 'cancelled') <> (old.status = 'cancelled'))
    then
      new.changed_at := clock_timestamp();
    end if;
    if new.vehicle_id is distinct from old.vehicle_id then
      new.driver_seen_at := null;
    end if;
  end if;

  -- Отметки времени по статусам.
  if new.status is distinct from old.status then
    if new.status <> 'cancelled' then
      new.cancelled_at := null;
      new.cancel_reason := null;
    end if;
    case new.status
      when 'planned' then
        new.started_at := null; new.arrived_at := null;
        new.picked_up_at := null; new.completed_at := null;
      when 'en_route' then
        new.started_at := coalesce(old.started_at, clock_timestamp());
        new.arrived_at := null; new.picked_up_at := null; new.completed_at := null;
      when 'arrived' then
        new.started_at := coalesce(old.started_at, clock_timestamp());
        new.arrived_at := coalesce(old.arrived_at, clock_timestamp());
        new.picked_up_at := null; new.completed_at := null;
      when 'in_progress' then
        new.started_at := coalesce(old.started_at, clock_timestamp());
        new.arrived_at := coalesce(old.arrived_at, clock_timestamp());
        new.picked_up_at := coalesce(old.picked_up_at, clock_timestamp());
        new.completed_at := null;
      when 'completed' then
        new.completed_at := clock_timestamp();
      when 'cancelled' then
        new.cancelled_at := clock_timestamp();
    end case;
  end if;

  return new;
end
$$;

create trigger trips_before_write
before insert or update on public.trips
for each row execute function public.trips_before_write();

create or replace function public.trips_after_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
begin
  -- маячки для приложений водителей
  if tg_op in ('UPDATE', 'DELETE') and old.vehicle_id is not null then
    insert into public.vehicle_feed (vehicle_id, changed_at)
    values (old.vehicle_id, clock_timestamp())
    on conflict (vehicle_id) do update set changed_at = excluded.changed_at;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.vehicle_id is not null
     and (tg_op = 'INSERT' or new.vehicle_id is distinct from old.vehicle_id) then
    insert into public.vehicle_feed (vehicle_id, changed_at)
    values (new.vehicle_id, clock_timestamp())
    on conflict (vehicle_id) do update set changed_at = excluded.changed_at;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  -- журнал
  if actor is not null and not exists (select 1 from public.profiles where id = actor) then
    actor := null;
  end if;

  if tg_op = 'INSERT' then
    insert into public.trip_events (trip_id, actor_id, kind) values (new.id, actor, 'created');
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.trip_events (trip_id, actor_id, kind, details)
    values (new.id, actor, 'status',
            new.status::text || coalesce(': ' || new.cancel_reason, ''));
  end if;
  if new.vehicle_id is distinct from old.vehicle_id then
    insert into public.trip_events (trip_id, actor_id, kind, details)
    values (new.id, actor, 'vehicle',
            coalesce((select name from public.vehicles where id = new.vehicle_id), '—'));
  end if;
  if (new.trip_date, new.pickup_time, new.arrive_by)
     is distinct from (old.trip_date, old.pickup_time, old.arrive_by) then
    insert into public.trip_events (trip_id, actor_id, kind, details)
    values (new.id, actor, 'time',
            to_char(old.trip_date, 'DD.MM') || ' ' || to_char(old.pickup_time, 'HH24:MI')
            || ' → ' ||
            to_char(new.trip_date, 'DD.MM') || ' ' || to_char(new.pickup_time, 'HH24:MI'));
  end if;
  if (new.client_id, new.from_address, new.to_address, new.note)
     is distinct from (old.client_id, old.from_address, old.to_address, old.note) then
    insert into public.trip_events (trip_id, actor_id, kind) values (new.id, actor, 'edited');
  end if;
  if new.driver_seen_at is not null and new.driver_seen_at is distinct from old.driver_seen_at
     and new.status is not distinct from old.status then
    insert into public.trip_events (trip_id, actor_id, kind) values (new.id, actor, 'seen');
  end if;

  return new;
end
$$;

create trigger trips_after_write
after insert or update or delete on public.trips
for each row execute function public.trips_after_write();

-- ───────────────────────── Действия водителя ─────────────────────────
-- Водитель не редактирует поездки напрямую — только через эти функции.

create or replace function public.driver_set_status(
  p_trip uuid,
  p_status public.trip_status,
  p_reason text default null
)
returns public.trips
language plpgsql security definer set search_path = ''
as $$
declare
  v uuid := public.my_vehicle_id();
  t public.trips;
begin
  if v is null then
    raise exception 'За вами не закреплена машина. Обратитесь к диспетчеру.';
  end if;

  select * into t from public.trips where id = p_trip for update;
  if not found or t.vehicle_id is distinct from v then
    raise exception 'Заказ не найден или передан другой машине.';
  end if;
  if t.status = 'cancelled' then
    raise exception 'Заказ отменён. Уточните у диспетчера.';
  end if;

  update public.trips
  set status = p_status,
      cancel_reason = case when p_status = 'cancelled'
        then coalesce(nullif(btrim(p_reason), ''), 'Клиент не вышел') end,
      driver_seen_at = clock_timestamp()
  where id = p_trip
  returning * into t;

  return t;
end
$$;

create or replace function public.driver_ack(p_trips uuid[])
returns void
language sql security definer set search_path = ''
as $$
  update public.trips
  set driver_seen_at = clock_timestamp()
  where id = any (p_trips) and vehicle_id = public.my_vehicle_id()
$$;

-- ───────────────────────── Статистика ─────────────────────────

create or replace function public.stats_report(p_from date, p_to date)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  res jsonb;
begin
  if not public.is_staff() then
    raise exception 'Недостаточно прав';
  end if;
  if p_to < p_from or p_to - p_from > 400 then
    raise exception 'Некорректный период';
  end if;

  select jsonb_build_object(
    'days', (
      select coalesce(jsonb_agg(x.d order by x.day), '[]'::jsonb)
      from (
        select g.day::date as day, jsonb_build_object(
          'date', g.day::date,
          'completed', (select count(*) from public.trips t
                        where t.trip_date = g.day::date and t.status = 'completed'),
          'cancelled', (select count(*) from public.trips t
                        where t.trip_date = g.day::date and t.status = 'cancelled'),
          'pending',   (select count(*) from public.trips t
                        where t.trip_date = g.day::date
                          and t.status not in ('completed', 'cancelled')),
          'refusals',  (select count(*) from public.refusals r where r.req_date = g.day::date),
          'refused_trips', (select coalesce(sum(case when r.with_return then 2 else 1 end), 0)
                            from public.refusals r where r.req_date = g.day::date)
        ) as d
        from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as g(day)
      ) x
    ),
    'hours', (
      select jsonb_agg(jsonb_build_object(
        'hour', h,
        'trips', (select count(*) from public.trips t
                  where t.trip_date between p_from and p_to and t.status <> 'cancelled'
                    and extract(hour from t.pickup_time) = h),
        'refusals', (select count(*) from public.refusals r
                     where r.req_date between p_from and p_to and r.req_time is not null
                       and extract(hour from r.req_time) = h)
      ) order by h)
      from generate_series(0, 23) as h
    ),
    'cancel_reasons', (
      select coalesce(jsonb_agg(jsonb_build_object('reason', c.reason, 'count', c.n) order by c.n desc), '[]'::jsonb)
      from (
        select coalesce(nullif(btrim(t.cancel_reason), ''), 'Без причины') as reason, count(*) as n
        from public.trips t
        where t.trip_date between p_from and p_to and t.status = 'cancelled'
        group by 1
      ) c
    ),
    'refusal_reasons', (
      select coalesce(jsonb_agg(jsonb_build_object('reason', c.reason, 'count', c.n) order by c.n desc), '[]'::jsonb)
      from (
        select r.reason, count(*) as n
        from public.refusals r
        where r.req_date between p_from and p_to
        group by 1
      ) c
    ),
    'vehicles', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', v.id, 'name', v.name, 'daily_limit', v.daily_limit, 'is_active', v.is_active,
        'completed', (select count(*) from public.trips t
                      where t.vehicle_id = v.id and t.trip_date between p_from and p_to
                        and t.status = 'completed'),
        'total', (select count(*) from public.trips t
                  where t.vehicle_id = v.id and t.trip_date between p_from and p_to
                    and t.status <> 'cancelled'),
        'work_days', (select count(distinct t.trip_date) from public.trips t
                      where t.vehicle_id = v.id and t.trip_date between p_from and p_to
                        and t.status <> 'cancelled')
      ) order by v.sort, v.name), '[]'::jsonb)
      from public.vehicles v
    ),
    'active_vehicles', (select count(*) from public.vehicles v where v.is_active),
    'avg_limit', (select coalesce(round(avg(v.daily_limit)), 16) from public.vehicles v where v.is_active)
  ) into res;

  return res;
end
$$;

-- ───────────────────────── Права доступа (RLS) ─────────────────────────

alter table public.profiles enable row level security;
alter table public.vehicles enable row level security;
alter table public.clients enable row level security;
alter table public.places enable row level security;
alter table public.trips enable row level security;
alter table public.trip_events enable row level security;
alter table public.refusals enable row level security;
alter table public.vehicle_feed enable row level security;
alter table public.app_settings enable row level security;

revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon, public;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- profiles: сотрудники видят всех, каждый видит себя. Изменения — только через
-- серверную функцию admin-users (service role).
create policy profiles_select on public.profiles for select to authenticated
  using ((select public.is_staff()) or id = (select auth.uid()));

-- vehicles
create policy vehicles_select on public.vehicles for select to authenticated
  using ((select public.is_staff()) or driver_id = (select auth.uid()));
create policy vehicles_staff_write on public.vehicles for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

-- clients: сотрудники — всё; водитель — только клиентов из своих ближайших поездок
create policy clients_staff on public.clients for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));
create policy clients_driver_select on public.clients for select to authenticated
  using (exists (
    select 1 from public.trips t
    where t.client_id = clients.id
      and t.vehicle_id = (select public.my_vehicle_id())
      and t.trip_date between current_date - 1 and current_date + 7
  ));

-- places
create policy places_staff on public.places for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

-- trips
create policy trips_staff on public.trips for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));
create policy trips_driver_select on public.trips for select to authenticated
  using (
    vehicle_id = (select public.my_vehicle_id())
    and trip_date between current_date - 1 and current_date + 7
  );

-- trip_events: читают сотрудники, пишет только триггер
create policy trip_events_staff_select on public.trip_events for select to authenticated
  using ((select public.is_staff()));

-- refusals
create policy refusals_staff on public.refusals for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

-- vehicle_feed
create policy vehicle_feed_select on public.vehicle_feed for select to authenticated
  using ((select public.is_staff()) or vehicle_id = (select public.my_vehicle_id()));

-- app_settings
create policy app_settings_select on public.app_settings for select to authenticated
  using ((select public.my_role()) is not null);
create policy app_settings_update on public.app_settings for update to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

-- ───────────────────────── Realtime ─────────────────────────

alter publication supabase_realtime add table
  public.trips, public.vehicles, public.vehicle_feed, public.refusals, public.clients;
