// Huella (SHA-256) del contenido de las vistas de lectura. Sirve para demostrar que borrar y reprocesar
// deja las colecciones en el mismo estado. Uso: node src/tools/checksum.js
import { createHash } from 'node:crypto';
import { conectarMongo } from '../common/mongo.js';

const canonico = (v) => {
  if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonico(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
};

export async function huellas(db) {
  const resultado = {};
  for (const nombre of ['envios', 'alertas', 'notificaciones']) {
    const docs = await db.collection(nombre).find({}, { projection: { _id: 0 } }).toArray();
    const lineas = docs.map(canonico).sort();
    resultado[nombre] = { documentos: docs.length, sha256: createHash('sha256').update(lineas.join('\n')).digest('hex').slice(0, 16) };
  }
  return resultado;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { client, db } = await conectarMongo();
  console.table(await huellas(db));
  await client.close();
}
