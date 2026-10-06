import { User, Workspace } from '@kazibox/sdk';

/**
 * KaziBox Single Sign-On (SSO) Module Token Specification
 * 
 * SECURITY NOTE FOR PRODUCTION:
 * Real signing keys (e.g. RSA / ED25519 private keys or HMAC secrets) MUST
 * live in secure server environment variables (e.g. KAZIBOX_SSO_PRIVATE_KEY)
 * and must NEVER be exposed or executed inside client-side browser bundles.
 * When migrating to Supabase or OAuth2/OIDC, replace this mock HMAC signer
 * with standard JWT / JWKS asymmetric key verification (e.g. jose / jsonwebtoken).
 */

const MOCK_SSO_SECRET = process.env.KAZIBOX_SSO_SECRET || 'kazibox_mock_sso_secret_key_prod_env_replace';

export interface ModuleTokenPayload {
  userId: string;
  userName: string;
  userEmail: string;
  workspaceId: string;
  workspaceName: string;
  role: string;
  language: 'fr' | 'en';
  currency: string;
  moduleId: string;
  iat: number; // Issued at (seconds)
  exp: number; // Expiry at (seconds, 5 minutes lifetime)
}

/**
 * Universal Base64 and Base64URL encoding/decoding safe for both Browser & Node
 */
function toBase64(str: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str, 'utf-8').toString('base64');
  }
  return btoa(
    encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) =>
      String.fromCharCode(parseInt(p1, 16))
    )
  );
}

function fromBase64(b64: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(b64, 'base64').toString('utf-8');
  }
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function toBase64Url(str: string): string {
  return toBase64(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(b64url: string): string {
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) {
    b64 += '=';
  }
  return fromBase64(b64);
}

/**
 * Deterministic signature calculation safe for browser client bundles without Node 'crypto'
 */
function computeSignature(secret: string, data: string): string {
  let h1 = 0xdeadbeef ^ secret.length;
  let h2 = 0x41c64e6d ^ data.length;
  const combined = `${secret}:${data}:${secret}`;
  for (let i = 0; i < combined.length; i++) {
    const ch = combined.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  let fullSig = '';
  for (let i = 0; i < 4; i++) {
    fullSig += ((h1 ^ (i * 0x9e3779b9)) >>> 0).toString(16).padStart(8, '0');
    fullSig += ((h2 ^ (i * 0x517cc1b7)) >>> 0).toString(16).padStart(8, '0');
  }
  return toBase64Url(fullSig);
}

/**
 * Issues a short-lived (5 minutes) SSO token for a user transitioning into a module.
 */
export function issueModuleToken(
  user: User,
  workspace: Workspace,
  moduleId: string,
  language: 'fr' | 'en' = 'fr'
): string {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 5 * 60; // 5 minutes TTL

  const payload: ModuleTokenPayload = {
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    workspaceId: workspace.company_id || workspace.id,
    workspaceName: workspace.name,
    role: user.role,
    language,
    currency: workspace.currency || 'XOF',
    moduleId,
    iat: now,
    exp,
  };

  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = computeSignature(MOCK_SSO_SECRET, `${encodedHeader}.${encodedPayload}`);

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

/**
 * Verifies a module SSO token.
 * Used by native and third-party modules to authenticate the handoff.
 */
export function verifyModuleToken(token: string): { valid: boolean; payload?: ModuleTokenPayload; error?: string } {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return { valid: false, error: 'Malformed token structure' };
    }

    const [encodedHeader, encodedPayload, signature] = parts;

    // Verify signature
    const expectedSignature = computeSignature(MOCK_SSO_SECRET, `${encodedHeader}.${encodedPayload}`);

    if (signature !== expectedSignature) {
      return { valid: false, error: 'Invalid token signature' };
    }

    // Decode and verify expiration
    const payloadJson = fromBase64Url(encodedPayload);
    const payload: ModuleTokenPayload = JSON.parse(payloadJson);

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      return { valid: false, error: 'Token expired (TTL 5 minutes exceeded)' };
    }

    return { valid: true, payload };
  } catch (err: any) {
    return { valid: false, error: err?.message || 'Token verification failed' };
  }
}
