import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/backend';

// AR-35: the code of every favourite, for the heart state and the sidebar count. The list itself
// is the paginated GET /api/favorites.
export async function GET(request: NextRequest) {
  return proxyToBackend(request, '/favorites/codes', { auth: true });
}
