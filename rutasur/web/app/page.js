import TorreLive from '@/components/TorreLive';
import { datosTorre } from '@/lib/queries';

export const dynamic = 'force-dynamic';

// Se renderiza en el servidor; el componente cliente aplica los cambios que llegan por SSE.
export default async function Page() {
  return <TorreLive inicial={await datosTorre()} />;
}
