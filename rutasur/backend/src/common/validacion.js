// Validacion de esquema de cada evento (JSON, sin Schema Registry). Cada consumidor la aplica.
import { TOPICS, ESTADOS, MOTIVOS, DISPOSICIONES, FRANJAS, MAX_INTENTOS, REGLAS_SLA, PRIORIDADES } from './catalogo.js';

const esTexto = (v) => typeof v === 'string' && v.trim().length > 0;
const esEnteroPositivo = (v) => Number.isInteger(v) && v > 0;
const esIso = (v) =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(v) && !Number.isNaN(Date.parse(v));

function comunes(e, err) {
  if (!esTexto(e.eventId)) err.push('eventId requerido');
  if (!esTexto(e.shipmentId)) err.push('shipmentId requerido');
  if (!esTexto(e.tipo)) err.push('tipo requerido');
  if (!esIso(e.ocurridoEn)) err.push('ocurridoEn debe ser ISO-8601 UTC');
  if (!esEnteroPositivo(e.secuencia)) err.push('secuencia debe ser un entero positivo');
  if (!esTexto(e.hubId)) err.push('hubId requerido');
  if (!esTexto(e.zonaId)) err.push('zonaId requerido');
  if (e.repartidorId != null && !esTexto(e.repartidorId)) err.push('repartidorId invalido');
  if (e.version !== 1) err.push('version debe ser 1');
}

const VALIDADORES = {
  [TOPICS.ESTADOS]: (e, err) => {
    comunes(e, err);
    if (esTexto(e.tipo) && !ESTADOS.includes(e.tipo)) err.push(`tipo desconocido: ${e.tipo}`);
    if (e.tipo === 'ENTREGA_FALLIDA' && !MOTIVOS.includes(e.motivo)) err.push('ENTREGA_FALLIDA requiere un motivo valido');
    if (e.intento !== undefined && !(Number.isInteger(e.intento) && e.intento >= 1 && e.intento <= MAX_INTENTOS)) {
      err.push('intento debe estar entre 1 y 3');
    }
    if (e.promesaVenceEn !== undefined && !esIso(e.promesaVenceEn)) err.push('promesaVenceEn invalida');
  },
  [TOPICS.PROMESAS]: (e, err) => {
    comunes(e, err);
    if (e.tipo !== 'PROMESA_ENTREGA') err.push('tipo debe ser PROMESA_ENTREGA');
    if (!esIso(e.promesaVenceEn)) err.push('promesaVenceEn requerida');
  },
  [TOPICS.REPROGRAMACIONES]: (e, err) => {
    comunes(e, err);
    if (!DISPOSICIONES.includes(e.tipo)) err.push(`tipo desconocido: ${e.tipo}`);
    if (!esEnteroPositivo(e.secuenciaOrigen)) err.push('secuenciaOrigen requerida');
    if (e.tipo === 'REPROGRAMADO') {
      if (!esIso(e.nuevoIntentoPara)) err.push('nuevoIntentoPara requerido');
      if (!FRANJAS.includes(e.franja)) err.push('franja invalida');
    }
  },
  [TOPICS.ALERTAS]: (e, err) => {
    comunes(e, err);
    if (!['ALERTA_ABIERTA', 'ALERTA_CERRADA'].includes(e.tipo)) err.push(`tipo desconocido: ${e.tipo}`);
    if (!REGLAS_SLA[e.regla]) err.push('regla desconocida');
    if (!PRIORIDADES.includes(e.prioridad)) err.push('prioridad invalida');
  },
  [TOPICS.NOTIFICACIONES]: (e, err) => {
    comunes(e, err);
    if (e.tipo !== 'NOTIFICACION_ENVIADA') err.push('tipo debe ser NOTIFICACION_ENVIADA');
    if (!['ENTREGA_FALLIDA', 'ALERTA_SLA'].includes(e.motivo)) err.push('motivo invalido');
    if (!esTexto(e.canal)) err.push('canal requerido');
  },
};

/** Devuelve la lista de errores de esquema (vacia si el evento es valido). */
export function validar(topic, evento) {
  const err = [];
  const validador = VALIDADORES[topic];
  if (!validador) return [`topic sin esquema: ${topic}`];
  validador(evento, err);
  return err;
}

/** Parsea y valida el valor de un mensaje de Kafka. No lanza: devuelve { ok, evento } o { ok:false, motivo }. */
export function parsearMensaje(topic, valor) {
  const texto = valor == null ? '' : valor.toString('utf8');
  let evento;
  try {
    evento = JSON.parse(texto);
  } catch {
    return { ok: false, motivo: 'JSON_INVALIDO', texto };
  }
  if (evento === null || typeof evento !== 'object' || Array.isArray(evento)) {
    return { ok: false, motivo: 'JSON_NO_ES_OBJETO', texto };
  }
  const errores = validar(topic, evento);
  if (errores.length) return { ok: false, motivo: `ESQUEMA_INVALIDO: ${errores.join('; ')}`, texto };
  return { ok: true, evento };
}
