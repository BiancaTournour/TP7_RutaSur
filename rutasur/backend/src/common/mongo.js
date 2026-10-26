import { MongoClient } from 'mongodb';
import { cfg } from './config.js';

export async function conectarMongo() {
  const client = new MongoClient(cfg.mongoUri, { serverSelectionTimeoutMS: 30_000 });
  await client.connect();
  return { client, db: client.db(cfg.mongoDb) };
}

/** Indices del modelo de datos. Se crean desde cualquier servicio (es idempotente). */
export async function asegurarIndices(db) {
  await db.collection('envios').createIndex({ shipmentId: 1 }, { unique: true });
  await db.collection('envios').createIndex({ estado: 1, zonaId: 1 });
  await db.collection('envios').createIndex({ 'promesa.venceEn': 1 });
  await db.collection('envios').createIndex({ ultimoEventoEn: -1 });
  await db.collection('alertas').createIndex({ estado: 1, prioridad: 1 });
  await db.collection('alertas').createIndex({ shipmentId: 1 });
  await db.collection('notificaciones').createIndex({ shipmentId: 1 });
  await db.collection('metricas_diarias').createIndex({ fecha: 1, zonaId: 1, franja: 1 }, { unique: true });
  await db.collection('eventos_procesados').createIndex({ consumidor: 1, eventId: 1 }, { unique: true });
  await db.collection('eventos_procesados').createIndex({ en: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });
  await db.collection('monitor_sla_estado').createIndex({ abierto: 1 });
  await db.collection('tiempos_hub_estado').createIndex({ ingresoMs: 1 });
}
