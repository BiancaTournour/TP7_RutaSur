// Catalogo de la practica: topics, estados, motivos, reglas y topologia del negocio.
export const TOPICS = {
  ESTADOS: 'envios.estados',
  PROMESAS: 'envios.promesas',
  REPROGRAMACIONES: 'envios.reprogramaciones',
  ALERTAS: 'alertas.sla',
  NOTIFICACIONES: 'notificaciones.enviadas',
  DLQ: 'envios.estados.dlq',
};

export const GRUPOS = {
  PROYECTOR: 'proyector',
  NOTIFICACIONES: 'notificaciones',
  REPROGRAMACION: 'reprogramacion',
  MONITOR_SLA: 'monitor-sla',
  ANALITICA: 'analitica',
  ANALITICA_TIEMPO_HUB: 'analitica-tiempo-hub',
};

export const ESTADOS = ['CREADO', 'INGRESADO_HUB', 'CLASIFICADO', 'EN_REPARTO', 'ENTREGADO', 'ENTREGA_FALLIDA'];
export const MOTIVOS = ['AUSENTE', 'DIRECCION_INCORRECTA', 'RECHAZADO', 'ZONA_INACCESIBLE'];
export const DISPOSICIONES = ['REPROGRAMADO', 'RETENIDO', 'DEVOLUCION_COMERCIO'];
export const FRANJAS = ['MANANA', 'TARDE'];
export const MAX_INTENTOS = 3;

export const REGLAS_SLA = {
  SIN_INGRESO: { prioridad: 'MEDIA' },
  SIN_SALIDA: { prioridad: 'ALTA' },
  FALLO_DIA_LIMITE: { prioridad: 'ALTA' },
  VENCIDO: { prioridad: 'CRITICA' },
};
export const PRIORIDADES = ['MEDIA', 'ALTA', 'CRITICA'];

// 3 centros de distribucion, 9 zonas (tasa de fallo base entre 5% y 30%), 120 repartidores
export const HUBS = ['HUB-NORTE', 'HUB-CENTRO', 'HUB-SUR'];
export const ZONAS = [
  { id: 'Z-N1', hubId: 'HUB-NORTE', tasaFallo: 0.05 },
  { id: 'Z-N2', hubId: 'HUB-NORTE', tasaFallo: 0.08 },
  { id: 'Z-N3', hubId: 'HUB-NORTE', tasaFallo: 0.12 },
  { id: 'Z-C1', hubId: 'HUB-CENTRO', tasaFallo: 0.1 },
  { id: 'Z-C2', hubId: 'HUB-CENTRO', tasaFallo: 0.15 },
  { id: 'Z-C3', hubId: 'HUB-CENTRO', tasaFallo: 0.18 },
  { id: 'Z-S1', hubId: 'HUB-SUR', tasaFallo: 0.22 },
  { id: 'Z-S2', hubId: 'HUB-SUR', tasaFallo: 0.26 },
  { id: 'Z-S3', hubId: 'HUB-SUR', tasaFallo: 0.3 },
];
