// Incrementos atomicos de metricas_diarias (CU4). Un documento por (fecha, zonaId, franja).
import { aMs, fechaDe, franjaDe } from './calendario.js';

export function incrementosResultado(e) {
  const t = aMs(e.ocurridoEn);
  const filtro = { fecha: fechaDe(t), zonaId: e.zonaId, franja: franjaDe(t) };
  const primerIntento = (e.intento ?? 1) === 1;
  const inc = { intentos: 1 };
  if (primerIntento) inc.intentos1 = 1;
  if (e.tipo === 'ENTREGADO') {
    inc.entregados = 1;
    if (primerIntento) inc.entregados1 = 1;
    if (e.promesaVenceEn) inc[aMs(e.promesaVenceEn) >= t ? 'sla.aTiempo' : 'sla.tarde'] = 1;
  } else {
    inc.fallidos = 1;
    inc[`motivos.${e.motivo}`] = 1;
  }
  return { filtro, inc, hubId: e.hubId };
}
