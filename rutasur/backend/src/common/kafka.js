import { Kafka, Partitioners, logLevel } from 'kafkajs';
import { cfg } from './config.js';
import { TOPICS } from './catalogo.js';

export const kafka = new Kafka({
  clientId: cfg.servicio,
  brokers: cfg.kafkaBrokers,
  logLevel: logLevel.ERROR,
  retry: { initialRetryTime: 300, retries: 15 },
});

/** Productor idempotente (sin duplicados por reintentos internos del cliente). */
export async function crearProducer() {
  const producer = kafka.producer({
    createPartitioner: Partitioners.DefaultPartitioner,
    idempotent: true,
    maxInFlightRequests: 1,
    allowAutoTopicCreation: false,
  });
  await producer.connect();
  return producer;
}

/** La clave de particion es SIEMPRE el shipmentId: garantiza el orden de los eventos de un mismo paquete. */
export const mensaje = (evento) => ({ key: evento.shipmentId, value: JSON.stringify(evento) });

export const publicar = (producer, topic, evento) => producer.send({ topic, messages: [mensaje(evento)] });

export async function publicarLote(producer, topic, eventos) {
  if (!eventos.length) return;
  await producer.send({ topic, messages: eventos.map(mensaje) });
}

/** Dead letter queue: cualquier consumidor deja aca lo que no pudo procesar, con el motivo. */
export async function enviarADlq(producer, { consumidor, topic, partition, offset, clave, motivo, valor }) {
  await producer.send({
    topic: TOPICS.DLQ,
    messages: [
      {
        key: clave ?? 'sin-clave',
        value: JSON.stringify({
          consumidor,
          motivo,
          origen: { topic, partition, offset },
          valorOriginal: (valor ?? '').slice(0, 2000),
          registradoEn: new Date().toISOString(),
        }),
      },
    ],
  });
}
