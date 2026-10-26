// Idempotencia por consumidor: coleccion eventos_procesados (consumidor + eventId unico, TTL 7 dias).
// Garantia de entrega "al menos una vez": un evento puede llegar dos veces, pero su efecto se aplica una sola.

/**
 * Para consumidores cuyo efecto es escribir en MongoDB: marca el evento y aplica el efecto
 * en UNA transaccion. O se hacen las dos cosas o ninguna (por eso hace falta un replica set).
 * Devuelve true si se aplico, false si el evento ya estaba procesado.
 */
export async function unaVez(client, db, consumidor, eventId, aplicar) {
  for (let intento = 1; ; intento++) {
    const session = client.startSession();
    try {
      let aplicado = false;
      await session.withTransaction(async () => {
        aplicado = false;
        const r = await db
          .collection('eventos_procesados')
          .updateOne({ consumidor, eventId }, { $setOnInsert: { consumidor, eventId, en: new Date() } }, { upsert: true, session });
        if (r.upsertedCount === 0) return; // ya procesado
        await aplicar(session);
        aplicado = true;
      });
      return aplicado;
    } catch (error) {
      if (error?.code === 11000 && intento < 4) continue; // carrera entre dos upserts: se reintenta
      throw error;
    } finally {
      await session.endSession();
    }
  }
}

/** Para consumidores cuyo efecto es publicar en Kafka: primero se publica (con eventId determinista), despues se marca. */
export async function yaProcesado(db, consumidor, eventId) {
  return Boolean(await db.collection('eventos_procesados').findOne({ consumidor, eventId }, { projection: { _id: 1 } }));
}

export async function marcarProcesado(db, consumidor, eventId) {
  try {
    await db.collection('eventos_procesados').insertOne({ consumidor, eventId, en: new Date() });
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }
}
