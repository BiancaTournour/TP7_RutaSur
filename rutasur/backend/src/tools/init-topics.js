// Crea los 6 topics del catalogo con su retencion. Corre una vez al levantar el entorno (servicio kafka-init).
import { kafka } from '../common/kafka.js';
import { TOPICS } from '../common/catalogo.js';
import { DIA } from '../common/calendario.js';

const retencion = (dias) => ({ 'retention.ms': String(dias * DIA) });
const definiciones = [
  { topic: TOPICS.ESTADOS, particiones: 3, config: retencion(30) }, // 3 particiones: reparto de carga y rebalanceo
  { topic: TOPICS.PROMESAS, particiones: 3, config: { 'cleanup.policy': 'compact', 'segment.ms': '60000', 'min.cleanable.dirty.ratio': '0.1' } },
  { topic: TOPICS.REPROGRAMACIONES, particiones: 1, config: retencion(30) },
  { topic: TOPICS.ALERTAS, particiones: 1, config: retencion(7) },
  { topic: TOPICS.NOTIFICACIONES, particiones: 1, config: retencion(7) },
  { topic: TOPICS.DLQ, particiones: 1, config: retencion(30) },
];

const admin = kafka.admin();
await admin.connect();
const creados = await admin.createTopics({
  waitForLeaders: true,
  topics: definiciones.map((d) => ({
    topic: d.topic,
    numPartitions: d.particiones,
    replicationFactor: 1,
    configEntries: Object.entries(d.config).map(([name, value]) => ({ name, value })),
  })),
});
console.log(creados ? 'Topics creados:' : 'Los topics ya existian:');
for (const d of definiciones) console.log(` - ${d.topic} (${d.particiones} particion/es)`);
await admin.disconnect();
