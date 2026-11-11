import { NextRequest, NextResponse } from 'next/server';
import { getPublicJwks, getPublicKeyPem } from '@/lib/jwt';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/auth/jwks
 * Returns standard RFC 7517 Public JSON Web Key Set for partner token verification.
 */
export async function GET(req: NextRequest) {
  const format = req.nextUrl.searchParams.get('format');
  if (format === 'pem') {
    return new NextResponse(getPublicKeyPem(), {
      status: 200,
      headers: {
        'Content-Type': 'application/x-pem-file',
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=3600',
      },
    });
  }

  const jwks = getPublicJwks();
  return NextResponse.json(jwks, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=3600',
    },
  });
}

