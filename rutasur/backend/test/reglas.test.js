import test from 'node:test';
import assert from 'node:assert/strict';
import { decidirReprogramacion, opcionesParaReprogramar } from '../src/common/reglas.js';
import { proximoDiaHabil, proximaHora, franjaDe, fechaDe, aMs, HORA } from '../src/common/calendario.js';

const viernesManana = '2026-01-09T11:00:00.000Z'; // viernes 11:00 UTC -> franja MANANA
const lunesTarde = '2026-01-05T17:00:00.000Z'; // lunes 17:00 UTC -> franja TARDE

test('AUSENTE: dia habil siguiente en la franja opuesta (MANANA -> TARDE) y saltea el fin de semana', () => {
  const d = decidirReprogramacion({ motivo: 'AUSENTE', intento: 1, ocurridoEn: viernesManana });
  assert.equal(d.tipo, 'REPROGRAMADO');
  assert.equal(d.franja, 'TARDE');
  assert.equal(d.nuevoIntentoPara, '2026-01-12T15:00:00.000Z'); // lunes 15:00
});

test('AUSENTE: franja TARDE -> nuevo intento por la MANANA del dia siguiente', () => {
  const d = decidirReprogramacion({ motivo: 'AUSENTE', intento: 2, ocurridoEn: lunesTarde });
  assert.equal(d.tipo, 'REPROGRAMADO');
  assert.equal(d.franja, 'MANANA');
  assert.equal(d.nuevoIntentoPara, '2026-01-06T09:00:00.000Z');
});

test('DIRECCION_INCORRECTA: queda retenido, no se reprograma solo', () => {
  assert.equal(decidirReprogramacion({ motivo: 'DIRECCION_INCORRECTA', intento: 1, ocurridoEn: lunesTarde }).tipo, 'RETENIDO');
});

test('RECHAZADO: devolucion al comercio', () => {
  const d = decidirReprogramacion({ motivo: 'RECHAZADO', intento: 1, ocurridoEn: lunesTarde });
  assert.deepEqual([d.tipo, d.causa], ['DEVOLUCION_COMERCIO', 'RECHAZADO']);
});

test('ZONA_INACCESIBLE: se trata como ausencia (supuesto documentado)', () => {
  assert.equal(decidirReprogramacion({ motivo: 'ZONA_INACCESIBLE', intento: 1, ocurridoEn: lunesTarde }).tipo, 'REPROGRAMADO');
});

test('tercer fallo: devolucion al comercio sea cual sea el motivo', () => {
  for (const motivo of ['AUSENTE', 'DIRECCION_INCORRECTA', 'RECHAZADO', 'ZONA_INACCESIBLE']) {
    const d = decidirReprogramacion({ motivo, intento: 3, ocurridoEn: lunesTarde });
    assert.deepEqual([d.tipo, d.causa], ['DEVOLUCION_COMERCIO', 'TERCER_FALLO'], motivo);
  }
});

test('opciones para reprogramar: proximo dia habil, ambas franjas', () => {
  const o = opcionesParaReprogramar(viernesManana);
  assert.deepEqual(o.map((x) => x.franja), ['MANANA', 'TARDE']);
  assert.equal(o[0].fecha, '2026-01-12T09:00:00.000Z');
});

test('calendario: helpers de dia habil y franja', () => {
  assert.equal(fechaDe(proximoDiaHabil(aMs(viernesManana))), '2026-01-12');
  assert.equal(proximaHora(aMs('2026-01-05T10:00:00.000Z'), 9), aMs('2026-01-06T09:00:00.000Z'));
  assert.equal(proximaHora(aMs('2026-01-05T08:00:00.000Z'), 9), aMs('2026-01-05T09:00:00.000Z'));
  assert.equal(franjaDe(aMs('2026-01-05T13:59:00.000Z')), 'MANANA');
  assert.equal(franjaDe(aMs('2026-01-05T14:00:00.000Z')), 'TARDE');
  assert.equal(HORA, 3600000);
});
