// Reductores puros de la proyeccion (CQRS: lado de lectura). Reciben el documento actual y un evento,
// devuelven el documento nuevo. No usan el reloj de la maquina: reconstruir desde Kafka da el mismo resultado.

export function envioVacio(shipmentId) {
  return {
    shipmentId,
    estado: null, // estado visible: ultimo estado, o la disposicion si es mas nueva (reprogramado/retenido/devolucion)
    estadoBase: null, // ultimo estado recibido en envios.estados
    ultimaSecuencia: 0,
    disposicion: null,
    intentos: 0,
    promesa: null,
    hubId: null,
    zonaId: null,
    repartidorId: null,
    historial: [],
    ultimoEventoEn: null,
  };
}

const calcularEstado = (doc) =>
  doc.disposicion && doc.disposicion.secuenciaOrigen >= doc.ultimaSecuencia ? doc.disposicion.tipo : doc.estadoBase;

const ordenar = (historial) =>
  historial.sort((a, b) => (a.ocurridoEn < b.ocurridoEn ? -1 : a.ocurridoEn > b.ocurridoEn ? 1 : a.orden - b.orden));

const maxTexto = (a, b) => (a == null ? b : b == null ? a : a > b ? a : b);

/** Aplica un evento de envios.estados. Descarta duplicados y eventos con secuencia menor o igual a la aplicada. */
export function aplicarEstado(actual, e) {
  const doc = structuredClone(actual ?? envioVacio(e.shipmentId));
  if (doc.historial.some((h) => h.eventId === e.eventId)) return { doc: actual, aplicado: false, motivo: 'DUPLICADO' };
  if (e.secuencia <= doc.ultimaSecuencia) return { doc: actual, aplicado: false, motivo: 'FUERA_DE_ORDEN' };

  doc.estadoBase = e.tipo;
  doc.ultimaSecuencia = e.secuencia;
  doc.hubId = e.hubId;
  doc.zonaId = e.zonaId;
  if (e.repartidorId) doc.repartidorId = e.repartidorId;
  if (e.intento) doc.intentos = Math.max(doc.intentos, e.intento);
  if (e.promesaVenceEn) doc.promesa = { venceEn: e.promesaVenceEn };
  doc.historial.push({
    eventId: e.eventId,
    tipo: e.tipo,
    secuencia: e.secuencia,
    orden: e.secuencia,
    ocurridoEn: e.ocurridoEn,
    ...(e.motivo && { motivo: e.motivo }),
    ...(e.intento && { intento: e.intento }),
  });
  ordenar(doc.historial);
  doc.ultimoEventoEn = maxTexto(doc.ultimoEventoEn, e.ocurridoEn);
  doc.estado = calcularEstado(doc);
  return { doc, aplicado: true };
}

/** Aplica un evento de envios.reprogramaciones (REPROGRAMADO / RETENIDO / DEVOLUCION_COMERCIO). */
export function aplicarDisposicion(actual, r) {
  const doc = structuredClone(actual ?? envioVacio(r.shipmentId));
  if (doc.historial.some((h) => h.eventId === r.eventId)) return { doc: actual, aplicado: false, motivo: 'DUPLICADO' };

  if (!doc.disposicion || r.secuenciaOrigen >= doc.disposicion.secuenciaOrigen) {
    doc.disposicion = {
      tipo: r.tipo,
      secuenciaOrigen: r.secuenciaOrigen,
      causa: r.causa ?? null,
      ...(r.nuevoIntentoPara && { nuevoIntentoPara: r.nuevoIntentoPara }),
      ...(r.franja && { franja: r.franja }),
    };
  }
  doc.hubId = doc.hubId ?? r.hubId;
  doc.zonaId = doc.zonaId ?? r.zonaId;
  doc.historial.push({
    eventId: r.eventId,
    tipo: r.tipo,
    secuencia: r.secuenciaOrigen,
    orden: r.secuenciaOrigen + 0.5,
    ocurridoEn: r.ocurridoEn,
    causa: r.causa ?? null,
    ...(r.nuevoIntentoPara && { nuevoIntentoPara: r.nuevoIntentoPara }),
  });
  ordenar(doc.historial);
  doc.ultimoEventoEn = maxTexto(doc.ultimoEventoEn, r.ocurridoEn);
  doc.estado = calcularEstado(doc);
  return { doc, aplicado: true };
}

/** Coleccion alertas: un documento por (envio, regla). */
export function aplicarAlerta(actual, a) {
  const doc = actual
    ? { ...actual }
    : {
        _id: `${a.shipmentId}:${a.regla}`,
        shipmentId: a.shipmentId,
        regla: a.regla,
        prioridad: a.prioridad,
        estado: 'ABIERTA',
        causa: null,
        abiertaEn: null,
        cerradaEn: null,
        hubId: a.hubId,
        zonaId: a.zonaId,
      };
  if (a.tipo === 'ALERTA_ABIERTA') {
    doc.prioridad = a.prioridad;
    doc.causa = a.causa ?? null;
    doc.abiertaEn = doc.abiertaEn ?? a.ocurridoEn;
    if (doc.estado !== 'CERRADA') doc.estado = 'ABIERTA';
  } else {
    doc.estado = 'CERRADA';
    doc.cerradaEn = a.ocurridoEn;
    doc.abiertaEn = doc.abiertaEn ?? a.ocurridoEn;
  }
  return doc;
}

/** Coleccion notificaciones: un documento por notificacion (el _id es el eventId, asi es idempotente). */
export const docNotificacion = (n) => ({
  _id: n.eventId,
  shipmentId: n.shipmentId,
  motivo: n.motivo,
  canal: n.canal,
  mensaje: n.mensaje ?? null,
  opcionesReprogramar: n.opcionesReprogramar ?? [],
  ocurridoEn: n.ocurridoEn,
  hubId: n.hubId,
  zonaId: n.zonaId,
});
