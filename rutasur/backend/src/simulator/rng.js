// Generador pseudoaleatorio con semilla (mulberry32): misma semilla -> misma corrida.
function semillaDesdeTexto(texto) {
  let h = 1779033703 ^ texto.length;
  for (let i = 0; i < texto.length; i++) {
    h = Math.imul(h ^ texto.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function crearRng(semilla) {
  const siguiente = mulberry32(semillaDesdeTexto(String(semilla)));
  return {
    next: siguiente,
    int: (min, max) => min + Math.floor(siguiente() * (max - min + 1)),
    chance: (p) => siguiente() < p,
    pick: (lista) => lista[Math.floor(siguiente() * lista.length)],
    weighted: (pesos) => {
      const entradas = Object.entries(pesos);
      const total = entradas.reduce((s, [, p]) => s + p, 0);
      let r = siguiente() * total;
      for (const [clave, peso] of entradas) {
        r -= peso;
        if (r < 0) return clave;
      }
      return entradas[entradas.length - 1][0];
    },
  };
}
