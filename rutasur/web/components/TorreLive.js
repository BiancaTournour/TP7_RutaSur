'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useLive } from '@/lib/useLive';
import { ESTADOS_ORDEN, etiqueta, fechaHora, REGLA_ETIQUETA } from '@/lib/catalogo';
import Vivo from './Vivo';

export default function TorreLive({ inicial }) {
  const { datos, conectado } = useLive(inicial, '/api/torre', '/api/stream');
  const [busqueda, setBusqueda] = useState('');

  return (
    <>
      <div className="fila">
        <h1>Torre de control</h1>
        <Vivo conectado={conectado} />
      </div>

      <section>
        <h2>Envíos por estado <small>({datos.total} en total)</small></h2>
        <div className="contadores">
          {ESTADOS_ORDEN.map((estado) => (
            <div key={estado} className={`contador ${estado}`}>
              <span className="n">{datos.porEstado[estado] ?? 0}</span>
              <span>{etiqueta(estado)}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="dos-columnas">
        <section>
          <h2>Cola de alertas <small>({datos.totalAlertas} abiertas, por prioridad)</small></h2>
          {datos.alertas.length === 0 ? (
            <p className="vacio">Sin alertas abiertas.</p>
          ) : (
            <table>
              <thead><tr><th>Prioridad</th><th>Envío</th><th>Regla</th><th>Abierta</th></tr></thead>
              <tbody>
                {datos.alertas.map((a) => (
                  <tr key={`${a.shipmentId}:${a.regla}`}>
                    <td><span className={`badge ${a.prioridad}`}>{a.prioridad}</span></td>
                    <td><Link href={`/envios/${a.shipmentId}`}>{a.shipmentId}</Link></td>
                    <td>{REGLA_ETIQUETA[a.regla] ?? a.regla}</td>
                    <td>{fechaHora(a.abiertaEn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section>
          <h2>Últimos eventos</h2>
          <table>
            <thead><tr><th>Envío</th><th>Estado</th><th>Zona</th><th>Cuándo (sim.)</th></tr></thead>
            <tbody>
              {datos.ultimos.map((u) => (
                <tr key={u.shipmentId}>
                  <td><Link href={`/envios/${u.shipmentId}`}>{u.shipmentId}</Link></td>
                  <td><span className={`etiqueta ${u.estado}`}>{etiqueta(u.estado)}</span></td>
                  <td>{u.zonaId}</td>
                  <td>{fechaHora(u.ultimoEventoEn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section>
        <h2>Buscar un envío</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (busqueda.trim()) window.location.href = `/envios/${encodeURIComponent(busqueda.trim())}`;
          }}
          className="fila"
        >
          <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="ENV-000123" />
          <button type="submit">Ver detalle</button>
        </form>
      </section>
    </>
  );
}
