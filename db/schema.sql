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
-- Detalhamento de como o valor foi calculado (períodos dia/noite, tolerância de check-out). Nulo em reservas antigas.
alter table reservations add column if not exists price_breakdown jsonb;
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
-- Pagamento é separado do status da reserva: toda reserva entra como pagamento pendente; o admin marca como pago.
alter table reservations add column if not exists payment_status text not null default 'pendente' check (payment_status in ('pendente','pago'));
-- GO
alter table reservations add column if not exists paid_at timestamptz;
-- GO
create table if not exists payment_receipts (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id),
  mime text not null check (mime in ('image/jpeg','image/png','application/pdf')),
  data bytea not null check (octet_length(data) <= 2000000),
  created_at timestamptz not null default now()
);
-- GO
create index if not exists receipts_by_reservation on payment_receipts (reservation_id);
-- GO
-- Telefone/WhatsApp do vizinho (opcional, só dígitos). Só o admin vê; usado no botão "Cobrar".
alter table reservations add column if not exists phone text check (char_length(phone) <= 20);
-- GO
-- Taxa extra (ex.: estacionou sem agendar). Já está INCLUÍDA em total_cents; aqui só para mostrar separado.
alter table reservations add column if not exists fee_cents int not null default 0 check (fee_cents >= 0);
-- GO
create table if not exists settings (key text primary key, value jsonb not null);
-- GO
insert into settings (key, value) values
  ('pricing', '{"dayPrice":30,"nightPrice":15,"dayStartHour":6,"nightStartHour":18,"checkoutTime":"10:30"}'),
  ('garage_name', '"Garagem"'),
  ('booking', '{"maximumReservationAdvanceDays":14}'),
  ('admin_epoch', '0')
on conflict do nothing;
-- GO
create table if not exists rate_limits (
  key text not null, window_start timestamptz not null, hits int not null default 1,
  primary key (key, window_start)
);
-- GO
-- Crédito do vizinho (pagou a mais / adiantou). Explicação completa em db/migrations/2026-10-22-credito.sql.
create table if not exists credits (
  id uuid primary key default gen_random_uuid(),
  amount_cents int not null check (amount_cents > 0),
  kind text not null check (kind in ('pagamento', 'manual')), -- pagamento registrado numa reserva | lançado avulso pelo admin
  reservation_id uuid references reservations(id),           -- reserva onde o dinheiro foi registrado (se houver)
  name text check (char_length(name) <= 80),                 -- de quem é o crédito (mesma regra de pessoa:
  apartment text check (char_length(apartment) <= 20),       --  nome, placa OU apartamento)
  plate text check (char_length(plate) <= 8),
  note text check (char_length(note) <= 300),
  created_at timestamptz not null default now()
);
-- GO
create table if not exists credit_uses (
  id bigserial primary key,
  credit_id uuid not null references credits(id),
  reservation_id uuid references reservations(id),           -- nulo = baixa feita pelo admin (ex.: devolveu o dinheiro)
  amount_cents int not null check (amount_cents <> 0),       -- + abateu da reserva | − voltou para o crédito
  reason text not null check (reason in ('abatimento', 'devolucao', 'baixa')),
  created_at timestamptz not null default now()
);
-- GO
create index if not exists credit_uses_by_credit on credit_uses (credit_id);
-- GO
create index if not exists credit_uses_by_reservation on credit_uses (reservation_id);
-- GO
-- Trava de segurança no próprio banco: um lote nunca fica negativo nem passa do valor recebido,
-- e uma reserva nunca recebe mais crédito do que o valor dela.
create or replace function credit_uses_check() returns trigger language plpgsql as $$
declare lote int; usado int; reserva int; abatido int;
begin
  select amount_cents into lote from credits where id = new.credit_id;
  select coalesce(sum(amount_cents), 0) into usado from credit_uses where credit_id = new.credit_id;
  if usado > lote or usado < 0 then raise exception 'crédito % ficaria com saldo inválido (%/%)', new.credit_id, usado, lote; end if;
  if new.reservation_id is not null then
    select total_cents into reserva from reservations where id = new.reservation_id;
    select coalesce(sum(amount_cents), 0) into abatido from credit_uses where reservation_id = new.reservation_id;
    if abatido > reserva or abatido < 0 then raise exception 'reserva % ficaria com crédito inválido (%/%)', new.reservation_id, abatido, reserva; end if;
  end if;
  return null;
end $$;
-- GO
drop trigger if exists credit_uses_valid on credit_uses;
-- GO
create trigger credit_uses_valid after insert on credit_uses for each row execute function credit_uses_check();
-- GO
-- Histórico imutável, igual ao de reservation_events (forbid_change já existe no schema).
drop trigger if exists credits_immutable on credits;
-- GO
create trigger credits_immutable before update or delete on credits for each row execute function forbid_change();
-- GO
drop trigger if exists credit_uses_immutable on credit_uses;
-- GO
create trigger credit_uses_immutable before update or delete on credit_uses for each row execute function forbid_change();
