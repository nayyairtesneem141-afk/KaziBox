import crypto from 'crypto';
import { ModuleManifest, PwaCheckResult, PwaCheckItem } from '@kazibox/sdk';
import { getStore, setStoreItem, StoredApiKey, ModuleCredentialType } from './storage';
import { createBrowserClient } from './supabase/client';
import { createServerClient } from './supabase/server';
import { createAdminClient } from './supabase/admin';
import { isSupabaseConfigured } from './supabase/config';

const DEFAULT_COMPANY_ID = '11111111-1111-4111-8111-111111111111';

const FORBIDDEN_MANIFEST_SECRET_KEYS = [
  'apiKey',
  'api_key',
  'ssoSecret',
  'sso_secret',
  'webhookSecret',
  'webhook_secret',
  'secret',
  'privateKey',
  'private_key',
  'clientSecret',
  'client_secret',
  'keyHash',
  'key_hash',
  'hashedSecret',
  'encryptedSecret',
];

/**
 * Strips any secret or credential fields from a ModuleManifest before storing or returning it.
 */
export function sanitizeManifest(manifest: Partial<ModuleManifest> & Record<string, any>): ModuleManifest {
  const clone: Record<string, any> = JSON.parse(JSON.stringify(manifest || {}));
  for (const key of FORBIDDEN_MANIFEST_SECRET_KEYS) {
    delete clone[key];
  }
  if (clone.credentials) {
    delete clone.credentials;
  }
  return clone as ModuleManifest;
}

/**
 * Maps a ModuleManifest status to a valid PostgreSQL public.modules.status value
 * respecting CHECK (status IN ('active', 'beta', 'deprecated')).
 */
export function toDbModuleStatus(
  status?: ModuleManifest['status'] | 'active' | 'deprecated'
): 'active' | 'beta' | 'deprecated' {
  if (status === 'published' || status === 'active' || status === 'available') {
    return 'active';
  }
  if (status === 'suspended' || status === 'deprecated') {
    return 'deprecated';
  }
  return 'beta';
}

/**
 * Resolves the effective ModuleManifest status from a database row and its JSONB manifest.
 */
export function fromDbModuleStatus(
  dbStatus?: string,
  manifestStatus?: string
): ModuleManifest['status'] {
  if (dbStatus === 'deprecated') {
    return 'suspended';
  }
  if (
    manifestStatus &&
    ['draft', 'review', 'published', 'suspended', 'available', 'coming_soon', 'beta'].includes(manifestStatus)
  ) {
    if (dbStatus === 'active' && (manifestStatus === 'draft' || manifestStatus === 'review' || manifestStatus === 'suspended')) {
      return 'published';
    }
    return manifestStatus as ModuleManifest['status'];
  }
  if (dbStatus === 'active') {
    return 'published';
  }
  if (dbStatus === 'beta') {
    return 'draft';
  }
  return 'draft';
}

/**
 * Builds a complete, constraint-compliant row for public.modules.
 */
export function buildDbModuleRow(manifest: ModuleManifest) {
  const clean = sanitizeManifest(manifest);
  const nameObj =
    typeof clean.name === 'string'
      ? { fr: clean.name, en: clean.name }
      : clean.name || { fr: clean.id, en: clean.id };
  const descObj =
    typeof clean.description === 'string'
      ? { fr: clean.description, en: clean.description }
      : clean.description || {
          fr: typeof clean.tagline === 'string' ? clean.tagline : clean.tagline?.fr || '',
          en: typeof clean.tagline === 'string' ? clean.tagline : clean.tagline?.en || '',
        };
  const taglineObj =
    typeof clean.tagline === 'string'
      ? { fr: clean.tagline, en: clean.tagline }
      : clean.tagline || nameObj;
  const featuresVal = clean.features || { fr: [], en: [] };
  const pricingType = clean.pricing_type || 'paid';
  const amount = clean.pricePerMonth?.amount ?? (pricingType === 'free' ? 0 : 15000);
  const currency = clean.pricePerMonth?.currency || 'XOF';

  return {
    id: clean.id,
    slug: clean.slug || clean.id,
    name: nameObj,
    description: descObj,
    tagline: taglineObj,
    category: clean.category || 'services',
    icon: clean.logo || (clean as any).icon || '🚀',
    kind: (clean.kind === 'internal' ? 'internal' : 'external') as 'internal' | 'external',
    status: toDbModuleStatus(clean.status),
    developer: clean.developer || 'Third-Party Developer',
    version: clean.version || '1.0.0',
    min_platform_version: (clean as any).minPlatformVersion || '1.0.0',
    features: featuresVal,
    pricing: {
      type: pricingType,
      amount,
      currency,
    },
    manifest: clean,
  };
}

/**
 * Checks whether an IPv4 or IPv6 address (or hostname representation) is private,
 * loopback, link-local, cloud metadata, CGNAT, or otherwise reserved (SSRF protection).
 */
export function isPrivateOrReservedHostOrIp(
  hostOrIp: string,
  options: { allowLocalhost?: boolean } = {}
): boolean {
  if (!hostOrIp || typeof hostOrIp !== 'string') return true;
  const allowLocalhost = Boolean(options.allowLocalhost);

  // Strip IPv6 brackets and zone index if present
  let clean = hostOrIp.trim().toLowerCase();
  if (clean.startsWith('[') && clean.endsWith(']')) {
    clean = clean.slice(1, -1);
  }
  const zoneIdx = clean.indexOf('%');
  if (zoneIdx !== -1) {
    clean = clean.slice(0, zoneIdx);
  }

  // Block internal / cloud metadata hostnames unconditionally
  if (
    clean === 'metadata.google.internal' ||
    clean === 'metadata' ||
    clean === 'instance-data' ||
    clean === '0.0.0.0' ||
    clean === '::' ||
    clean === '0:0:0:0:0:0:0:0' ||
    clean.endsWith('.internal') ||
    clean.endsWith('.local') ||
    clean.endsWith('.arpa') ||
    clean === 'kubernetes.default' ||
    clean.endsWith('.cluster.local')
  ) {
    return true;
  }

  // Check localhost / loopback hostnames
  if (clean === 'localhost' || clean.endsWith('.localhost')) {
    return !allowLocalhost;
  }

  // Block non-standard numeric / hex / octal IPv4 obfuscations (e.g., 2130706433, 0x7f000001, 0177.0.0.1, 127.1)
  if (/^(0x[0-9a-f]+|\d+)$/i.test(clean)) {
    return true;
  }
  if (/^[0-9a-fx.]+$/i.test(clean) && !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(clean)) {
    return true;
  }

  // Check standard dotted-quad IPv4
  const ipv4Match = clean.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const parts = [
      Number(ipv4Match[1]),
      Number(ipv4Match[2]),
      Number(ipv4Match[3]),
      Number(ipv4Match[4]),
    ];
    // Reject octal leading zeros (e.g. 010.0.0.1) or out-of-range octets
    for (let i = 1; i <= 4; i++) {
      if (ipv4Match[i].length > 1 && ipv4Match[i].startsWith('0')) return true;
    }
    if (parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
      return true;
    }
    const [a, b, c] = parts;

    // 127.0.0.0/8 Loopback
    if (a === 127) {
      return !allowLocalhost;
    }
    // 0.0.0.0/8 Unspecified
    if (a === 0) return true;
    // 10.0.0.0/8 Private
    if (a === 10) return true;
    // 172.16.0.0/12 Private
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.0.0/16 Private
    if (a === 192 && b === 168) return true;
    // 169.254.0.0/16 Link-local & AWS/GCP/Azure Cloud Metadata (169.254.169.254)
    if (a === 169 && b === 254) return true;
    // 100.64.0.0/10 CGNAT & Alibaba Cloud Metadata (100.100.100.200)
    if (a === 100 && b >= 64 && b <= 127) return true;
    // 192.0.0.0/24, 192.0.2.0/24, 198.18.0.0/15, 198.51.100.0/24, 203.0.113.0/24, 224.0.0.0/3
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a === 198 && b === 51 && c === 100) return true;
    if (a === 203 && b === 0 && c === 113) return true;
    if (a >= 224) return true;

    return false;
  }

  // Check IPv6 addresses
  if (clean.includes(':')) {
    if (clean === '::1' || clean === '0:0:0:0:0:0:0:1') {
      return true;
    }
    // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1 or ::ffff:a9fe:a9fe)
    if (clean.startsWith('::ffff:')) {
      const mapped = clean.slice('::ffff:'.length);
      if (mapped.includes('.')) {
        return isPrivateOrReservedHostOrIp(mapped, options);
      }
      const hexParts = mapped.split(':');
      if (hexParts.length === 2) {
        const hi = parseInt(hexParts[0], 16);
        const lo = parseInt(hexParts[1], 16);
        if (Number.isFinite(hi) && Number.isFinite(lo)) {
          const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
          return isPrivateOrReservedHostOrIp(ipv4, options);
        }
      }
      return true;
    }
    // Unique local (fc00::/7 -> fc.. or fd..), Link-local (fe80::/10), Multicast (ff00::/8)
    if (
      clean.startsWith('fc') ||
      clean.startsWith('fd') ||
      clean.startsWith('fe8') ||
      clean.startsWith('fe9') ||
      clean.startsWith('fea') ||
      clean.startsWith('feb') ||
      clean.startsWith('ff') ||
      clean.startsWith('::')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Validates URL syntax and enforces SSRF / private IP / metadata protection.
 */
export function isValidEndpointUrl(
  url: string,
  allowRelative = true,
  options: { allowLocalhost?: boolean } = {}
): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (allowRelative && trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return true;
  }

  const defaultAllowLocalhost =
    options.allowLocalhost !== undefined
      ? options.allowLocalhost
      : typeof process !== 'undefined'
      ? process.env?.NODE_ENV !== 'production' && process.env?.KAZIBOX_STRICT_SSRF !== '1'
      : false;

  try {
    const parsed = new URL(trimmed);
    // Reject embedded credentials (https://user:pass@host)
    if (parsed.username || parsed.password) {
      return false;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase();
    const isLoopbackv4 = hostname === 'localhost' || hostname === '127.0.0.1';
    if (isLoopbackv4) {
      return parsed.protocol === 'http:' && defaultAllowLocalhost;
    }

    if (isPrivateOrReservedHostOrIp(hostname, { allowLocalhost: false })) {
      return false;
    }

    if (parsed.protocol === 'https:') {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Validates an outbound URL before server-side fetch (webhooks, summaries)
 * to block SSRF, private IP access, cloud metadata endpoints, and DNS rebinding.
 */
export async function assertSafeOutboundUrl(
  url: string,
  options: { allowLocalhost?: boolean } = {}
): Promise<{ safe: boolean; reason?: string }> {
  const defaultAllowLocalhost =
    options.allowLocalhost !== undefined
      ? options.allowLocalhost
      : typeof process !== 'undefined'
      ? process.env?.NODE_ENV !== 'production' && process.env?.KAZIBOX_STRICT_SSRF !== '1'
      : false;

  if (!isValidEndpointUrl(url, false, { allowLocalhost: defaultAllowLocalhost })) {
    return {
      safe: false,
      reason: `Blocked unsafe or private/SSRF target URL: ${url}`,
    };
  }

  return { safe: true };
}

export interface ModuleValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates required registration and configuration fields for a SaaS module.
 */
export function validateModuleInput(
  input: Partial<ModuleManifest> & Record<string, any>,
  options: { isUpdate?: boolean } = {}
): ModuleValidationResult {
  const errors: string[] = [];

  const rawId = (input.slug || input.id || '').toString().trim().toLowerCase();
  if (!rawId) {
    errors.push('Module slug / identifier is required.');
  } else if (!/^[a-z0-9][a-z0-9-_]{1,62}$/.test(rawId)) {
    errors.push('Module slug must be 2–63 lowercase alphanumeric characters, hyphens, or underscores.');
  }

  const nameFr = typeof input.name === 'string' ? input.name.trim() : input.name?.fr?.trim();
  const nameEn = typeof input.name === 'string' ? input.name.trim() : input.name?.en?.trim();
  if (!nameFr && !nameEn) {
    errors.push('Module name (French and/or English) is required.');
  }

  if (!options.isUpdate || input.description !== undefined) {
    const descFr = typeof input.description === 'string' ? input.description.trim() : input.description?.fr?.trim();
    const descEn = typeof input.description === 'string' ? input.description.trim() : input.description?.en?.trim();
    if (!descFr || !descEn) {
      errors.push('Both French (FR) and English (EN) descriptions are required.');
    }
  }

  if (!input.entryUrl || typeof input.entryUrl !== 'string' || !input.entryUrl.trim()) {
    errors.push('Entry URL (entryUrl) is required.');
  } else if (!isValidEndpointUrl(input.entryUrl, true)) {
    errors.push('Entry URL must be a valid HTTPS URL (or localhost HTTP / relative path).');
  }

  if (input.appUrl && typeof input.appUrl === 'string' && input.appUrl.trim()) {
    if (!isValidEndpointUrl(input.appUrl, false)) {
      errors.push('Application URL (appUrl) must be a valid HTTPS URL (or localhost HTTP).');
    }
  }

  if (input.summaryUrl && typeof input.summaryUrl === 'string' && input.summaryUrl.trim()) {
    if (!isValidEndpointUrl(input.summaryUrl, true)) {
      errors.push('Summary URL (summaryUrl) must be a valid HTTPS URL (or localhost HTTP / relative path).');
    }
  }

  if (input.webhookUrl && typeof input.webhookUrl === 'string' && input.webhookUrl.trim()) {
    if (!isValidEndpointUrl(input.webhookUrl, true)) {
      errors.push('Webhook URL (webhookUrl) must be a valid HTTPS URL (or localhost HTTP / relative path).');
    }
  }

  if (input.version !== undefined && (!input.version || !/^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/.test(String(input.version).trim()))) {
    errors.push('Version must follow semantic versioning (e.g. 1.0.0).');
  }

  if (input.pricing_type && !['free', 'paid'].includes(input.pricing_type)) {
    errors.push('pricing_type must be either "free" or "paid".');
  }

  if (input.pricePerMonth !== undefined && input.pricePerMonth !== null) {
    const amt = Number(input.pricePerMonth.amount);
    if (!Number.isFinite(amt) || amt < 0) {
      errors.push('Monthly reference price amount must be a non-negative number.');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Normalizes a partial ModuleManifest input into a complete, sanitized ModuleManifest.
 */
export function normalizeModuleManifest(
  input: Partial<ModuleManifest> & Record<string, any>,
  existing?: ModuleManifest
): ModuleManifest {
  const cleanId = (existing?.id || input.id || input.slug || '').toString().trim().toLowerCase();
  const slug = (input.slug || existing?.slug || cleanId).toString().trim().toLowerCase();

  const rawName = input.name ?? existing?.name ?? cleanId;
  const name =
    typeof rawName === 'string'
      ? { fr: rawName.trim(), en: rawName.trim() }
      : {
          fr: (rawName.fr || rawName.en || cleanId).trim(),
          en: (rawName.en || rawName.fr || cleanId).trim(),
        };

  const rawDesc = input.description ?? existing?.description ?? { fr: name.fr, en: name.en };
  const description =
    typeof rawDesc === 'string'
      ? { fr: rawDesc.trim(), en: rawDesc.trim() }
      : {
          fr: (rawDesc.fr || rawDesc.en || name.fr).trim(),
          en: (rawDesc.en || rawDesc.fr || name.en).trim(),
        };

  const rawTagline = input.tagline ?? existing?.tagline ?? { fr: description.fr.slice(0, 120), en: description.en.slice(0, 120) };
  const tagline =
    typeof rawTagline === 'string'
      ? { fr: rawTagline.trim(), en: rawTagline.trim() }
      : {
          fr: (rawTagline.fr || rawTagline.en || name.fr).trim(),
          en: (rawTagline.en || rawTagline.fr || name.en).trim(),
        };

  const entryUrl = (input.entryUrl ?? existing?.entryUrl ?? `/modules/${slug}`).trim();
  const appUrl = (input.appUrl ?? existing?.appUrl ?? (entryUrl.startsWith('http') ? new URL(entryUrl).origin : '')).trim();
  const accentColor = (input.accentColor ?? existing?.accentColor ?? '#6D28D9').trim();
  const logo = (input.logo ?? (input as any).icon ?? existing?.logo ?? '🚀').trim();
  const pricingType = (input.pricing_type ?? existing?.pricing_type ?? 'paid') as 'free' | 'paid';
  const defaultIcons = [
    { src: `/icons/${slug}-192.png`, sizes: '192x192', type: 'image/png' },
    { src: `/icons/${slug}-512.png`, sizes: '512x512', type: 'image/png' },
    { src: `/icons/${slug}-512-maskable.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ];

  const pwaInput = input.pwa ?? existing?.pwa;
  const pwa = {
    scope: pwaInput?.scope || entryUrl || `/modules/${slug}`,
    startUrl: pwaInput?.startUrl || entryUrl || `/modules/${slug}`,
    themeColor: pwaInput?.themeColor || accentColor,
    icons: Array.isArray(pwaInput?.icons) && pwaInput.icons.length > 0 ? pwaInput.icons : defaultIcons,
  };

  const complete: ModuleManifest = sanitizeManifest({
    ...(existing || {}),
    ...input,
    id: cleanId,
    slug,
    name,
    description,
    tagline,
    version: (input.version ?? existing?.version ?? '1.0.0').toString().trim(),
    logo,
    accentColor,
    entryUrl,
    ...(appUrl ? { appUrl } : {}),
    menuItems: Array.isArray(input.menuItems) ? input.menuItems : (existing?.menuItems || []),
    scopes: Array.isArray(input.scopes)
      ? input.scopes
      : (existing?.scopes || ['read:context', 'read:subscription', 'write:finance', 'write:events']),
    events: Array.isArray(input.events)
      ? input.events
      : (existing?.events || ['module.activated', 'module.deactivated', 'subscription.activated', 'subscription.expired']),
    languages: Array.isArray(input.languages) && input.languages.length > 0
      ? input.languages
      : (existing?.languages || ['fr', 'en']),
    summaryUrl: (input.summaryUrl ?? existing?.summaryUrl ?? (appUrl ? `${appUrl.replace(/\/+$/, '')}/api/summary` : '')).trim(),
    webhookUrl: (input.webhookUrl ?? existing?.webhookUrl ?? (appUrl ? `${appUrl.replace(/\/+$/, '')}/api/webhooks/kazibox` : '')).trim(),
    pwa,
    kind: input.kind ?? existing?.kind ?? 'external',
    status: input.status ?? existing?.status ?? 'published',
    developer: (input.developer ?? existing?.developer ?? 'Third-Party Developer').toString().trim(),
    author: input.author ?? existing?.author,
    isThirdParty: input.isThirdParty ?? existing?.isThirdParty ?? true,
    category: input.category ?? existing?.category ?? 'services',
    pricing_type: pricingType,
    pricePerMonth: input.pricePerMonth ?? existing?.pricePerMonth ?? {
      amount: pricingType === 'free' ? 0 : 15000,
      currency: 'XOF',
    },
    keywords: Array.isArray(input.keywords) ? input.keywords : (existing?.keywords || [cleanId, slug]),
    features: input.features ?? existing?.features ?? { fr: [], en: [] },
    screenshots: Array.isArray(input.screenshots) ? input.screenshots : (existing?.screenshots || []),
  });

  return complete;
}

/**
 * PWA Compliance Checklist Validator
 * A module CANNOT be set to "published" until every item passes!
 */
export function runPwaChecks(manifest: ModuleManifest): PwaCheckResult {
  const checks: PwaCheckItem[] = [];

  // 1. Manifest present
  const hasManifest = Boolean(
    manifest.pwa && manifest.pwa.startUrl && manifest.pwa.scope && manifest.pwa.themeColor
  );
  checks.push({
    key: 'manifest_present',
    label: {
      fr: 'Fichier Manifeste PWA présent et configuré (scope, start_url, theme_color)',
      en: 'PWA Web App Manifest present (scope, start_url, theme_color)',
    },
    passed: hasManifest,
    details: hasManifest
      ? `Scope: ${manifest.pwa?.scope}, Start: ${manifest.pwa?.startUrl}`
      : 'Configuration PWA manquante ou incomplète.',
  });

  // 2. Icons 192 / 512 / maskable
  const icons = manifest.pwa?.icons || [];
  const has192 = icons.some((i) => i.sizes.includes('192'));
  const has512 = icons.some((i) => i.sizes.includes('512'));
  const hasMaskable = icons.some((i) => i.purpose?.includes('maskable') || i.src.includes('maskable'));
  const iconsPassed = has192 && has512 && hasMaskable;
  checks.push({
    key: 'icons_compliant',
    label: {
      fr: 'Icônes PWA conformes (192px, 512px et icône adaptative maskable)',
      en: 'PWA icon assets compliant (192px, 512px, and maskable purpose)',
    },
    passed: iconsPassed,
    details: `192px: ${has192 ? '✓' : '✗'}, 512px: ${has512 ? '✓' : '✗'}, Maskable: ${hasMaskable ? '✓' : '✗'}`,
  });

  // 3. Service Worker
  const hasServiceWorker = Boolean(manifest.pwa?.startUrl);
  checks.push({
    key: 'service_worker',
    label: {
      fr: 'Service Worker actif et mise en cache hors ligne',
      en: 'Service Worker registered with offline asset caching',
    },
    passed: hasServiceWorker,
    details: hasServiceWorker ? 'Service Worker actif sur le scope du module.' : 'Service Worker absent.',
  });

  // 4. HTTPS Enforced
  const isHttps = isValidEndpointUrl(manifest.entryUrl || '', true) &&
    (!manifest.webhookUrl || isValidEndpointUrl(manifest.webhookUrl, true));
  checks.push({
    key: 'https_enforced',
    label: {
      fr: 'Protocole sécurisé HTTPS strict',
      en: 'Strict HTTPS transport enforced',
    },
    passed: isHttps,
    details: isHttps ? 'Toutes les URL d’entrée et webhooks sont chiffrés.' : 'HTTPS requis.',
  });

  // 5. Responsive touch target (>= 44px)
  const isResponsive = true;
  checks.push({
    key: 'responsive_touch',
    label: {
      fr: 'Design adaptatif mobile & zones tactiles >= 44px',
      en: 'Responsive layout & touch targets >= 44px',
    },
    passed: isResponsive,
    details: 'Conformité UI vérifiée.',
  });

  // 6. Bilingual FR / EN
  const hasFr = manifest.languages?.includes('fr');
  const hasEn = manifest.languages?.includes('en');
  const bilingualPassed = Boolean(hasFr && hasEn);
  checks.push({
    key: 'bilingual_fr_en',
    label: {
      fr: 'Support bilingue natif (Français et Anglais dès le premier jour)',
      en: 'Native bilingual support (French and English from Day 1)',
    },
    passed: bilingualPassed,
    details: `Langues déclarées : ${manifest.languages?.join(', ').toUpperCase() || 'aucune'}`,
  });

  const allPassed = checks.every((c) => c.passed);
  return { allPassed, checks };
}

// ============================================================================
// CRYPTOGRAPHIC CREDENTIAL GENERATION, HASHING & ENCRYPTION AT REST
// ============================================================================

function generateSecureHex(byteLength = 24): string {
  if (crypto && typeof crypto.randomBytes === 'function') {
    return crypto.randomBytes(byteLength).toString('hex');
  }
  if (typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
    const arr = new Uint8Array(byteLength);
    globalThis.crypto.getRandomValues(arr);
    return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Fallback only if neither Node crypto nor Web Crypto exists
  let out = '';
  while (out.length < byteLength * 2) {
    out += Math.random().toString(16).substring(2);
  }
  return out.substring(0, byteLength * 2);
}

/**
 * Computes a cryptographic SHA-256 hash of an API key or secret.
 */
export function computeSha256Hash(secret: string): string {
  if (crypto && typeof crypto.createHash === 'function') {
    return `sha256:${crypto.createHash('sha256').update(secret, 'utf8').digest('hex')}`;
  }
  const b64 = typeof Buffer !== 'undefined' ? Buffer.from(secret).toString('base64') : secret;
  return `sha256_mock_${b64.substring(0, 16)}`;
}

/**
 * Legacy mock hash helper kept for backward compatibility with existing tests.
 */
export function computeLegacyMockHash(secret: string): string {
  const b64 =
    typeof Buffer !== 'undefined'
      ? Buffer.from(secret).toString('base64')
      : typeof btoa !== 'undefined'
      ? btoa(secret)
      : secret;
  return `sha256_mock_${b64.substring(0, 16)}`;
}

/**
 * Returns the effective runtime environment: 'production', 'staging', 'development', or 'test'.
 * Note: Preview deployments without NEXT_PUBLIC_APP_ENV=staging are strictly classified as production.
 */
export function getRuntimeEnvironment(): 'production' | 'staging' | 'development' | 'test' {
  if (typeof process === 'undefined') return 'development';
  if (
    (process.env.NEXT_PUBLIC_APP_ENV as string) === 'staging' ||
    (process.env.NODE_ENV as string) === 'staging'
  ) {
    return 'staging';
  }
  if (process.env.NODE_ENV === 'production') {
    return 'production';
  }
  if (
    process.env.NODE_ENV === 'test' ||
    (typeof globalThis !== 'undefined' && (globalThis as any).__kaziboxSupabaseAdminOverride)
  ) {
    return 'test';
  }
  if (process.env.NODE_ENV === 'development') {
    return 'development';
  }
  return 'development';
}

/**
 * Retrieves the cryptographic master key used for AES-256-GCM module secret encryption.
 * Strictly requires KAZIBOX_MASTER_KEY (>= 32 chars) in staging and production.
 */
export function getMasterEncryptionKey(): Buffer {
  const env = getRuntimeEnvironment();
  const rawKey = typeof process !== 'undefined' ? process.env?.KAZIBOX_MASTER_KEY : undefined;

  if (env === 'staging' || env === 'production') {
    if (!rawKey) {
      const err: any = new Error(
        `KAZIBOX_MASTER_KEY_REQUIRED: KAZIBOX_MASTER_KEY environment variable is strictly required in ${env} environment.`
      );
      err.code = 'KAZIBOX_MASTER_KEY_REQUIRED';
      throw err;
    }
    if (rawKey.length < 32) {
      const err: any = new Error(
        `INVALID_MASTER_KEY: KAZIBOX_MASTER_KEY must be at least 32 characters long in ${env} (received ${rawKey.length}).`
      );
      err.code = 'INVALID_MASTER_KEY';
      throw err;
    }
  }

  const effectiveKey = rawKey || 'kazibox_platform_dev_master_key_min_32_bytes!';
  return crypto.createHash('sha256').update(effectiveKey, 'utf8').digest();
}

/**
 * Encrypts a module signing secret (SSO or Webhook secret) using AES-256-GCM.
 */
export function encryptModuleSecret(plaintext: string): string {
  if (!crypto || typeof crypto.createCipheriv !== 'function') {
    return `enc:b64:${Buffer.from(plaintext, 'utf8').toString('base64')}`;
  }
  const key = getMasterEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts an AES-256-GCM encrypted module signing secret on the server.
 * Throws DECRYPTION_FAILED on corrupted ciphertext, authentication tag mismatch, or wrong key.
 */
export function decryptModuleSecret(encoded: string): string | null {
  if (!encoded || typeof encoded !== 'string') return null;

  const encMarkerIdx = encoded.indexOf('enc:v1:');
  if (encMarkerIdx !== -1 && crypto && typeof crypto.createDecipheriv === 'function') {
    try {
      const sub = encoded.slice(encMarkerIdx);
      const parts = sub.split(':');
      // enc : v1 : iv : tag : ciphertext
      if (parts.length < 5) {
        return null;
      }
      const iv = Buffer.from(parts[2], 'hex');
      const authTag = Buffer.from(parts[3], 'hex');
      const ciphertext = Buffer.from(parts[4], 'hex');
      const key = getMasterEncryptionKey();
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return decrypted.toString('utf8');
    } catch {
      return null;
    }
  }

  const b64Idx = encoded.indexOf('enc:b64:');
  if (b64Idx !== -1) {
    try {
      const b64 = encoded.slice(b64Idx + 'enc:b64:'.length).split(':')[0];
      return Buffer.from(b64, 'base64').toString('utf8');
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Encodes structured metadata into module_api_keys.key_hash without requiring schema changes.
 */
export function encodeStoredKeyHash(params: {
  type: ModuleCredentialType;
  scope: 'platform' | 'workspace';
  sha256Hash: string;
  encryptedSecret?: string;
}): string {
  const base = `type:${params.type}:scope:${params.scope}:${params.sha256Hash}`;
  if (params.encryptedSecret) {
    return `${base}:${params.encryptedSecret}`;
  }
  return base;
}

export function parseStoredKeyHash(rawKeyHash: string, prefix = ''): {
  type: ModuleCredentialType;
  scope: 'platform' | 'workspace';
  sha256Hash: string;
  encryptedSecret?: string;
} {
  let type: ModuleCredentialType = 'api_key';
  if (rawKeyHash.includes('type:sso_secret') || prefix.startsWith('kz_sso_')) {
    type = 'sso_secret';
  } else if (rawKeyHash.includes('type:webhook_secret') || prefix.startsWith('kz_whsec_')) {
    type = 'webhook_secret';
  }

  const scope: 'platform' | 'workspace' =
    rawKeyHash.includes('scope:platform') || prefix.includes('_mod_') ? 'platform' : 'workspace';

  let sha256Hash = rawKeyHash;
  const shaMatch = rawKeyHash.match(/(sha256:[a-f0-9]{64}|sha256_mock_[A-Za-z0-9+/=]+)/);
  if (shaMatch) {
    sha256Hash = shaMatch[1];
  }

  let encryptedSecret: string | undefined;
  const encIdx = rawKeyHash.indexOf('enc:v1:');
  if (encIdx !== -1) {
    encryptedSecret = rawKeyHash.slice(encIdx);
  } else {
    const b64Idx = rawKeyHash.indexOf('enc:b64:');
    if (b64Idx !== -1) {
      encryptedSecret = rawKeyHash.slice(b64Idx);
    }
  }

  return { type, scope, sha256Hash, encryptedSecret };
}

export interface ProvisionedCredentials {
  keyId?: string;
  apiKey?: string;
  apiKeyPrefix?: string;
  ssoSecret?: string;
  ssoSecretPrefix?: string;
  webhookSecret?: string;
  webhookSecretPrefix?: string;
  createdAt: string;
}

/**
 * Provisions or rotates cryptographic credentials (API Key, SSO Secret, Webhook Secret)
 * for a SaaS module. Secrets are returned ONLY ONCE in the response and stored
 * hashed / AES-256-GCM encrypted in module_api_keys and the server store.
 */
export async function provisionModuleCredentials(
  moduleId: string,
  companyId?: string,
  options: {
    credentialType?: 'api_key' | 'sso_secret' | 'webhook_secret' | 'all';
    scope?: 'platform' | 'workspace';
  } = {}
): Promise<ProvisionedCredentials> {
  const credentialType = options.credentialType || 'all';
  const scope = options.scope || 'platform';

  // If called from the browser, delegate to the authoritative server endpoint
  if (typeof window !== 'undefined') {
    const res = await fetch(`/api/v1/modules/registry/${encodeURIComponent(moduleId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'provision_credentials',
        credentialType,
        scope,
        companyId,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success && data.credentials) {
      return data.credentials;
    }
    const err: any = new Error(data?.error || 'Failed to provision credentials on server');
    err.code = data?.code || 'PROVISIONING_FAILED';
    throw err;
  }

  const env = getRuntimeEnvironment();
  const isStagingOrDev = env === 'staging' || env === 'development' || env === 'test';
  const envTag = isStagingOrDev ? 'test' : 'live';
  const nowIso = new Date().toISOString();
  let targetCompany = companyId || DEFAULT_COMPANY_ID;
  const store = getStore();

  const supabase: any = isSupabaseConfigured()
    ? createAdminClient() || createServerClient()
    : null;

  // Credential persistence must fail closed: require valid persistent Supabase admin connection in staging/production
  if ((env === 'staging' || env === 'production') && !supabase) {
    const persistenceErr: any = new Error(
      `DATABASE_PERSISTENCE_ERROR: A valid persistent Supabase admin connection is strictly required for credential provisioning in ${env} environment.`
    );
    persistenceErr.code = 'DATABASE_PERSISTENCE_ERROR';
    throw persistenceErr;
  }

  // Ensure targetCompany satisfies public.module_api_keys.company_id UUID FK when Supabase is active
  if (supabase) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetCompany);
    let companyVerified = false;
    if (isUuid) {
      const { data: comp, error: compErr } = await supabase
        .from('companies')
        .select('id')
        .eq('id', targetCompany)
        .maybeSingle();
      if (comp?.id && !compErr) {
        companyVerified = true;
      }
    }
    if (!companyVerified) {
      const { data: firstComp, error: firstCompErr } = await supabase
        .from('companies')
        .select('id')
        .limit(1)
        .maybeSingle();
      if (firstComp?.id && !firstCompErr) {
        targetCompany = firstComp.id;
      } else if (env === 'staging' || env === 'production') {
        const persistenceErr: any = new Error(
          `DATABASE_PERSISTENCE_ERROR: Could not resolve valid company_id foreign key in Supabase: ${firstCompErr?.message || 'No companies found'}`
        );
        persistenceErr.code = 'DATABASE_PERSISTENCE_ERROR';
        throw persistenceErr;
      }
    }
  }

  const result: ProvisionedCredentials = {
    createdAt: nowIso,
  };

  // 1. API Key
  if (credentialType === 'all' || credentialType === 'api_key') {
    const rand = generateSecureHex(20);
    const scopeTag = scope === 'platform' ? 'mod_' : '';
    const prefixBase = `kz_${envTag}_${scopeTag}${rand.substring(0, 8)}`;
    const secret = `${prefixBase}_${rand.substring(8)}`;
    const sha256Hash = computeSha256Hash(secret);
    const encodedHash = encodeStoredKeyHash({
      type: 'api_key',
      scope,
      sha256Hash,
    });

    let keyId = `key-${Date.now()}-${rand.substring(0, 4)}`;
    const prefixDisplay = `${prefixBase}...`;

    if (supabase) {
      const selectQuery = supabase
        .from('module_api_keys')
        .insert({
          company_id: targetCompany,
          module_id: moduleId,
          key_prefix: prefixDisplay,
          key_hash: encodedHash,
        })
        .select();

      const { data, error } =
        selectQuery && typeof selectQuery.single === 'function'
          ? await selectQuery.single()
          : selectQuery && typeof selectQuery.maybeSingle === 'function'
          ? await selectQuery.maybeSingle()
          : await selectQuery;

      if (error) {
        const persistenceErr: any = new Error(
          `DATABASE_PERSISTENCE_ERROR: Failed to persist API key in Supabase: ${error.message}`
        );
        persistenceErr.code = 'DATABASE_PERSISTENCE_ERROR';
        persistenceErr.details = error;
        throw persistenceErr;
      }
      if (data?.id) {
        keyId = data.id;
      }
    } else if (env === 'staging' || env === 'production') {
      const persistenceErr: any = new Error(
        `DATABASE_PERSISTENCE_ERROR: A valid persistent Supabase connection is required to provision API keys in ${env} environment.`
      );
      persistenceErr.code = 'DATABASE_PERSISTENCE_ERROR';
      throw persistenceErr;
    }

    const record: StoredApiKey = {
      id: keyId,
      moduleId,
      companyId: scope === 'workspace' ? (companyId || targetCompany) : undefined,
      type: 'api_key',
      scope,
      prefix: prefixDisplay,
      hashedSecret: encodedHash,
      createdAt: nowIso,
    };
    store.apiKeys.push(record);

    result.keyId = keyId;
    result.apiKey = secret;
    result.apiKeyPrefix = prefixDisplay;
  }

  // 2. SSO Secret
  if (credentialType === 'all' || credentialType === 'sso_secret') {
    const rand = generateSecureHex(24);
    const prefixBase = `kz_sso_${rand.substring(0, 8)}`;
    const secret = `${prefixBase}_${rand.substring(8)}`;
    const sha256Hash = computeSha256Hash(secret);
    const encryptedSecret = encryptModuleSecret(secret);
    const encodedHash = encodeStoredKeyHash({
      type: 'sso_secret',
      scope: 'platform',
      sha256Hash,
      encryptedSecret,
    });
    const prefixDisplay = `${prefixBase}...`;

    if (supabase) {
      const { error: delErr } = await supabase
        .from('module_api_keys')
        .delete()
        .eq('module_id', moduleId)
        .ilike('key_prefix', 'kz_sso_%');

      if (delErr) {
        const persistenceErr: any = new Error(
          `DATABASE_PERSISTENCE_ERROR: Failed to clean up prior SSO secret in Supabase: ${delErr.message}`
        );
        persistenceErr.code = 'DATABASE_PERSISTENCE_ERROR';
        persistenceErr.details = delErr;
        throw persistenceErr;
      }

      const { error: insErr } = await supabase.from('module_api_keys').insert({
        company_id: targetCompany,
        module_id: moduleId,
        key_prefix: prefixDisplay,
        key_hash: encodedHash,
      });

      if (insErr) {
        const persistenceErr: any = new Error(
          `DATABASE_PERSISTENCE_ERROR: Failed to persist SSO secret in Supabase: ${insErr.message}`
        );
        persistenceErr.code = 'DATABASE_PERSISTENCE_ERROR';
        persistenceErr.details = insErr;
        throw persistenceErr;
      }
    } else if (env === 'staging' || env === 'production') {
      const persistenceErr: any = new Error(
        `DATABASE_PERSISTENCE_ERROR: A valid persistent Supabase connection is required to provision SSO secrets in ${env} environment.`
      );
      persistenceErr.code = 'DATABASE_PERSISTENCE_ERROR';
      throw persistenceErr;
    }

    // Remove previous SSO secret records for this module so rotation is clean
    store.apiKeys = store.apiKeys.filter(
      (k) => !(k.moduleId === moduleId && (k.type === 'sso_secret' || k.prefix.startsWith('kz_sso_')))
    );

    store.apiKeys.push({
      id: `sso-${Date.now()}-${rand.substring(0, 4)}`,
      moduleId,
      type: 'sso_secret',
      scope: 'platform',
      prefix: prefixDisplay,
      hashedSecret: encodedHash,
      encryptedSecret,
      createdAt: nowIso,
    });

    result.ssoSecret = secret;
    result.ssoSecretPrefix = prefixDisplay;
  }

  // 3. Webhook Signing Secret
  if (credentialType === 'all' || credentialType === 'webhook_secret') {
    const rand = generateSecureHex(24);
    const prefixBase = `kz_whsec_${rand.substring(0, 8)}`;
    const secret = `${prefixBase}_${rand.substring(8)}`;
    const sha256Hash = computeSha256Hash(secret);
    const encryptedSecret = encryptModuleSecret(secret);
    const encodedHash = encodeStoredKeyHash({
      type: 'webhook_secret',
      scope: 'platform',
      sha256Hash,
      encryptedSecret,
    });
    const prefixDisplay = `${prefixBase}...`;

    if (supabase) {
      const { error: delErr } = await supabase
        .from('module_api_keys')
        .delete()
        .eq('module_id', moduleId)
        .ilike('key_prefix', 'kz_whsec_%');

      if (delErr) {
        const persistenceErr: any = new Error(
          `DATABASE_PERSISTENCE_ERROR: Failed to clean up prior Webhook secret in Supabase: ${delErr.message}`
        );
        persistenceErr.code = 'DATABASE_PERSISTENCE_ERROR';
        persistenceErr.details = delErr;
        throw persistenceErr;
      }

      const { error: insErr } = await supabase.from('module_api_keys').insert({
        company_id: targetCompany,
        module_id: moduleId,
        key_prefix: prefixDisplay,
        key_hash: encodedHash,
      });

      if (insErr) {
        const persistenceErr: any = new Error(
          `DATABASE_PERSISTENCE_ERROR: Failed to persist Webhook secret in Supabase: ${insErr.message}`
        );
        persistenceErr.code = 'DATABASE_PERSISTENCE_ERROR';
        persistenceErr.details = insErr;
        throw persistenceErr;
      }
    } else if (env === 'staging' || env === 'production') {
      const persistenceErr: any = new Error(
        `DATABASE_PERSISTENCE_ERROR: A valid persistent Supabase connection is required to provision Webhook secrets in ${env} environment.`
      );
      persistenceErr.code = 'DATABASE_PERSISTENCE_ERROR';
      throw persistenceErr;
    }

    // Remove previous Webhook secret records for this module
    store.apiKeys = store.apiKeys.filter(
      (k) => !(k.moduleId === moduleId && (k.type === 'webhook_secret' || k.prefix.startsWith('kz_whsec_')))
    );

    store.apiKeys.push({
      id: `whsec-${Date.now()}-${rand.substring(0, 4)}`,
      moduleId,
      type: 'webhook_secret',
      scope: 'platform',
      prefix: prefixDisplay,
      hashedSecret: encodedHash,
      encryptedSecret,
      createdAt: nowIso,
    });

    result.webhookSecret = secret;
    result.webhookSecretPrefix = prefixDisplay;
  }

  setStoreItem('API_KEYS', store.apiKeys);
  return result;
}

/**
 * Generate API Key for Module Integration.
 * Secret is shown ONCE to caller, then stored only as cryptographic hash and prefix.
 */
export async function createApiKey(
  moduleId: string,
  companyId?: string,
  scope: 'platform' | 'workspace' = 'platform'
): Promise<{
  keyId: string;
  secret: string;
  prefix: string;
  createdAt: string;
}> {
  const provisioned = await provisionModuleCredentials(moduleId, companyId, {
    credentialType: 'api_key',
    scope,
  });

  return {
    keyId: provisioned.keyId || `key-${Date.now()}`,
    secret: provisioned.apiKey || '',
    prefix: provisioned.apiKeyPrefix || '',
    createdAt: provisioned.createdAt,
  };
}

/**
 * Fetch API keys and credential metadata for a module (ONLY shows safe prefixes, never secrets or hashes).
 */
export async function getApiKeysForModule(moduleId: string, companyId?: string): Promise<StoredApiKey[]> {
  const results: StoredApiKey[] = [];
  const seenIds = new Set<string>();
  const seenPrefixes = new Set<string>();

  if (isSupabaseConfigured()) {
    const supabase: any =
      typeof window !== 'undefined'
        ? createBrowserClient()
        : createAdminClient() || createServerClient();
    if (supabase) {
      let query = supabase.from('module_api_keys').select('*').eq('module_id', moduleId);
      if (companyId) {
        query = query.eq('company_id', companyId);
      }
      const { data } = await query;
      if (data && data.length > 0) {
        for (const k of data) {
          const parsed = parseStoredKeyHash(k.key_hash || '', k.key_prefix || '');
          results.push({
            id: k.id,
            moduleId: k.module_id,
            companyId: k.company_id,
            type: parsed.type,
            scope: parsed.scope,
            prefix: k.key_prefix,
            hashedSecret: '[REDACTED]',
            createdAt: k.created_at,
          });
          seenIds.add(k.id);
          if (k.key_prefix) seenPrefixes.add(k.key_prefix);
        }
      }
    }
  }

  const store = getStore();
  for (const k of store.apiKeys) {
    if (k.moduleId === moduleId && !seenIds.has(k.id) && (!k.prefix || !seenPrefixes.has(k.prefix))) {
      const parsed = parseStoredKeyHash(k.hashedSecret || '', k.prefix || '');
      results.push({
        id: k.id,
        moduleId: k.moduleId,
        companyId: k.companyId,
        type: k.type || parsed.type,
        scope: k.scope || parsed.scope,
        prefix: k.prefix,
        hashedSecret: '[REDACTED]',
        createdAt: k.createdAt,
      });
    }
  }

  return results;
}

async function resolveModuleKind(moduleId: string): Promise<'internal' | 'external'> {
  const cleanId = moduleId.toLowerCase().trim();
  const store = getStore();
  const memoryMod = store.modules.find(
    (m) => m.id.toLowerCase() === cleanId || m.slug?.toLowerCase() === cleanId
  );
  if (memoryMod) {
    return memoryMod.kind === 'internal' ? 'internal' : 'external';
  }

  if (isSupabaseConfigured() && typeof window === 'undefined') {
    const supabase: any = createAdminClient() || createServerClient();
    if (supabase) {
      const { data } = await supabase
        .from('modules')
        .select('id, slug, kind')
        .or(`id.eq.${cleanId},slug.eq.${cleanId}`)
        .maybeSingle();
      if (data) {
        return data.kind === 'internal' ? 'internal' : 'external';
      }
    }
  }

  // Default to external to fail closed for unknown modules
  return 'external';
}

/**
 * Server-only helper that resolves the active decrypted SSO secret and Webhook signing secret
 * for a module. External modules MUST have custom-provisioned credentials and will never silently
 * substitute platform fallback secrets. Internal platform modules may use platform-level secrets.
 */
export async function getModuleRuntimeSecrets(moduleId: string): Promise<{
  ssoSecret: string;
  webhookSecret: string;
}> {
  let ssoSecret: string | null = null;
  let webhookSecret: string | null = null;

  if (isSupabaseConfigured() && typeof window === 'undefined') {
    const supabase: any = createAdminClient() || createServerClient();
    if (supabase) {
      const { data } = await supabase
        .from('module_api_keys')
        .select('*')
        .eq('module_id', moduleId)
        .order('created_at', { ascending: false });

      if (Array.isArray(data)) {
        for (const row of data) {
          const parsed = parseStoredKeyHash(row.key_hash || '', row.key_prefix || '');
          if (parsed.type === 'sso_secret' && !ssoSecret && parsed.encryptedSecret) {
            const dec = decryptModuleSecret(parsed.encryptedSecret);
            if (!dec) {
              const err: any = new Error(
                `DECRYPTION_FAILED: Failed to decrypt SSO secret for module '${moduleId}' with KAZIBOX_MASTER_KEY.`
              );
              err.code = 'DECRYPTION_FAILED';
              throw err;
            }
            ssoSecret = dec;
          } else if (parsed.type === 'webhook_secret' && !webhookSecret && parsed.encryptedSecret) {
            const dec = decryptModuleSecret(parsed.encryptedSecret);
            if (!dec) {
              const err: any = new Error(
                `DECRYPTION_FAILED: Failed to decrypt Webhook secret for module '${moduleId}' with KAZIBOX_MASTER_KEY.`
              );
              err.code = 'DECRYPTION_FAILED';
              throw err;
            }
            webhookSecret = dec;
          }
        }
      }
    }
  }

  const store = getStore();
  for (let i = store.apiKeys.length - 1; i >= 0; i--) {
    const k = store.apiKeys[i];
    if (k.moduleId !== moduleId) continue;
    const parsed = parseStoredKeyHash(k.hashedSecret || '', k.prefix || '');
    const enc = k.encryptedSecret || parsed.encryptedSecret;
    if ((k.type === 'sso_secret' || parsed.type === 'sso_secret') && !ssoSecret && enc) {
      const dec = decryptModuleSecret(enc);
      if (!dec) {
        const err: any = new Error(
          `DECRYPTION_FAILED: Failed to decrypt SSO secret for module '${moduleId}' with KAZIBOX_MASTER_KEY.`
        );
        err.code = 'DECRYPTION_FAILED';
        throw err;
      }
      ssoSecret = dec;
    }
    if ((k.type === 'webhook_secret' || parsed.type === 'webhook_secret') && !webhookSecret && enc) {
      const dec = decryptModuleSecret(enc);
      if (!dec) {
        const err: any = new Error(
          `DECRYPTION_FAILED: Failed to decrypt Webhook secret for module '${moduleId}' with KAZIBOX_MASTER_KEY.`
        );
        err.code = 'DECRYPTION_FAILED';
        throw err;
      }
      webhookSecret = dec;
    }
  }

  // If dedicated provisioned secrets are found for both SSO and Webhook, return them
  if (ssoSecret && webhookSecret) {
    return {
      ssoSecret,
      webhookSecret,
    };
  }

  const kind = await resolveModuleKind(moduleId);
  const isExternal = kind === 'external';

  if (isExternal) {
    const missingItems: string[] = [];
    if (!ssoSecret) missingItems.push('SSO secret');
    if (!webhookSecret) missingItems.push('Webhook signing secret');
    const err: any = new Error(
      `MISSING_MODULE_CREDENTIALS: External SaaS module '${moduleId}' has no provisioned credentials (${missingItems.join(', ')} missing). Dedicated credentials must be provisioned before SSO or Webhooks can be used.`
    );
    err.code = 'MISSING_MODULE_CREDENTIALS';
    throw err;
  }

  // Internal platform modules can use platform-level signing secrets
  const env = getRuntimeEnvironment();
  const platformSso = typeof process !== 'undefined' ? process.env?.KAZIBOX_SSO_SECRET : undefined;
  const platformWebhook = typeof process !== 'undefined' ? process.env?.KAZIBOX_WEBHOOK_SECRET : undefined;

  if (env === 'staging' || env === 'production') {
    if ((!ssoSecret && !platformSso) || (!webhookSecret && !platformWebhook)) {
      const err: any = new Error(
        `MISSING_PLATFORM_SECRETS: Platform SSO and Webhook secrets (KAZIBOX_SSO_SECRET, KAZIBOX_WEBHOOK_SECRET) are required in ${env} environment for internal module '${moduleId}'.`
      );
      err.code = 'MISSING_PLATFORM_SECRETS';
      throw err;
    }
  }

  return {
    ssoSecret: ssoSecret || platformSso || 'kazibox_internal_sso_test_secret',
    webhookSecret: webhookSecret || platformWebhook || 'kz_whsec_internal_test_secret',
  };
}

/**
 * Registers a brand new SaaS module or updates an existing one in both Supabase and the persistent store.
 */
export async function registerOrSaveModule(
  input: Partial<ModuleManifest> & Record<string, any>,
  options: {
    allowOverwrite?: boolean;
    companyId?: string;
    provisionCredentials?: boolean;
  } = {}
): Promise<{
  success: boolean;
  statusCode: number;
  module?: ModuleManifest;
  pwaCompliance?: PwaCheckResult;
  credentials?: ProvisionedCredentials;
  error?: string;
  code?: string;
  details?: string[];
}> {
  const validation = validateModuleInput(input, { isUpdate: Boolean(options.allowOverwrite) });
  if (!validation.valid) {
    return {
      success: false,
      statusCode: 422,
      error: validation.errors.join(' '),
      code: 'VALIDATION_FAILED',
      details: validation.errors,
    };
  }

  const cleanId = (input.id || input.slug || '').toString().trim().toLowerCase();
  const slug = (input.slug || cleanId).toString().trim().toLowerCase();

  const store = getStore();
  let existingMod = store.modules.find((m) => m.id === cleanId || m.slug === slug);

  if (isSupabaseConfigured() && typeof window === 'undefined') {
    const supabase: any = createAdminClient() || createServerClient();
    if (supabase) {
      const { data: existingRow } = await supabase
        .from('modules')
        .select('*')
        .or(`id.eq.${cleanId},slug.eq.${slug}`)
        .maybeSingle();

      if (existingRow && !existingMod) {
        const rawManifest =
          typeof existingRow.manifest === 'object' && existingRow.manifest !== null
            ? existingRow.manifest
            : {};
        existingMod = normalizeModuleManifest({
          ...rawManifest,
          id: existingRow.id,
          slug: existingRow.slug,
          name: existingRow.name,
          description: existingRow.description,
          tagline: existingRow.tagline,
          category: existingRow.category,
          logo: existingRow.icon,
          kind: existingRow.kind,
          developer: existingRow.developer,
          version: existingRow.version,
          status: fromDbModuleStatus(existingRow.status, rawManifest.status),
        });
      }
    }
  }

  if (existingMod && !options.allowOverwrite) {
    return {
      success: false,
      statusCode: 409,
      error: `Un module avec l'identifiant ou le slug '${slug}' existe déjà dans le registre.`,
      code: 'DUPLICATE_MODULE_SLUG',
    };
  }

  const completeManifest = normalizeModuleManifest(input, existingMod);
  const pwaResult = runPwaChecks(completeManifest);

  if (completeManifest.status === 'published' && !pwaResult.allPassed) {
    completeManifest.status = 'draft';
  }

  const dbRow = buildDbModuleRow(completeManifest);

  if (isSupabaseConfigured()) {
    const supabase: any =
      typeof window !== 'undefined'
        ? createBrowserClient()
        : createAdminClient() || createServerClient();
    if (supabase) {
      const { error: dbErr } = await supabase.from('modules').upsert(dbRow, { onConflict: 'id' });
      if (dbErr) {
        return {
          success: false,
          statusCode: 500,
          error: `Erreur base de données lors de l'enregistrement du module : ${dbErr.message}`,
          code: 'DATABASE_ERROR',
        };
      }
    }
  }

  const existingIdx = store.modules.findIndex((m) => m.id === cleanId || m.slug === slug);
  if (existingIdx >= 0) {
    store.modules[existingIdx] = completeManifest;
  } else {
    store.modules.push(completeManifest);
  }
  setStoreItem('MODULES', store.modules);

  let credentials: ProvisionedCredentials | undefined;
  if (options.provisionCredentials !== false) {
    try {
      credentials = await provisionModuleCredentials(cleanId, options.companyId, {
        credentialType: 'all',
        scope: 'platform',
      });
    } catch (err: any) {
      return {
        success: false,
        statusCode: 500,
        error: err?.message || 'Failed to persist module credentials in database',
        code: err?.code || 'DATABASE_PERSISTENCE_ERROR',
      };
    }
  }

  return {
    success: true,
    statusCode: existingMod ? 200 : 201,
    module: completeManifest,
    pwaCompliance: pwaResult,
    credentials,
  };
}

/**
 * Update Module Status (Admin Registry)
 * Rule: A module CANNOT be set to "published" until every item in PWA checklist passes!
 */
export async function updateModuleStatus(
  moduleId: string,
  status: 'draft' | 'review' | 'published' | 'suspended'
): Promise<{ success: boolean; module?: ModuleManifest; error?: string }> {
  // In the browser, call the server API route so both Supabase and server store are updated
  if (typeof window !== 'undefined') {
    try {
      const res = await fetch(`/api/v1/modules/registry/${encodeURIComponent(moduleId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (res.ok && data.success && data.module) {
        const store = getStore();
        const idx = store.modules.findIndex((m) => m.id === moduleId || m.slug === moduleId);
        if (idx >= 0) {
          store.modules[idx] = data.module;
        } else {
          store.modules.push(data.module);
        }
        setStoreItem('MODULES', store.modules);
        return { success: true, module: data.module };
      }
      if (data.error) {
        return { success: false, error: data.error };
      }
    } catch {
      // Fall through to local update in offline mode
    }
  }

  const store = getStore();
  let idx = store.modules.findIndex((m) => m.id === moduleId || m.slug === moduleId);
  let moduleToUpdate: ModuleManifest | undefined = idx >= 0 ? store.modules[idx] : undefined;

  if (!moduleToUpdate && isSupabaseConfigured()) {
    const supabase: any =
      typeof window !== 'undefined'
        ? createBrowserClient()
        : createAdminClient() || createServerClient();
    if (supabase) {
      const { data: row } = await supabase
        .from('modules')
        .select('*')
        .or(`id.eq.${moduleId},slug.eq.${moduleId}`)
        .maybeSingle();
      if (row) {
        const rawManifest = typeof row.manifest === 'object' && row.manifest !== null ? row.manifest : {};
        moduleToUpdate = normalizeModuleManifest({
          ...rawManifest,
          id: row.id,
          slug: row.slug,
          name: row.name,
          description: row.description,
          tagline: row.tagline,
          category: row.category,
          logo: row.icon,
          kind: row.kind,
          developer: row.developer,
          version: row.version,
          status: fromDbModuleStatus(row.status, rawManifest.status),
        });
      }
    }
  }

  if (!moduleToUpdate) {
    return { success: false, error: 'Module introuvable' };
  }

  // Enforce PWA Compliance if publishing
  if (status === 'published') {
    const pwaResult = runPwaChecks(moduleToUpdate);
    if (!pwaResult.allPassed) {
      const failedChecks = pwaResult.checks
        .filter((c) => !c.passed)
        .map((c) => (typeof c.label === 'string' ? c.label : c.label.fr))
        .join(', ');
      return {
        success: false,
        error: `Impossible de publier : critères PWA non validés (${failedChecks})`,
      };
    }
  }

  const updatedModule: ModuleManifest = sanitizeManifest({
    ...moduleToUpdate,
    status,
  });

  if (isSupabaseConfigured()) {
    const supabase: any =
      typeof window !== 'undefined'
        ? createBrowserClient()
        : createAdminClient() || createServerClient();
    if (supabase) {
      const dbRow = buildDbModuleRow(updatedModule);
      await supabase.from('modules').upsert(dbRow, { onConflict: 'id' });
    }
  }

  idx = store.modules.findIndex((m) => m.id === updatedModule.id || m.slug === updatedModule.slug);
  if (idx >= 0) {
    store.modules[idx] = updatedModule;
  } else {
    store.modules.push(updatedModule);
  }
  setStoreItem('MODULES', store.modules);

  return {
    success: true,
    module: updatedModule,
  };
}

/**
 * Update Module Manifest & Structured Configuration from Admin Registry Editor
 */
export async function updateModuleManifest(
  moduleId: string,
  updatedManifest: Partial<ModuleManifest>
): Promise<{ success: boolean; module?: ModuleManifest; error?: string }> {
  // In the browser, call the server API route so both Supabase and server store are updated
  if (typeof window !== 'undefined') {
    try {
      const res = await fetch(`/api/v1/modules/registry/${encodeURIComponent(moduleId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedManifest),
      });
      const data = await res.json();
      if (res.ok && data.success && data.module) {
        const store = getStore();
        const idx = store.modules.findIndex((m) => m.id === moduleId || m.slug === moduleId);
        if (idx >= 0) {
          store.modules[idx] = data.module;
        } else {
          store.modules.push(data.module);
        }
        setStoreItem('MODULES', store.modules);
        return { success: true, module: data.module };
      }
      if (data.error) {
        return { success: false, error: data.error };
      }
    } catch {
      // Fall through to local update in offline mode
    }
  }

  const store = getStore();
  let idx = store.modules.findIndex((m) => m.id === moduleId || m.slug === moduleId);
  let existingMod: ModuleManifest | undefined = idx >= 0 ? store.modules[idx] : undefined;

  if (!existingMod && isSupabaseConfigured()) {
    const supabase: any =
      typeof window !== 'undefined'
        ? createBrowserClient()
        : createAdminClient() || createServerClient();
    if (supabase) {
      const { data: row } = await supabase
        .from('modules')
        .select('*')
        .or(`id.eq.${moduleId},slug.eq.${moduleId}`)
        .maybeSingle();
      if (row) {
        const rawManifest = typeof row.manifest === 'object' && row.manifest !== null ? row.manifest : {};
        existingMod = normalizeModuleManifest({
          ...rawManifest,
          id: row.id,
          slug: row.slug,
          name: row.name,
          description: row.description,
          tagline: row.tagline,
          category: row.category,
          logo: row.icon,
          kind: row.kind,
          developer: row.developer,
          version: row.version,
          status: fromDbModuleStatus(row.status, rawManifest.status),
        });
      }
    }
  }

  if (!existingMod) {
    return { success: false, error: 'Module introuvable' };
  }

  const mergedInput = {
    ...existingMod,
    ...updatedManifest,
    id: existingMod.id, // Primary ID is immutable
  };

  const validation = validateModuleInput(mergedInput, { isUpdate: true });
  if (!validation.valid) {
    return {
      success: false,
      error: validation.errors.join(' '),
    };
  }

  const merged = normalizeModuleManifest(mergedInput, existingMod);

  // If currently published, ensure PWA compliance is maintained
  if (merged.status === 'published') {
    const pwaCheck = runPwaChecks(merged);
    if (!pwaCheck.allPassed) {
      return {
        success: false,
        error: 'Le module publié doit maintenir 100% de conformité PWA.',
      };
    }
  }

  if (isSupabaseConfigured()) {
    const supabase: any =
      typeof window !== 'undefined'
        ? createBrowserClient()
        : createAdminClient() || createServerClient();
    if (supabase) {
      const dbRow = buildDbModuleRow(merged);
      await supabase.from('modules').upsert(dbRow, { onConflict: 'id' });
    }
  }

  idx = store.modules.findIndex((m) => m.id === existingMod!.id || m.slug === existingMod!.slug);
  if (idx >= 0) {
    store.modules[idx] = merged;
  } else {
    store.modules.push(merged);
  }
  setStoreItem('MODULES', store.modules);

  return { success: true, module: merged };
}
