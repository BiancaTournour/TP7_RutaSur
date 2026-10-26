const num = (clave, defecto) => (process.env[clave] !== undefined && process.env[clave] !== '' ? Number(process.env[clave]) : defecto);

export const cfg = {
  kafkaBrokers: (process.env.KAFKA_BROKERS || 'localhost:29092').split(','),
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/rutasur?directConnection=true',
  mongoDb: process.env.MONGO_DB || 'rutasur',
  servicio: process.env.SERVICE_NAME || 'rutasur',
  // 1 hora simulada = 30 s reales  ->  factor 120
  aceleracion: num('ACELERACION', 120),
  simInicio: Date.UTC(2026, 0, 5, 6, 0, 0), // lunes 05/01/2026 06:00 UTC
  puertoSimulador: num('PUERTO_SIMULADOR', 4000),
};

export const simCfg = {
  semilla: process.env.SEMILLA || 'rutasur-2026',
  enviosPorMinuto: num('ENVIOS_POR_MINUTO', 20),
  probDemoraHub: num('PROB_DEMORA_HUB', 0.1),
  tasaDuplicado: num('TASA_DUPLICADO', 0.02),
  tasaFueraDeOrden: num('TASA_FUERA_DE_ORDEN', 0.02),
  tasaMalformado: num('TASA_MALFORMADO', 0.01),
  factorTarde: num('FACTOR_TARDE', 1.25), // la franja TARDE falla un poco mas
  motivosPesos: { AUSENTE: 60, DIRECCION_INCORRECTA: 20, RECHAZADO: 15, ZONA_INACCESIBLE: 5 },
};
