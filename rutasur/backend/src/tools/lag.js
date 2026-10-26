// Lag de cada grupo de consumidores: mensajes publicados que el grupo todavia no proceso.
// Uso: node src/tools/lag.js [--watch]
import { kafka } from '../common/kafka.js';
import { GRUPOS } from '../common/catalogo.js';

const admin = kafka.admin();
await admin.connect();

async function medir() {
  const filas = [];
  const totales = {};
  for (const grupo of Object.values(GRUPOS)) {
    let offsets;
    try {
      offsets = await admin.fetchOffsets({ groupId: grupo });
    } catch {
      continue;
    }
    for (const t of offsets) {
      const fin = new Map((await admin.fetchTopicOffsets(t.topic)).map((p) => [p.partition, p]));
      for (const p of t.partitions) {
        const f = fin.get(p.partition);
        const comprometido = Number(p.offset);
        const lag = comprometido < 0 ? Number(f.high) - Number(f.low) : Number(f.high) - comprometido;
        totales[grupo] = (totales[grupo] ?? 0) + lag;
        filas.push({ grupo, topic: t.topic, particion: p.partition, offset: comprometido < 0 ? '-' : comprometido, fin: Number(f.high), lag });
      }
    }
  }
  console.log(`\n=== Lag por grupo (${new Date().toLocaleTimeString()}) ===`);
  console.table(filas);
  console.log('Lag total por grupo:', totales);
}

if (process.argv.includes('--watch')) {
  for (;;) {
    await medir();
    await new Promise((r) => setTimeout(r, 2000));
  }
} else {
  await medir();
  await admin.disconnect();
}
