// Integracion en memoria: simula Kafka (orden global por instante de emision; por clave se conserva el orden)
// y hace pasar los eventos por las mismas funciones que usan los servicios.
import test from 'node:test';
import assert from 'node:assert/strict';
import { crearRng } from '../src/simulator/rng.js';
import { planificarEnvio } from '../src/simulator/planificador.js';
import { simCfg } from '../src/common/config.js';
import { parsearMensaje } from '../src/common/validacion.js';
import { TOPICS } from '../src/common/catalogo.js';
import { decidirReprogramacion } from '../src/common/reglas.js';
import { aplicarEstado, aplicarDisposicion } from '../src/common/proyeccion.js';
import { incrementosResultado } from '../src/common/metricas.js';
import { estadoMonitorNuevo, aplicarEventoEstado, aplicarPromesa, evaluar, abrirAlertas, cerrarAlertas } from '../src/common/monitor.js';
import { aMs, MIN } from '../src/common/calendario.js';

const INICIO = Date.UTC(2026, 0, 5, 6, 0, 0);
const N = 400;

function generar(cfg) {
  const mensajes = [];
  for (let n = 0; n < N; n++) {
    mensajes.push(
      ...planificarEnvio({ shipmentId: `ENV-${String(n + 1).padStart(6, '0')}`, rng: crearRng(`${cfg.semilla}:${n}`), creadoMs: INICIO + n * 360_000, cfg }).mensajes,
    );
  }
  return mensajes.sort((a, b) => a.atMs - b.atMs);
}

test('flujo completo: DLQ, duplicados, orden, reprogramacion exacta, analitica y SLA', () => {
  const mensajes = generar(simCfg);
  const dlq = [];
  const envios = new Map();
  const reprogramaciones = [];
  const resultadosUnicos = new Map();
  const visto = new Set();

  // --- consumidores de envios.estados ---
  for (const m of mensajes.filter((x) => x.topic === TOPICS.ESTADOS)) {
    const r = parsearMensaje(TOPICS.ESTADOS, Buffer.from(m.valor));
    if (!r.ok) {
      dlq.push({ motivo: r.motivo, clave: m.clave });
      continue; // el consumo continua
    }
    const e = r.evento;
    // proyector (idempotente por eventId + regla de secuencia)
    if (!visto.has(`p:${e.eventId}`)) {
      visto.add(`p:${e.eventId}`);
      const res = aplicarEstado(envios.get(e.shipmentId) ?? null, e);
      if (res.aplicado) envios.set(e.shipmentId, res.doc);
    }
    // reprogramacion: una decision por ENTREGA_FALLIDA unica
    if (e.tipo === 'ENTREGA_FALLIDA' && !visto.has(`r:${e.eventId}`)) {
      visto.add(`r:${e.eventId}`);
      const d = decidirReprogramacion({ motivo: e.motivo, intento: e.intento, ocurridoEn: e.ocurridoEn });
      reprogramaciones.push({ origen: e, d });
      const actual = envios.get(e.shipmentId) ?? null;
      const res = aplicarDisposicion(actual, { eventId: `repro:${e.eventId}`, shipmentId: e.shipmentId, secuenciaOrigen: e.secuencia, ocurridoEn: e.ocurridoEn, hubId: e.hubId, zonaId: e.zonaId, tipo: d.tipo, causa: d.causa, nuevoIntentoPara: d.nuevoIntentoPara, franja: d.franja });
      if (res.aplicado) envios.set(e.shipmentId, res.doc);
    }
    // analitica
    if ((e.tipo === 'ENTREGADO' || e.tipo === 'ENTREGA_FALLIDA') && !resultadosUnicos.has(e.eventId)) resultadosUnicos.set(e.eventId, e);
  }

  // 1) cada malformado termina en la DLQ con su motivo y el resto sigue
  const malformados = mensajes.filter((m) => m.stat === 'MALFORMADO').length;
  assert.ok(malformados > 0, 'la corrida incluye eventos malformados');
  assert.equal(dlq.length, malformados);
  assert.ok(dlq.every((d) => /JSON_INVALIDO|ESQUEMA_INVALIDO/.test(d.motivo)));

  // 2) historial sin entradas repetidas aunque haya duplicados
  const duplicados = mensajes.filter((m) => m.stat === 'DUPLICADO').length;
  assert.ok(duplicados > 0, 'la corrida incluye duplicados');
  for (const doc of envios.values()) {
    const ids = doc.historial.map((h) => h.eventId);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(doc.historial.length < 15);
  }

  // 3) un ENTREGA_FALLIDA genera exactamente una decision, y se cumple la regla de cada motivo
  const fallidas = [...resultadosUnicos.values()].filter((e) => e.tipo === 'ENTREGA_FALLIDA');
  assert.equal(reprogramaciones.length, fallidas.length);
  for (const { origen, d } of reprogramaciones) {
    if (origen.intento >= 3) assert.equal(d.tipo, 'DEVOLUCION_COMERCIO');
    else if (origen.motivo === 'DIRECCION_INCORRECTA') assert.equal(d.tipo, 'RETENIDO');
    else if (origen.motivo === 'RECHAZADO') assert.equal(d.tipo, 'DEVOLUCION_COMERCIO');
    else assert.equal(d.tipo, 'REPROGRAMADO');
  }

  // 4) los eventos fuera de orden no hicieron retroceder ningun estado: la secuencia aplicada es la maxima emitida
  const maxSecuencia = new Map();
  for (const m of mensajes.filter((x) => x.topic === TOPICS.ESTADOS && x.stat !== 'MALFORMADO')) {
    const e = JSON.parse(m.valor);
    maxSecuencia.set(e.shipmentId, Math.max(maxSecuencia.get(e.shipmentId) ?? 0, e.secuencia));
  }
  for (const [id, doc] of envios) assert.equal(doc.ultimaSecuencia, maxSecuencia.get(id), id);

  // 5) todos los envios terminan en un estado final coherente (la corrida cubre todo el ciclo)
  const finales = new Set(['ENTREGADO', 'DEVOLUCION_COMERCIO', 'RETENIDO']);
  for (const doc of envios.values()) assert.ok(finales.has(doc.estado) || doc.estado === 'REPROGRAMADO', `${doc.shipmentId}: ${doc.estado}`);

  // 6) analitica: los duplicados no inflan los contadores
  const total = [...resultadosUnicos.values()].map(incrementosResultado).reduce((s, x) => s + x.inc.intentos, 0);
  assert.equal(total, resultadosUnicos.size);
  const entregados = [...resultadosUnicos.values()].filter((e) => e.tipo === 'ENTREGADO').length;
  assert.ok(entregados > fallidas.length, 'la mayoria de los intentos entrega');
});

test('SLA: recorrer el tiempo simulado genera alertas, no repite ninguna y las cierra al entregar', () => {
  const alertas = [];
  const estados = new Map();
  const todos = generar({ ...simCfg, tasaFueraDeOrden: 0, tasaDuplicado: 0, tasaMalformado: 0 });
  const fin = todos.at(-1).atMs;

  let i = 0;
  for (let ahora = INICIO; ahora <= fin + 2 * 86_400_000; ahora += 60 * MIN) {
    while (i < todos.length && todos[i].atMs <= ahora) {
      const m = todos[i++];
      const e = JSON.parse(m.valor);
      const st = estados.get(e.shipmentId) ?? estadoMonitorNuevo(e.shipmentId);
      estados.set(e.shipmentId, st);
      if (m.topic === TOPICS.PROMESAS) aplicarPromesa(st, e);
      else if (aplicarEventoEstado(st, e) && st.entregado) alertas.push(...cerrarAlertas(st, aMs(e.ocurridoEn)));
    }
    for (const st of estados.values()) alertas.push(...abrirAlertas(st, evaluar(st, ahora), ahora));
  }

  const aperturas = alertas.filter((a) => a.tipo === 'ALERTA_ABIERTA');
  assert.equal(new Set(aperturas.map((a) => a.eventId)).size, aperturas.length, 'ninguna regla repite sobre el mismo envio');
  assert.ok(new Set(aperturas.map((a) => a.regla)).size >= 3, 'se generan varias reglas distintas');
  for (const c of alertas.filter((a) => a.tipo === 'ALERTA_CERRADA')) {
    assert.ok(estados.get(c.shipmentId).entregado, 'solo se cierran alertas de envios entregados');
  }
});
