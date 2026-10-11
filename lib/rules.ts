// Limites do negócio num lugar só. (Os configuráveis pelo painel ficam na tabela settings.)
export const RULES = {
  minMinutes: 30,          // reserva mínima
  maxDurationDays: 14,     // reserva máxima
  maxPhotos: 10,           // por reserva
  maxPhotoBytes: 2_000_000,
  advanceDaysMax: 60,      // teto do que o painel pode configurar (o calendário mostra até isso)
  advanceDaysDefault: 14,  // padrão de maximumReservationAdvanceDays
} as const;
