import { Kafka, logLevel } from 'kafkajs';

const BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');

export function crearKafka(clientId) {
  return new Kafka({ clientId, brokers: BROKERS, logLevel: logLevel.WARN });
}

/** Publica un evento usando shipmentId como clave de partición. */
export async function publicar(productor, topic, evento) {
  await productor.send({
    topic,
    messages: [{ key: evento.shipmentId, value: JSON.stringify(evento) }],
  });
}

/** Publica en la DLQ el mensaje original junto con el motivo del rechazo. */
export async function enviarADlq(productor, { topicOrigen, valorCrudo, clave, motivo, grupo }) {
  await productor.send({
    topic: 'envios.estados.dlq',
    messages: [{
      key: clave,
      value: JSON.stringify({
        motivo,
        grupo,
        topicOrigen,
        recibidoEn: new Date().toISOString(),
        original: valorCrudo,
      }),
    }],
  });
}