'use client';
import { useLive } from '@/lib/useLive';
import { etiqueta, fechaHora } from '@/lib/catalogo';
import Vivo from './Vivo';

const PASOS = [
  ['CREADO', 'Registrado'],
  ['INGRESADO_HUB', 'En el centro de distribución'],
  ['CLASIFICADO', 'Preparado para salir'],
  ['EN_REPARTO', 'En camino'],
  ['ENTREGADO', 'Entregado'],
];
const MENSAJES = {
  ENTREGA_FALLIDA: 'No pudimos entregar tu envío. Te avisamos para reprogramar.',
  REPROGRAMADO: 'Reprogramamos tu entrega.',
  RETENIDO: 'Tu envío está retenido: necesitamos que confirmes la dirección.',
  DEVOLUCION_COMERCIO: 'Tu envío fue devuelto al comercio.',
};

export default function TrackingLive({ id, inicial }) {
  const { datos, conectado } = useLive(inicial, `/api/tracking/${id}`, `/api/stream?id=${id}`);
  const indice = PASOS.findIndex(([estado]) => estado === datos.estado);

  return (
    <div className="tracking">
      <div className="fila"><h1>Seguimiento de tu envío</h1><Vivo conectado={conectado} /></div>
      <p className="codigo">{id}</p>
      {!datos.encontrado ? (
        <p className="vacio">No encontramos ese envío todavía.</p>
      ) : (
        <>
          <p className="estado-grande">{etiqueta(datos.estado)}</p>
          {MENSAJES[datos.estado] && <p>{MENSAJES[datos.estado]}</p>}
          <ol className="pasos">
            {PASOS.map(([estado, texto], i) => (
              <li key={estado} className={i <= indice ? 'hecho' : ''}>{texto}</li>
            ))}
          </ol>
          {datos.estado !== 'ENTREGADO' && datos.estado !== 'DEVOLUCION_COMERCIO' && (
            <p>Fecha estimada: <strong>{fechaHora(datos.fechaEstimada)}</strong></p>
          )}
        </>
      )}
    </div>
  );
}
