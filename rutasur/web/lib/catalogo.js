export const ESTADOS_ORDEN = ['CREADO', 'INGRESADO_HUB', 'CLASIFICADO', 'EN_REPARTO', 'ENTREGADO', 'ENTREGA_FALLIDA', 'REPROGRAMADO', 'RETENIDO', 'DEVOLUCION_COMERCIO'];

export const ETIQUETAS = {
  CREADO: 'Creado',
  INGRESADO_HUB: 'En el hub',
  CLASIFICADO: 'Clasificado',
  EN_REPARTO: 'En reparto',
  ENTREGADO: 'Entregado',
  ENTREGA_FALLIDA: 'Entrega fallida',
  REPROGRAMADO: 'Reprogramado',
  RETENIDO: 'Retenido',
  DEVOLUCION_COMERCIO: 'Devolución al comercio',
};

export const HUBS = ['HUB-NORTE', 'HUB-CENTRO', 'HUB-SUR'];
export const ZONAS = [
  { id: 'Z-N1', hubId: 'HUB-NORTE' }, { id: 'Z-N2', hubId: 'HUB-NORTE' }, { id: 'Z-N3', hubId: 'HUB-NORTE' },
  { id: 'Z-C1', hubId: 'HUB-CENTRO' }, { id: 'Z-C2', hubId: 'HUB-CENTRO' }, { id: 'Z-C3', hubId: 'HUB-CENTRO' },
  { id: 'Z-S1', hubId: 'HUB-SUR' }, { id: 'Z-S2', hubId: 'HUB-SUR' }, { id: 'Z-S3', hubId: 'HUB-SUR' },
];
export const MOTIVOS = ['AUSENTE', 'DIRECCION_INCORRECTA', 'RECHAZADO', 'ZONA_INACCESIBLE'];
export const MOTIVO_ETIQUETA = { AUSENTE: 'Ausente', DIRECCION_INCORRECTA: 'Dirección incorrecta', RECHAZADO: 'Rechazado', ZONA_INACCESIBLE: 'Zona inaccesible' };
export const REGLA_ETIQUETA = { SIN_INGRESO: 'Sin ingreso al hub', SIN_SALIDA: 'Sin salida a reparto', FALLO_DIA_LIMITE: 'Fallo en el día límite', VENCIDO: 'Vencido' };

export const etiqueta = (estado) => ETIQUETAS[estado] ?? estado ?? '—';

// La hora se muestra en UTC porque el reloj de la simulacion es UTC
export const fechaHora = (iso) => (iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : '—');
