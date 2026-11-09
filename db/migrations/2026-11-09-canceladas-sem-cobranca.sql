-- Reservas JÁ canceladas antes desta versão: zera o valor e tira de "pendente" (sem cobrança).
-- Se uma delas tinha sido paga (fora do crédito), esse valor vira crédito da pessoa, como o app faz agora ao cancelar.
-- Cole no Neon > SQL Editor e rode (branch `teste` e depois `production`). É um comando só (tudo ou nada) e pode rodar
-- de novo sem efeito: só pega canceladas com valor maior que zero.
-- O valor antigo fica no histórico da reserva (evento "cancelada_sem_cobranca"); reativar a reserva no painel o devolve.

with alvo as (
  select * from (
    select r.id, r.total_cents, coalesce(r.fee_cents, 0) as fee_cents, r.payment_status, r.name, r.apartment, r.plate,
      coalesce((select sum(u.amount_cents) from credit_uses u where u.reservation_id = r.id), 0)::int as usado
    from reservations r
    where r.status = 'cancelada' and r.deleted_at is null and r.total_cents > 0
  ) x where usado = 0            -- crédito usado nelas já foi devolvido ao cancelar
),
lote as (
  insert into credits (amount_cents, kind, reservation_id, name, apartment, plate, note)
  select total_cents, 'pagamento', id, name, apartment, plate, 'Pago na reserva cancelada'
  from alvo where payment_status = 'pago'
  returning reservation_id, amount_cents
),
zerada as (
  update reservations r set total_cents = 0, fee_cents = 0, payment_status = 'pendente', paid_at = null, updated_at = now()
  from alvo where r.id = alvo.id
  returning r.id
),
evento as (
  insert into reservation_events (reservation_id, actor, action, details)
  select alvo.id, 'sistema', 'cancelada_sem_cobranca', jsonb_build_object(
    'valor_anterior_cents', alvo.total_cents, 'taxa_anterior_cents', alvo.fee_cents,
    'pago_virou_credito_cents', case when alvo.payment_status = 'pago' then alvo.total_cents end)
  from alvo join zerada on zerada.id = alvo.id
  returning 1
)
select (select count(*) from zerada) as canceladas_zeradas,
       (select count(*) from lote) as pagas_que_viraram_credito,
       (select coalesce(sum(amount_cents), 0) from lote) / 100.0 as reais_em_credito;
