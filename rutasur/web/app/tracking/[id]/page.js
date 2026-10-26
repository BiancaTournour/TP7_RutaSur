import TrackingLive from '@/components/TrackingLive';
import { datosTracking } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export default async function Page({ params }) {
  return <TrackingLive id={params.id} inicial={await datosTracking(params.id)} />;
}
