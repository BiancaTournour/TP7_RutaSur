// Servicio de reprogramacion (CU2): ante cada ENTREGA_FALLIDA decide el proximo paso y lo publica.
import { crearLog } from '../common/log.js';
import { GRUPOS, TOPICS } from '../common/catalogo.js';
import { conectarMongo, asegurarIndices } from '../common/mongo.js';
import { crearProducer, publicar } from '../common/kafka.js';
import { correrConsumidor, alApagar } from '../common/consumidor.js';
import { yaProcesado, marcarProcesado } from '../common/idempotencia.js';
import { decidirReprogramacion } from '../common/reglas.js';

const log = crearLog('reprogramacion');
const { client, db } = await conectarMongo();
await asegurarIndices(db);
const producer = await crearProducer();

const consumer = await correrConsumidor({
  grupo: GRUPOS.REPROGRAMACION,
  topics: [TOPICS.ESTADOS],
  producer,
  log,
  manejar: async ({ evento: e, meta }) => {
    if (e.tipo !== 'ENTREGA_FALLIDA') return;
    if (await yaProcesado(db, GRUPOS.REPROGRAMACION, e.eventId)) {
      log.info('duplicado-ignorado', { eventId: e.eventId, ...meta });
      return;
    }
    const d = decidirReprogramacion({ motivo: e.motivo, intento: e.intento ?? 1, ocurridoEn: e.ocurridoEn });
    await publicar(producer, TOPICS.REPROGRAMACIONES, {
      // eventId determinista: si el evento se reprocesa, sale el MISMO eventId y el proyector lo descarta
      eventId: `repro:${e.eventId}`,
      shipmentId: e.shipmentId,
      tipo: d.tipo,
      ocurridoEn: e.ocurridoEn,
      secuencia: e.secuencia,
      secuenciaOrigen: e.secuencia,
      hubId: e.hubId,
      zonaId: e.zonaId,
      repartidorId: e.repartidorId ?? null,
      version: 1,
      causa: d.causa,
      motivo: e.motivo,
      intento: e.intento ?? 1,
      ...(d.franja && { franja: d.franja }),
      ...(d.nuevoIntentoPara && { nuevoIntentoPara: d.nuevoIntentoPara }),
    });
    await marcarProcesado(db, GRUPOS.REPROGRAMACION, e.eventId);
    log.info('decision-publicada', { eventId: e.eventId, shipmentId: e.shipmentId, decision: d.tipo, causa: d.causa, ...meta });
  },
});

alApagar(async () => {
  await consumer.disconnect();
  await producer.disconnect();
  await client.close();
});
