import fs from 'node:fs';
import path from 'node:path';
import { MedicationItem, PrescriptionSale } from './inventory.js';
import { FileLockIdempotencyStore, IdempotencyStore } from '@kazibox/sdk';

export interface SerializedTenantData {
  medications: MedicationItem[];
  sales: PrescriptionSale[];
  expenses: Array<{ id: string; reference: string; amount: number; description: string; date: string }>;
}

export interface PharmaStorageAdapter {
  getTenant(companyId: string): SerializedTenantData | null;
  saveTenant(companyId: string, data: SerializedTenantData): void;
  flush?(): void;
}

/**
 * In-memory storage adapter for local testing and zero-dependency development.
 */
export class MemoryPharmaStorageAdapter implements PharmaStorageAdapter {
  private store = new Map<string, SerializedTenantData>();

  getTenant(companyId: string): SerializedTenantData | null {
    const data = this.store.get(companyId);
    if (!data) return null;
    return JSON.parse(JSON.stringify(data));
  }

  saveTenant(companyId: string, data: SerializedTenantData): void {
    this.store.set(companyId, JSON.parse(JSON.stringify(data)));
  }
}

/**
 * Durable JSON file storage adapter for containerized deployments (DigitalOcean VPS, Droplet, Docker).
 * Persists data to disk using atomic writes (write temp file + rename) to prevent corruption during unexpected restarts.
 *
 * ARCHITECTURAL CONCURRENCY & DEPLOYMENT CONSTRAINT:
 * File-based storage is strictly intended for single-instance deployments where a single Node process owns
 * the mounted volume directory (/data). In multi-instance or horizontal auto-scaled deployments, shared
 * transactional storage (such as Supabase PostgreSQL or a managed SQL database) must be used instead to
 * prevent distributed file write collisions.
 */
export class FilePharmaStorageAdapter implements PharmaStorageAdapter {
  private filePath: string;
  private cache = new Map<string, SerializedTenantData>();
  private initialized = false;

  constructor(filePath?: string) {
    const configuredPath =
      filePath ||
      process.env.PHARMA_DATA_FILE ||
      (process.env.PHARMA_DATA_DIR
        ? path.join(process.env.PHARMA_DATA_DIR, 'pharmastock-state.json')
        : path.resolve('.cache', 'pharmastock-data.json'));

    this.filePath = configuredPath;
    this.ensureInitialized();
  }

  private ensureInitialized(): void {
    if (this.initialized) return;
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        if (raw.trim()) {
          try {
            const parsed = JSON.parse(raw);
            for (const [key, val] of Object.entries(parsed)) {
              this.cache.set(key, val as SerializedTenantData);
            }
          } catch (parseErr) {
            // Safely preserve corrupted file before initializing empty state
            const backupPath = `${this.filePath}.corrupted.${Date.now()}`;
            try {
              fs.copyFileSync(this.filePath, backupPath);
              console.warn(`[PharmaStorage] Warning: Malformed JSON in ${this.filePath}. Backed up to ${backupPath}:`, parseErr);
            } catch {}
          }
        }
      }
    } catch (err) {
      console.warn(`[PharmaStorage] Warning: Failed to load existing state from ${this.filePath}:`, err);
    }
    this.initialized = true;
  }

  getTenant(companyId: string): SerializedTenantData | null {
    this.ensureInitialized();
    const data = this.cache.get(companyId);
    if (!data) return null;
    return JSON.parse(JSON.stringify(data));
  }

  saveTenant(companyId: string, data: SerializedTenantData): void {
    this.ensureInitialized();
    const previous = this.cache.get(companyId);
    this.cache.set(companyId, JSON.parse(JSON.stringify(data)));
    try {
      this.flush();
    } catch (err) {
      // Revert in-memory cache to maintain strict synchronization with disk
      if (previous !== undefined) {
        this.cache.set(companyId, previous);
      } else {
        this.cache.delete(companyId);
      }
      throw err;
    }
  }

  flush(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const serializable: Record<string, SerializedTenantData> = {};
    for (const [key, val] of this.cache.entries()) {
      serializable[key] = val;
    }
    const uniqueSuffix = `${process.pid}.${Date.now()}.${Math.random().toString(36).substring(2, 8)}`;
    const tmpFile = `${this.filePath}.tmp.${uniqueSuffix}`;
    try {
      fs.writeFileSync(tmpFile, JSON.stringify(serializable, null, 2), 'utf8');
      fs.renameSync(tmpFile, this.filePath);
    } catch (err) {
      try {
        if (fs.existsSync(tmpFile)) {
          fs.unlinkSync(tmpFile);
        }
      } catch {}
      throw new Error(`[PharmaStorage] Error persisting state to ${this.filePath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  getFilePath(): string {
    return this.filePath;
  }
}

let activeAdapter: PharmaStorageAdapter = process.env.PHARMA_DATA_FILE || process.env.PHARMA_DATA_DIR
  ? new FilePharmaStorageAdapter()
  : new MemoryPharmaStorageAdapter();

export function getPharmaStorageAdapter(): PharmaStorageAdapter {
  return activeAdapter;
}

export function setPharmaStorageAdapter(adapter: PharmaStorageAdapter): void {
  activeAdapter = adapter;
}

// ─────────────────────────────────────────────────────────────────────────────
// Idempotency & Replay Protection Storage (Single-Instance Persistent)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves the base filesystem directory for persistent locks and idempotency records.
 * Uses PHARMA_IDEMPOTENCY_DIR, PHARMA_DATA_DIR, or directory containing PHARMA_DATA_FILE.
 * Defaults to .cache/pharmastock-data/idempotency.
 */
export function getDefaultIdempotencyDir(subDir?: string): string {
  const baseDir =
    process.env.PHARMA_IDEMPOTENCY_DIR ||
    (process.env.PHARMA_DATA_DIR
      ? path.join(process.env.PHARMA_DATA_DIR, 'idempotency')
      : process.env.PHARMA_DATA_FILE
        ? path.join(path.dirname(process.env.PHARMA_DATA_FILE), 'idempotency')
        : path.resolve('.cache', 'pharmastock-data', 'idempotency'));

  return subDir ? path.join(baseDir, subDir) : baseDir;
}

let activeSsoStore: IdempotencyStore | null = null;
let activeWebhookStore: IdempotencyStore | null = null;

/**
 * Returns the active persistent SSO replay protection store.
 * Survives process restarts by persisting locks to the filesystem via FileLockIdempotencyStore.
 *
 * ARCHITECTURAL CONCURRENCY & DEPLOYMENT CONSTRAINT:
 * Single-instance deployment constraint: relies on local filesystem locks for a single Node process.
 * Scaling to multi-instance deployments requires a shared transactional database adapter.
 */
export function getPharmaSsoIdempotencyStore(): IdempotencyStore {
  if (!activeSsoStore) {
    activeSsoStore = new FileLockIdempotencyStore(getDefaultIdempotencyDir('sso'));
  }
  return activeSsoStore;
}

export function setPharmaSsoIdempotencyStore(store: IdempotencyStore | null): void {
  activeSsoStore = store;
}

/**
 * Returns the active persistent Webhook idempotency store.
 * Survives process restarts by persisting locks to the filesystem via FileLockIdempotencyStore.
 *
 * ARCHITECTURAL CONCURRENCY & DEPLOYMENT CONSTRAINT:
 * Single-instance deployment constraint: relies on local filesystem locks for a single Node process.
 * Scaling to multi-instance deployments requires a shared transactional database adapter.
 */
export function getPharmaWebhookIdempotencyStore(): IdempotencyStore {
  if (!activeWebhookStore) {
    activeWebhookStore = new FileLockIdempotencyStore(getDefaultIdempotencyDir('webhooks'));
  }
  return activeWebhookStore;
}

export function setPharmaWebhookIdempotencyStore(store: IdempotencyStore | null): void {
  activeWebhookStore = store;
}

/**
 * Resets cached idempotency stores (useful in test teardown).
 */
export function resetPharmaIdempotencyStores(): void {
  activeSsoStore = null;
  activeWebhookStore = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tenant Provisioning Lifecycle Persistence
// ─────────────────────────────────────────────────────────────────────────────

export interface TenantProvisioningRecord {
  status: string;
  updatedAt: string | null;
}

function getProvisioningFilePath(): string {
  const baseDir =
    process.env.PHARMA_DATA_DIR ||
    (process.env.PHARMA_DATA_FILE
      ? path.dirname(process.env.PHARMA_DATA_FILE)
      : path.resolve('.cache', 'pharmastock-data'));
  return path.join(baseDir, 'tenant-provisioning.json');
}

export function saveTenantProvisioningRecord(companyId: string, record: TenantProvisioningRecord): void {
  try {
    const file = getProvisioningFilePath();
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    let all: Record<string, TenantProvisioningRecord> = {};
    if (fs.existsSync(file)) {
      try {
        all = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {}
    }
    all[companyId] = record;
    fs.writeFileSync(file, JSON.stringify(all, null, 2), 'utf8');
  } catch (err) {
    console.warn(`[PharmaStorage] Warning: Failed to persist tenant provisioning record for ${companyId}:`, err);
  }
}

export function getPersistedTenantProvisioningStatus(companyId: string): TenantProvisioningRecord {
  try {
    const file = getProvisioningFilePath();
    if (fs.existsSync(file)) {
      const all: Record<string, TenantProvisioningRecord> = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (all[companyId]) return all[companyId];
    }
  } catch {}
  return { status: 'unprovisioned', updatedAt: null };
}

export function clearTenantProvisioningRecords(): void {
  try {
    const file = getProvisioningFilePath();
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  } catch {}
}
