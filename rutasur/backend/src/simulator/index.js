// Simulador de eventos: reemplaza a los sistemas de origen (deposito, app del repartidor, comercio).
// Publica envios.estados y envios.promesas. No consume nada. Tiene una API HTTP para disparar escenarios en la demo.
import http from 'node:http';
import { cfg, simCfg } from '../common/config.js';
import { crearLog } from '../common/log.js';
import { crearProducer } from '../common/kafka.js';
import { alApagar } from '../common/consumidor.js';
import { iso } from '../common/calendario.js';
import { crearRng } from './rng.js';
import { planificarEnvio, mensajeMalformadoSuelto } from './planificador.js';

const log = crearLog('simulador');
const producer = await crearProducer();

const inicioReal = Date.now();
/** Reloj simulado: 1 hora simulada = 30 s reales con ACELERACION=120. */
const simAhora = () => cfg.simInicio + (Date.now() - inicioReal) * cfg.aceleracion;

// ---- cola de mensajes ordenada por instante de emision (min-heap) ----
const heap = [];
const subir = (i) => {
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heap[p].atMs <= heap[i].atMs) break;
    [heap[p], heap[i]] = [heap[i], heap[p]];
    i = p;
  }
};
const bajar = (i) => {
  for (;;) {
    const l = 2 * i + 1;
    const r = l + 1;
    let m = i;
    if (l < heap.length && heap[l].atMs < heap[m].atMs) m = l;
    if (r < heap.length && heap[r].atMs < heap[m].atMs) m = r;
    if (m === i) break;
    [heap[m], heap[i]] = [heap[i], heap[m]];
    i = m;
  }
};
const encolar = (m) => {
  heap.push(m);
  subir(heap.length - 1);
};
const sacar = () => {
  const tope = heap[0];
  const ultimo = heap.pop();
  if (heap.length) {
    heap[0] = ultimo;
    bajar(0);
  }
  return tope;
};

// ---- estado del simulador ----
let activo = true;
let siguiente = 0; // numero del proximo envio del flujo continuo
let ocupado = false;
const contadores = { envios: 0, rafagas: 0, escenarios: {} };
const emitidos = {};
const msPorEnvio = () => (60_000 / simCfg.enviosPorMinuto) * cfg.aceleracion; // tiempo simulado entre envios

const idContinuo = (n) => `ENV-${String(n + 1).padStart(6, '0')}`;

function agendar(plan) {
  for (const m of plan.mensajes) encolar(m);
  contadores.envios += 1;
}

function crearEnvioContinuo(n) {
  const shipmentId = idContinuo(n);
  const creadoMs = cfg.simInicio + n * msPorEnvio(); // determinista: depende solo del numero de envio
  agendar(planificarEnvio({ shipmentId, rng: crearRng(`${simCfg.semilla}:${n}`), creadoMs, cfg: simCfg }));
}

async function enviar(lote) {
  const porTopic = new Map();
  for (const m of lote) {
    if (!porTopic.has(m.topic)) porTopic.set(m.topic, []);
    porTopic.get(m.topic).push({ key: m.clave, value: m.valor });
    emitidos[m.stat] = (emitidos[m.stat] ?? 0) + 1;
  }
  await producer.sendBatch({ topicMessages: [...porTopic].map(([topic, messages]) => ({ topic, messages })) });
}

async function ciclo() {
  if (ocupado) return;
  ocupado = true;
  try {
    const ahora = simAhora();
    if (activo) {
      while (cfg.simInicio + siguiente * msPorEnvio() <= ahora) crearEnvioContinuo(siguiente++);
    }
    const lote = [];
    while (heap.length && heap[0].atMs <= ahora) lote.push(sacar());
    for (let i = 0; i < lote.length; i += 500) await enviar(lote.slice(i, i + 500));
    if (lote.length) log.info('emitidos', { mensajes: lote.length, pendientes: heap.length, simulado: iso(ahora) });
  } catch (error) {
    log.error('fallo-al-emitir', { error: error.message });
  } finally {
    ocupado = false;
  }
}
const temporizador = setInterval(ciclo, 200);

// ---- escenarios a pedido (demo) ----
const SIN_ANOMALIAS = { sinAnomalias: true, rapido: true };
const ESCENARIOS = {
  feliz: { prefijo: 'FELIZ', opciones: { ...SIN_ANOMALIAS, resultados: ['ENTREGADO'] } },
  ausente: { prefijo: 'AUSENTE', opciones: { ...SIN_ANOMALIAS, resultados: ['AUSENTE', 'ENTREGADO'] } },
  'tercer-fallo': { prefijo: 'FALLO3', opciones: { ...SIN_ANOMALIAS, resultados: ['AUSENTE', 'AUSENTE', 'AUSENTE'] } },
  // promesa en 4,5 h simuladas y el envio no sale del hub: SIN_SALIDA (alta) a los ~15 s reales, VENCIDO a los ~2 min
  demorado: { prefijo: 'DEMORADO', opciones: { ...SIN_ANOMALIAS, soloHastaHub: true, horasPromesa: 4.5 } },
};

function lanzarEscenario(nombre) {
  const n = (contadores.escenarios[nombre] = (contadores.escenarios[nombre] ?? 0) + 1);
  const ahora = simAhora();

  if (nombre === 'malformado') {
    const shipmentId = `ENV-DEMO-MALFORMADO-${n}`;
    encolar(mensajeMalformadoSuelto(shipmentId, ahora));
    return { shipmentIds: [shipmentId], detalle: 'Evento malformado publicado: debe terminar en envios.estados.dlq' };
  }
  if (nombre === 'rafaga') {
    contadores.rafagas += 1;
    const ids = [];
    for (let i = 1; i <= 500; i++) {
      const shipmentId = `ENV-RAF${contadores.rafagas}-${String(i).padStart(4, '0')}`;
      const creadoMs = ahora + i * 10; // 500 envios en pocos segundos
      agendar(
        planificarEnvio({
          shipmentId,
          rng: crearRng(`${simCfg.semilla}:rafaga:${contadores.rafagas}:${i}`),
          creadoMs,
          cfg: simCfg,
          opciones: { inmediato: true },
        }),
      );
      if (i <= 3) ids.push(shipmentId);
    }
    return { shipmentIds: ids, detalle: '500 envios programados (ejemplos arriba)' };
  }
  const def = ESCENARIOS[nombre];
  if (!def) return null;
  const shipmentId = `ENV-DEMO-${def.prefijo}-${n}`;
  const plan = planificarEnvio({
    shipmentId,
    rng: crearRng(`${simCfg.semilla}:demo:${nombre}:${n}`),
    creadoMs: ahora,
    cfg: simCfg,
    opciones: def.opciones,
  });
  agendar(plan);
  return { shipmentIds: [shipmentId], promesaVenceEn: plan.promesaVenceEn, detalle: `Escenario "${nombre}" iniciado` };
}

// ---- API HTTP de control ----
const responder = (res, codigo, cuerpo) => {
  res.writeHead(codigo, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(cuerpo));
};

const servidor = http.createServer((req, res) => {
  const ruta = req.url.split('?')[0];
  if (req.method === 'GET' && ruta === '/health') return responder(res, 200, { ok: true });
  if (req.method === 'GET' && ruta === '/estado') {
    return responder(res, 200, {
      flujoActivo: activo,
      aceleracion: cfg.aceleracion,
      relojSimulado: iso(simAhora()),
      semilla: simCfg.semilla,
      enviosPorMinuto: simCfg.enviosPorMinuto,
      enviosCreados: contadores.envios,
      mensajesPendientes: heap.length,
      emitidosPorTipo: emitidos,
    });
  }
  if (req.method === 'POST' && ruta === '/flujo/pausar') {
    activo = false;
    return responder(res, 200, { flujoActivo: activo });
  }
  if (req.method === 'POST' && ruta === '/flujo/reanudar') {
    activo = true;
    return responder(res, 200, { flujoActivo: activo });
  }
  const m = ruta.match(/^\/escenarios\/([a-z-]+)$/);
  if (req.method === 'POST' && m) {
    const resultado = lanzarEscenario(m[1]);
    if (!resultado) return responder(res, 404, { ok: false, error: `escenario desconocido: ${m[1]}` });
    log.info('escenario-lanzado', { escenario: m[1], envios: resultado.shipmentIds.join(',') });
    return responder(res, 200, { ok: true, escenario: m[1], ...resultado });
  }
  return responder(res, 404, { ok: false, error: 'ruta no encontrada' });
});
servidor.listen(cfg.puertoSimulador, () =>
  log.info('simulador-listo', { puerto: cfg.puertoSimulador, aceleracion: cfg.aceleracion, enviosPorMinuto: simCfg.enviosPorMinuto, semilla: simCfg.semilla }),
);

alApagar(async () => {
  clearInterval(temporizador);
  servidor.close();
  await producer.disconnect();
});
