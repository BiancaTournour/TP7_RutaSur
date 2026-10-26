'use client';
import { useEffect, useState } from 'react';

/**
 * Aplica los cambios en vivo: escucha el stream SSE y, cuando llega un aviso, vuelve a pedir los datos
 * (agrupando avisos cercanos: como mucho una consulta cada 300 ms).
 */
export function useLive(inicial, urlDatos, urlStream) {
  const [datos, setDatos] = useState(inicial);
  const [conectado, setConectado] = useState(false);

  useEffect(() => {
    let cancelado = false;
    let timer = null;
    const refrescar = async () => {
      try {
        const r = await fetch(urlDatos, { cache: 'no-store' });
        if (r.ok && !cancelado) setDatos(await r.json());
      } catch {
        /* se reintenta con el proximo aviso */
      }
    };
    const fuente = new EventSource(urlStream);
    fuente.onopen = () => setConectado(true);
    fuente.onerror = () => setConectado(false);
    fuente.onmessage = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        refrescar();
      }, 300);
    };
    return () => {
      cancelado = true;
      clearTimeout(timer);
      fuente.close();
    };
  }, [urlDatos, urlStream]);

  return { datos, conectado };
}
