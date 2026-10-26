// Recuento manual e independiente para validar los 3 indicadores de analitica:
// lee envios.estados completo, cuenta los resultados de entrega unicos y compara contra metricas_diarias.
// Uso: docker compose run --rm tools src/tools/recuento.js
import { kafka } from '../common/kafka.js';
import { TOPICS } from '../common/catalogo.js';
import { conectarMongo } from '../common/mongo.js';

const admin = kafka.admin();
await admin.connect();
const fin = await admin.fetchTopicOffsets(TOPICS.ESTADOS);
await admin.disconnect();
const pendientes = new Map(fin.filter((p) => Number(p.high) > Number(p.low)).map((p) => [p.partition, Number(p.high) - 1]));

const vistos = new Set();
const esperado = {}; // "fecha|zona|franja" -> contadores
const consumer = kafka.consumer({ groupId: `recuento-${Date.now()}` });
await consumer.connect();
await consumer.subscribe({ topic: TOPICS.ESTADOS, fromBeginning: true });

await new Promise((resolver) => {
  if (pendientes.size === 0) resolver();
  consumer.run({
    eachMessage: async ({ partition, message }) => {
      try {
        const e = JSON.parse(message.value.toString());
        if ((e.tipo === 'ENTREGADO' || e.tipo === 'ENTREGA_FALLIDA') && e.eventId && !vistos.has(e.eventId) && e.zonaId && !Number.isNaN(Date.parse(e.ocurridoEn))) {
          vistos.add(e.eventId);
          const fecha = e.ocurridoEn.slice(0, 10);
          const franja = Number(e.ocurridoEn.slice(11, 13)) < 14 ? 'MANANA' : 'TARDE';
          const k = `${fecha}|${e.zonaId}|${franja}`;
          const c = (esperado[k] ??= { intentos1: 0, entregados1: 0, fallidos: 0, entregados: 0, AUSENTE: 0, DIRECCION_INCORRECTA: 0, RECHAZADO: 0, ZONA_INACCESIBLE: 0 });
          const primero = (e.intento ?? 1) === 1;
          if (primero) c.intentos1++;
          if (e.tipo === 'ENTREGADO') {
            c.entregados++;
            if (primero) c.entregados1++;
          } else {
            c.fallidos++;
            c[e.motivo]++;
          }
        }
      } catch {
        /* evento malformado: ya va a la DLQ, no cuenta */
      }
      if (pendientes.get(partition) !== undefined && Number(message.offset) >= pendientes.get(partition)) {
        pendientes.delete(partition);
        if (pendientes.size === 0) resolver();
      }
    },
  });
});
await consumer.disconnect();

const { client, db } = await conectarMongo();
const docs = await db.collection('metricas_diarias').find({}).toArray();
let diferencias = 0;
const claves = new Set([...Object.keys(esperado), ...docs.map((d) => `${d.fecha}|${d.zonaId}|${d.franja}`)]);
for (const k of claves) {
  const [fecha, zonaId, franja] = k.split('|');
  const d = docs.find((x) => x.fecha === fecha && x.zonaId === zonaId && x.franja === franja) ?? {};
  const e = esperado[k] ?? {};
  const pares = [
    ['intentos1', d.intentos1 ?? 0, e.intentos1 ?? 0],
    ['entregados1', d.entregados1 ?? 0, e.entregados1 ?? 0],
    ['fallidos', d.fallidos ?? 0, e.fallidos ?? 0],
    ['entregados', d.entregados ?? 0, e.entregados ?? 0],
    ...['AUSENTE', 'DIRECCION_INCORRECTA', 'RECHAZADO', 'ZONA_INACCESIBLE'].map((m) => [m, d.motivos?.[m] ?? 0, e[m] ?? 0]),
  ];
  for (const [campo, enMongo, recontado] of pares) {
    if (enMongo !== recontado) {
      diferencias++;
      console.log(`DIFERENCIA ${k} ${campo}: mongo=${enMongo} recuento=${recontado}`);
    }
  }
}
console.log(`\nResultados unicos recontados: ${vistos.size} | celdas (dia, zona, franja): ${claves.size}`);
console.log(diferencias === 0 ? 'OK: metricas_diarias coincide con el recuento manual.' : `Hay ${diferencias} diferencias (si el sistema aun esta procesando, espera a que el lag llegue a 0 y repeti).`);
await client.close();
process.exit(diferencias === 0 ? 0 : 2);
