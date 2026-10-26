// Puente change streams (MongoDB) -> SSE. Un unico juego de change streams compartido por todos los clientes.
import { EventEmitter } from 'node:events';
import { getDb } from './mongo';

const COLECCIONES = [
  ['envios', 'envio'],
  ['alertas', 'alerta'],
  ['notificaciones', 'notificacion'],
];

async function iniciar(live) {
  const db = await getDb();
  for (const [coleccion, tipo] of COLECCIONES) {
    await db.createCollection(coleccion).catch(() => {}); // si ya existe, no pasa nada; asi se puede escuchar con la base vacia
    const abrir = () => {
      // Los change streams requieren que MongoDB corra como replica set (aunque sea de un solo nodo)
      const stream = db.collection(coleccion).watch([], { fullDocument: 'updateLookup' });
      stream.on('change', (cambio) => {
        const doc = cambio.fullDocument;
        if (doc?.shipmentId) live.emisor.emit('evento', { tipo, shipmentId: doc.shipmentId });
      });
      const reabrir = () => setTimeout(abrir, 2000);
      stream.on('error', reabrir);
      stream.on('close', reabrir);
    };
    abrir();
  }
}

export async function suscribir(escucha) {
  if (!globalThis.__live) {
    globalThis.__live = { emisor: new EventEmitter() };
    globalThis.__live.emisor.setMaxListeners(0);
    await iniciar(globalThis.__live);
  }
  const { emisor } = globalThis.__live;
  emisor.on('evento', escucha);
  return () => emisor.off('evento', escucha);
}
