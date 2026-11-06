/**
 * KaziBox Flex Validation Harness — Safety Configuration & Environment Guards
 *
 * CRITICAL SAFETY RULES:
 * 1. Defaults to DRY_RUN mode. Live execution requires EXECUTE_LIVE_MUTATIONS="true".
 * 2. Refuses to start unless CONFIRM_DISPOSABLE_ENVIRONMENT="true" is set.
 *    NOTE: CONFIRM_DISPOSABLE_ENVIRONMENT="true" alone does NOT prove a target is disposable;
 *    it acts as a required explicit operator confirmation gate.
 * 3. Extracts project reference and rejects blocked project IDs (vkixehivjytpuhrjlaud, etc.).
 * 4. Automatically discovers and blocks any project URL/ID configured in local .env files.
 * 5. Fails closed on unrecognized, ambiguous, or malformed URL structures.
 * 6. Never prints or logs credentials, tokens, or raw authorization headers.
 */

import fs from 'node:fs';
import path from 'node:path';

// Known blocked production and preview project references
const HARDCODED_BLOCKED_REFS = new Set([
  'vkixehivjytpuhrjlaud', // Primary KaziBox project ref
  'lvfoklqxqwgpktylphbu', // Central Moteur engine edge gateway ref
]);

/**
 * Masks a secret string to prevent credential exposure in logs.
 * @param {string|undefined|null} secret
 * @returns {string}
 */
export function maskSecret(secret) {
  if (!secret || typeof secret !== 'string') return '[EMPTY]';
  if (secret.length <= 8) return '[REDACTED]';
  return `${secret.slice(0, 3)}...${secret.slice(-3)} [REDACTED ${secret.length} chars]`;
}

/**
 * Extracts the Supabase project reference from a URL.
 * Supports: https://<ref>.supabase.co or localhost/127.0.0.1
 * Fails closed on ambiguous, malformed, or nested subdomain structures.
 * @param {string} urlString
 * @returns {string|null}
 */
export function extractProjectRef(urlString) {
  if (!urlString || typeof urlString !== 'string') return null;
  const trimmed = urlString.trim();

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null; // Malformed URL -> fail closed
  }

  // Reject unsupported protocols
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();

  // Local test instance
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'local-disposable-instance';
  }

  // Hosted Supabase domains: *.supabase.co or *.supabase.net
  if (hostname.endsWith('.supabase.co') || hostname.endsWith('.supabase.net')) {
    const parts = hostname.split('.');
    // Standard hosted format: <project-ref>.supabase.co (3 parts)
    if (parts.length === 3) {
      const ref = parts[0];
      if (/^[a-z0-9-]+$/.test(ref)) {
        return ref;
      }
    }
    // Direct pooler format: db.<project-ref>.supabase.co (4 parts)
    if (parts.length === 4 && parts[0] === 'db') {
      const ref = parts[1];
      if (/^[a-z0-9-]+$/.test(ref)) {
        return ref;
      }
    }
  }

  return null;
}

/**
 * Scans local environment files to extract existing configured project references
 * and raw URLs without printing or exposing their contents.
 * @param {string} baseDir
 * @returns {{ blockedRefs: Set<string>, blockedSubstrings: Set<string> }}
 */
function discoverLocallyConfiguredBlockedTargets(baseDir) {
  const blockedRefs = new Set(HARDCODED_BLOCKED_REFS);
  const blockedSubstrings = new Set([...HARDCODED_BLOCKED_REFS]);

  const candidateFiles = [
    path.join(baseDir, '.env.local'),
    path.join(baseDir, '.env.preview.local'),
    path.join(baseDir, 'platform', '.env.local'),
    path.join(baseDir, 'platform', '.env.example'),
  ];

  for (const filePath of candidateFiles) {
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const matches = content.match(/https?:\/\/[^\s"'`]+/gi) || [];
        for (const rawUrl of matches) {
          const ref = extractProjectRef(rawUrl);
          if (ref && ref !== 'local-disposable-instance') {
            blockedRefs.add(ref);
            blockedSubstrings.add(ref);
          }
        }
      } catch {
        // Silently ignore read errors to maintain documentation integrity
      }
    }
  }

  return { blockedRefs, blockedSubstrings };
}

/**
 * Validates the environment and returns the sanitized configuration.
 * Aborts immediately if any safety gate fails.
 * @param {Object} options
 * @param {string} [options.rootDir]
 * @returns {Object} Sanitized configuration
 */
export function loadAndValidateConfig(options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const errors = [];

  // 1. Explicit Confirmation Flag
  const confirmationFlag = process.env.CONFIRM_DISPOSABLE_ENVIRONMENT;
  if (confirmationFlag !== 'true') {
    errors.push(
      'SAFETY ABORT: CONFIRM_DISPOSABLE_ENVIRONMENT must be set to "true". ' +
      'Setting this flag confirms operator intent for a disposable test environment, ' +
      'though it does not itself verify target project isolation.'
    );
  }

  // 2. Disposable Supabase URL
  const supabaseUrl = process.env.DISPOSABLE_SUPABASE_URL?.trim();
  if (!supabaseUrl) {
    errors.push('CONFIGURATION ERROR: DISPOSABLE_SUPABASE_URL environment variable is required.');
  }

  // 3. Service Role Key
  const serviceRoleKey = process.env.DISPOSABLE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) {
    errors.push('CONFIGURATION ERROR: DISPOSABLE_SERVICE_ROLE_KEY environment variable is required.');
  }

  // 4. URL Validation & Project Ref Extraction (Fail closed)
  let projectRef = null;
  if (supabaseUrl) {
    projectRef = extractProjectRef(supabaseUrl);
    if (!projectRef) {
      errors.push(
        'SECURITY ABORT: Ambiguous, malformed, or unrecognized DISPOSABLE_SUPABASE_URL. ' +
        'Must be in format "https://<project-ref>.supabase.co" or local test host.'
      );
    }
  }

  // 5. Unconditional Substring & Project Ref Blacklist Enforcement
  if (supabaseUrl) {
    // Check hardcoded production blocks unconditionally
    for (const hardcoded of HARDCODED_BLOCKED_REFS) {
      if (supabaseUrl.toLowerCase().includes(hardcoded.toLowerCase()) || projectRef === hardcoded) {
        errors.push(
          'CRITICAL SECURITY VIOLATION: Target project matches a permanent hardcoded production reference (' + hardcoded + '). ' +
          'Execution refused under all circumstances.'
        );
        break;
      }
    }

    // Unconditionally reject any target configured in normal development or preview environment files
    const { blockedRefs, blockedSubstrings } = discoverLocallyConfiguredBlockedTargets(rootDir);
    
    for (const blocked of blockedSubstrings) {
      if (!HARDCODED_BLOCKED_REFS.has(blocked) && supabaseUrl.toLowerCase().includes(blocked.toLowerCase())) {
        errors.push(
          'CRITICAL SECURITY VIOLATION: Target URL matches an existing locally-configured development/preview project (' + blocked + '). ' +
          'Test harness execution is strictly forbidden against configured development or preview environments.'
        );
        break;
      }
    }

    if (projectRef && !HARDCODED_BLOCKED_REFS.has(projectRef) && blockedRefs.has(projectRef)) {
      errors.push(
        'CRITICAL SECURITY VIOLATION: Target project reference (' + projectRef + ') is configured in local development/preview .env files. ' +
        'Target isolation violated; refusing execution.'
      );
    }
  }

  // 6. Dry Run vs Live Execution Mode (Defaults to DRY_RUN)
  const executeLive = process.env.EXECUTE_LIVE_MUTATIONS === 'true';
  const dryRun = !executeLive;

  // 7. Migration Execution Flag
  const allowMigrations = process.env.ALLOW_MIGRATION_EXECUTION === 'true';

  // 8. Cleanup Flag
  const allowCleanup = process.env.ENABLE_FIXTURE_CLEANUP === 'true';

  if (errors.length > 0) {
    return {
      isValid: false,
      errors,
      config: null,
    };
  }

  return {
    isValid: true,
    errors: [],
    config: {
      supabaseUrl,
      projectRef,
      serviceRoleKey, // Never logged or printed
      dryRun,
      executeLive,
      allowMigrations,
      allowCleanup,
      rootDir,
    },
  };
}

/**
 * Sanitizes headers for display or debug output, redacting authentication secrets.
 * @param {Object} headers
 * @returns {Object}
 */
export function sanitizeHeaders(headers = {}) {
  const sanitized = {};
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === 'authorization' || lowerKey === 'apikey' || lowerKey.includes('secret') || lowerKey.includes('token')) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}
