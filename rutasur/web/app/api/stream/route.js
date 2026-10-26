import { suscribir } from '@/lib/live';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Server-Sent Events: flujo de un solo sentido, sin infraestructura adicional (por eso SSE y no WebSocket).
export async function GET(request) {
  const id = new URL(request.url).searchParams.get('id');
  const codificador = new TextEncoder();
  let cerrar;

  const stream = new ReadableStream({
    async start(controller) {
      const enviar = (texto) => {
        try {
          controller.enqueue(codificador.encode(texto));
        } catch {
          /* cliente desconectado */
        }
      };
      enviar('retry: 2000\n\n: conectado\n\n');
      const desuscribir = await suscribir((evento) => {
        if (id && evento.shipmentId !== id) return;
        enviar(`data: ${JSON.stringify(evento)}\n\n`);
      });
      const latido = setInterval(() => enviar(': ping\n\n'), 15000);
      cerrar = () => {
        clearInterval(latido);
        desuscribir();
        try {
          controller.close();
        } catch {
          /* ya cerrado */
        }
      };
      request.signal.addEventListener('abort', cerrar);
    },
    cancel() {
      cerrar?.();
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' },
  });
}
