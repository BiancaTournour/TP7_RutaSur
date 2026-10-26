// Muestra lo que hay en envios.estados.dlq (revision manual). Se queda escuchando; Ctrl+C para salir.
import { kafka } from '../common/kafka.js';
import { TOPICS } from '../common/catalogo.js';

const consumer = kafka.consumer({ groupId: `revision-dlq-${Date.now()}` });
await consumer.connect();
await consumer.subscribe({ topic: TOPICS.DLQ, fromBeginning: true });
console.log(`Leyendo ${TOPICS.DLQ} desde el principio (Ctrl+C para salir)...\n`);
await consumer.run({
  eachMessage: async ({ partition, message }) => {
    let d;
    try {
      d = JSON.parse(message.value.toString());
    } catch {
      d = { crudo: message.value.toString() };
    }
    console.log(`[p${partition} o${message.offset}] envio=${message.key} consumidor=${d.consumidor}`);
    console.log(`   motivo : ${d.motivo}`);
    console.log(`   origen : ${d.origen?.topic} p${d.origen?.partition} o${d.origen?.offset}`);
    console.log(`   valor  : ${d.valorOriginal}\n`);
  },
});
