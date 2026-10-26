import test from 'node:test';
import assert from 'node:assert/strict';
import { parsearMensaje, validar } from '../src/common/validacion.js';
import { TOPICS } from '../src/common/catalogo.js';

const base = {
  eventId: 'ENV-000001:1',
  shipmentId: 'ENV-000001',
  tipo: 'CREADO',
  ocurridoEn: '2026-01-05T06:00:00.000Z',
  secuencia: 1,
  hubId: 'HUB-SUR',
  zonaId: 'Z-S1',
  repartidorId: 'R-301',
  version: 1,
};
const buf = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o));

test('evento valido', () => {
  assert.equal(parsearMensaje(TOPICS.ESTADOS, buf(base)).ok, true);
});

test('JSON cortado va a la DLQ con motivo JSON_INVALIDO', () => {
  const r = parsearMensaje(TOPICS.ESTADOS, buf(JSON.stringify(base).slice(0, 40)));
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'JSON_INVALIDO');
});

test('esquema invalido: tipo inexistente, sin eventId, secuencia no numerica, falla sin motivo', () => {
  assert.match(parsearMensaje(TOPICS.ESTADOS, buf({ ...base, tipo: 'VOLANDO' })).motivo, /tipo desconocido/);
  assert.match(parsearMensaje(TOPICS.ESTADOS, buf({ ...base, eventId: undefined })).motivo, /eventId/);
  assert.match(parsearMensaje(TOPICS.ESTADOS, buf({ ...base, secuencia: 'tres' })).motivo, /secuencia/);
  assert.match(parsearMensaje(TOPICS.ESTADOS, buf({ ...base, tipo: 'ENTREGA_FALLIDA' })).motivo, /motivo/);
});

test('ENTREGA_FALLIDA con motivo valido pasa', () => {
  assert.equal(validar(TOPICS.ESTADOS, { ...base, tipo: 'ENTREGA_FALLIDA', motivo: 'AUSENTE', intento: 1 }).length, 0);
});

test('esquemas de los otros topics', () => {
  assert.equal(validar(TOPICS.PROMESAS, { ...base, tipo: 'PROMESA_ENTREGA', promesaVenceEn: '2026-01-06T12:00:00.000Z' }).length, 0);
  assert.ok(validar(TOPICS.PROMESAS, { ...base, tipo: 'PROMESA_ENTREGA' }).length > 0);
  assert.equal(validar(TOPICS.ALERTAS, { ...base, tipo: 'ALERTA_ABIERTA', regla: 'VENCIDO', prioridad: 'CRITICA' }).length, 0);
  assert.ok(validar(TOPICS.ALERTAS, { ...base, tipo: 'ALERTA_ABIERTA', regla: 'INVENTADA', prioridad: 'CRITICA' }).length > 0);
  assert.equal(
    validar(TOPICS.REPROGRAMACIONES, { ...base, tipo: 'REPROGRAMADO', secuenciaOrigen: 5, franja: 'TARDE', nuevoIntentoPara: '2026-01-06T15:00:00.000Z' }).length,
    0,
  );
  assert.equal(validar(TOPICS.NOTIFICACIONES, { ...base, tipo: 'NOTIFICACION_ENVIADA', motivo: 'ENTREGA_FALLIDA', canal: 'SIMULADO' }).length, 0);
});
