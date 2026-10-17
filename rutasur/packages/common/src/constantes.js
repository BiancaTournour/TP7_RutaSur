export const TOPICS = {
  ESTADOS: 'envios.estados',
  PROMESAS: 'envios.promesas',
  REPROGRAMACIONES: 'envios.reprogramaciones',
  ALERTAS_SLA: 'alertas.sla',
  NOTIFICACIONES: 'notificaciones.enviadas',
  DLQ: 'envios.estados.dlq',
};

export const GRUPOS = {
  PROYECTOR: 'proyector',
  NOTIFICACIONES: 'notificaciones',
  REPROGRAMACION: 'reprogramacion',
  MONITOR_SLA: 'monitor-sla',
  ANALITICA: 'analitica',
};

export const ESTADOS = {
  CREADO: 'CREADO',
  INGRESADO_HUB: 'INGRESADO_HUB',
  CLASIFICADO: 'CLASIFICADO',
  EN_REPARTO: 'EN_REPARTO',
  ENTREGADO: 'ENTREGADO',
  ENTREGA_FALLIDA: 'ENTREGA_FALLIDA',
};

export const MOTIVOS = {
  AUSENTE: 'AUSENTE',
  DIRECCION_INCORRECTA: 'DIRECCION_INCORRECTA',
  RECHAZADO: 'RECHAZADO',
  ZONA_INACCESIBLE: 'ZONA_INACCESIBLE',
};

export const VERSION_ESQUEMA = 1;