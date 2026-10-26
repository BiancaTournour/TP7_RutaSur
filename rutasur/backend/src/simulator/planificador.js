// Planifica el ciclo de vida completo de UN envio como una lista de mensajes con su instante de emision.
// Es una funcion pura: (semilla, numero de envio) -> mismo plan. Asi la corrida es reproducible.
import { TOPICS, ZONAS, HUBS } from '../common/catalogo.js';
import { MIN, HORA, iso, aMs, franjaDe, proximaHora } from '../common/calendario.js';
import { decidirReprogramacion } from '../common/reglas.js';

const ES_DE_REPARTIDOR = ['EN_REPARTO', 'ENTREGADO', 'ENTREGA_FALLIDA'];

function variantesMalformadas(rng, shipmentId, base, n) {
  const variantes = [
    () => JSON.stringify(base).slice(0, 45), // JSON cortado
    () => JSON.stringify({ ...base, eventId: `${shipmentId}:X${n}`, tipo: 'VOLANDO' }), // tipo inexistente
    () => JSON.stringify({ ...base, eventId: undefined }), // sin eventId
    () => JSON.stringify({ ...base, eventId: `${shipmentId}:X${n}`, secuencia: 'tres' }), // secuencia no numerica
    () => JSON.stringify({ ...base, eventId: `${shipmentId}:X${n}`, tipo: 'ENTREGA_FALLIDA', motivo: undefined }), // falla sin motivo
  ];
  return rng.pick(variantes)();
}

/**
 * opciones:
 *  rapido        compacta tiempos y reintentos (escenarios de demo)
 *  horasPromesa  fuerza el plazo de la promesa
 *  resultados    resultado forzado por intento: ['AUSENTE', 'ENTREGADO', ...]
 *  soloHastaHub  el envio queda detenido en el hub (escenario "demorado")
 *  inmediato     los primeros eventos salen ya (rafaga)
 *  sinAnomalias  sin duplicados, desorden, malformados ni demora de hub
 */
export function planificarEnvio({ shipmentId, rng, creadoMs, cfg, opciones = {} }) {
  const { rapido = false, horasPromesa, resultados = [], soloHastaHub = false, inmediato = false, sinAnomalias = false } = opciones;

  const zona = rng.pick(ZONAS);
  const hubId = zona.hubId;
  const repartidorId = `R-${HUBS.indexOf(hubId) + 1}${String(rng.int(1, 40)).padStart(2, '0')}`;
  const promesaMs = creadoMs + Math.round((horasPromesa ?? rng.int(28, 40)) * HORA);

  // ---- 1) linea de tiempo del mundo real (ocurridoEn) ----
  const eventos = [];
  const agregar = (tipo, ocurridoMs, extra = {}) => eventos.push({ tipo, ocurridoMs, secuencia: eventos.length + 1, extra });

  agregar('CREADO', creadoMs, { promesaVenceEn: iso(promesaMs) });
  const demoraHub = !sinAnomalias && !rapido && rng.chance(cfg.probDemoraHub);
  let tIngreso;
  if (inmediato) tIngreso = creadoMs + 20_000;
  else if (rapido) tIngreso = creadoMs + (soloHastaHub ? 2 : 10) * MIN;
  else tIngreso = creadoMs + (demoraHub ? rng.int(16 * 60, 22 * 60) : rng.int(60, 180)) * MIN;
  agregar('INGRESADO_HUB', tIngreso);

  if (!soloHastaHub) {
    const tClasificado = inmediato ? tIngreso + 20_000 : tIngreso + (rapido ? 10 : rng.int(30, 90)) * MIN;
    agregar('CLASIFICADO', tClasificado, { intento: 1 });
    let salida = rapido
      ? tClasificado + 10 * MIN
      : proximaHora(Math.max(tClasificado + 30 * MIN, creadoMs + 10 * HORA), rng.pick([9, 15]));
    let intento = 1;
    for (;;) {
      agregar('EN_REPARTO', salida, { intento });
      const resultadoMs = salida + (rapido ? 20 : rng.int(120, 240)) * MIN;
      const forzado = resultados[intento - 1];
      let falla;
      let motivo;
      if (forzado) {
        falla = forzado !== 'ENTREGADO';
        motivo = falla ? forzado : undefined;
      } else {
        const p = Math.min(0.6, zona.tasaFallo * (franjaDe(resultadoMs) === 'TARDE' ? cfg.factorTarde : 1));
        falla = rng.chance(p);
        if (falla) motivo = rng.weighted(cfg.motivosPesos);
      }
      if (!falla) {
        agregar('ENTREGADO', resultadoMs, { intento, promesaVenceEn: iso(promesaMs) });
        break;
      }
      agregar('ENTREGA_FALLIDA', resultadoMs, { intento, motivo, promesaVenceEn: iso(promesaMs) });
      const decision = decidirReprogramacion({ motivo, intento, ocurridoEn: iso(resultadoMs) });
      if (decision.tipo !== 'REPROGRAMADO') break; // retenido o devuelto: sale del circuito
      intento += 1;
      salida = rapido ? resultadoMs + HORA : aMs(decision.nuevoIntentoPara);
      agregar('CLASIFICADO', rapido ? resultadoMs + 30 * MIN : salida - 30 * MIN, { intento });
    }
  }

  // ---- 2) cuando se emite cada evento (demora de sincronizacion del repartidor) ----
  let anterior = 0;
  for (const ev of eventos) {
    const demora =
      inmediato && ev.secuencia <= 3 ? 0 : (ES_DE_REPARTIDOR.includes(ev.tipo) ? rng.int(0, 10) : rng.int(0, 2)) * MIN;
    ev.emitirMs = Math.max(anterior, ev.ocurridoMs + demora);
    anterior = ev.emitirMs;
  }
  // fuera de orden: se intercambia el instante de emision de dos eventos consecutivos
  if (!sinAnomalias) {
    for (let i = 1; i < eventos.length - 1; i++) {
      if (rng.chance(cfg.tasaFueraDeOrden)) {
        [eventos[i].emitirMs, eventos[i + 1].emitirMs] = [eventos[i + 1].emitirMs, eventos[i].emitirMs];
        i += 1;
      }
    }
  }

  // ---- 3) mensajes de Kafka ----
  const base = { shipmentId, hubId, zonaId: zona.id, repartidorId, version: 1 };
  const mensajes = [
    {
      atMs: creadoMs,
      topic: TOPICS.PROMESAS,
      clave: shipmentId,
      stat: 'PROMESA',
      valor: JSON.stringify({
        ...base,
        eventId: `${shipmentId}:P`,
        tipo: 'PROMESA_ENTREGA',
        ocurridoEn: iso(creadoMs),
        secuencia: 1,
        repartidorId: null,
        promesaVenceEn: iso(promesaMs),
      }),
    },
  ];
  let malformados = 0;
  for (const ev of eventos) {
    const evento = {
      ...base,
      eventId: `${shipmentId}:${ev.secuencia}`,
      tipo: ev.tipo,
      ocurridoEn: iso(ev.ocurridoMs),
      secuencia: ev.secuencia,
      ...ev.extra,
    };
    const valor = JSON.stringify(evento);
    mensajes.push({ atMs: ev.emitirMs, topic: TOPICS.ESTADOS, clave: shipmentId, valor, stat: ev.tipo });
    if (sinAnomalias) continue;
    if (rng.chance(cfg.tasaDuplicado)) {
      mensajes.push({ atMs: ev.emitirMs + rng.int(1, 60) * 1000, topic: TOPICS.ESTADOS, clave: shipmentId, valor, stat: 'DUPLICADO' });
    }
    if (rng.chance(cfg.tasaMalformado)) {
      malformados += 1;
      mensajes.push({
        atMs: ev.emitirMs + 500,
        topic: TOPICS.ESTADOS,
        clave: shipmentId,
        valor: variantesMalformadas(rng, shipmentId, evento, malformados),
        stat: 'MALFORMADO',
      });
    }
  }
  mensajes.sort((a, b) => a.atMs - b.atMs);

  return { shipmentId, hubId, zonaId: zona.id, promesaVenceEn: iso(promesaMs), cantidadEventos: eventos.length, mensajes };
}

/** Un unico evento malformado suelto (escenario "evento invalido"). */
export function mensajeMalformadoSuelto(shipmentId, atMs) {
  return {
    atMs,
    topic: TOPICS.ESTADOS,
    clave: shipmentId,
    stat: 'MALFORMADO',
    valor: JSON.stringify({ eventId: `${shipmentId}:X1`, shipmentId, tipo: 'VOLANDO', ocurridoEn: 'ayer', secuencia: 'uno', version: 9 }),
  };
}
