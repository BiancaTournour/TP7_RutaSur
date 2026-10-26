import { getDb } from './mongo';

const RANGO_PRIORIDAD = { $switch: { branches: [{ case: { $eq: ['$prioridad', 'CRITICA'] }, then: 3 }, { case: { $eq: ['$prioridad', 'ALTA'] }, then: 2 }], default: 1 } };

export async function datosTorre() {
  const db = await getDb();
  const [porEstado, alertas, totalAlertas, ultimos] = await Promise.all([
    db.collection('envios').aggregate([{ $group: { _id: '$estado', n: { $sum: 1 } } }]).toArray(),
    db
      .collection('alertas')
      .aggregate([
        { $match: { estado: 'ABIERTA' } },
        { $addFields: { rango: RANGO_PRIORIDAD } },
        { $sort: { rango: -1, abiertaEn: 1 } },
        { $limit: 40 },
        { $project: { _id: 0, rango: 0 } },
      ])
      .toArray(),
    db.collection('alertas').countDocuments({ estado: 'ABIERTA' }),
    db
      .collection('envios')
      .find({}, { projection: { _id: 0, shipmentId: 1, estado: 1, zonaId: 1, hubId: 1, ultimoEventoEn: 1 } })
      .sort({ ultimoEventoEn: -1 })
      .limit(15)
      .toArray(),
  ]);
  const conteo = Object.fromEntries(porEstado.map((x) => [x._id, x.n]));
  return { porEstado: conteo, total: porEstado.reduce((s, x) => s + x.n, 0), alertas, totalAlertas, ultimos };
}

export async function datosDetalle(id) {
  const db = await getDb();
  const [envio, alertas, notificaciones] = await Promise.all([
    db.collection('envios').findOne({ shipmentId: id }, { projection: { _id: 0 } }),
    db.collection('alertas').find({ shipmentId: id }, { projection: { _id: 0 } }).toArray(),
    db.collection('notificaciones').find({ shipmentId: id }, { projection: { _id: 0 } }).sort({ ocurridoEn: 1 }).toArray(),
  ]);
  return { envio, alertas, notificaciones };
}

// Tracking publico: solo estado y fecha estimada. Nada de repartidor, hub, zona, alertas ni historial interno.
export async function datosTracking(id) {
  const db = await getDb();
  const e = await db.collection('envios').findOne({ shipmentId: id }, { projection: { _id: 0, shipmentId: 1, estado: 1, promesa: 1, disposicion: 1 } });
  if (!e) return { encontrado: false, shipmentId: id };
  const reprogramado = e.estado === 'REPROGRAMADO' && e.disposicion?.nuevoIntentoPara;
  return {
    encontrado: true,
    shipmentId: e.shipmentId,
    estado: e.estado,
    fechaEstimada: reprogramado ? e.disposicion.nuevoIntentoPara : (e.promesa?.venceEn ?? null),
  };
}

export async function datosAnalitica({ zona, hub, desde, hasta }) {
  const db = await getDb();
  const filtro = {};
  if (zona) filtro.zonaId = zona;
  if (hub) filtro.hubId = hub;
  if (desde || hasta) filtro.fecha = { ...(desde && { $gte: desde }), ...(hasta && { $lte: hasta }) };
  const col = db.collection('metricas_diarias');
  const [primerIntentoZonaFranja, primerIntentoDia, motivos, sla, tiempoHub] = await Promise.all([
    col.aggregate([{ $match: filtro }, { $group: { _id: { zona: '$zonaId', franja: '$franja' }, intentos: { $sum: '$intentos1' }, entregados: { $sum: '$entregados1' } } }]).toArray(),
    col.aggregate([{ $match: filtro }, { $group: { _id: '$fecha', intentos: { $sum: '$intentos1' }, entregados: { $sum: '$entregados1' } } }, { $sort: { _id: 1 } }]).toArray(),
    col
      .aggregate([
        { $match: filtro },
        { $group: { _id: '$zonaId', AUSENTE: { $sum: '$motivos.AUSENTE' }, DIRECCION_INCORRECTA: { $sum: '$motivos.DIRECCION_INCORRECTA' }, RECHAZADO: { $sum: '$motivos.RECHAZADO' }, ZONA_INACCESIBLE: { $sum: '$motivos.ZONA_INACCESIBLE' } } },
        { $sort: { _id: 1 } },
      ])
      .toArray(),
    col.aggregate([{ $match: filtro }, { $group: { _id: { hub: '$hubId', fecha: '$fecha' }, aTiempo: { $sum: '$sla.aTiempo' }, tarde: { $sum: '$sla.tarde' } } }, { $sort: { '_id.hub': 1, '_id.fecha': 1 } }]).toArray(),
    col.aggregate([{ $match: { ...filtro, 'tiempoHub.n': { $gt: 0 } } }, { $group: { _id: '$hubId', n: { $sum: '$tiempoHub.n' }, sumaMs: { $sum: '$tiempoHub.sumaMs' } } }, { $sort: { _id: 1 } }]).toArray(),
  ]);
  return { primerIntentoZonaFranja, primerIntentoDia, motivos, sla, tiempoHub };
}
