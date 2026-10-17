import { z } from 'zod';
import { ESTADOS, MOTIVOS } from './constantes.js';

// Campos comunes a todo evento (según el documento)
const base = {
  eventId: z.string().min(1),
  shipmentId: z.string().min(1),
  ocurridoEn: z.string().datetime(),        // reloj SIMULADO, ISO 8601
  secuencia: z.number().int().positive(),
  hubId: z.string().min(1),
  zonaId: z.string().min(1),
  repartidorId: z.string().min(1).nullable(), // null hasta que se clasifica
  version: z.number().int(),
};

export const EventoEstado = z.discriminatedUnion('tipo', [
  z.object({ ...base, tipo: z.literal(ESTADOS.CREADO) }),
  z.object({ ...base, tipo: z.literal(ESTADOS.INGRESADO_HUB) }),
  z.object({ ...base, tipo: z.literal(ESTADOS.CLASIFICADO) }),
  z.object({ ...base, tipo: z.literal(ESTADOS.EN_REPARTO) }),
  z.object({ ...base, tipo: z.literal(ESTADOS.ENTREGADO) }),
  z.object({
    ...base,
    tipo: z.literal(ESTADOS.ENTREGA_FALLIDA),
    motivo: z.enum(Object.values(MOTIVOS)),
  }),
]);

export const EventoPromesa = z.object({
  ...base,
  tipo: z.literal('PROMESA'),
  venceEn: z.string().datetime(),
});

/**
 * Valida un evento. Devuelve { ok: true, evento } o { ok: false, motivo }.
 * El motivo es el texto que se escribe en la DLQ.
 */
export function validar(esquema, crudo) {
  const r = esquema.safeParse(crudo);
  if (r.success) return { ok: true, evento: r.data };
  const motivo = r.error.issues
    .map((i) => `${i.path.join('.') || '(raíz)'}: ${i.message}`)
    .join('; ');
  return { ok: false, motivo };
}