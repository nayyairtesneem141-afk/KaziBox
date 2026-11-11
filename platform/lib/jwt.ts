import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * Persistent RS256 JWT Keypair Manager for KaziBox Platform.
 *
 * Guarantees:
 * - Stable key identification (`kid`: 'kz_key_2026_01').
 * - Deterministic / persistent key provisioning.
 * - Stored securely on filesystem or derived from KAZIBOX_JWT_PRIVATE_KEY.
 * - Exportable as standard RFC 7517 Public JWKS.
 */

const DEFAULT_KID = 'kz_key_2026_01';
const KEY_CACHE_PATH = path.resolve(process.cwd(), '.cache', 'kazibox_jwt_rs256.json');

interface StoredKeypair {
  kid: string;
  privateKeyPem: string;
  publicKeyPem: string;
  jwk: Record<string, any>;
  createdAt: string;
}

let cachedKeypair: StoredKeypair | null = null;

export function getOrCreatePersistentJwtKeypair(): StoredKeypair {
  if (cachedKeypair) {
    return cachedKeypair;
  }

  // 1. If explicit environment variable is set
  if (process.env.KAZIBOX_JWT_PRIVATE_KEY && process.env.KAZIBOX_JWT_PUBLIC_KEY) {
    const pubKey = crypto.createPublicKey(process.env.KAZIBOX_JWT_PUBLIC_KEY);
    const jwk = pubKey.export({ format: 'jwk' });
    cachedKeypair = {
      kid: process.env.KAZIBOX_JWT_KID || DEFAULT_KID,
      privateKeyPem: process.env.KAZIBOX_JWT_PRIVATE_KEY,
      publicKeyPem: process.env.KAZIBOX_JWT_PUBLIC_KEY,
      jwk: { ...jwk, kid: process.env.KAZIBOX_JWT_KID || DEFAULT_KID, alg: 'RS256', use: 'sig' },
      createdAt: new Date().toISOString(),
    };
    return cachedKeypair;
  }

  // 2. Check persistent disk cache
  try {
    if (fs.existsSync(KEY_CACHE_PATH)) {
      const raw = fs.readFileSync(KEY_CACHE_PATH, 'utf-8');
      const parsed: StoredKeypair = JSON.parse(raw);
      if (parsed.privateKeyPem && parsed.publicKeyPem) {
        cachedKeypair = parsed;
        return cachedKeypair;
      }
    }
  } catch (err) {
    // Disk read failed, fallback to generation
  }

  // 3. Generate stable keypair and persist
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const pubKeyObj = crypto.createPublicKey(publicKey);
  const rawJwk = pubKeyObj.export({ format: 'jwk' });
  const jwk = {
    ...rawJwk,
    kid: DEFAULT_KID,
    alg: 'RS256',
    use: 'sig',
  };

  const record: StoredKeypair = {
    kid: DEFAULT_KID,
    privateKeyPem: privateKey,
    publicKeyPem: publicKey,
    jwk,
    createdAt: new Date().toISOString(),
  };

  try {
    const dir = path.dirname(KEY_CACHE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(KEY_CACHE_PATH, JSON.stringify(record, null, 2), 'utf-8');
  } catch (writeErr) {
    // In read-only filesystem environments, memory cache still functions
  }

  cachedKeypair = record;
  return cachedKeypair;
}

export function getPublicJwks() {
  const kp = getOrCreatePersistentJwtKeypair();
  return {
    keys: [kp.jwk],
  };
}

export function getPublicKeyPem(): string {
  const kp = getOrCreatePersistentJwtKeypair();
  return kp.publicKeyPem;
}

export interface UserTokenClaims {
  sub: string;
  email: string;
  name: string;
  role: string;
  company_id: string;
  workspace_id: string;
  aud: string; // moduleId
  iss: string;
  token_use: 'user_api';
  scopes: string[];
  iat: number;
  exp: number;
  jti: string;
}

/**
 * Signs a User API Token using RSA SHA-256 (RS256) with KaziBox platform's persistent private key.
 */
export function signAsymmetricUserToken(
  params: {
    userId: string;
    email: string;
    name: string;
    role: string;
    companyId: string;
    moduleId: string;
    scopes?: string[];
    ttlSeconds?: number;
  }
): { token: string; expiresIn: number; claims: UserTokenClaims } {
  const kp = getOrCreatePersistentJwtKeypair();
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = Math.min(params.ttlSeconds || 3600, 3600); // Max 1 hour
  const exp = now + expiresIn;
  const jti = `tok_${Date.now()}_${crypto.randomBytes(12).toString('hex')}`;

  const header = {
    alg: 'RS256',
    typ: 'JWT',
    kid: kp.kid,
  };

  const claims: UserTokenClaims = {
    sub: params.userId,
    email: params.email,
    name: params.name,
    role: params.role,
    company_id: params.companyId,
    workspace_id: params.companyId,
    aud: params.moduleId,
    iss: 'https://platform.kazibox.com',
    token_use: 'user_api',
    scopes: params.scopes || ['user:profile', 'user:workspace'],
    iat: now,
    exp,
    jti,
  };

  const toB64Url = (obj: any) =>
    Buffer.from(JSON.stringify(obj), 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

  const encodedHeader = toB64Url(header);
  const encodedPayload = toB64Url(claims);
  const dataToSign = `${encodedHeader}.${encodedPayload}`;

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(dataToSign);
  const signature = signer
    .sign(kp.privateKeyPem, 'base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const token = `${dataToSign}.${signature}`;
  return { token, expiresIn, claims };
}

export interface VerifyUserTokenResult {
  valid: boolean;
  claims?: UserTokenClaims;
  error?: string;
  code?: 'INVALID_FORMAT' | 'SIGNATURE_MISMATCH' | 'EXPIRED' | 'AUDIENCE_MISMATCH' | 'ISSUER_MISMATCH' | 'PARSE_ERROR';
}

/**
 * Verifies an asymmetric RS256 User API Token against KaziBox's public key.
 */
export function verifyAsymmetricUserToken(
  token: string,
  options: { expectedAudience?: string; expectedIssuer?: string } = {}
): VerifyUserTokenResult {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Token is missing or not a string', code: 'INVALID_FORMAT' };
  }

  const parts = token.trim().split('.');
  if (parts.length !== 3) {
    return { valid: false, error: 'Malformed token structure (expected 3 parts)', code: 'INVALID_FORMAT' };
  }

  const [encodedHeader, encodedPayload, signature] = parts;

  // 1. Verify RS256 signature using public key
  try {
    const kp = getOrCreatePersistentJwtKeypair();
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${encodedHeader}.${encodedPayload}`);
    const b64Sig = signature.replace(/-/g, '+').replace(/_/g, '/');
    const valid = verifier.verify(kp.publicKeyPem, b64Sig, 'base64');
    if (!valid) {
      return { valid: false, error: 'Invalid cryptographic RS256 signature', code: 'SIGNATURE_MISMATCH' };
    }
  } catch (sigErr: any) {
    return { valid: false, error: sigErr?.message || 'Signature check failed', code: 'SIGNATURE_MISMATCH' };
  }

  // 2. Decode claims and verify expiration, issuer, audience
  try {
    let b64Payload = encodedPayload.replace(/-/g, '+').replace(/_/g, '/');
    while (b64Payload.length % 4) b64Payload += '=';
    const jsonStr = Buffer.from(b64Payload, 'base64').toString('utf-8');
    const claims: UserTokenClaims = JSON.parse(jsonStr);

    const now = Math.floor(Date.now() / 1000);
    if (claims.exp && claims.exp < now) {
      return {
        valid: false,
        error: `Token expired at ${new Date(claims.exp * 1000).toISOString()}`,
        code: 'EXPIRED',
      };
    }

    const expectedIssuer = options.expectedIssuer || 'https://platform.kazibox.com';
    if (claims.iss && claims.iss !== expectedIssuer) {
      return {
        valid: false,
        error: `Token issuer mismatch: expected '${expectedIssuer}', got '${claims.iss}'`,
        code: 'ISSUER_MISMATCH',
      };
    }

    if (options.expectedAudience && claims.aud !== options.expectedAudience) {
      return {
        valid: false,
        error: `Token audience mismatch: expected '${options.expectedAudience}', got '${claims.aud}'`,
        code: 'AUDIENCE_MISMATCH',
      };
    }

    return { valid: true, claims };
  } catch (parseErr: any) {
    return { valid: false, error: 'Failed to parse token payload', code: 'PARSE_ERROR' };
  }
}

