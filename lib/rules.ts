// Limites do negócio num lugar só. (Os configuráveis pelo painel ficam na tabela settings.)
export const RULES = {
  minMinutes: 30,          // reserva mínima
  maxDurationDays: 14,     // reserva máxima
  maxPhotos: 10,           // por reserva
  maxReceipts: 3,          // comprovantes por reserva (enviados pelo vizinho)
  maxPhotoBytes: 2_000_000,
  advanceDaysMax: 60,      // teto do que o painel pode configurar (o calendário mostra até isso)
  advanceDaysDefault: 14,  // padrão de maximumReservationAdvanceDays
  maxUnpaidDefault: 1,     // padrão de maxUnpaidReservations (bloqueia com 2 ou mais pendências)
  noBookingFeeDefault: 10, // taxa sugerida (R$) para quem estaciona sem agendar (configurável no painel)
  monthlyCostDefault: 200, // custo mensal da garagem para o resumo financeiro (configurável no painel)
} as const;
