import { z } from "zod";
const clean = (n: number, min = 1) => z.string().trim().min(min).max(n).regex(/^[^\u0000-\u001f<>]*$/, "Caracteres inválidos");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const plate = z.string().trim().toUpperCase().regex(/^[A-Z]{3}-?\d[A-Z0-9]\d{2}$/, "Placa inválida");

// ----- Área dos vizinhos -----
export const reservationSchema = z.object({
  startDate: date, startTime: time, endDate: date, endTime: time,
  name: clean(80, 2), apartment: clean(20), carBrand: clean(40, 2), carModel: clean(40), carColor: clean(30, 2), plate,
  website: z.string().max(200).optional(), // isca (honeypot): humanos não preenchem
});

// ----- Área administrativa (campos opcionais: registro manual pode ser parcial) -----
const txt = (n: number) => z.string().trim().max(n).regex(/^[^\u0000-\u0008\u000b-\u001f<>]*$/, "Caracteres inválidos").nullish();
const dt = z.string().datetime({ offset: true });
export const STATUSES = ["pendente", "confirmada", "em_andamento", "finalizada", "cancelada", "bloqueada", "irregular"] as const;
export const adminCreateSchema = z.object({
  startAt: dt, endAt: dt, status: z.enum(STATUSES).default("confirmada"),
  name: txt(80), apartment: txt(20), carBrand: txt(40), carModel: txt(40), carColor: txt(30),
  plate: plate.nullish().or(z.literal("")), notes: txt(1000),
  totalCents: z.number().int().min(0).max(10_000_000).nullish(),
});
// priceMode só vale quando o horário muda: "keep" mantém o valor contratado, "recalc" usa os preços atuais (decisão explícita do admin)
export const adminPatchSchema = adminCreateSchema.partial().extend({ priceMode: z.enum(["keep", "recalc"]).optional() });
export const quoteSchema = z.object({ startAt: dt, endAt: dt });

export const pricingSchema = z.object({
  dayPrice: z.number().min(0).max(10000), nightPrice: z.number().min(0).max(10000),
  dayStartHour: z.number().int().min(0).max(23), nightStartHour: z.number().int().min(0).max(23),
  checkoutTime: time.default("10:30"), // horário-limite de saída sem cobrar a manhã (igual ao dia começar = sem tolerância)
}).refine((p) => { const [h, m] = p.checkoutTime.split(":").map(Number); return h * 60 + m >= p.dayStartHour * 60 && h * 60 + m < p.nightStartHour * 60; },
  { message: "O check-out precisa ficar entre o início do dia e o início da noite." });
export const pixSchema = z.object({
  key: z.string().trim().max(77).regex(/^[A-Za-z0-9@.+\-_]*$/, "Chave PIX inválida."),
  name: z.string().trim().max(25),
  city: z.string().trim().max(15),
});
export const settingsSchema = z.object({ pix: pixSchema.optional(), pricing: pricingSchema, garageName: z.string().trim().min(1).max(60), maximumReservationAdvanceDays: z.number().int().min(1).max(60) });
export const isUuid = (v: string) => z.string().uuid().safeParse(v).success;
