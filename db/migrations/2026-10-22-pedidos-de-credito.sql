-- Pedidos de crédito feitos pelo vizinho (com comprovante) e confirmados pelo admin.
-- Cole no Neon > SQL Editor e rode (branch `teste` e depois `production`). Pode rodar mais de uma vez.
-- Precisa da migração anterior (2026-10-22-credito.sql) já aplicada.
-- (É o mesmo trecho do fim de db/schema.sql; `npm run db:init` também aplica.)

-- Pedido: o vizinho diz "mandei R$ X". Só vira crédito (lote em `credits`) quando o admin confirma.
create table if not exists credit_requests (
  id uuid primary key default gen_random_uuid(),
  amount_cents int not null check (amount_cents > 0),         -- valor informado (o admin confirma o valor que recebeu)
  status text not null default 'pendente' check (status in ('pendente', 'confirmado', 'recusado', 'cancelado')),
  source text not null default 'vizinho' check (source in ('vizinho', 'admin')),
  name text not null check (char_length(name) <= 80),
  apartment text check (char_length(apartment) <= 20),
  plate text check (char_length(plate) <= 8),
  phone text check (char_length(phone) <= 20),
  note text check (char_length(note) <= 300),                 -- recado do vizinho
  admin_note text check (char_length(admin_note) <= 300),     -- motivo da recusa / observação do admin
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists credit_requests_pending on credit_requests (created_at) where status = 'pendente';

-- Comprovantes do pedido: o vizinho e o admin podem anexar. Privados (só o admin vê).
create table if not exists credit_receipts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references credit_requests(id),
  actor text not null check (actor in ('vizinho', 'admin')),
  mime text not null check (mime in ('image/jpeg', 'image/png', 'application/pdf')),
  data bytea not null check (octet_length(data) <= 2000000),
  created_at timestamptz not null default now()
);

create index if not exists credit_receipts_by_request on credit_receipts (request_id);

-- O lote criado na confirmação aponta para o pedido. Novo tipo de lote: 'deposito' (crédito adicionado pelo vizinho).
alter table credits add column if not exists request_id uuid references credit_requests(id);

alter table credits drop constraint if exists credits_kind_check;

alter table credits add constraint credits_kind_check check (kind in ('pagamento', 'manual', 'deposito'));

-- Um pedido vira no máximo um lote (confirmar duas vezes não duplica o crédito).
create unique index if not exists credits_one_per_request on credits (request_id) where request_id is not null;
