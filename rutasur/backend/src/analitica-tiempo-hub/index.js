// Cuarto indicador (demo de reprocesamiento): tiempo medio entre INGRESADO_HUB y EN_REPARTO por hub.
// Es un grupo de consumidores NUEVO que lee envios.estados DESDE EL PRINCIPIO: completa el historico
// (la retencion del log es de 30 dias) sin tocar ni reiniciar los demas servicios.
import { crearLog } from '../common/log.js';
import { GRUPOS, TOPICS } from '../common/catalogo.js';
import { conectarMongo, asegurarIndices } from '../common/mongo.js';
import { crearProducer } from '../common/kafka.js';
import { correrConsumidor, alApagar } from '../common/consumidor.js';
import { unaVez } from '../common/idempotencia.js';
import { aMs, fechaDe, franjaDe } from '../common/calendario.js';

const log = crearLog('analitica-tiempo-hub');
const { client, db } = await conectarMongo();
await asegurarIndices(db);
const producer = await crearProducer();

const consumer = await correrConsumidor({
  grupo: GRUPOS.ANALITICA_TIEMPO_HUB,
  topics: [TOPICS.ESTADOS],
  desdeElPrincipio: true,
  producer,
  log,
  manejar: async ({ evento: e, meta }) => {
    const t = aMs(e.ocurridoEn);
    const estados = db.collection('tiempos_hub_estado');

    if (e.tipo === 'INGRESADO_HUB') {
      await unaVez(client, db, GRUPOS.ANALITICA_TIEMPO_HUB, e.eventId, (session) =>
        estados.updateOne({ _id: e.shipmentId }, { $min: { ingresoMs: t }, $setOnInsert: { contado: false } }, { upsert: true, session }),
      );
      return;
    }

    if (e.tipo === 'EN_REPARTO' && (e.intento ?? 1) === 1) {
      const aplicado = await unaVez(client, db, GRUPOS.ANALITICA_TIEMPO_HUB, e.eventId, async (session) => {
        const st = await estados.findOne({ _id: e.shipmentId }, { session });
        if (!st || st.contado || st.ingresoMs == null || t < st.ingresoMs) return;
        await estados.updateOne({ _id: e.shipmentId }, { $set: { contado: true } }, { session });
        await db.collection('metricas_diarias').updateOne(
          { fecha: fechaDe(t), zonaId: e.zonaId, franja: franjaDe(t) },
          { $inc: { 'tiempoHub.n': 1, 'tiempoHub.sumaMs': t - st.ingresoMs }, $setOnInsert: { hubId: e.hubId } },
          { upsert: true, session },
        );
      });
      if (aplicado) log.info('tiempo-hub-sumado', { eventId: e.eventId, hub: e.hubId, ...meta });
    }
  },
});

alApagar(async () => {
  await consumer.disconnect();
  await producer.disconnect();
  await client.close();
});
