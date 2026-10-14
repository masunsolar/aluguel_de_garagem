# Garagem — agendamento e controle

Next.js 15 + TypeScript + Tailwind 4 + Postgres (Neon). Pensado para Vercel + Neon, ambos com plano gratuito.

## Como funciona
| | Vizinhos | Administrador |
|---|---|---|
| Telas | `/` | `/admin` (login em `/admin/login`) |
| API | `/api/config`, `/api/availability`, `/api/reservations`, `/api/minhas-reservas` | tudo em `/api/admin/*` |
| Código | `lib/services/public.ts` (só dados mínimos) | `lib/services/admin.ts` |
| Sessão | cookie `viz`: só lista os IDs das reservas do próprio navegador | cookie `adm`: sessão do admin (revogável) |

- **Vizinho**: vê só livre/ocupado, reserva, vê o preço, acompanha e cancela **as próprias** reservas futuras. Em outro aparelho, usa o código de acompanhamento (mostrado uma vez na confirmação; o banco guarda só o hash).
- **Admin**: calendário de 28 dias, lista com filtros, nova reserva manual, bloqueio de horário (com motivo que o vizinho nunca vê), edição, confirmar / irregular / cancelar / excluir, fotos privadas, histórico por reserva, arrecadação, preços, nome da garagem e antecedência máxima de reserva.

## Regras de negócio
- **Preço** (`lib/pricing.ts`): R$30 por "dia" (06h–18h) e R$15 por "noite" (18h–06h) em que o carro ficar; valores e horários editáveis no painel. Ex.: 18:00 → 10:00 do dia seguinte = R$45.
  - O servidor sempre calcula; o do navegador é só prévia. O **valor cobrado fica gravado na reserva** e nunca muda sozinho: mudar preços não afeta reservas antigas.
  - Ao editar o **horário** de uma reserva, o painel mostra "o novo horário resultaria em R$X com os preços atuais" e você escolhe **Manter valor atual** (padrão) ou **Recalcular**. Editar o valor à mão também é permitido. Tudo isso fica no histórico (de → para).
- **Antecedência máxima** (`maximumReservationAdvanceDays`, padrão 14, ajustável de 1 a 60 em *Configurações*): vale no servidor, não só na tela. Outros limites ficam em `lib/rules.ts` (reserva de 30 min a 14 dias, 10 fotos por reserva, 2 MB por foto).
- **Conflitos**: *exclusion constraint* no banco (`db/schema.sql`). Ocupam a vaga: pendente, confirmada, em_andamento, **irregular** e bloqueada. Intervalo `[)`: 10:00→12:00 permite 12:00→14:00 e recusa 11:59→13:00. Se você registrar algo que conflita, o painel lista as reservas em conflito com atalho para abri-las.
- **Status** (`lib/status.ts`): o status **gravado** só muda por ação sua. Para exibição, uma reserva *confirmada* aparece como **em andamento** quando o horário começa e **finalizada** quando termina, calculado na hora de mostrar. Nada é gravado, e valor e histórico não mudam com o relógio.
- **Datas** (`lib/time.ts`): o banco guarda instantes (`timestamptz`); todo horário digitado/exibido é `America/Sao_Paulo`, convertido por `Intl`, sem depender do fuso do navegador ou do servidor. Datas impossíveis (30/02) são recusadas.

## Segurança em resumo
- Admin: senha guardada como **hash scrypt com salt** (`ADMIN_PASSWORD_HASH`). Cookie `HttpOnly`, `Secure` em produção, `SameSite=Strict`, 1 dia, contendo só um número de versão (sem dados sensíveis).
- **Logout invalida na hora** o token (a "época" da sessão sobe no banco; cópias do cookie param de valer). O `middleware.ts` barra `/admin` e `/api/admin` sem assinatura válida, e cada rota ainda confere a época (`requireAdmin()`).
- Cookies de vizinho e de admin têm *audiences* diferentes: um não vale como o outro.
- Limites por IP (no Postgres, funcionam em serverless): login 5/15 min (40/h no total), reservas 8/h, códigos 10/15 min, cancelamentos 10/h. Mais campo-isca anti-robô e validação de tamanho/caracteres/datas.
- Fotos: sem URL pública; `/api/admin/photos/[id]` exige sessão de admin (`private, no-store`). Só JPEG (confere início e fim do arquivo), até 2 MB e 10 por reserva.
- Auditoria: o evento é gravado no **mesmo comando SQL** da mudança. Triggers impedem alterar/apagar eventos e apagar reservas de verdade (exclusão é *soft delete*). Registra criação, edição (de → para), valor, status, bloqueio/remoção, foto adicionada/removida, exclusão, cancelamento do vizinho e mudanças de configuração.
- Erros inesperados nunca expõem detalhes técnicos: o usuário vê "erro temporário".

## Variáveis de ambiente
| Variável | O que é | Como obter |
|---|---|---|
| `DATABASE_URL` | Conexão com o Postgres do Neon | Neon → *Connect* → copie a string (termina com `sslmode=require`) |
| `ADMIN_PASSWORD_HASH` | Hash da sua senha de admin (nunca a senha) | `npm run hash-password -- "sua senha longa"` e cole a linha inteira `scrypt:...:...` |
| `AUTH_SECRET` | Segredo que assina os cookies (mín. 32 caracteres) | `openssl rand -base64 48` |

Nenhuma outra variável é usada. **Não** coloque valores reais no repositório (`.env.local` está no `.gitignore`).
- Trocar `AUTH_SECRET` desloga todo mundo (admin e o "Minhas reservas" dos vizinhos, que podem religar pelo código).
- Trocar a senha: gere um hash novo, atualize `ADMIN_PASSWORD_HASH` e faça *Sair* no painel (isso invalida as sessões antigas).

## Rodar localmente
1. `npm install`
2. Tenha um Postgres (local ou um branch do Neon) e crie `.env.local` a partir de `.env.example`.
3. `npm run db:init` (cria tabelas, constraints, triggers e valores iniciais; pode rodar de novo sem problema).
4. `npm run dev` → http://localhost:3000 e http://localhost:3000/admin/login

## Testar no Neon sem tocar na produção (branch de teste)
A suíte (`npm test`, 53 verificações) grava dados de teste e zera a tabela de limites, então **nunca** aponte para o banco real.
1. No Neon: *Branches* → **Create branch** (nome `teste`, a partir do principal) → *Connect* escolhendo esse branch → copie a string dele.
2. Em `.env.local` use a string **do branch** em `DATABASE_URL`, o `ADMIN_PASSWORD_HASH` de uma senha de teste e um `AUTH_SECRET`.
3. `npm run db:init` → `npm run build` → `PORT=3100 npm start`
4. Em outro terminal: `TEST_ADMIN_PASSWORD="a senha de teste" npm test`. Resultado esperado: `53 passaram, 0 falharam`.
5. Apague o branch `teste` no Neon.
Isso valida o driver do Neon de verdade (consultas, constraints, triggers, concorrência). Se algo falhar só no Neon, é a informação mais valiosa antes de publicar.

### Neon x Postgres local (o que muda)
- Em produção o app usa o driver HTTP do Neon (sem pool nem conexão aberta: bom para serverless). `pg` só é usado em desenvolvimento/testes quando a URL não é `neon.tech`.
- Nenhuma operação do app precisa de transação multi-comando: cada mudança + evento de auditoria é **um único comando SQL** (CTE).
- Datas e `jsonb` são normalizados no código para funcionar igual nos dois drivers. O schema usa só recursos nativos e a extensão `btree_gist` (suportada pelo Neon).
- Banco gratuito "dorme" quando ocioso: o primeiro acesso depois de um tempo parado leva ~1 s a mais.

## Deploy na Vercel
1. **Neon**: crie o projeto em neon.com (escolha a região mais próxima, de preferência São Paulo se disponível) e copie a `DATABASE_URL` do branch principal.
2. **Localmente**, com essa `DATABASE_URL` em `.env.local`: `npm run db:init` (cria as tabelas na produção).
3. Gere o hash da senha: `npm run hash-password -- "sua senha longa"` e o segredo: `openssl rand -base64 48`.
4. Suba o código para um repositório no GitHub (sem `.env.local`).
5. **Vercel** → *Add New → Project* → importe o repositório (Next.js é detectado sozinho; não precisa mudar build nem pasta).
6. Em *Environment Variables* cadastre `DATABASE_URL`, `ADMIN_PASSWORD_HASH` e `AUTH_SECRET` (marque Production; Preview só se for usar).
7. **Deploy**.
8. *(Opcional, recomendado)* **Região**: em *Settings → Functions → Function Region* escolha a mesma região do banco (São Paulo, `gru1`, se o Neon estiver em São Paulo). Cada página faz algumas consultas ao banco; com app e banco longe (ex.: app nos EUA e banco no Brasil) cada consulta soma ~100+ ms. **Não é obrigatório**: funciona em qualquer região. Se o banco estiver nos EUA, deixe o padrão. Depois de mudar, faça um novo deploy.
9. Teste na ordem: abra `/`; faça uma reserva; entre em `/admin/login`; veja a reserva; abra-a e envie uma foto; volte ao site e cancele a reserva em "Minhas reservas".

## Primeiro acesso ao /admin
1. Abra `https://SEU-SITE.vercel.app/admin/login` e entre com a **senha** (não o hash) escolhida no passo 3.
2. Clique em **Configurações**: ajuste o *nome da garagem*, os *preços* (dia/noite e horários de corte) e a *antecedência máxima* (dias) e salve.
3. Faça uma reserva de teste pelo site, confira no painel e apague-a (o histórico é preservado).
4. Divulgue o endereço **da raiz** (`/`) aos vizinhos. O `/admin` não tem link na página pública.

## Limitações conhecidas
- **Neon e Vercel reais não foram executados pelo autor** (o ambiente de desenvolvimento não alcança esses serviços). Use o roteiro do branch de teste acima antes de publicar.
- Plano **Hobby** da Vercel é para uso **não comercial**; cobrar vizinhos pode exigir olhar os termos ou o plano Pro.
- Neon gratuito: 0,5 GB (cabem milhares de fotos já reduzidas) e o banco hiberna quando ocioso.
- Fotos: o servidor confere início/fim do JPEG, mas não recodifica a imagem.
- Cookies são **assinados, não criptografados**: o do vizinho guarda IDs de reservas dele (sem dados pessoais).
- Limite por IP: vizinhos no mesmo Wi-Fi dividem a cota de 8 reservas/hora.
- Edições simultâneas do mesmo registro por duas abas do admin: vale a última (há um único administrador).
- Não há cobrança automática: o PIX é só exibido ao vizinho e você confirma o recebimento no painel. E-mail e WhatsApp não existem.


## PIX

Painel → Configurações → "PIX para pagamento": informe a chave (e, opcionalmente, nome do recebedor e cidade).
O vizinho vê a chave com botão "Copiar" na tela de sucesso da reserva e em "Minhas reservas". Com nome e cidade
preenchidos, também recebe o PIX "copia e cola" já com o valor. A chave é pública por natureza (feita para quem vai pagar).
Alterações ficam no histórico de configurações.

## Check-out e detalhamento da cobrança
- **Check-out** (`checkoutTime`, padrão 10:30, em *Configurações*): quem pernoitou e sai até esse horário não paga o "dia" da manhã da saída. O dia continua começando em `dayStartHour`. Para desligar, use o mesmo horário do início do dia.
- Cada reserva grava em `price_breakdown` os períodos contabilizados (dia/noite, horários e valores). O vizinho vê a tabela na prévia, na confirmação e em "Minhas reservas"; o admin vê no editor. Reservas antigas ficam sem detalhamento.
- **Atualização de um banco existente:** rode `npm run db:init` apontando para ele **antes** de publicar esta versão (adiciona a coluna `price_breakdown`; não apaga nada).

## Pagamento e comprovante
- Toda reserva entra com **pagamento pendente** (separado do status da reserva). O admin marca **pago** / **voltar para pendente** no editor; a data do pagamento fica registrada e auditada.
- O vizinho envia o comprovante (foto/print da galeria ou PDF, até 2 MB, até 3 por reserva) em "Minhas reservas". Enviar comprovante **não** marca como pago: o admin confere e marca.
- Comprovantes são privados: só o admin vê, em `/api/admin/receipts/{id}`.
- Fotos do veículo agora podem vir da galeria (antes o celular abria só a câmera).
