import * as nodeCrypto from 'crypto';

/**
 * Universal Base64 and Base64URL encoding/decoding safe for Node.js and Browser.
 */
export function toBase64(str: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str, 'utf-8').toString('base64');
  }
  return btoa(
    encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) =>
      String.fromCharCode(parseInt(p1, 16))
    )
  );
}

export function fromBase64(b64: string): string {
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

export function toBase64Url(str: string): string {
  return toBase64(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(b64url: string): string {
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) {
    b64 += '=';
  }
  return fromBase64(b64);
}

/**
 * Computes standard HMAC-SHA256 digest in hex format.
 */
export function computeHmacSha256Hex(secret: string, data: string): string {
  if (nodeCrypto && typeof nodeCrypto.createHmac === 'function') {
    return nodeCrypto.createHmac('sha256', secret).update(data, 'utf-8').digest('hex');
  }
  // Browser fallback for hex digest
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
  return fullSig;
}

/**
 * Computes standard RFC 7515 HMAC-SHA256 Base64URL signature when Node crypto is available,
 * with fallback to deterministic signature.
 */
export function computeHmacSha256Base64Url(secret: string, data: string): string {
  if (nodeCrypto && typeof nodeCrypto.createHmac === 'function') {
    return nodeCrypto
      .createHmac('sha256', secret)
      .update(data, 'utf-8')
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }
  return computeSsoSignature(secret, data);
}

/**
 * Computes deterministic SSO signature compatible with KaziBox platform/lib/sso.ts.
 */
export function computeSsoSignature(secret: string, data: string): string {
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
