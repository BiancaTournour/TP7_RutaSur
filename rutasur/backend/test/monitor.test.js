import test from 'node:test';
import assert from 'node:assert/strict';
import { RelojSimulado, estadoMonitorNuevo, aplicarEventoEstado, aplicarPromesa, evaluar, abrirAlertas, cerrarAlertas } from '../src/common/monitor.js';
import { HORA, aMs } from '../src/common/calendario.js';

const T0 = aMs('2026-01-05T06:00:00.000Z');
const PROMESA = T0 + 30 * HORA; // 06/01 12:00
const e = (secuencia, tipo, extra = {}) => ({ secuencia, tipo, hubId: 'HUB-SUR', zonaId: 'Z-S1', ...extra });

function envio() {
  const st = estadoMonitorNuevo('ENV-1');
  aplicarPromesa(st, { promesaVenceEn: new Date(PROMESA).toISOString(), hubId: 'HUB-SUR', zonaId: 'Z-S1' });
  aplicarEventoEstado(st, e(1, 'CREADO'));
  return st;
}
const reglas = (st, ahora) => evaluar(st, ahora).map((r) => `${r.regla}:${r.prioridad}`);

test('cada una de las 4 reglas dispara con su prioridad', () => {
  // SIN_INGRESO (media): faltan < 10 h y no ingreso al hub
  assert.deepEqual(reglas(envio(), PROMESA - 9 * HORA), ['SIN_INGRESO:MEDIA']);
  // SIN_SALIDA (alta): faltan < 4 h y no esta en reparto
  const enHub = envio();
  aplicarEventoEstado(enHub, e(2, 'INGRESADO_HUB'));
  assert.deepEqual(reglas(enHub, PROMESA - 3 * HORA), ['SIN_SALIDA:ALTA']);
  // FALLO_DIA_LIMITE (alta): ENTREGA_FALLIDA y la promesa vence hoy
  const falla = envio();
  [e(2, 'INGRESADO_HUB'), e(3, 'CLASIFICADO'), e(4, 'EN_REPARTO'), e(5, 'ENTREGA_FALLIDA', { motivo: 'AUSENTE' })].forEach((x) => aplicarEventoEstado(falla, x));
  assert.ok(reglas(falla, PROMESA - 5 * HORA).includes('FALLO_DIA_LIMITE:ALTA'));
  // VENCIDO (critica): paso el vencimiento sin ENTREGADO
  assert.ok(reglas(enHub, PROMESA + HORA).includes('VENCIDO:CRITICA'));
});

test('no alerta si falta mucho, si esta en reparto (SIN_SALIDA) ni si ya fue entregado', () => {
  assert.deepEqual(reglas(envio(), T0 + HORA), []);
  const reparto = envio();
  [e(2, 'INGRESADO_HUB'), e(3, 'CLASIFICADO'), e(4, 'EN_REPARTO')].forEach((x) => aplicarEventoEstado(reparto, x));
  assert.deepEqual(reglas(reparto, PROMESA - 2 * HORA), []);
  aplicarEventoEstado(reparto, e(5, 'ENTREGADO'));
  assert.deepEqual(reglas(reparto, PROMESA + 10 * HORA), []);
});

test('una misma regla no alerta dos veces sobre el mismo envio', () => {
  const st = envio();
  const ahora = PROMESA - 9 * HORA;
  assert.equal(abrirAlertas(st, evaluar(st, ahora), ahora).length, 1);
  assert.equal(abrirAlertas(st, evaluar(st, ahora + HORA), ahora + HORA).length, 0);
  // ...pero otra regla distinta si puede alertar despues
  const tarde = PROMESA - 3 * HORA;
  assert.deepEqual(abrirAlertas(st, evaluar(st, tarde), tarde).map((a) => a.regla), ['SIN_SALIDA']);
});

test('ids de alerta deterministas (un reintento no crea alertas distintas) y cierre al entregar', () => {
  const st = envio();
  const abiertas = abrirAlertas(st, evaluar(st, PROMESA - 3 * HORA), PROMESA - 3 * HORA);
  assert.deepEqual(abiertas.map((a) => a.eventId).sort(), ['alerta:ENV-1:SIN_INGRESO:ABIERTA', 'alerta:ENV-1:SIN_SALIDA:ABIERTA']);
  aplicarEventoEstado(st, e(2, 'ENTREGADO'));
  const cierres = cerrarAlertas(st, PROMESA);
  assert.deepEqual(cierres.map((a) => a.tipo), ['ALERTA_CERRADA', 'ALERTA_CERRADA']);
  assert.equal(st.abierto, false);
  assert.equal(cerrarAlertas(st, PROMESA).length, 0); // no se cierra dos veces
});

test('eventos repetidos o viejos se descartan por secuencia', () => {
  const st = envio();
  assert.equal(aplicarEventoEstado(st, e(1, 'CREADO')), false);
  aplicarEventoEstado(st, e(3, 'CLASIFICADO'));
  assert.equal(aplicarEventoEstado(st, e(2, 'INGRESADO_HUB')), false);
  assert.equal(st.ingreso, true); // CLASIFICADO implica que ya paso por el hub
});

test('reloj simulado: avanza con los eventos y se extrapola con la aceleracion', () => {
  let real = 1_000_000;
  const reloj = new RelojSimulado(120, () => real);
  assert.equal(reloj.ahora(), null);
  reloj.observar(T0);
  real += 30_000; // 30 s reales = 1 hora simulada
  assert.equal(reloj.ahora(), T0 + HORA);
  reloj.observar(T0 - HORA); // nunca retrocede
  assert.equal(reloj.ahora(), T0 + HORA);
});

test('el estado del monitor es serializable (se respalda en MongoDB y se recupera tras un reinicio)', () => {
  const st = envio();
  abrirAlertas(st, evaluar(st, PROMESA - 9 * HORA), PROMESA - 9 * HORA);
  const recuperado = JSON.parse(JSON.stringify(st));
  assert.equal(abrirAlertas(recuperado, evaluar(recuperado, PROMESA - 9 * HORA), PROMESA - 9 * HORA).length, 0); // no se repite
});
