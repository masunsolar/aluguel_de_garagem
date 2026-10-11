create extension if not exists btree_gist;
-- GO
create table if not exists reservations (
  id uuid primary key default gen_random_uuid(),
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'confirmada'
    check (status in ('pendente','confirmada','em_andamento','finalizada','cancelada','bloqueada','irregular')),
  source text not null default 'vizinho' check (source in ('vizinho','admin')),
  total_cents int not null default 0 check (total_cents >= 0),
  name text check (char_length(name) <= 80),
  apartment text check (char_length(apartment) <= 20),
  car_brand text check (char_length(car_brand) <= 40),
  car_model text check (char_length(car_model) <= 40),
  car_color text check (char_length(car_color) <= 30),
  plate text check (char_length(plate) <= 8),
  notes text check (char_length(notes) <= 1000),
  access_hash text unique,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at > start_at),
  -- Proteção real contra corrida: o próprio banco recusa intervalos sobrepostos.
  -- Ocupam a vaga: pendente, confirmada, em_andamento, irregular e bloqueada. Intervalo [) permite encaixe (21:00 sai, 21:00 entra).
  constraint no_overlap exclude using gist (tstzrange(start_at, end_at, '[)') with &&)
    where (deleted_at is null and status in ('pendente','confirmada','em_andamento','bloqueada','irregular'))
);
-- GO
create index if not exists reservations_by_start on reservations (start_at) where deleted_at is null;
-- GO
create table if not exists reservation_events (
  id bigserial primary key,
  reservation_id uuid references reservations(id),  -- nulo = evento de configuração
  actor text not null check (actor in ('vizinho','admin','sistema')),
  action text not null,
  details jsonb,
  created_at timestamptz not null default now()
);
-- GO
create index if not exists events_by_reservation on reservation_events (reservation_id, created_at);
-- GO
create or replace function forbid_change() returns trigger language plpgsql as $$
begin raise exception '% em % não é permitido (histórico é imutável)', tg_op, tg_table_name; end $$;
-- GO
drop trigger if exists events_immutable on reservation_events;
-- GO
create trigger events_immutable before update or delete on reservation_events for each row execute function forbid_change();
-- GO
drop trigger if exists reservations_no_hard_delete on reservations;
-- GO
create trigger reservations_no_hard_delete before delete on reservations for each row execute function forbid_change();
-- GO
create table if not exists reservation_photos (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id),
  mime text not null default 'image/jpeg',
  data bytea not null check (octet_length(data) <= 2000000),
  created_at timestamptz not null default now()
);
-- GO
create index if not exists photos_by_reservation on reservation_photos (reservation_id);
-- GO
create table if not exists settings (key text primary key, value jsonb not null);
-- GO
insert into settings (key, value) values
  ('pricing', '{"dayPrice":30,"nightPrice":15,"dayStartHour":6,"nightStartHour":18}'),
  ('garage_name', '"Garagem"'),
  ('booking', '{"maximumReservationAdvanceDays":14}'),
  ('admin_epoch', '0')
on conflict do nothing;
-- GO
create table if not exists rate_limits (
  key text not null, window_start timestamptz not null, hits int not null default 1,
  primary key (key, window_start)
);
