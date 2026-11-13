-- ДЕМО-РЕЖИМ: вымышленные данные и «оживление» для показа системы.
--
-- !!! Применяется ТОЛЬКО к демо-базе (и к локальной базе разработчика).
-- !!! В боевую базу этот файл не попадает: он лежит вне supabase/migrations.
--
-- Что делает:
--   demo.reset()  — стирает данные и создаёт заново: 10 клиентов, 2 машины, историю за 2 недели,
--                   расписание на сегодня (вокруг текущего времени) и на завтра, отказы.
--   demo.tick()   — каждые 10 секунд: «Машина 2» сама проходит статусы заказов и ездит по карте;
--                   «Машину 1» ведёт человек с телефона (если телефон молчит — по карте ездит и она).
--   public.demo_reset() — кнопка «Начать демо заново» на сайте.
-- Файл можно применять повторно.

create schema if not exists demo;
create extension if not exists pg_cron;

-- Местное время (Абхазия = UTC+3).
create or replace function demo.today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Europe/Moscow')::date
$$;

create or replace function demo.now_minutes() returns numeric
language sql stable set search_path = '' as $$
  select extract(epoch from (now() at time zone 'Europe/Moscow')::time) / 60
$$;

-- Точка на условном маршруте по Сухуму в заданный момент (машина ходит по кругу).
create or replace function demo.route_point(
  route int, at_time timestamptz,
  out lat double precision, out lng double precision
)
language plpgsql immutable set search_path = '' as $$
declare
  lats double precision[];
  lngs double precision[];
  period numeric;
  n int; u numeric; i int; j int; f double precision;
begin
  if route = 1 then
    lats := array[43.0030, 43.0025, 43.0022, 43.0060, 43.0090, 43.0075, 43.0055];
    lngs := array[41.0100, 41.0200, 41.0300, 41.0340, 41.0280, 41.0180, 41.0110];
    period := 540;
  else
    lats := array[43.0120, 43.0100, 43.0070, 43.0040, 43.0080, 43.0130, 43.0150];
    lngs := array[41.0000, 41.0100, 41.0220, 41.0330, 41.0400, 41.0300, 41.0150];
    period := 660;
  end if;
  n := array_length(lats, 1);
  u := (extract(epoch from at_time)::numeric % period) / period * n;
  i := floor(u)::int % n;
  j := (i + 1) % n;
  f := (u - floor(u))::double precision;
  lat := lats[i + 1] + (lats[j + 1] - lats[i + 1]) * f;
  lng := lngs[i + 1] + (lngs[j + 1] - lngs[i + 1]) * f;
end
$$;

-- Расписание одного дня: по 5 клиентов на машину, каждому «туда» и «обратно».
--   mode: 'past'   — день прошёл: поездки выполнены, изредка отменены;
--         'today'  — то, что по времени уже позади, выполнено, остальное в плане;
--         'future' — всё в плане.
create or replace function demo.add_day(day date, start_min int, mode text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v1 constant uuid := '00000000-0000-4000-8000-000000000001';
  v2 constant uuid := '00000000-0000-4000-8000-000000000002';
  places constant text[] := array[
    'Республиканская больница, физиотерапия, Сухум, ул. Аргун, 2',
    'Реабилитационный центр, Сухум, ул. Ардзинба, 150',
    'Городская поликлиника №1, Сухум, пр. Аиааира, 91',
    'Бассейн (ЛФК), Сухум, Набережная Махаджиров, 18',
    'МСЭ (медико-социальная экспертиза), Сухум, ул. Лакоба, 34'
  ];
  now_min numeric := demo.now_minutes();
  c record;
  i int := 0;
  slot int; there int; back int;
  place text; veh uuid; pair uuid;
  st_there public.trip_status; st_back public.trip_status;
  reason text;
begin
  for c in select id, address from public.clients order by full_name loop
    veh := case when i < 5 then v1 else v2 end;
    slot := i % 5;
    there := start_min + slot * 40;
    back := there + 90;
    place := places[i % 5 + 1];
    pair := gen_random_uuid();
    reason := null;

    if mode = 'past' then
      if (i + extract(day from day)::int) % 11 = 0 then
        st_there := 'cancelled'; st_back := 'cancelled';
        reason := case when i % 2 = 0 then 'Клиент заболел' else 'Клиент отменил' end;
      else
        st_there := 'completed'; st_back := 'completed';
      end if;
    elsif mode = 'today' then
      st_there := case when there + 30 < now_min then 'completed' else 'planned' end;
      st_back := case when back + 25 < now_min then 'completed' else 'planned' end;
    else
      st_there := 'planned'; st_back := 'planned';
    end if;

    insert into public.trips
      (trip_date, pickup_time, arrive_by, client_id, from_address, to_address, direction,
       pair_id, vehicle_id, status, cancel_reason, note, completed_at)
    values
      (day, time '00:00' + make_interval(mins => there), time '00:00' + make_interval(mins => there + 30),
       c.id, c.address, place, 'there', pair, veh, st_there, reason,
       case when slot = 0 then 'Позвонить за 10 минут до приезда.' end,
       case when st_there = 'completed'
         then (day + time '00:00' + make_interval(mins => there + 28)) at time zone 'Europe/Moscow' end),
      (day, time '00:00' + make_interval(mins => back), null,
       c.id, place, c.address, 'back', pair, veh, st_back, reason, null,
       case when st_back = 'completed'
         then (day + time '00:00' + make_interval(mins => back + 22)) at time zone 'Europe/Moscow' end);

    i := i + 1;
  end loop;
end
$$;

create or replace function demo.reset()
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v1 constant uuid := '00000000-0000-4000-8000-000000000001';
  v2 constant uuid := '00000000-0000-4000-8000-000000000002';
  reasons constant text[] := array['no_cars', 'no_cars', 'no_cars', 'no_cars', 'out_of_hours', 'other'];
  d1 uuid; d2 uuid;
  today date := demo.today();
  now_min int := floor(demo.now_minutes())::int;
  start_min int;
  d int; k int; n int; dow int; day date;
  c record;
  known boolean; reason text; req int;
begin
  select id into d1 from public.profiles where login = 'driver1';
  select id into d2 from public.profiles where login = 'driver2';

  -- 1. Стираем всё, кроме сотрудников.
  truncate public.trips, public.trip_events, public.refusals,
           public.vehicle_locations, public.vehicle_feed;
  -- «where true» обязателен: через API база запрещает delete/update без условия.
  delete from public.clients where true;
  delete from public.places where true;
  update public.vehicles set driver_id = null where true;
  delete from public.vehicles where id not in (v1, v2);

  update public.app_settings
  set org_name = 'Социальное такси (демо)', dispatcher_phone = '+7 940 000-00-02'
  where id = 1;

  -- 2. Машины (с постоянными id — приложению водителя не нужно перезаходить).
  insert into public.vehicles (id, name, plate, driver_id, seats, daily_limit, is_active, sort)
  values (v1, 'Машина 1', 'А 101 АА', d1, 3, 16, true, 1),
         (v2, 'Машина 2', 'А 202 АА', d2, 3, 16, true, 2)
  on conflict (id) do update
    set name = excluded.name, plate = excluded.plate, driver_id = excluded.driver_id,
        seats = excluded.seats, daily_limit = excluded.daily_limit,
        is_active = true, sort = excluded.sort;

  -- 3. Места и клиенты (все имена и диагнозы вымышлены).
  insert into public.places (name, address) values
    ('Республиканская больница, физиотерапия', 'Сухум, ул. Аргун, 2'),
    ('Реабилитационный центр', 'Сухум, ул. Ардзинба, 150'),
    ('Городская поликлиника №1', 'Сухум, пр. Аиааира, 91'),
    ('Бассейн (ЛФК)', 'Сухум, Набережная Махаджиров, 18'),
    ('МСЭ (медико-социальная экспертиза)', 'Сухум, ул. Лакоба, 34');

  insert into public.clients
    (full_name, phone, address, diagnosis, mobility, escort, extra_phone, extra_contact, notes)
  values
    ('Авидзба Беслан Нодарович', '+7 940 111-11-06', 'Сухум, ул. Абазинская, 67', 'Ампутация левой голени', 'walks', false, null, null, 'Ходит на протезе, с тростью.'),
    ('Агрба Ахра Русланович', '+7 940 111-11-01', 'Сухум, ул. Инал-Ипа, 14, кв. 7', 'ДЦП, спастическая диплегия', 'wheelchair', true, '+7 940 111-11-91', 'мама Ирина', 'Коляска складная. 2 этаж без лифта — нужна помощь.'),
    ('Ашуба Гудиса Валерьевич', '+7 940 111-11-08', 'Сухум, ул. Воронова, 9', 'Слабовидящий (инвалидность по зрению)', 'assist', false, null, null, null),
    ('Гунба Эсма Руслановна', '+7 940 111-11-09', 'Сухум, ул. Лакоба, 101, кв. 4', 'Ревматоидный артрит', 'walks', false, null, null, null),
    ('Джопуа Саида Адгуровна', '+7 940 111-11-05', 'Сухум, ул. Званба, 5', 'Артроз тазобедренных суставов, после эндопротезирования', 'assist', false, null, null, null),
    ('Квициния Астанда Зауровна', '+7 940 111-11-02', 'Сухум, ул. Чанба, 8', 'Последствия инсульта, правосторонний гемипарез', 'assist', false, null, null, null),
    ('Лакоба Тимур Асланович', '+7 940 111-11-10', 'Сухум, пр. Аиааира, 140, кв. 55', 'Последствия ЧМТ, атаксия', 'wheelchair', true, '+7 940 111-11-90', 'жена Амра', null),
    ('Тарба Мадина Беслановна', '+7 940 111-11-04', 'Сухум, ул. Эшба, 122, кв. 30', 'Рассеянный склероз', 'wheelchair', true, '+7 940 111-11-94', 'сестра Саида', null),
    ('Хагба Нури Темурович', '+7 940 111-11-03', 'Сухум, ул. Гумистинская, 41', 'Травма позвоночника (L1), нижний парапарез', 'wheelchair', false, null, null, 'Пересаживается сам.'),
    ('Цвижба Лана Игоревна', '+7 940 111-11-07', 'Сухум, ул. Аидгылара, 23, кв. 12', 'ДЦП, гемипаретическая форма', 'assist', true, '+7 940 111-11-97', 'отец Игорь', null);

  -- 4. История за две недели (без воскресений), сегодня и завтра.
  for d in 1..14 loop
    day := today - d;
    if extract(dow from day) <> 0 then
      perform demo.add_day(day, 540, 'past');
    end if;
  end loop;

  -- Сегодняшнее расписание строится вокруг текущего времени: часть поездок уже
  -- выполнена, одна-две идут прямо сейчас, остальные впереди.
  start_min := greatest(10, least(1170, (now_min - 100) / 10 * 10));
  perform demo.add_day(today, start_min, 'today');
  perform demo.add_day(today + 1, 540, 'future');

  -- Прошлое и заказы «самоходной» Машины 2 считаем принятыми водителями;
  -- заказы Машины 1 остаются «не принятыми» — их принимает человек в приложении.
  update public.trips set driver_seen_at = clock_timestamp()
  where trip_date < today or vehicle_id = v2 or status = 'completed';

  -- 5. Отказы: больше всего — в утренние часы, когда машин не хватает.
  for d in 0..14 loop
    day := today - d;
    dow := extract(dow from day)::int;
    continue when dow = 0;
    n := (d * 7 + dow) % 4;
    for k in 0..n - 1 loop
      select id, full_name, phone, address into c
      from public.clients order by full_name offset (d + k * 3) % 10 limit 1;
      known := k % 2 = 0;
      reason := reasons[(d + k) % 6 + 1];
      req := case when d = 0 then greatest(480, least(1200, now_min - 30 + k * 40))
                  else 540 + ((d * 3 + k * 5) % 5) * 60 end;
      insert into public.refusals
        (req_date, req_time, client_id, client_name, phone, from_address, to_address,
         with_return, reason, comment)
      values
        (day, time '00:00' + make_interval(mins => req),
         case when known then c.id end,
         case when known then c.full_name else 'Новый клиент (по телефону)' end,
         case when known then c.phone else '+7 940 222-22-0' || k end,
         case when known then c.address else 'Сухум, Новый район' end,
         'Реабилитационный центр, Сухум, ул. Ардзинба, 150',
         k % 3 <> 2, reason,
         case when reason = 'other' or k = 1 then 'Просили перезвонить, если освободится время.' end);
    end loop;
  end loop;

  -- 6. Журнал: убираем служебный шум, который создала сама загрузка.
  delete from public.trip_events where kind = 'seen';

  perform demo.tick();
end
$$;

create or replace function demo.tick()
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v1 constant uuid := '00000000-0000-4000-8000-000000000001';
  v2 constant uuid := '00000000-0000-4000-8000-000000000002';
  today date := demo.today();
  now_min numeric := demo.now_minutes();
  d2 uuid;
  p record;
begin
  if not exists (select 1 from public.vehicles where id = v2) then
    return;  -- демо-данные ещё не загружены
  end if;

  -- 1. Машина 2 ведёт себя как водитель с приложением: принимает заказы и проходит статусы.
  select driver_id into d2 from public.vehicles where id = v2;
  if d2 is not null then
    perform set_config('request.jwt.claims',
      json_build_object('sub', d2, 'role', 'authenticated')::text, true);
  end if;

  update public.trips t
  set status = x.target, driver_seen_at = clock_timestamp()
  from (
    select s.id,
      (case
        when now_min >= s.e then 'completed'
        when now_min >= s.p + 2 then 'in_progress'
        when now_min >= s.p - 1 then 'arrived'
        when now_min >= s.p - 8 then 'en_route'
        else 'planned'
      end)::public.trip_status as target
    from (
      select id,
        extract(epoch from pickup_time) / 60 as p,
        greatest(
          extract(epoch from coalesce(arrive_by, pickup_time + interval '25 minutes')) / 60,
          extract(epoch from pickup_time) / 60 + 10
        ) as e
      from public.trips
      where trip_date = today and vehicle_id = v2 and status not in ('completed', 'cancelled')
    ) s
  ) x
  where t.id = x.id and x.target > t.status;

  -- Новые и изменённые диспетчером заказы «водитель» принимает через полминуты.
  update public.trips
  set driver_seen_at = clock_timestamp()
  where vehicle_id = v2 and trip_date >= today and status <> 'completed'
    and (driver_seen_at is null or driver_seen_at < changed_at)
    and changed_at < clock_timestamp() - interval '25 seconds';

  perform set_config('request.jwt.claims', '', true);

  -- 2. Положение на карте. Машина 2 ездит всегда; Машина 1 — только пока с телефона
  --    не приходят настоящие координаты (у настоящих точность > 0).
  select * into p from demo.route_point(2, clock_timestamp());
  insert into public.vehicle_locations (vehicle_id, lat, lng, accuracy, speed, on_duty, recorded_at)
  values (v2, p.lat, p.lng, 0, 8, true, clock_timestamp())
  on conflict (vehicle_id) do update
    set lat = excluded.lat, lng = excluded.lng, accuracy = 0, speed = 8,
        on_duty = true, recorded_at = excluded.recorded_at;

  select * into p from demo.route_point(1, clock_timestamp());
  insert into public.vehicle_locations (vehicle_id, lat, lng, accuracy, speed, on_duty, recorded_at)
  values (v1, p.lat, p.lng, 0, 7, true, clock_timestamp())
  on conflict (vehicle_id) do update
    set lat = excluded.lat, lng = excluded.lng, accuracy = 0, speed = 7,
        on_duty = true, recorded_at = excluded.recorded_at
    where coalesce(public.vehicle_locations.accuracy, 1) = 0
       or public.vehicle_locations.recorded_at < clock_timestamp() - interval '60 seconds';
end
$$;

-- Кнопка «Начать демо заново» на сайте.
create or replace function public.demo_reset()
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_staff() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Недостаточно прав';
  end if;
  perform demo.reset();
end
$$;

revoke all on function public.demo_reset() from public, anon;
grant execute on function public.demo_reset() to authenticated, service_role;
revoke all on all functions in schema demo from public, anon, authenticated;

-- Расписание: «оживление» каждые 10 секунд, полный сброс каждую ночь (04:10 по местному),
-- чистка журнала заданий.
select cron.unschedule(jobid) from cron.job where jobname in ('demo-tick', 'demo-reset', 'demo-cron-cleanup');
select cron.schedule('demo-tick', '10 seconds', 'select demo.tick()');
select cron.schedule('demo-reset', '10 1 * * *', 'select demo.reset()');
select cron.schedule('demo-cron-cleanup', '40 * * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '2 hours'$$);

notify pgrst, 'reload schema';
