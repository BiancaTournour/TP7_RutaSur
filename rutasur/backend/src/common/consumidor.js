// Envoltorio de consumidor: confirmacion MANUAL de offsets, validacion de esquema y DLQ.
// El offset se confirma recien despues de procesar el evento (y escribir en MongoDB / Kafka):
// si el proceso cae a mitad de camino, el evento se reintenta (al menos una vez).
import { kafka, enviarADlq } from './kafka.js';
import { parsearMensaje } from './validacion.js';

export async function correrConsumidor({ grupo, topics, desdeElPrincipio = false, producer, log, manejar }) {
  const consumer = kafka.consumer({ groupId: grupo, allowAutoTopicCreation: false, sessionTimeout: 30_000, heartbeatInterval: 3_000 });
  await consumer.connect();
  for (const topic of topics) await consumer.subscribe({ topic, fromBeginning: desdeElPrincipio });

  await consumer.run({
    autoCommit: false,
    eachMessage: async ({ topic, partition, message }) => {
      const meta = { topic, partition, offset: message.offset };
      const clave = message.key ? message.key.toString() : 'sin-clave';
      const r = parsearMensaje(topic, message.value);
      if (!r.ok) {
        await enviarADlq(producer, { consumidor: grupo, ...meta, clave, motivo: r.motivo, valor: r.texto });
        log.warn('enviado-a-dlq', { ...meta, clave, motivo: r.motivo.slice(0, 90) });
      } else {
        await manejar({ topic, evento: r.evento, meta });
      }
      await consumer.commitOffsets([{ topic, partition, offset: (BigInt(message.offset) + 1n).toString() }]);
    },
  });

  log.info('consumidor-iniciado', { grupo, topics: topics.join(',') });
  return consumer;
}

/** Cierre ordenado ante SIGTERM/SIGINT (docker stop). */
export function alApagar(fn) {
  let cerrando = false;
  const cerrar = async () => {
    if (cerrando) return;
    cerrando = true;
    try {
      await fn();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', cerrar);
  process.on('SIGINT', cerrar);
}
