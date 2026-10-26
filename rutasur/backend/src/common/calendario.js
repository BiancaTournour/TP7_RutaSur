// Utilidades de tiempo simulado. Todo en UTC para que las corridas sean reproducibles.
export const MIN = 60_000;
export const HORA = 3_600_000;
export const DIA = 86_400_000;

export const iso = (ms) => new Date(ms).toISOString();
export const aMs = (texto) => Date.parse(texto);
export const fechaDe = (ms) => new Date(ms).toISOString().slice(0, 10);
export const franjaDe = (ms) => (new Date(ms).getUTCHours() < 14 ? 'MANANA' : 'TARDE');
export const franjaOpuesta = (franja) => (franja === 'MANANA' ? 'TARDE' : 'MANANA');
// Hora (UTC) a la que sale el repartidor en cada franja
export const HORA_SALIDA = { MANANA: 9, TARDE: 15 };

const esHabil = (ms) => {
  const dia = new Date(ms).getUTCDay();
  return dia !== 0 && dia !== 6;
};
const medianoche = (ms) => Math.floor(ms / DIA) * DIA;

/** Medianoche UTC del proximo dia habil (lunes a viernes) posterior a `ms`. */
export function proximoDiaHabil(ms) {
  let t = medianoche(ms) + DIA;
  while (!esHabil(t)) t += DIA;
  return t;
}

/** Primer instante >= ms que cae en `hora`:00 UTC de un dia habil. */
export function proximaHora(ms, hora) {
  let t = medianoche(ms) + hora * HORA;
  if (t < ms) t += DIA;
  while (!esHabil(t)) t += DIA;
  return t;
}

export const venceHoy = (promesaMs, ahoraMs) => fechaDe(promesaMs) === fechaDe(ahoraMs);
