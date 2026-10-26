export function crearLog(servicio) {
  const linea = (nivel, mensaje, campos = {}) =>
    `${new Date().toISOString()} ${nivel} [${servicio}] ${mensaje}` +
    Object.entries(campos).map(([k, v]) => ` ${k}=${v}`).join('');
  return {
    info: (m, c) => console.log(linea('INFO', m, c)),
    warn: (m, c) => console.warn(linea('WARN', m, c)),
    error: (m, c) => console.error(linea('ERROR', m, c)),
  };
}
