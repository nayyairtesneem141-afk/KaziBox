import { createHmac, randomBytes } from 'crypto';
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
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  
  const signature = createHmac('sha256', MOCK_SSO_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');

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
    const expectedSignature = createHmac('sha256', MOCK_SSO_SECRET)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64url');

    if (signature !== expectedSignature) {
      return { valid: false, error: 'Invalid token signature' };
    }

    // Decode and verify expiration
    const payloadJson = Buffer.from(encodedPayload, 'base64url').toString('utf-8');
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
