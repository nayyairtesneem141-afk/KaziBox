import { getStore, setStoreItem } from './storage';
import { isSupabaseConfigured } from './supabase/config';
import { createServerClient } from './supabase/server';
import { createAdminClient } from './supabase/admin';

export type DirectoryCategory =
  | 'hospitality'
  | 'automotive'
  | 'beauty'
  | 'retail'
  | 'health'
  | 'services'
  | 'food'
  | 'technology'
  | 'logistics'
  | 'other';

export type DirectoryStatus =
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'published'
  | 'suspended'
  | 'hidden';

export interface LocalizedString {
  fr: string;
  en: string;
}

export interface BusinessDirectoryEntry {
  id: string;
  companyId?: string | null;
  name: string;
  slug: string;
  tagline: LocalizedString | string;
  description: LocalizedString | string;
  category: DirectoryCategory;
  country: string; // CD, CM, SN, CI, etc.
  city: string;
  address: string;
  phone: string;
  email: string;
  website?: string;
  logoUrl?: string;
  coverImageUrl?: string;
  openingHours?: string;
  status: DirectoryStatus;
  isActive: boolean;
  isVerified: boolean;
  isFeatured: boolean;
  rejectionReason?: string;
  adminNotes?: string;
  submittedBy?: string;
  submittedAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DirectoryQueryFilter {
  search?: string;
  category?: DirectoryCategory | 'all';
  country?: string | 'all';
  city?: string;
  status?: DirectoryStatus | 'all';
  isActive?: boolean;
  isFeatured?: boolean;
  companyId?: string;
}

export const DIRECTORY_CATEGORIES: { id: DirectoryCategory; label: LocalizedString; icon: string }[] = [
  { id: 'hospitality', label: { fr: 'Hôtellerie & Hébergement', en: 'Hospitality & Hotels' }, icon: '🏨' },
  { id: 'automotive', label: { fr: 'Automobile & Garage', en: 'Automotive & Garage' }, icon: '🚗' },
  { id: 'beauty', label: { fr: 'Beauté & Salons de Coiffure', en: 'Beauty & Hair Salons' }, icon: '✂️' },
  { id: 'retail', label: { fr: 'Commerce & Vente au détail', en: 'Retail & Stores' }, icon: '🛍️' },
  { id: 'health', label: { fr: 'Santé & Pharmacies', en: 'Health & Pharmacy' }, icon: '🏥' },
  { id: 'food', label: { fr: 'Restauration & Alimentation', en: 'Food & Restaurants' }, icon: '🍽️' },
  { id: 'services', label: { fr: 'Services Professionnels', en: 'Professional Services' }, icon: '💼' },
  { id: 'technology', label: { fr: 'Technologie & Numérique', en: 'Technology & Digital' }, icon: '💻' },
  { id: 'logistics', label: { fr: 'Transport & Logistique', en: 'Transport & Logistics' }, icon: '🚚' },
  { id: 'other', label: { fr: 'Autres Activités', en: 'Other Businesses' }, icon: '🏢' },
];

export const DIRECTORY_COUNTRIES: { code: string; name: LocalizedString; flag: string }[] = [
  { code: 'CI', name: { fr: 'Côte d’Ivoire', en: 'Ivory Coast' }, flag: '🇨🇮' },
  { code: 'SN', name: { fr: 'Sénégal', en: 'Senegal' }, flag: '🇸🇳' },
  { code: 'CM', name: { fr: 'Cameroun', en: 'Cameroon' }, flag: '🇨🇲' },
  { code: 'CD', name: { fr: 'RDC (Congo)', en: 'DR Congo' }, flag: '🇨🇩' },
];

/**
 * Generate URL-friendly slug from business name
 */
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}

/**
 * Normalizes localized string helper
 */
export function resolveLocalizedString(val: LocalizedString | string | undefined | null, lang: string = 'fr'): string {
  if (!val) return '';
  if (typeof val === 'string') return val;
  return lang === 'en' ? val.en || val.fr || '' : val.fr || val.en || '';
}

/**
 * Initial seed entries across key African cities
 */
export const INITIAL_DIRECTORY_ENTRIES: BusinessDirectoryEntry[] = [
  {
    id: 'dir-palmeraie-01',
    companyId: '11111111-1111-4111-8111-111111111111',
    name: 'Hôtel & Résidence Palmeraie',
    slug: 'hotel-residence-palmeraie',
    tagline: {
      fr: 'Suites haut de gamme, piscine et espaces séminaires',
      en: 'Premium suites, pool, and conference facilities',
    },
    description: {
      fr: 'Situé au cœur de la Palmeraie à Abidjan, un complexe hôtelier 4 étoiles avec restaurant gastronomique et salles de conférences.',
      en: 'Located in Palmeraie Abidjan, a 4-star hospitality complex with fine dining and seminar rooms.',
    },
    category: 'hospitality',
    country: 'CI',
    city: 'Abidjan',
    address: 'Boulevard de la Palmeraie, Cocody',
    phone: '+225 27 22 44 88',
    email: 'contact@palmeraie.ci',
    website: 'https://palmeraie.ci',
    logoUrl: '🏨',
    coverImageUrl: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800',
    openingHours: '24h/24, 7j/7',
    status: 'published',
    isActive: true,
    isVerified: true,
    isFeatured: true,
    submittedBy: 'usr-owner-01',
    submittedAt: '2026-01-20T10:00:00Z',
    reviewedBy: 'usr-admin-01',
    reviewedAt: '2026-01-21T09:00:00Z',
    publishedAt: '2026-01-21T09:30:00Z',
    createdAt: '2026-01-20T10:00:00Z',
    updatedAt: '2026-01-21T09:30:00Z',
  },
  {
    id: 'dir-garage-express-02',
    companyId: '22222222-2222-4222-8222-222222222222',
    name: 'Garage & Mécanique Express',
    slug: 'garage-mecanique-express',
    tagline: {
      fr: 'Diagnostic électronique, vidange express et mécanique générale',
      en: 'Electronic diagnostics, quick lube, and mechanical repair',
    },
    description: {
      fr: 'Atelier mécanique multimarque à Dakar avec banc de diagnostic informatisé et service rapide.',
      en: 'Multi-brand automotive workshop in Dakar with computerized diagnostics and express servicing.',
    },
    category: 'automotive',
    country: 'SN',
    city: 'Dakar',
    address: 'Avenue Cheikh Anta Diop, Fann',
    phone: '+221 33 825 00 11',
    email: 'contact@garage-express.sn',
    website: 'https://garage-express.sn',
    logoUrl: '🚗',
    coverImageUrl: 'https://images.unsplash.com/photo-1619642751034-765dfdf7c58e?w=800',
    openingHours: 'Lun - Sam: 08:00 - 18:30',
    status: 'published',
    isActive: true,
    isVerified: true,
    isFeatured: false,
    submittedBy: 'usr-owner-02',
    submittedAt: '2026-02-15T08:00:00Z',
    reviewedBy: 'usr-admin-01',
    reviewedAt: '2026-02-16T11:00:00Z',
    publishedAt: '2026-02-16T11:30:00Z',
    createdAt: '2026-02-15T08:00:00Z',
    updatedAt: '2026-02-16T11:30:00Z',
  },
  {
    id: 'dir-salon-elegance-03',
    companyId: '33333333-3333-4333-8333-333333333333',
    name: 'Salon Élégance & Spa Douala',
    slug: 'salon-elegance-spa-douala',
    tagline: {
      fr: 'Coiffure afro-européenne, soins du visage et onglerie',
      en: 'Afro-European hair styling, skincare, and nail salon',
    },
    description: {
      fr: 'Espace beauté et bien-être haut de gamme situé à Bonanjo, Douala.',
      en: 'High-end beauty and wellness studio located in Bonanjo, Douala.',
    },
    category: 'beauty',
    country: 'CM',
    city: 'Douala',
    address: 'Rue Ivy, Bonanjo',
    phone: '+237 233 42 12 34',
    email: 'bonanjo@salon-elegance.cm',
    logoUrl: '✂️',
    coverImageUrl: 'https://images.unsplash.com/photo-1560066984-138dadb4c035?w=800',
    openingHours: 'Mar - Dim: 09:00 - 19:00',
    status: 'published',
    isActive: true,
    isVerified: true,
    isFeatured: true,
    submittedBy: 'usr-owner-03',
    submittedAt: '2026-03-01T14:00:00Z',
    reviewedBy: 'usr-admin-01',
    reviewedAt: '2026-03-02T10:00:00Z',
    publishedAt: '2026-03-02T10:15:00Z',
    createdAt: '2026-03-01T14:00:00Z',
    updatedAt: '2026-03-02T10:15:00Z',
  },
  {
    id: 'dir-kinshasa-logistics-04',
    companyId: null,
    name: 'Kinshasa Fret & Logistique',
    slug: 'kinshasa-fret-logistique',
    tagline: {
      fr: 'Dédouanement, livraison urbaine et fret multimodal',
      en: 'Customs clearance, urban delivery, and multimodal freight',
    },
    description: {
      fr: 'Spécialiste du transport de marchandises et logistique du dernier kilomètre à Kinshasa et Kongo Central.',
      en: 'Specialist in cargo transportation and last-mile logistics across Kinshasa and Kongo Central.',
    },
    category: 'logistics',
    country: 'CD',
    city: 'Kinshasa',
    address: 'Boulevard du 30 Juin, Gombe',
    phone: '+243 81 234 5678',
    email: 'info@kinlogistics.cd',
    website: 'https://kinlogistics.cd',
    logoUrl: '🚚',
    openingHours: 'Lun - Ven: 08:00 - 17:00',
    status: 'pending_review',
    isActive: true,
    isVerified: false,
    isFeatured: false,
    submittedBy: 'usr-ext-99',
    submittedAt: '2026-10-10T11:00:00Z',
    createdAt: '2026-10-10T11:00:00Z',
    updatedAt: '2026-10-10T11:00:00Z',
  },
];

/**
 * Fetch directory entries with multi-dimensional filtering
 */
export async function getDirectoryEntries(filters: DirectoryQueryFilter = {}): Promise<BusinessDirectoryEntry[]> {
  if (isSupabaseConfigured()) {
    const supabase = (createAdminClient() || createServerClient()) as any;
    if (supabase) {
      try {
        let query = supabase.from('business_directory').select('*');

        if (filters.country && filters.country !== 'all') {
          query = query.eq('country', filters.country);
        }
        if (filters.category && filters.category !== 'all') {
          query = query.eq('category', filters.category);
        }
        if (filters.city) {
          query = query.ilike('city', `%${filters.city}%`);
        }
        if (filters.companyId) {
          query = query.eq('company_id', filters.companyId);
        }
        if (filters.status && filters.status !== 'all') {
          query = query.eq('status', filters.status);
        }
        if (filters.isActive !== undefined) {
          query = query.eq('is_active', filters.isActive);
        }
        if (filters.isFeatured !== undefined) {
          query = query.eq('is_featured', filters.isFeatured);
        }

        query = query.order('is_featured', { ascending: false }).order('created_at', { ascending: false });

        const { data, error } = await query;
        if (!error && data && data.length > 0) {
          return data.map(mapDbRowToEntry);
        }
      } catch (err) {
        console.warn('[Directory] Fallback to in-memory store:', err);
      }
    }
  }

  // Local in-memory fallback
  const store = getStore() as any;
  const entries: BusinessDirectoryEntry[] = store.directoryEntries || INITIAL_DIRECTORY_ENTRIES;

  return entries.filter((entry) => {
    if (filters.country && filters.country !== 'all' && entry.country !== filters.country) return false;
    if (filters.category && filters.category !== 'all' && entry.category !== filters.category) return false;
    if (filters.city && !entry.city.toLowerCase().includes(filters.city.toLowerCase())) return false;
    if (filters.companyId && entry.companyId !== filters.companyId) return false;
    if (filters.status && filters.status !== 'all' && entry.status !== filters.status) return false;
    if (filters.isActive !== undefined && entry.isActive !== filters.isActive) return false;
    if (filters.isFeatured !== undefined && entry.isFeatured !== filters.isFeatured) return false;

    if (filters.search) {
      const q = filters.search.toLowerCase();
      const nameMatch = entry.name.toLowerCase().includes(q);
      const cityMatch = entry.city.toLowerCase().includes(q);
      const tagFr = resolveLocalizedString(entry.tagline, 'fr').toLowerCase();
      const tagEn = resolveLocalizedString(entry.tagline, 'en').toLowerCase();
      const descFr = resolveLocalizedString(entry.description, 'fr').toLowerCase();
      const descEn = resolveLocalizedString(entry.description, 'en').toLowerCase();
      if (!nameMatch && !cityMatch && !tagFr.includes(q) && !tagEn.includes(q) && !descFr.includes(q) && !descEn.includes(q)) {
        return false;
      }
    }

    return true;
  }).sort((a, b) => {
    if (a.isFeatured && !b.isFeatured) return -1;
    if (!a.isFeatured && b.isFeatured) return 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

/**
 * Fetch a single directory entry by ID or Slug
 */
export async function getDirectoryEntryByIdOrSlug(idOrSlug: string): Promise<BusinessDirectoryEntry | null> {
  if (isSupabaseConfigured()) {
    const supabase = (createAdminClient() || createServerClient()) as any;
    if (supabase) {
      try {
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
        let query = supabase.from('business_directory').select('*');
        if (isUuid) {
          query = query.or(`id.eq.${idOrSlug},slug.eq.${idOrSlug}`);
        } else {
          query = query.eq('slug', idOrSlug);
        }
        const { data, error } = await query.maybeSingle();
        if (!error && data) {
          return mapDbRowToEntry(data);
        }
      } catch (err) {
        console.warn('[Directory] Fallback to in-memory store:', err);
      }
    }
  }

  const store = getStore() as any;
  const entries: BusinessDirectoryEntry[] = store.directoryEntries || INITIAL_DIRECTORY_ENTRIES;
  return entries.find((e) => e.id === idOrSlug || e.slug === idOrSlug) || null;
}

/**
 * Register a new directory entry
 */
export async function createDirectoryEntry(
  data: Partial<BusinessDirectoryEntry> & { name: string; category: DirectoryCategory; country: string; city: string; phone: string; email: string },
  sessionUserId?: string
): Promise<{ success: boolean; entry?: BusinessDirectoryEntry; error?: string }> {
  if (!data.name || !data.category || !data.country || !data.city || !data.phone || !data.email) {
    return { success: false, error: 'Champs obligatoires manquants (Nom, Catégorie, Pays, Ville, Téléphone, Email).' };
  }

  const baseSlug = generateSlug(data.name);
  const uniqueSuffix = Math.floor(100 + Math.random() * 900);
  const slug = `${baseSlug}-${uniqueSuffix}`;
  const now = new Date().toISOString();

  const newEntry: BusinessDirectoryEntry = {
    id: `dir-${Date.now()}-${uniqueSuffix}`,
    companyId: data.companyId || null,
    name: data.name.trim(),
    slug: data.slug || slug,
    tagline: data.tagline || '',
    description: data.description || '',
    category: data.category,
    country: data.country.toUpperCase(),
    city: data.city.trim(),
    address: data.address || '',
    phone: data.phone.trim(),
    email: data.email.trim().toLowerCase(),
    website: data.website || '',
    logoUrl: data.logoUrl || '🏢',
    coverImageUrl: data.coverImageUrl || '',
    openingHours: data.openingHours || '',
    status: 'pending_review',
    isActive: true,
    isVerified: false,
    isFeatured: false,
    submittedBy: sessionUserId,
    submittedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  if (isSupabaseConfigured()) {
    const supabase = (createAdminClient() || createServerClient()) as any;
    if (supabase) {
      try {
        const { data: inserted, error } = await supabase
          .from('business_directory')
          .insert({
            company_id: newEntry.companyId,
            name: newEntry.name,
            slug: newEntry.slug,
            tagline: typeof newEntry.tagline === 'object' ? newEntry.tagline : { fr: newEntry.tagline, en: newEntry.tagline },
            description: typeof newEntry.description === 'object' ? newEntry.description : { fr: newEntry.description, en: newEntry.description },
            category: newEntry.category,
            country: newEntry.country,
            city: newEntry.city,
            address: newEntry.address,
            phone: newEntry.phone,
            email: newEntry.email,
            website: newEntry.website,
            logo_url: newEntry.logoUrl,
            cover_image_url: newEntry.coverImageUrl,
            opening_hours: newEntry.openingHours,
            status: newEntry.status,
            is_active: newEntry.isActive,
            is_verified: newEntry.isVerified,
            is_featured: newEntry.isFeatured,
            submitted_by: newEntry.submittedBy,
          })
          .select()
          .single();

        if (!error && inserted) {
          return { success: true, entry: mapDbRowToEntry(inserted) };
        }
      } catch (err: any) {
        console.warn('[Directory] Database insert error, falling back:', err);
      }
    }
  }

  const store = getStore() as any;
  const list = store.directoryEntries || [...INITIAL_DIRECTORY_ENTRIES];
  list.unshift(newEntry);
  setStoreItem('DIRECTORY_ENTRIES', list);

  return { success: true, entry: newEntry };
}

/**
 * Update an existing directory entry
 */
export async function updateDirectoryEntry(
  id: string,
  updates: Partial<BusinessDirectoryEntry>
): Promise<{ success: boolean; entry?: BusinessDirectoryEntry; error?: string }> {
  const existing = await getDirectoryEntryByIdOrSlug(id);
  if (!existing) {
    return { success: false, error: 'Fiche entreprise introuvable' };
  }

  const now = new Date().toISOString();
  const merged: BusinessDirectoryEntry = {
    ...existing,
    ...updates,
    id: existing.id, // Immutable
    updatedAt: now,
  };

  if (isSupabaseConfigured()) {
    const supabase = (createAdminClient() || createServerClient()) as any;
    if (supabase) {
      try {
        const { data: updated, error } = await supabase
          .from('business_directory')
          .update({
            name: merged.name,
            tagline: typeof merged.tagline === 'object' ? merged.tagline : { fr: merged.tagline, en: merged.tagline },
            description: typeof merged.description === 'object' ? merged.description : { fr: merged.description, en: merged.description },
            category: merged.category,
            country: merged.country,
            city: merged.city,
            address: merged.address,
            phone: merged.phone,
            email: merged.email,
            website: merged.website,
            logo_url: merged.logoUrl,
            cover_image_url: merged.coverImageUrl,
            opening_hours: merged.openingHours,
            is_active: merged.isActive,
            updated_at: now,
          })
          .eq('id', existing.id)
          .select()
          .single();

        if (!error && updated) {
          return { success: true, entry: mapDbRowToEntry(updated) };
        }
      } catch (err) {
        console.warn('[Directory] Update error, fallback to memory:', err);
      }
    }
  }

  const store = getStore() as any;
  const list = store.directoryEntries || [...INITIAL_DIRECTORY_ENTRIES];
  const idx = list.findIndex((e: any) => e.id === existing.id);
  if (idx !== -1) {
    list[idx] = merged;
    setStoreItem('DIRECTORY_ENTRIES', list);
  }

  return { success: true, entry: merged };
}

/**
 * Admin Review & Moderation Workflow
 */
export async function reviewDirectoryEntry(
  id: string,
  action: 'approve' | 'reject' | 'publish' | 'suspend' | 'activate' | 'hide' | 'verify' | 'feature',
  adminUserId?: string,
  payload?: { rejectionReason?: string; adminNotes?: string }
): Promise<{ success: boolean; entry?: BusinessDirectoryEntry; error?: string }> {
  const existing = await getDirectoryEntryByIdOrSlug(id);
  if (!existing) {
    return { success: false, error: 'Fiche entreprise introuvable' };
  }

  const now = new Date().toISOString();
  const updates: Partial<BusinessDirectoryEntry> = {
    updatedAt: now,
  };

  switch (action) {
    case 'approve':
      updates.status = 'approved';
      updates.reviewedBy = adminUserId;
      updates.reviewedAt = now;
      updates.rejectionReason = undefined;
      break;

    case 'reject':
      if (!payload?.rejectionReason) {
        return { success: false, error: 'Le motif de rejet est obligatoire' };
      }
      updates.status = 'rejected';
      updates.rejectionReason = payload.rejectionReason;
      updates.reviewedBy = adminUserId;
      updates.reviewedAt = now;
      break;

    case 'publish':
      updates.status = 'published';
      updates.isActive = true;
      updates.publishedAt = now;
      updates.reviewedBy = adminUserId;
      updates.reviewedAt = now;
      break;

    case 'suspend':
      updates.status = 'suspended';
      break;

    case 'activate':
      updates.isActive = true;
      break;

    case 'hide':
      updates.isActive = false;
      break;

    case 'verify':
      updates.isVerified = !existing.isVerified;
      break;

    case 'feature':
      updates.isFeatured = !existing.isFeatured;
      break;

    default:
      return { success: false, error: `Action de modération non reconnue: ${action}` };
  }

  if (payload?.adminNotes) {
    updates.adminNotes = payload.adminNotes;
  }

  const merged: BusinessDirectoryEntry = {
    ...existing,
    ...updates,
  };

  if (isSupabaseConfigured()) {
    const supabase = (createAdminClient() || createServerClient()) as any;
    if (supabase) {
      try {
        const { data: updated, error } = await supabase
          .from('business_directory')
          .update({
            status: merged.status,
            is_active: merged.isActive,
            is_verified: merged.isVerified,
            is_featured: merged.isFeatured,
            rejection_reason: merged.rejectionReason || null,
            admin_notes: merged.adminNotes || null,
            reviewed_by: merged.reviewedBy || null,
            reviewed_at: merged.reviewedAt || null,
            published_at: merged.publishedAt || null,
            updated_at: now,
          })
          .eq('id', existing.id)
          .select()
          .single();

        if (!error && updated) {
          return { success: true, entry: mapDbRowToEntry(updated) };
        }
      } catch (err) {
        console.warn('[Directory] Review DB update error, fallback to memory:', err);
      }
    }
  }

  const store = getStore() as any;
  const list = store.directoryEntries || [...INITIAL_DIRECTORY_ENTRIES];
  const idx = list.findIndex((e: any) => e.id === existing.id);
  if (idx !== -1) {
    list[idx] = merged;
    setStoreItem('DIRECTORY_ENTRIES', list);
  }

  return { success: true, entry: merged };
}

/**
 * Delete a directory entry
 */
export async function deleteDirectoryEntry(id: string): Promise<{ success: boolean; error?: string }> {
  if (isSupabaseConfigured()) {
    const supabase = (createAdminClient() || createServerClient()) as any;
    if (supabase) {
      try {
        await supabase.from('business_directory').delete().eq('id', id);
      } catch (err) {
        console.warn('[Directory] Delete DB error:', err);
      }
    }
  }

  const store = getStore() as any;
  const list = (store.directoryEntries || [...INITIAL_DIRECTORY_ENTRIES]).filter((e: any) => e.id !== id);
  setStoreItem('DIRECTORY_ENTRIES', list);

  return { success: true };
}

/**
 * Maps database snake_case row to camelCase BusinessDirectoryEntry
 */
function mapDbRowToEntry(row: any): BusinessDirectoryEntry {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    slug: row.slug,
    tagline: row.tagline,
    description: row.description,
    category: row.category,
    country: row.country,
    city: row.city,
    address: row.address,
    phone: row.phone,
    email: row.email,
    website: row.website,
    logoUrl: row.logo_url,
    coverImageUrl: row.cover_image_url,
    openingHours: row.opening_hours,
    status: row.status,
    isActive: row.is_active,
    isVerified: row.is_verified,
    isFeatured: row.is_featured,
    rejectionReason: row.rejection_reason,
    adminNotes: row.admin_notes,
    submittedBy: row.submitted_by,
    submittedAt: row.submitted_at || row.created_at,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
