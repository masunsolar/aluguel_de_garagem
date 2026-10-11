import "server-only";
import { sql } from "./db";
export type Actor = "vizinho" | "admin" | "sistema";
export const logEvent = (reservationId: string, actor: Actor, action: string, details: object = {}) =>
  sql`insert into reservation_events (reservation_id, actor, action, details)
      values (${reservationId}, ${actor}, ${action}, ${JSON.stringify(details)}::jsonb)`;
