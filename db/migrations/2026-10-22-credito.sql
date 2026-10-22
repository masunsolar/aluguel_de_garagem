-- Crédito do vizinho (pagou a mais, adiantou dinheiro, PIX sem reserva).
-- Cole no Neon > SQL Editor e rode. Pode rodar mais de uma vez: nada é duplicado nem apagado.
-- (É o mesmo trecho que está no fim de db/schema.sql; `npm run db:init` também aplica.)
--
-- Modelo: cada dinheiro recebido vira um "lote" em `credits`. Cada vez que um lote paga (abate) uma reserva,
-- entra uma linha positiva em `credit_uses`; se a reserva for cancelada, a devolução é uma linha NEGATIVA.
-- Saldo de um lote = valor do lote − soma dos usos. Nada é editado nem apagado: o histórico fica completo.

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

create table if not exists credit_uses (
  id bigserial primary key,
  credit_id uuid not null references credits(id),
  reservation_id uuid references reservations(id),           -- nulo = baixa feita pelo admin (ex.: devolveu o dinheiro)
  amount_cents int not null check (amount_cents <> 0),       -- + abateu da reserva | − voltou para o crédito
  reason text not null check (reason in ('abatimento', 'devolucao', 'baixa')),
  created_at timestamptz not null default now()
);

create index if not exists credit_uses_by_credit on credit_uses (credit_id);
create index if not exists credit_uses_by_reservation on credit_uses (reservation_id);

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

drop trigger if exists credit_uses_valid on credit_uses;
create trigger credit_uses_valid after insert on credit_uses for each row execute function credit_uses_check();

-- Histórico imutável, igual ao de reservation_events (forbid_change já existe no schema).
drop trigger if exists credits_immutable on credits;
create trigger credits_immutable before update or delete on credits for each row execute function forbid_change();
drop trigger if exists credit_uses_immutable on credit_uses;
create trigger credit_uses_immutable before update or delete on credit_uses for each row execute function forbid_change();
