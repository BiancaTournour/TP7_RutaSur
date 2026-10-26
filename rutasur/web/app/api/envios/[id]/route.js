import { datosDetalle } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export async function GET(_request, { params }) {
  return Response.json(await datosDetalle(params.id));
}
