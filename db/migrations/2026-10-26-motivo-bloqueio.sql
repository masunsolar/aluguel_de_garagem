-- Motivo do bloqueio visível para os vizinhos.
-- Cole no Neon > SQL Editor e rode (branch `teste` e depois `production`). Pode rodar mais de uma vez.
-- (É o mesmo trecho do fim de db/schema.sql; `npm run db:init` também aplica.)
-- As observações (`notes`) continuam privadas: só o novo campo aparece no site.
alter table reservations add column if not exists public_reason text check (char_length(public_reason) <= 200);
