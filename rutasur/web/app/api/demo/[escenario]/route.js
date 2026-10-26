export const dynamic = 'force-dynamic';

const SIMULADOR = process.env.SIMULADOR_URL || 'http://localhost:4000';

// El panel de demo no habla con Kafka: le pide al simulador (HTTP) que dispare el escenario.
export async function POST(_request, { params }) {
  try {
    const r = await fetch(`${SIMULADOR}/escenarios/${params.escenario}`, { method: 'POST', cache: 'no-store' });
    return Response.json(await r.json(), { status: r.status });
  } catch (error) {
    return Response.json({ ok: false, error: `No se pudo contactar al simulador: ${error.message}` }, { status: 502 });
  }
}
