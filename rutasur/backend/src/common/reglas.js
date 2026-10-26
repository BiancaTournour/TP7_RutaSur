// Reglas de reprogramacion (CU2). Las usa el servicio de reprogramacion y el simulador
// (el simulador "es el mundo real": el repartidor sale en la fecha que la regla indica).
import { MAX_INTENTOS } from './catalogo.js';
import { aMs, franjaDe, franjaOpuesta, proximoDiaHabil, HORA, HORA_SALIDA, iso } from './calendario.js';

/**
 * Decide que pasa con un envio tras una ENTREGA_FALLIDA.
 *  - 3er intento fallido (cualquier motivo)  -> devolucion al comercio
 *  - DIRECCION_INCORRECTA                    -> retenido hasta correccion
 *  - RECHAZADO                               -> devolucion al comercio
 *  - AUSENTE (y ZONA_INACCESIBLE)            -> nuevo intento el dia habil siguiente, en la franja opuesta
 */
export function decidirReprogramacion({ motivo, intento, ocurridoEn }) {
  if (intento >= MAX_INTENTOS) return { tipo: 'DEVOLUCION_COMERCIO', causa: 'TERCER_FALLO' };
  if (motivo === 'DIRECCION_INCORRECTA') return { tipo: 'RETENIDO', causa: 'DIRECCION_INCORRECTA' };
  if (motivo === 'RECHAZADO') return { tipo: 'DEVOLUCION_COMERCIO', causa: 'RECHAZADO' };
  const franja = franjaOpuesta(franjaDe(aMs(ocurridoEn)));
  const dia = proximoDiaHabil(aMs(ocurridoEn));
  return {
    tipo: 'REPROGRAMADO',
    causa: motivo,
    franja,
    nuevoIntentoPara: iso(dia + HORA_SALIDA[franja] * HORA),
  };
}

/** Opciones que se le ofrecen al destinatario en la notificacion (proximo dia habil, ambas franjas). */
export function opcionesParaReprogramar(ocurridoEn) {
  const dia = proximoDiaHabil(aMs(ocurridoEn));
  return ['MANANA', 'TARDE'].map((franja) => ({ franja, fecha: iso(dia + HORA_SALIDA[franja] * HORA) }));
}
