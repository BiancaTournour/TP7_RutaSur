// Reconstruccion de las vistas del proyector (requisito: "borrar una coleccion y reprocesar el topic deja el mismo resultado").
//   1) docker compose stop proyector
//   2) docker compose run --rm tools src/tools/reconstruir.js
//   3) docker compose start proyector        (el grupo vuelve a leer los topics desde el offset 0)
//   4) docker compose run --rm tools src/tools/checksum.js   -> misma huella que antes
import { kafka } from '../common/kafka.js';
import { GRUPOS, TOPICS } from '../common/catalogo.js';
import { conectarMongo } from '../common/mongo.js';
import { huellas } from './checksum.js';

const admin = kafka.admin();
await admin.connect();
const { groups } = await admin.describeGroups([GRUPOS.PROYECTOR]);
if (groups[0]?.members?.length) {
  console.error('El proyector sigue activo. Detenelo primero: docker compose stop proyector');
  process.exit(1);
}

const { client, db } = await conectarMongo();
console.log('Huella ANTES de borrar:');
console.table(await huellas(db));

for (const nombre of ['envios', 'alertas', 'notificaciones']) await db.collection(nombre).deleteMany({});
await db.collection('eventos_procesados').deleteMany({ consumidor: GRUPOS.PROYECTOR });
console.log('Colecciones envios, alertas y notificaciones vaciadas; marcas de idempotencia del proyector borradas.');

for (const topic of [TOPICS.ESTADOS, TOPICS.REPROGRAMACIONES, TOPICS.ALERTAS, TOPICS.NOTIFICACIONES]) {
  await admin.resetOffsets({ groupId: GRUPOS.PROYECTOR, topic, earliest: true });
}
console.log('Offsets del grupo "proyector" reiniciados al principio de cada topic.');
console.log('Ahora: docker compose start proyector');
await admin.disconnect();
await client.close();
