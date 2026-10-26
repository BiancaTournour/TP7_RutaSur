'use client';
import Link from 'next/link';
import { useState } from 'react';

const ESCENARIOS = [
  ['feliz', 'Envío feliz', 'Recorre todos los estados sin incidentes (~30 s).'],
  ['ausente', 'Ausente', 'Falla por ausencia y se reprograma: aparecen notificación, reprogramación y métrica.'],
  ['demorado', 'Demorado', 'Queda detenido en el hub: alerta ALTA (sin salida) antes del vencimiento.'],
  ['tercer-fallo', 'Tercer fallo', 'Agota sus 3 intentos y pasa a devolución al comercio.'],
  ['rafaga', 'Ráfaga (500 envíos)', 'Acumulación y recuperación: mirá el lag de los grupos.'],
  ['malformado', 'Evento inválido', 'Inyecta un evento malformado: va a la DLQ y el flujo sigue.'],
];

export default function PanelDemo() {
  const [log, setLog] = useState([]);
  const [ocupado, setOcupado] = useState(null);

  async function lanzar(escenario) {
    setOcupado(escenario);
    try {
      const r = await fetch(`/api/demo/${escenario}`, { method: 'POST' });
      const j = await r.json();
      setLog((l) => [{ escenario, ...j, hora: new Date().toLocaleTimeString() }, ...l].slice(0, 12));
    } catch (error) {
      setLog((l) => [{ escenario, ok: false, error: error.message, hora: new Date().toLocaleTimeString() }, ...l]);
    } finally {
      setOcupado(null);
    }
  }

  return (
    <>
      <h1>Panel de demo</h1>
      <p>Cada botón le pide al simulador que dispare un escenario. El resto del sistema reacciona solo, a través de Kafka.</p>
      <div className="botones">
        {ESCENARIOS.map(([clave, titulo, ayuda]) => (
          <button key={clave} disabled={ocupado !== null} onClick={() => lanzar(clave)}>
            <strong>{titulo}</strong>
            <small>{ayuda}</small>
          </button>
        ))}
      </div>

      <h2>Resultados</h2>
      {log.length === 0 && <p className="vacio">Todavía no lanzaste ningún escenario.</p>}
      <ul className="resultados">
        {log.map((x, i) => (
          <li key={i} className={x.ok ? '' : 'error'}>
            <time>{x.hora}</time> <strong>{x.escenario}</strong> —{' '}
            {x.ok ? (
              <>
                {x.detalle}{' '}
                {x.shipmentIds?.map((id) => (
                  <span key={id}><Link href={`/envios/${id}`}>{id}</Link> (<Link href={`/tracking/${id}`}>tracking</Link>) </span>
                ))}
              </>
            ) : (
              x.error
            )}
          </li>
        ))}
      </ul>

      <h2>Pasos que se hacen desde la terminal</h2>
      <pre>{`# Paso 5 · caída de un servicio (el lag de su grupo crece; al reiniciar procesa lo pendiente sin duplicar)
docker compose stop notificaciones
docker compose run --rm tools src/tools/lag.js --watch
docker compose start notificaciones

# Paso 6 · ver el evento inválido en la DLQ
docker compose run --rm tools src/tools/ver-dlq.js

# Paso 8 · reprocesamiento: activar el 4.º indicador (grupo nuevo que lee el histórico desde el offset 0)
docker compose --profile replay up -d analitica-tiempo-hub`}</pre>
    </>
  );
}
