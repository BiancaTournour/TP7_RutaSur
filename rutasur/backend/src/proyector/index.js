// Proyector (CQRS, lado de lectura): consume los eventos y mantiene envios, alertas y notificaciones en MongoDB.
// Cada evento se aplica junto con su marca de "procesado" en una transaccion -> idempotente.
import { crearLog } from '../common/log.js';
import { GRUPOS, TOPICS } from '../common/catalogo.js';
import { conectarMongo, asegurarIndices } from '../common/mongo.js';
import { crearProducer } from '../common/kafka.js';
import { correrConsumidor, alApagar } from '../common/consumidor.js';
import { unaVez } from '../common/idempotencia.js';
import { aplicarEstado, aplicarDisposicion, aplicarAlerta, docNotificacion } from '../common/proyeccion.js';

const log = crearLog('proyector');
const { client, db } = await conectarMongo();
await asegurarIndices(db);
const producer = await crearProducer();

async function actualizarEnvio(session, reducir, evento, meta) {
  const col = db.collection('envios');
  const existente = await col.findOne({ shipmentId: evento.shipmentId }, { session });
  // Sin el _id: los reductores clonan el documento, y el replaceOne conserva el _id original del documento
  const { _id, ...actual } = existente ?? {};
  const r = reducir(existente ? actual : null, evento);
  if (!r.aplicado) {
    log.warn('descartado', { eventId: evento.eventId, motivo: r.motivo, ...meta });
    return;
  }
  await col.replaceOne({ shipmentId: evento.shipmentId }, r.doc, { upsert: true, session });
}

const consumer = await correrConsumidor({
  grupo: GRUPOS.PROYECTOR,
  topics: [TOPICS.ESTADOS, TOPICS.REPROGRAMACIONES, TOPICS.ALERTAS, TOPICS.NOTIFICACIONES],
  producer,
  log,
  manejar: async ({ topic, evento, meta }) => {
    const aplicado = await unaVez(client, db, GRUPOS.PROYECTOR, evento.eventId, async (session) => {
      switch (topic) {
        case TOPICS.ESTADOS:
          return actualizarEnvio(session, aplicarEstado, evento, meta);
        case TOPICS.REPROGRAMACIONES:
          return actualizarEnvio(session, aplicarDisposicion, evento, meta);
        case TOPICS.ALERTAS: {
          const col = db.collection('alertas');
          const actual = await col.findOne({ _id: `${evento.shipmentId}:${evento.regla}` }, { session });
          return col.replaceOne({ _id: `${evento.shipmentId}:${evento.regla}` }, aplicarAlerta(actual, evento), { upsert: true, session });
        }
        case TOPICS.NOTIFICACIONES: {
          const doc = docNotificacion(evento);
          return db.collection('notificaciones').replaceOne({ _id: doc._id }, doc, { upsert: true, session });
        }
      }
    });
    log.info(aplicado ? 'aplicado' : 'duplicado-ignorado', { eventId: evento.eventId, tipo: evento.tipo, ...meta });
  },
});

alApagar(async () => {
  await consumer.disconnect();
  await producer.disconnect();
  await client.close();
});
