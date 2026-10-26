import DetalleLive from '@/components/DetalleLive';
import { datosDetalle } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export default async function Page({ params }) {
  return <DetalleLive id={params.id} inicial={await datosDetalle(params.id)} />;
}
