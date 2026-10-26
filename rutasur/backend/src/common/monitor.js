// Nucleo puro del monitor de SLA (CU3): estado interno por envio + evaluacion de reglas.
// El reloj es el SIMULADO, el que viaja en los eventos (ocurridoEn), no el de la maquina.
import { REGLAS_SLA } from './catalogo.js';
import { HORA, aMs, iso, venceHoy } from './calendario.js';

export class RelojSimulado {
  constructor(aceleracion, ahoraReal = () => Date.now()) {
    this.aceleracion = aceleracion;
    this.ahoraReal = ahoraReal;
    this.simMs = null;
    this.realMs = null;
  }
  /** Avanza el reloj con el ocurridoEn de un evento (solo hacia adelante). */
  observar(ms) {
    if (this.simMs === null || ms > this.simMs) {
      this.simMs = ms;
      this.realMs = this.ahoraReal();
    }
  }
  restaurar(simMs) {
    if (simMs != null) {
      this.simMs = simMs;
      this.realMs = this.ahoraReal();
    }
  }
  /** Tiempo simulado actual: ultimo evento visto + lo transcurrido en tiempo real * aceleracion. */
  ahora() {
    if (this.simMs === null) return null;
    return this.simMs + (this.ahoraReal() - this.realMs) * this.aceleracion;
  }
}

export const estadoMonitorNuevo = (shipmentId) => ({
  shipmentId,
  abierto: true,
  estado: null,
  ultimaSecuencia: 0,
  ingreso: false, // ya paso por el hub
  enReparto: false,
  entregado: false,
  fallaUltima: false,
  promesaMs: null,
  hubId: null,
  zonaId: null,
  emitidas: {}, // reglas que ya alertaron (una regla no repite sobre el mismo envio)
  cerradas: {},
});

const ESTADOS_POSTERIORES_AL_HUB = ['INGRESADO_HUB', 'CLASIFICADO', 'EN_REPARTO', 'ENTREGADO', 'ENTREGA_FALLIDA'];

/** Aplica un evento de envios.estados. Devuelve false si se descarta por secuencia vieja o repetida. */
export function aplicarEventoEstado(st, e) {
  if (e.secuencia <= st.ultimaSecuencia) return false;
  st.ultimaSecuencia = e.secuencia;
  st.estado = e.tipo;
  st.hubId = e.hubId;
  st.zonaId = e.zonaId;
  if (ESTADOS_POSTERIORES_AL_HUB.includes(e.tipo)) st.ingreso = true;
  st.enReparto = e.tipo === 'EN_REPARTO';
  st.entregado = e.tipo === 'ENTREGADO';
  st.fallaUltima = e.tipo === 'ENTREGA_FALLIDA';
  if (e.promesaVenceEn && st.promesaMs === null) st.promesaMs = aMs(e.promesaVenceEn);
  return true;
}

export function aplicarPromesa(st, p) {
  st.promesaMs = aMs(p.promesaVenceEn);
  st.hubId = st.hubId ?? p.hubId;
  st.zonaId = st.zonaId ?? p.zonaId;
}

/** Reglas que se cumplen para este envio en el instante simulado `ahoraMs`. */
export function evaluar(st, ahoraMs) {
  if (!st.abierto || st.entregado || st.promesaMs === null || ahoraMs === null) return [];
  const resta = st.promesaMs - ahoraMs;
  const out = [];
  if (!st.ingreso && resta > 0 && resta < 10 * HORA) {
    out.push({ regla: 'SIN_INGRESO', causa: 'Faltan menos de 10 h y el envio no ingreso al hub' });
  }
  if (!st.enReparto && resta > 0 && resta < 4 * HORA) {
    out.push({ regla: 'SIN_SALIDA', causa: 'Faltan menos de 4 h y el envio no esta en reparto' });
  }
  if (st.fallaUltima && venceHoy(st.promesaMs, ahoraMs)) {
    out.push({ regla: 'FALLO_DIA_LIMITE', causa: 'Entrega fallida y la promesa vence hoy' });
  }
  if (resta < 0) out.push({ regla: 'VENCIDO', causa: 'Paso el vencimiento sin ENTREGADO' });
  return out.map((r) => ({ ...r, prioridad: REGLAS_SLA[r.regla].prioridad }));
}

/** Construye un evento de alerta. El eventId es determinista: reenviarlo no genera una alerta nueva. */
export function eventoAlerta(st, tipo, regla, causa, ahoraMs) {
  const sufijo = tipo === 'ALERTA_ABIERTA' ? 'ABIERTA' : 'CERRADA';
  return {
    eventId: `alerta:${st.shipmentId}:${regla}:${sufijo}`,
    shipmentId: st.shipmentId,
    tipo,
    regla,
    prioridad: REGLAS_SLA[regla].prioridad,
    causa: causa ?? null,
    ocurridoEn: iso(Math.round(ahoraMs)),
    secuencia: Math.max(1, st.ultimaSecuencia),
    hubId: st.hubId ?? 'DESCONOCIDO',
    zonaId: st.zonaId ?? 'DESCONOCIDA',
    repartidorId: null,
    version: 1,
  };
}

/** Marca como emitidas las reglas pendientes y devuelve los eventos de apertura. Muta `st`. */
export function abrirAlertas(st, resultados, ahoraMs) {
  const eventos = [];
  for (const r of resultados) {
    if (st.emitidas[r.regla]) continue;
    st.emitidas[r.regla] = true;
    eventos.push(eventoAlerta(st, 'ALERTA_ABIERTA', r.regla, r.causa, ahoraMs));
  }
  return eventos;
}

/** Al llegar ENTREGADO: cierra todas las alertas abiertas del envio. Muta `st`. */
export function cerrarAlertas(st, ahoraMs) {
  const eventos = [];
  for (const regla of Object.keys(st.emitidas)) {
    if (st.cerradas[regla]) continue;
    st.cerradas[regla] = true;
    eventos.push(eventoAlerta(st, 'ALERTA_CERRADA', regla, 'Envio entregado', ahoraMs));
  }
  st.abierto = false;
  return eventos;
}
