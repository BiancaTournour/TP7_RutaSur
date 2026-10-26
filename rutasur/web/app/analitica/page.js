import { datosAnalitica } from '@/lib/queries';
import { ZONAS, HUBS, MOTIVOS, MOTIVO_ETIQUETA } from '@/lib/catalogo';

export const dynamic = 'force-dynamic';

const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
const Barra = ({ valor, color = 'var(--azul)' }) => (
  <span className="barra-pct"><i style={{ width: `${valor ?? 0}%`, background: color }} /></span>
);

export default async function Page({ searchParams }) {
  const filtros = { zona: searchParams.zona || '', hub: searchParams.hub || '', desde: searchParams.desde || '', hasta: searchParams.hasta || '' };
  const d = await datosAnalitica(filtros);
  const zonas = [...new Set(d.primerIntentoZonaFranja.map((x) => x._id.zona))].sort();
  const celda = (zona, franja) => d.primerIntentoZonaFranja.find((x) => x._id.zona === zona && x._id.franja === franja);
  const hubs = [...new Set(d.sla.map((x) => x._id.hub))];

  return (
    <>
      <h1>Analítica de mejora</h1>
      <form method="get" className="filtros">
        <label>Zona
          <select name="zona" defaultValue={filtros.zona}><option value="">Todas</option>{ZONAS.map((z) => <option key={z.id}>{z.id}</option>)}</select>
        </label>
        <label>Hub
          <select name="hub" defaultValue={filtros.hub}><option value="">Todos</option>{HUBS.map((h) => <option key={h}>{h}</option>)}</select>
        </label>
        <label>Desde <input type="date" name="desde" defaultValue={filtros.desde} /></label>
        <label>Hasta <input type="date" name="hasta" defaultValue={filtros.hasta} /></label>
        <button type="submit">Filtrar</button>
      </form>

      <section>
        <h2>1 · Tasa de entrega en primer intento <small>¿Dónde y cuándo fallamos más?</small></h2>
        {zonas.length === 0 ? <p className="vacio">Todavía no hay métricas para estos filtros.</p> : (
          <>
            <table>
              <thead><tr><th>Zona</th><th>Mañana</th><th>Tarde</th></tr></thead>
              <tbody>
                {zonas.map((z) => (
                  <tr key={z}>
                    <td>{z}</td>
                    {['MANANA', 'TARDE'].map((f) => {
                      const c = celda(z, f);
                      const v = c ? pct(c.entregados, c.intentos) : null;
                      return <td key={f}>{v === null ? '—' : <><strong>{v}%</strong> <small>({c.entregados}/{c.intentos})</small> <Barra valor={v} color={v < 75 ? 'var(--rojo)' : 'var(--verde)'} /></>}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <h3>Por día</h3>
            <table>
              <thead><tr><th>Día (sim.)</th><th>Tasa primer intento</th></tr></thead>
              <tbody>{d.primerIntentoDia.map((x) => <tr key={x._id}><td>{x._id}</td><td><strong>{pct(x.entregados, x.intentos)}%</strong> <small>({x.entregados}/{x.intentos})</small></td></tr>)}</tbody>
            </table>
          </>
        )}
      </section>

      <section>
        <h2>2 · Distribución de motivos de fallo <small>¿Por qué fallamos?</small></h2>
        <table>
          <thead><tr><th>Zona</th>{MOTIVOS.map((m) => <th key={m}>{MOTIVO_ETIQUETA[m]}</th>)}<th>Total</th></tr></thead>
          <tbody>
            {d.motivos.map((z) => {
              const total = MOTIVOS.reduce((s, m) => s + z[m], 0);
              return (
                <tr key={z._id}>
                  <td>{z._id}</td>
                  {MOTIVOS.map((m) => <td key={m}>{z[m]} <small>({pct(z[m], total) ?? 0}%)</small></td>)}
                  <td><strong>{total}</strong></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section>
        <h2>3 · Cumplimiento de SLA <small>¿Qué hub llega tarde?</small></h2>
        {hubs.length === 0 ? <p className="vacio">Sin entregas todavía.</p> : (
          <table>
            <thead><tr><th>Hub</th><th>Día (sim.)</th><th>A tiempo</th><th>Cumplimiento</th></tr></thead>
            <tbody>
              {d.sla.map((x) => {
                const total = x.aTiempo + x.tarde;
                const v = pct(x.aTiempo, total);
                return <tr key={`${x._id.hub}${x._id.fecha}`}><td>{x._id.hub}</td><td>{x._id.fecha}</td><td>{x.aTiempo}/{total}</td><td><strong>{v ?? '—'}%</strong> <Barra valor={v} color={v < 90 ? 'var(--rojo)' : 'var(--verde)'} /></td></tr>;
              })}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>4 · Tiempo medio entre INGRESADO_HUB y EN_REPARTO <small>indicador agregado con el sistema en marcha</small></h2>
        {d.tiempoHub.length === 0 ? (
          <p className="vacio">Todavía no está activo. Se enciende con <code>docker compose --profile replay up -d analitica-tiempo-hub</code>: un grupo nuevo lee el histórico de Kafka y completa el gráfico con datos anteriores a su creación.</p>
        ) : (
          <table>
            <thead><tr><th>Hub</th><th>Envíos medidos</th><th>Tiempo medio</th></tr></thead>
            <tbody>{d.tiempoHub.map((x) => <tr key={x._id}><td>{x._id}</td><td>{x.n}</td><td><strong>{(x.sumaMs / x.n / 3600000).toFixed(1)} h</strong> <Barra valor={Math.min(100, (x.sumaMs / x.n / 3600000 / 24) * 100)} /></td></tr>)}</tbody>
          </table>
        )}
      </section>
    </>
  );
}
