/**
 * KaziBox — Canonical Module Resolution & Alias Strategy
 *
 * Establishes a bidirectional, backward-compatible mapping between:
 * 1. UI route / manifest identifiers (e.g. 'garage-auto', 'hair-salon')
 * 2. Database catalogue identifiers in public.modules (e.g. 'garage', 'hotel-property', 'demo')
 * 3. Entitlement keys in subscriptions.included_module_ids and company_modules
 */

export const MODULE_ALIASES: Record<string, string> = {
  // Automotive
  'garage-auto': 'garage',
  'garage': 'garage',

  // Hospitality
  'hotel': 'hotel-property',
  'hotel-property': 'hotel-property',

  // Beauty & Spa
  'hair-salon': 'salon',
  'salon-beauty': 'salon',
  'salon': 'salon',

  // Development & Demo
  'demo-module': 'demo',
  'demo': 'demo',

  // Health & Pharmacy
  'pharmastock': 'pharmacy',
  'pharmacy': 'pharmacy',
};

/**
 * Returns canonical module ID for database catalogue compatibility
 */
export function toCanonicalModuleId(moduleId: string): string {
  if (!moduleId || typeof moduleId !== 'string') return moduleId;
  const clean = moduleId.trim().toLowerCase();
  return MODULE_ALIASES[clean] || clean;
}

/**
 * Returns deduplicated canonical module IDs
 */
export function toCanonicalModuleIds(moduleIds: string[]): string[] {
  if (!Array.isArray(moduleIds)) return [];
  return Array.from(new Set(moduleIds.map(toCanonicalModuleId).filter(Boolean)));
}

/**
 * Returns all recognized alias identifiers for a given module ID (including the canonical ID).
 */
export function getModuleAliases(moduleId: string): string[] {
  const canonical = toCanonicalModuleId(moduleId);
  const aliases = new Set<string>([canonical, moduleId]);
  for (const [alias, target] of Object.entries(MODULE_ALIASES)) {
    if (target === canonical) {
      aliases.add(alias);
    }
  }
  return Array.from(aliases);
}
