import test from 'node:test';
import assert from 'node:assert/strict';
import { aplicarEstado, aplicarDisposicion, aplicarAlerta } from '../src/common/proyeccion.js';

const ev = (secuencia, tipo, extra = {}) => ({
  eventId: `ENV-1:${secuencia}`,
  shipmentId: 'ENV-1',
  tipo,
  secuencia,
  ocurridoEn: new Date(Date.UTC(2026, 0, 5, 6 + secuencia, 0, 0)).toISOString(),
  hubId: 'HUB-SUR',
  zonaId: 'Z-S1',
  repartidorId: 'R-301',
  version: 1,
  ...extra,
});

const ciclo = [ev(1, 'CREADO', { promesaVenceEn: '2026-01-07T00:00:00.000Z' }), ev(2, 'INGRESADO_HUB'), ev(3, 'CLASIFICADO', { intento: 1 }), ev(4, 'EN_REPARTO', { intento: 1 }), ev(5, 'ENTREGADO', { intento: 1 })];

const aplicarTodos = (eventos) => eventos.reduce((doc, e) => (aplicarEstado(doc, e).doc ?? doc), null);

test('CU1: el documento refleja el ultimo estado y el historial completo', () => {
  const doc = aplicarTodos(ciclo);
  assert.equal(doc.estado, 'ENTREGADO');
  assert.deepEqual(doc.historial.map((h) => h.tipo), ['CREADO', 'INGRESADO_HUB', 'CLASIFICADO', 'EN_REPARTO', 'ENTREGADO']);
  assert.equal(doc.promesa.venceEn, '2026-01-07T00:00:00.000Z');
  assert.equal(doc.ultimaSecuencia, 5);
});

test('duplicado: el mismo eventId no agrega una entrada repetida', () => {
  const doc = aplicarTodos(ciclo);
  const r = aplicarEstado(doc, ciclo[2]);
  assert.equal(r.aplicado, false);
  assert.equal(doc.historial.length, 5);
});

test('fuera de orden: un evento con secuencia menor o igual no hace retroceder el estado', () => {
  let doc = aplicarTodos(ciclo.slice(0, 4)); // EN_REPARTO
  const llegaTarde = aplicarEstado(doc, ev(2, 'INGRESADO_HUB', { eventId: 'otro-id' }));
  assert.equal(llegaTarde.aplicado, false);
  assert.equal(llegaTarde.motivo, 'FUERA_DE_ORDEN');
  assert.equal(doc.estado, 'EN_REPARTO');
});

test('disposicion: REPROGRAMADO se ve mientras no haya un estado mas nuevo; el nuevo intento lo reemplaza', () => {
  const fallo = ev(5, 'ENTREGA_FALLIDA', { motivo: 'AUSENTE', intento: 1 });
  let doc = aplicarTodos([...ciclo.slice(0, 4), fallo]);
  assert.equal(doc.estado, 'ENTREGA_FALLIDA');
  const repro = { eventId: 'repro:ENV-1:5', shipmentId: 'ENV-1', tipo: 'REPROGRAMADO', secuenciaOrigen: 5, ocurridoEn: fallo.ocurridoEn, causa: 'AUSENTE', franja: 'TARDE', nuevoIntentoPara: '2026-01-06T15:00:00.000Z', hubId: 'HUB-SUR', zonaId: 'Z-S1' };
  doc = aplicarDisposicion(doc, repro).doc;
  assert.equal(doc.estado, 'REPROGRAMADO');
  doc = aplicarEstado(doc, ev(6, 'CLASIFICADO', { intento: 2 })).doc;
  assert.equal(doc.estado, 'CLASIFICADO');
});

test('reconstruccion: el resultado no depende del orden de llegada entre topics (borrar y reprocesar = mismo estado)', () => {
  const fallo1 = ev(5, 'ENTREGA_FALLIDA', { motivo: 'AUSENTE', intento: 1 });
  const estados = [...ciclo.slice(0, 4), fallo1, ev(6, 'CLASIFICADO', { intento: 2 }), ev(7, 'EN_REPARTO', { intento: 2 }), ev(8, 'ENTREGA_FALLIDA', { motivo: 'RECHAZADO', intento: 2 })];
  const reprogramaciones = [
    { eventId: 'repro:ENV-1:5', shipmentId: 'ENV-1', tipo: 'REPROGRAMADO', secuenciaOrigen: 5, ocurridoEn: fallo1.ocurridoEn, causa: 'AUSENTE', franja: 'TARDE', nuevoIntentoPara: '2026-01-06T15:00:00.000Z', hubId: 'HUB-SUR', zonaId: 'Z-S1' },
    { eventId: 'repro:ENV-1:8', shipmentId: 'ENV-1', tipo: 'DEVOLUCION_COMERCIO', secuenciaOrigen: 8, ocurridoEn: estados[7].ocurridoEn, causa: 'RECHAZADO', hubId: 'HUB-SUR', zonaId: 'Z-S1' },
  ];
  const referencia = (() => {
    let doc = aplicarTodos(estados);
    for (const r of reprogramaciones) doc = aplicarDisposicion(doc, r).doc;
    return doc;
  })();
  assert.equal(referencia.estado, 'DEVOLUCION_COMERCIO');

  // 200 intercalados aleatorios que respetan el orden dentro de cada topic (como Kafka)
  let semilla = 7;
  const azar = () => ((semilla = (semilla * 1664525 + 1013904223) % 4294967296) / 4294967296);
  for (let i = 0; i < 200; i++) {
    const a = estados.map((e) => ({ k: 'e', e }));
    const b = reprogramaciones.map((r) => ({ k: 'r', e: r }));
    const mezcla = [];
    while (a.length || b.length) mezcla.push((b.length && (!a.length || azar() < 0.4) ? b : a).shift());
    let doc = null;
    for (const m of mezcla) doc = (m.k === 'e' ? aplicarEstado(doc, m.e) : aplicarDisposicion(doc, m.e)).doc ?? doc;
    assert.deepEqual(doc, referencia, `intercalado ${i} distinto`);
  }
});

test('alertas: abrir, cerrar y reaplicar es idempotente; un cierre no se pisa con una apertura tardia', () => {
  const abrir = { shipmentId: 'ENV-1', tipo: 'ALERTA_ABIERTA', regla: 'SIN_SALIDA', prioridad: 'ALTA', causa: 'x', ocurridoEn: '2026-01-05T10:00:00.000Z', hubId: 'H', zonaId: 'Z' };
  const cerrar = { ...abrir, tipo: 'ALERTA_CERRADA', ocurridoEn: '2026-01-05T12:00:00.000Z' };
  let doc = aplicarAlerta(null, abrir);
  assert.equal(doc.estado, 'ABIERTA');
  doc = aplicarAlerta(doc, cerrar);
  doc = aplicarAlerta(doc, abrir);
  assert.equal(doc.estado, 'CERRADA');
  assert.equal(doc.abiertaEn, '2026-01-05T10:00:00.000Z');
  assert.equal(doc._id, 'ENV-1:SIN_SALIDA');
});
