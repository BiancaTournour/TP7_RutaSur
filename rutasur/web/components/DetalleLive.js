'use client';
import Link from 'next/link';
import { useLive } from '@/lib/useLive';
import { etiqueta, fechaHora, REGLA_ETIQUETA, MOTIVO_ETIQUETA } from '@/lib/catalogo';
import Vivo from './Vivo';

function construirLinea({ envio, alertas, notificaciones }) {
  const items = (envio?.historial ?? []).map((h) => ({
    cuando: h.ocurridoEn,
    orden: h.orden,
    clase: h.tipo,
    titulo: etiqueta(h.tipo) + (h.intento ? ` · intento ${h.intento}` : ''),
    detalle: h.motivo ? `Motivo: ${MOTIVO_ETIQUETA[h.motivo] ?? h.motivo}` : h.causa ? `Causa: ${h.causa}${h.nuevoIntentoPara ? ` · nuevo intento ${fechaHora(h.nuevoIntentoPara)}` : ''}` : '',
  }));
  for (const a of alertas) {
    items.push({ cuando: a.abiertaEn, orden: 99, clase: `ALERTA ${a.prioridad}`, titulo: `Alerta ${a.prioridad}: ${REGLA_ETIQUETA[a.regla] ?? a.regla}`, detalle: a.estado === 'CERRADA' ? `Cerrada ${fechaHora(a.cerradaEn)}` : a.causa });
  }
  for (const n of notificaciones) {
    items.push({ cuando: n.ocurridoEn, orden: 98, clase: 'NOTIFICACION', titulo: `Notificación (${n.canal.toLowerCase()})`, detalle: n.mensaje });
  }
  return items.sort((x, y) => (x.cuando < y.cuando ? -1 : x.cuando > y.cuando ? 1 : x.orden - y.orden));
}

export default function DetalleLive({ id, inicial }) {
  const { datos, conectado } = useLive(inicial, `/api/envios/${id}`, `/api/stream?id=${id}`);
  const { envio } = datos;

  return (
    <>
      <div className="fila">
        <h1>Envío {id}</h1>
        <Vivo conectado={conectado} />
      </div>
      <p><Link href="/">← Torre de control</Link> · <Link href={`/tracking/${id}`}>Ver tracking público</Link></p>

      {!envio ? (
        <p className="vacio">Todavía no hay datos de este envío.</p>
      ) : (
        <>
          <section className="resumen">
            <div><small>Estado</small><strong className={`etiqueta ${envio.estado}`}>{etiqueta(envio.estado)}</strong></div>
            <div><small>Intentos</small><strong>{envio.intentos}</strong></div>
            <div><small>Promesa</small><strong>{fechaHora(envio.promesa?.venceEn)}</strong></div>
            <div><small>Hub / Zona</small><strong>{envio.hubId} / {envio.zonaId}</strong></div>
            <div><small>Repartidor</small><strong>{envio.repartidorId ?? '—'}</strong></div>
          </section>

          <section>
            <h2>Línea de tiempo</h2>
            <ol className="linea">
              {construirLinea(datos).map((it, i) => (
                <li key={i} className={it.clase.split(' ')[0]}>
                  <time>{fechaHora(it.cuando)}</time>
                  <div><strong>{it.titulo}</strong>{it.detalle ? <span> — {it.detalle}</span> : null}</div>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </>
  );
}
