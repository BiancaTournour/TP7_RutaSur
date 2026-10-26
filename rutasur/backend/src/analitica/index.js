// Servicio de analitica (CU4): suma cada resultado de entrega a metricas_diarias con incrementos atomicos.
import { crearLog } from '../common/log.js';
import { GRUPOS, TOPICS } from '../common/catalogo.js';
import { conectarMongo, asegurarIndices } from '../common/mongo.js';
import { crearProducer } from '../common/kafka.js';
import { correrConsumidor, alApagar } from '../common/consumidor.js';
import { unaVez } from '../common/idempotencia.js';
import { incrementosResultado } from '../common/metricas.js';

const log = crearLog('analitica');
const { client, db } = await conectarMongo();
await asegurarIndices(db);
const producer = await crearProducer();

const consumer = await correrConsumidor({
  grupo: GRUPOS.ANALITICA,
  topics: [TOPICS.ESTADOS],
  producer,
  log,
  manejar: async ({ evento: e, meta }) => {
    if (e.tipo !== 'ENTREGADO' && e.tipo !== 'ENTREGA_FALLIDA') return;
    const { filtro, inc, hubId } = incrementosResultado(e);
    const aplicado = await unaVez(client, db, GRUPOS.ANALITICA, e.eventId, (session) =>
      db.collection('metricas_diarias').updateOne(filtro, { $inc: inc, $setOnInsert: { hubId } }, { upsert: true, session }),
    );
    log.info(aplicado ? 'metrica-incrementada' : 'duplicado-ignorado', { eventId: e.eventId, tipo: e.tipo, zona: e.zonaId, ...meta });
  },
});

alApagar(async () => {
  await consumer.disconnect();
  await producer.disconnect();
  await client.close();
});
