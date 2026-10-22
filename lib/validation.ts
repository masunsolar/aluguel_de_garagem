import { z } from "zod";
const clean = (n: number, min = 1) => z.string().trim().min(min).max(n).regex(/^[^\u0000-\u001f<>]*$/, "Caracteres inválidos");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
// Telefone opcional: aceita "(43) 99999-8888", "+55 43 99999-8888"... e guarda só os dígitos
const phone = z.string().trim().max(25).regex(/^[0-9()+\-.\s]*$/, "Telefone inválido")
  .transform((v) => v.replace(/\D/g, ""))
  .refine((d) => d === "" || (d.length >= 10 && d.length <= 13), "Telefone inválido: use DDD + número.");
const plate = z.string().trim().toUpperCase().regex(/^[A-Z]{3}-?\d[A-Z0-9]\d{2}$/, "Placa inválida");

// ----- Área dos vizinhos -----
export const reservationSchema = z.object({
  startDate: date, startTime: time, endDate: date, endTime: time,
  name: clean(80, 2), apartment: clean(20), carBrand: clean(40, 2), carModel: clean(40), carColor: clean(30, 2), plate,
  phone: phone.optional(),
  website: z.string().max(200).optional(), // isca (honeypot): humanos não preenchem
});

// ----- Área administrativa (campos opcionais: registro manual pode ser parcial) -----
const txt = (n: number) => z.string().trim().max(n).regex(/^[^\u0000-\u0008\u000b-\u001f<>]*$/, "Caracteres inválidos").nullish();
const dt = z.string().datetime({ offset: true });
export const STATUSES = ["pendente", "confirmada", "em_andamento", "finalizada", "cancelada", "bloqueada", "irregular"] as const;
export const PAYMENT_STATUSES = ["pendente", "pago"] as const;
export const adminCreateSchema = z.object({
  startAt: dt, endAt: dt, status: z.enum(STATUSES).default("confirmada"),
  name: txt(80), apartment: txt(20), carBrand: txt(40), carModel: txt(40), carColor: txt(30),
  plate: plate.nullish().or(z.literal("")), notes: txt(1000), phone: phone.nullish(),
  // totalCents = valor do USO (sem a taxa). feeCents = taxa extra (ex.: estacionou sem agendar), somada por cima.
  totalCents: z.number().int().min(0).max(10_000_000).nullish(),
  feeCents: z.number().int().min(0).max(10_000_000).optional(),
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(), // ausente na criação = pendente
});
// priceMode só vale quando o horário muda: "keep" mantém o valor contratado, "recalc" usa os preços atuais (decisão explícita do admin)
export const adminPatchSchema = adminCreateSchema.partial().extend({ priceMode: z.enum(["keep", "recalc"]).optional() });
export const quoteSchema = z.object({ startAt: dt, endAt: dt });

export const pricingSchema = z.object({
  dayPrice: z.number().min(0).max(10000), nightPrice: z.number().min(0).max(10000),
  dayStartHour: z.number().int().min(0).max(23), nightStartHour: z.number().int().min(0).max(23),
  checkoutTime: time.default("10:30"), // horário-limite de saída sem cobrar a manhã (igual ao dia começar = sem tolerância)
  // pacotes com desconto; null/ausente = desligado
  fullDayPrice: z.number().min(0).max(10000).nullable().default(null),
  weekendPrice: z.number().min(0).max(10000).nullable().default(null),
  weekPrice: z.number().min(0).max(10000).nullable().default(null),
}).refine((p) => { const [h, m] = p.checkoutTime.split(":").map(Number); return h * 60 + m >= p.dayStartHour * 60 && h * 60 + m < p.nightStartHour * 60; },
  { message: "O check-out precisa ficar entre o início do dia e o início da noite." });
export const pixSchema = z.object({
  key: z.string().trim().max(77).regex(/^[A-Za-z0-9@.+\-_]*$/, "Chave PIX inválida."),
  name: z.string().trim().max(25),
  city: z.string().trim().max(15),
});
export const settingsSchema = z.object({ pix: pixSchema.optional(), pricing: pricingSchema, garageName: z.string().trim().min(1).max(60), maximumReservationAdvanceDays: z.number().int().min(1).max(60),
  // Bloqueia novas reservas do apartamento com MAIS de N pagamentos pendentes. null = desligado; ausente = não mexe.
  maxUnpaidReservations: z.number().int().min(0).max(50).nullable().optional(),
  // Modelo da mensagem de cobrança (WhatsApp). Vazio = volta ao padrão; ausente = não mexe.
  // Passo do seletor de horário do vizinho. Ausente = não mexe.
  // Custo mensal da garagem (resumo financeiro). Ausente = não mexe.
  monthlyCost: z.number().min(0).max(100000).optional(),
  // Taxa sugerida para quem estaciona sem agendar (R$). Ausente = não mexe.
  noBookingFee: z.number().min(0).max(10000).optional(),
  timeStepMinutes: z.union([z.literal(5), z.literal(10), z.literal(30)]).optional(),
  chargeTemplate: z.string().max(1500).regex(/^[^\u0000-\u0008\u000b-\u001f]*$/, "Caracteres inválidos na mensagem.").optional() });
export const isUuid = (v: string) => z.string().uuid().safeParse(v).success;
