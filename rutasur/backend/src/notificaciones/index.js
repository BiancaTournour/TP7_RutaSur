// Servicio de notificaciones (CU2/CU3): registra (simula) el aviso al destinatario ante fallos y alertas.
import { crearLog } from '../common/log.js';
import { GRUPOS, TOPICS } from '../common/catalogo.js';
import { conectarMongo, asegurarIndices } from '../common/mongo.js';
import { crearProducer, publicar } from '../common/kafka.js';
import { correrConsumidor, alApagar } from '../common/consumidor.js';
import { yaProcesado, marcarProcesado } from '../common/idempotencia.js';
import { opcionesParaReprogramar } from '../common/reglas.js';

const log = crearLog('notificaciones');
const { client, db } = await conectarMongo();
await asegurarIndices(db);
const producer = await crearProducer();

const base = (e) => ({
  shipmentId: e.shipmentId,
  tipo: 'NOTIFICACION_ENVIADA',
  ocurridoEn: e.ocurridoEn,
  secuencia: e.secuencia,
  hubId: e.hubId,
  zonaId: e.zonaId,
  repartidorId: null,
  version: 1,
  canal: 'SIMULADO', // no se envian correos ni SMS reales: se registra la notificacion
});

function construir(topic, e) {
  if (topic === TOPICS.ESTADOS && e.tipo === 'ENTREGA_FALLIDA') {
    return {
      ...base(e),
      eventId: `notif:${e.eventId}`,
      motivo: 'ENTREGA_FALLIDA',
      mensaje: `No pudimos entregar tu envio ${e.shipmentId} (${e.motivo}). Elegi cuando reprogramar.`,
      opcionesReprogramar: opcionesParaReprogramar(e.ocurridoEn),
    };
  }
  if (topic === TOPICS.ALERTAS && e.tipo === 'ALERTA_ABIERTA') {
    return {
      ...base(e),
      eventId: `notif:${e.eventId}`,
      motivo: 'ALERTA_SLA',
      mensaje: `Tu envio ${e.shipmentId} podria demorarse mas de lo prometido. Estamos trabajando para resolverlo.`,
      opcionesReprogramar: [],
    };
  }
  return null;
}

const consumer = await correrConsumidor({
  grupo: GRUPOS.NOTIFICACIONES,
  topics: [TOPICS.ESTADOS, TOPICS.ALERTAS],
  producer,
  log,
  manejar: async ({ topic, evento: e, meta }) => {
    const notificacion = construir(topic, e);
    if (!notificacion) return;
    if (await yaProcesado(db, GRUPOS.NOTIFICACIONES, e.eventId)) {
      log.info('duplicado-ignorado', { eventId: e.eventId, ...meta });
      return;
    }
    await publicar(producer, TOPICS.NOTIFICACIONES, notificacion);
    await marcarProcesado(db, GRUPOS.NOTIFICACIONES, e.eventId);
    log.info('notificacion-registrada', { eventId: e.eventId, shipmentId: e.shipmentId, motivo: notificacion.motivo, ...meta });
  },
});

alApagar(async () => {
  await consumer.disconnect();
  await producer.disconnect();
  await client.close();
});
