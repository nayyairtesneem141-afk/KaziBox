import { toBase64Url, fromBase64Url, computeSsoSignature, computeHmacSha256Base64Url } from './crypto.js';
import { User, Workspace } from './types.js';

export const DEFAULT_SSO_SECRET =
  (typeof process !== 'undefined' && process.env?.KAZIBOX_SSO_SECRET) ||
  'kazibox_mock_sso_secret_key_prod_env_replace';

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
  jti?: string; // Unique token identifier for single-use replay protection
  iss?: string; // Token issuer (e.g. 'https://platform.kazibox.com')
  aud?: string; // Audience (moduleId)
  token_use?: 'sso_handoff' | 'user_api';
}

export interface IssueSsoTokenParams {
  user: Pick<User, 'id' | 'name' | 'email' | 'role'>;
  workspace: Pick<Workspace, 'id' | 'name'> & { company_id?: string; currency?: string };
  moduleId: string;
  language?: 'fr' | 'en';
  ttlSeconds?: number;
  jti?: string;
}

/**
 * Issues a short-lived (default 5 minutes) SSO token for a user transitioning into a module.
 */
export function issueSsoToken(params: IssueSsoTokenParams, secret: string = DEFAULT_SSO_SECRET): string {
  const now = Math.floor(Date.now() / 1000);
  const ttl = params.ttlSeconds ?? 5 * 60;
  const exp = now + ttl;
  const jti = params.jti || `sso_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  const payload: ModuleTokenPayload = {
    userId: params.user.id,
    userName: params.user.name,
    userEmail: params.user.email,
    workspaceId: params.workspace.company_id || params.workspace.id,
    workspaceName: params.workspace.name,
    role: params.user.role,
    language: params.language || 'fr',
    currency: params.workspace.currency || 'XOF',
    moduleId: params.moduleId,
    iat: now,
    exp,
    jti,
    iss: 'https://platform.kazibox.com',
    aud: params.moduleId,
    token_use: 'sso_handoff',
  };

  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = computeSsoSignature(secret, `${encodedHeader}.${encodedPayload}`);

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

export interface SsoVerificationResult {
  valid: boolean;
  payload?: ModuleTokenPayload;
  error?: string;
  code?: 'INVALID_FORMAT' | 'SIGNATURE_MISMATCH' | 'EXPIRED' | 'PARSE_ERROR' | 'REPLAY_DETECTED';
}

/**
 * Verifies a module SSO handoff token.
 * Validates token structure, signature matching the module's SSO secret, and the 5-minute TTL.
 */
export function verifySsoToken(token: string, secret: string = DEFAULT_SSO_SECRET): SsoVerificationResult {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Token is missing or not a string', code: 'INVALID_FORMAT' };
  }

  const parts = token.trim().split('.');
  if (parts.length !== 3) {
    return { valid: false, error: 'Malformed token structure (expected 3 parts)', code: 'INVALID_FORMAT' };
  }

  const [encodedHeader, encodedPayload, signature] = parts;

  // 1. Verify signature (accepts both standard HMAC-SHA256 base64url and deterministic KaziBox SSO signature)
  const expectedSignature = computeSsoSignature(secret, `${encodedHeader}.${encodedPayload}`);
  const expectedHmacSignature = computeHmacSha256Base64Url(secret, `${encodedHeader}.${encodedPayload}`);
  if (signature !== expectedSignature && signature !== expectedHmacSignature) {
    return { valid: false, error: 'Invalid token signature', code: 'SIGNATURE_MISMATCH' };
  }

  // 2. Decode payload & verify TTL
  try {
    const payloadJson = fromBase64Url(encodedPayload);
    const payload: ModuleTokenPayload = JSON.parse(payloadJson);

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return {
        valid: false,
        error: `Token expired at ${new Date(payload.exp * 1000).toISOString()} (TTL exceeded)`,
        code: 'EXPIRED',
      };
    }

    // 3. Optional soft-validation of issuer and audience if present
    if (payload.iss && payload.iss !== 'https://platform.kazibox.com') {
      return { valid: false, error: `Invalid token issuer: ${payload.iss}`, code: 'SIGNATURE_MISMATCH' };
    }

    return { valid: true, payload };
  } catch (err: any) {
    return { valid: false, error: err?.message || 'Failed to parse token payload', code: 'PARSE_ERROR' };
  }
}
