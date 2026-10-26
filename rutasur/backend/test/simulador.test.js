import test from 'node:test';
import assert from 'node:assert/strict';
import { crearRng } from '../src/simulator/rng.js';
import { planificarEnvio } from '../src/simulator/planificador.js';
import { simCfg } from '../src/common/config.js';
import { validar } from '../src/common/validacion.js';
import { TOPICS } from '../src/common/catalogo.js';

const CREADO = Date.UTC(2026, 0, 5, 6, 0, 0);
const plan = (n, opciones, cfg = simCfg) =>
  planificarEnvio({ shipmentId: `ENV-${n}`, rng: crearRng(`${cfg.semilla}:${n}`), creadoMs: CREADO + n * 360000, cfg, opciones });

test('semilla fija: la misma corrida se repite exactamente', () => {
  for (let n = 0; n < 50; n++) assert.deepEqual(plan(n), plan(n));
  assert.notDeepEqual(plan(1), plan(2));
});

test('los eventos validos cumplen el esquema y la secuencia crece de a uno por envio', () => {
  for (let n = 0; n < 300; n++) {
    const estados = plan(n).mensajes.filter((m) => m.topic === TOPICS.ESTADOS && m.stat !== 'MALFORMADO' && m.stat !== 'DUPLICADO');
    const eventos = estados.map((m) => JSON.parse(m.valor)).sort((a, b) => a.secuencia - b.secuencia);
    eventos.forEach((e, i) => {
      assert.equal(e.secuencia, i + 1);
      assert.deepEqual(validar(TOPICS.ESTADOS, e), []);
      if (i) assert.ok(e.ocurridoEn >= eventos[i - 1].ocurridoEn);
    });
    assert.equal(eventos[0].tipo, 'CREADO');
    assert.ok(eventos.length <= 15, 'el historial esta acotado (menos de 15 eventos)');
  }
});

test('escenario ausente: falla, se reprograma y termina entregado', () => {
  const p = plan(1, { sinAnomalias: true, rapido: true, resultados: ['AUSENTE', 'ENTREGADO'] });
  const tipos = p.mensajes.filter((m) => m.topic === TOPICS.ESTADOS).map((m) => JSON.parse(m.valor).tipo);
  assert.deepEqual(tipos, ['CREADO', 'INGRESADO_HUB', 'CLASIFICADO', 'EN_REPARTO', 'ENTREGA_FALLIDA', 'CLASIFICADO', 'EN_REPARTO', 'ENTREGADO']);
});

test('escenario tercer fallo: tres intentos fallidos y el ciclo termina (devolucion)', () => {
  const p = plan(1, { sinAnomalias: true, rapido: true, resultados: ['AUSENTE', 'AUSENTE', 'AUSENTE'] });
  const eventos = p.mensajes.filter((m) => m.topic === TOPICS.ESTADOS).map((m) => JSON.parse(m.valor));
  assert.equal(eventos.filter((e) => e.tipo === 'ENTREGA_FALLIDA').length, 3);
  assert.equal(eventos.at(-1).tipo, 'ENTREGA_FALLIDA');
  assert.equal(eventos.at(-1).intento, 3);
});

test('escenario demorado: el envio queda detenido en el hub', () => {
  const p = plan(1, { sinAnomalias: true, rapido: true, soloHastaHub: true, horasPromesa: 4.5 });
  const tipos = p.mensajes.filter((m) => m.topic === TOPICS.ESTADOS).map((m) => JSON.parse(m.valor).tipo);
  assert.deepEqual(tipos, ['CREADO', 'INGRESADO_HUB']);
});

test('DIRECCION_INCORRECTA y RECHAZADO sacan al envio del circuito (no hay nuevo intento)', () => {
  for (const motivo of ['DIRECCION_INCORRECTA', 'RECHAZADO']) {
    const p = plan(1, { sinAnomalias: true, rapido: true, resultados: [motivo] });
    const tipos = p.mensajes.filter((m) => m.topic === TOPICS.ESTADOS).map((m) => JSON.parse(m.valor).tipo);
    assert.equal(tipos.at(-1), 'ENTREGA_FALLIDA');
    assert.equal(tipos.filter((t) => t === 'EN_REPARTO').length, 1);
  }
});

test('las anomalias aparecen con la frecuencia configurada (duplicados, malformados, desorden)', () => {
  const stats = { DUPLICADO: 0, MALFORMADO: 0, validos: 0, desorden: 0 };
  for (let n = 0; n < 2000; n++) {
    const p = plan(n);
    const estados = p.mensajes.filter((m) => m.topic === TOPICS.ESTADOS);
    for (const m of estados) {
      if (m.stat === 'DUPLICADO') stats.DUPLICADO++;
      else if (m.stat === 'MALFORMADO') stats.MALFORMADO++;
      else stats.validos++;
    }
    const validos = estados.filter((m) => m.stat !== 'DUPLICADO' && m.stat !== 'MALFORMADO').map((m) => JSON.parse(m.valor).secuencia);
    if (validos.some((s, i) => i && s < validos[i - 1])) stats.desorden++;
  }
  assert.ok(Math.abs(stats.DUPLICADO / stats.validos - 0.02) < 0.01, `duplicados ${stats.DUPLICADO / stats.validos}`);
  assert.ok(Math.abs(stats.MALFORMADO / stats.validos - 0.01) < 0.006, `malformados ${stats.MALFORMADO / stats.validos}`);
  assert.ok(stats.desorden > 0);
});

test('la tasa de fallo respeta las zonas (entre 5% y 30%) y la zona sur falla mas que la norte', () => {
  const por = {};
  for (let n = 0; n < 6000; n++) {
    for (const m of plan(n, { sinAnomalias: true }).mensajes) {
      if (m.topic !== TOPICS.ESTADOS) continue;
      const e = JSON.parse(m.valor);
      if (e.tipo !== 'ENTREGADO' && e.tipo !== 'ENTREGA_FALLIDA') continue;
      const z = (por[e.zonaId] ??= { n: 0, f: 0 });
      z.n++;
      if (e.tipo === 'ENTREGA_FALLIDA') z.f++;
    }
  }
  const tasa = (z) => por[z].f / por[z].n;
  assert.ok(tasa('Z-N1') < 0.12 && tasa('Z-N1') > 0.02, `N1 ${tasa('Z-N1')}`);
  assert.ok(tasa('Z-S3') > 0.25 && tasa('Z-S3') < 0.45, `S3 ${tasa('Z-S3')}`);
  assert.ok(tasa('Z-S3') > tasa('Z-N1'));
});
