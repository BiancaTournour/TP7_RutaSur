// Monitor de SLA (CU3): consumidor con estado (en memoria, respaldado en MongoDB) que cruza envios.estados
// con envios.promesas. La alerta nace de EVALUAR EL TIEMPO: al recibir cada evento y ademas con un barrido
// periodico sobre todos los envios abiertos. Usa el reloj simulado que viaja en los eventos.
import { crearLog } from '../common/log.js';
import { cfg } from '../common/config.js';
import { GRUPOS, TOPICS } from '../common/catalogo.js';
import { aMs } from '../common/calendario.js';
import { conectarMongo, asegurarIndices } from '../common/mongo.js';
import { crearProducer, publicarLote } from '../common/kafka.js';
import { correrConsumidor, alApagar } from '../common/consumidor.js';
import {
  RelojSimulado,
  estadoMonitorNuevo,
  aplicarEventoEstado,
  aplicarPromesa,
  evaluar,
  abrirAlertas,
  cerrarAlertas,
} from '../common/monitor.js';

const log = crearLog('monitor-sla');
const { client, db } = await conectarMongo();
await asegurarIndices(db);
const producer = await crearProducer();
const coleccion = db.collection('monitor_sla_estado');

const reloj = new RelojSimulado(cfg.aceleracion);
const abiertos = new Map(); // shipmentId -> estado interno (solo envios abiertos)

// ---- recuperacion tras un reinicio: el estado y el reloj salen de MongoDB ----
for (const doc of await coleccion.find({ abierto: true, shipmentId: { $exists: true } }).toArray()) {
  const { _id, ...st } = doc;
  abiertos.set(st.shipmentId, st);
}
const relojGuardado = await coleccion.findOne({ _id: '__reloj__' });
reloj.restaurar(relojGuardado?.simMs);
log.info('estado-recuperado', { enviosAbiertos: abiertos.size, relojSimulado: relojGuardado ? new Date(relojGuardado.simMs).toISOString() : 'sin-datos' });

const guardar = (st) => coleccion.replaceOne({ _id: st.shipmentId }, { _id: st.shipmentId, ...st }, { upsert: true });

// ---- todo lo que toca el estado corre en serie (eventos y barrido) ----
let cola = Promise.resolve();
const serializar = (fn) => {
  const resultado = cola.then(fn);
  cola = resultado.catch(() => {});
  return resultado;
};

/**
 * Orden de operaciones (al menos una vez): publicar alertas -> persistir estado -> confirmar offset.
 * Los eventId de alerta son deterministas, asi que un reintento no genera alertas distintas.
 * Se trabaja sobre una copia: si algo falla, el estado en memoria no queda adelantado.
 */
async function confirmar(copia, alertas) {
  if (alertas.length) {
    await publicarLote(producer, TOPICS.ALERTAS, alertas);
    for (const a of alertas) log.info(a.tipo === 'ALERTA_ABIERTA' ? 'alerta-emitida' : 'alerta-cerrada', { shipmentId: a.shipmentId, regla: a.regla, prioridad: a.prioridad, eventId: a.eventId });
  }
  await guardar(copia);
  if (copia.abierto) abiertos.set(copia.shipmentId, copia);
  else abiertos.delete(copia.shipmentId);
}

const consumer = await correrConsumidor({
  grupo: GRUPOS.MONITOR_SLA,
  topics: [TOPICS.ESTADOS, TOPICS.PROMESAS],
  producer,
  log,
  manejar: ({ topic, evento: e, meta }) =>
    serializar(async () => {
      reloj.observar(aMs(e.ocurridoEn));
      const previo = abiertos.get(e.shipmentId) ?? (await coleccion.findOne({ _id: e.shipmentId })) ?? estadoMonitorNuevo(e.shipmentId);
      const { _id, ...sinId } = previo;
      const st = structuredClone(sinId);

      if (topic === TOPICS.ESTADOS) {
        if (!aplicarEventoEstado(st, e)) {
          log.warn('descartado', { eventId: e.eventId, motivo: 'secuencia-vieja-o-repetida', ...meta });
          return;
        }
      } else {
        aplicarPromesa(st, e);
      }

      const ahora = reloj.ahora();
      const alertas = st.entregado ? cerrarAlertas(st, ahora) : abrirAlertas(st, evaluar(st, ahora), ahora);
      await confirmar(st, alertas);
      log.info('estado-actualizado', { eventId: e.eventId, estado: st.estado, ...meta });
    }),
});

// ---- barrido periodico: cada "minuto simulado" se reevaluan todos los envios abiertos ----
const tickMs = Math.max(500, Math.round(60_000 / cfg.aceleracion));
let ultimoGuardadoReloj = 0;
const barrido = setInterval(() => {
  serializar(async () => {
    const ahora = reloj.ahora();
    if (ahora === null) return;
    const alertas = [];
    const copias = [];
    for (const original of abiertos.values()) {
      const pendientes = evaluar(original, ahora).filter((r) => !original.emitidas[r.regla]);
      if (!pendientes.length) continue;
      const copia = structuredClone(original);
      alertas.push(...abrirAlertas(copia, pendientes, ahora));
      copias.push(copia);
    }
    if (alertas.length) {
      await publicarLote(producer, TOPICS.ALERTAS, alertas);
      for (const a of alertas) log.info('alerta-emitida', { shipmentId: a.shipmentId, regla: a.regla, prioridad: a.prioridad, eventId: a.eventId });
      for (const copia of copias) {
        await guardar(copia);
        abiertos.set(copia.shipmentId, copia);
      }
    }
    if (Date.now() - ultimoGuardadoReloj > 5000) {
      ultimoGuardadoReloj = Date.now();
      await coleccion.replaceOne({ _id: '__reloj__' }, { _id: '__reloj__', abierto: false, simMs: reloj.simMs }, { upsert: true });
    }
  }).catch((error) => log.error('fallo-en-barrido', { error: error.message }));
}, tickMs);

alApagar(async () => {
  clearInterval(barrido);
  await consumer.disconnect();
  await producer.disconnect();
  await client.close();
});
