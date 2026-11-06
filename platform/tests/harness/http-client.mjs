/**
 * KaziBox Flex Validation Harness — Zero-Dependency PostgREST HTTP Client
 *
 * Designed to interact with Supabase PostgREST endpoints using native Node.js fetch.
 * Strictly avoids logging authorization tokens, passwords, or full request payloads.
 * Enforces explicit timeouts on every live fetch path.
 * Implements dry-run safety intercepts to prevent accidental remote writes.
 */

import { sanitizeHeaders } from './config.mjs';

const DEFAULT_TIMEOUT_MS = 10000;

export class PostgrestHarnessClient {
  /**
   * @param {Object} config
   * @param {string} config.supabaseUrl
   * @param {string} config.serviceRoleKey
   * @param {string} config.projectRef
   * @param {boolean} config.dryRun
   */
  constructor(config) {
    this.baseUrl = config.supabaseUrl.replace(/\/+$/, '');
    this.serviceRoleKey = config.serviceRoleKey;
    this.projectRef = config.projectRef;
    this.dryRun = config.dryRun;
  }

  /**
   * Builds sanitized request headers.
   * @private
   */
  _buildHeaders(extraHeaders = {}) {
    return {
      'Content-Type': 'application/json',
      'apikey': this.serviceRoleKey,
      'Authorization': `Bearer ${this.serviceRoleKey}`,
      'Prefer': 'return=representation',
      ...extraHeaders,
    };
  }

  /**
   * Sanitizes an error to prevent leaking secrets or full connection strings.
   * @private
   */
  _sanitizeError(err) {
    if (!err) return 'Unknown error';
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return `Request timed out after ${DEFAULT_TIMEOUT_MS}ms limit`;
    }
    // Redact any potential auth/key strings from error text
    let msg = String(err.message || err);
    if (this.serviceRoleKey) {
      msg = msg.replaceAll(this.serviceRoleKey, '[REDACTED]');
    }
    return msg;
  }

  /**
   * Executes an RPC call against PostgREST: POST /rest/v1/rpc/<functionName>
   * @param {string} functionName
   * @param {Object} payload
   * @param {Object} [options]
   * @returns {Promise<{ httpStatus: number, ok: boolean, data: any, rawText: string, durationMs: number, dryRun: boolean }>}
   */
  async rpc(functionName, payload = {}, options = {}) {
    const endpoint = `${this.baseUrl}/rest/v1/rpc/${encodeURIComponent(functionName)}`;
    const headers = this._buildHeaders(options.headers);
    const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;

    if (this.dryRun) {
      return {
        dryRun: true,
        httpStatus: 200,
        ok: true,
        data: {
          _dry_run_simulated: true,
          action: 'POST_RPC',
          functionName,
          payloadKeys: Object.keys(payload),
          endpoint: `/rest/v1/rpc/${functionName}`,
        },
        rawText: '{"_dry_run_simulated":true}',
        durationMs: 0,
      };
    }

    const start = performance.now();
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });

      const rawText = await res.text();
      let data = null;
      try {
        data = JSON.parse(rawText);
      } catch {
        data = { raw: rawText };
      }

      return {
        dryRun: false,
        httpStatus: res.status,
        ok: res.ok,
        data,
        rawText,
        durationMs: Math.round(performance.now() - start),
      };
    } catch (err) {
      return {
        dryRun: false,
        httpStatus: 0,
        ok: false,
        data: null,
        rawText: this._sanitizeError(err),
        durationMs: Math.round(performance.now() - start),
      };
    }
  }

  /**
   * Queries a table via PostgREST: GET /rest/v1/<table>?<queryParams>
   * @param {string} tableName
   * @param {string} queryParams (e.g. "select=*&id=eq.123")
   * @param {Object} [options]
   * @returns {Promise<{ httpStatus: number, ok: boolean, data: any, rawText: string, durationMs: number }>}
   */
  async queryTable(tableName, queryParams = 'select=*', options = {}) {
    const endpoint = `${this.baseUrl}/rest/v1/${encodeURIComponent(tableName)}?${queryParams}`;
    const headers = this._buildHeaders();
    const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;

    if (this.dryRun) {
      return {
        dryRun: true,
        httpStatus: 200,
        ok: true,
        data: [],
        rawText: '[]',
        durationMs: 0,
      };
    }

    const start = performance.now();
    try {
      const res = await fetch(endpoint, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });

      const rawText = await res.text();
      let data = null;
      try {
        data = JSON.parse(rawText);
      } catch {
        data = [];
      }

      return {
        dryRun: false,
        httpStatus: res.status,
        ok: res.ok,
        data,
        rawText,
        durationMs: Math.round(performance.now() - start),
      };
    } catch (err) {
      return {
        dryRun: false,
        httpStatus: 0,
        ok: false,
        data: null,
        rawText: this._sanitizeError(err),
        durationMs: Math.round(performance.now() - start),
      };
    }
  }

  /**
   * Inserts row(s) into a table: POST /rest/v1/<table>
   * @param {string} tableName
   * @param {Object|Array<Object>} rows
   * @param {Object} [options]
   * @returns {Promise<{ httpStatus: number, ok: boolean, data: any, rawText: string }>}
   */
  async insertTable(tableName, rows, options = {}) {
    const endpoint = `${this.baseUrl}/rest/v1/${encodeURIComponent(tableName)}`;
    const headers = this._buildHeaders({ 'Prefer': 'resolution=merge-duplicates,return=representation' });
    const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;

    if (this.dryRun) {
      return {
        dryRun: true,
        httpStatus: 201,
        ok: true,
        data: Array.isArray(rows) ? rows : [rows],
        rawText: '{"_dry_run_simulated":true}',
      };
    }

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(rows),
        signal: AbortSignal.timeout(timeoutMs),
      });

      const rawText = await res.text();
      let data = null;
      try {
        data = JSON.parse(rawText);
      } catch {
        data = { raw: rawText };
      }

      return {
        dryRun: false,
        httpStatus: res.status,
        ok: res.ok,
        data,
        rawText,
      };
    } catch (err) {
      return {
        dryRun: false,
        httpStatus: 0,
        ok: false,
        data: null,
        rawText: this._sanitizeError(err),
      };
    }
  }

  /**
   * Deletes matching rows from a table: DELETE /rest/v1/<table>?<queryParams>
   * Strictly requires targeted queryParams to avoid broad deletes.
   * @param {string} tableName
   * @param {string} queryParams
   * @param {Object} [options]
   * @returns {Promise<{ httpStatus: number, ok: boolean, count: number, rawText: string }>}
   */
  async deleteTable(tableName, queryParams, options = {}) {
    if (!queryParams || queryParams === 'select=*' || queryParams.length < 5) {
      throw new Error(`SAFETY REJECTION: Broad delete queries are prohibited. Provided: "${queryParams}"`);
    }

    const endpoint = `${this.baseUrl}/rest/v1/${encodeURIComponent(tableName)}?${queryParams}`;
    const headers = this._buildHeaders({ 'Prefer': 'count=exact' });
    const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;

    if (this.dryRun) {
      return {
        dryRun: true,
        httpStatus: 204,
        ok: true,
        count: 0,
        rawText: '',
      };
    }

    try {
      const res = await fetch(endpoint, {
        method: 'DELETE',
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });

      const rawText = await res.text();
      return {
        dryRun: false,
        httpStatus: res.status,
        ok: res.ok,
        count: parseInt(res.headers.get('content-range')?.split('/')[1] || '0', 10),
        rawText,
      };
    } catch (err) {
      return {
        dryRun: false,
        httpStatus: 0,
        ok: false,
        count: 0,
        rawText: this._sanitizeError(err),
      };
    }
  }

  /**
   * Checks PostgREST schema introspection / OpenAPI health.
   * GET /rest/v1/
   * @param {Object} [options]
   */
  async inspectSchema(options = {}) {
    const endpoint = `${this.baseUrl}/rest/v1/`;
    const headers = this._buildHeaders();
    const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;

    if (this.dryRun) {
      return {
        dryRun: true,
        httpStatus: 200,
        ok: true,
        definitions: {
          subscription_entitlements: {},
          entitlement_schedule_adjustments: {},
          payment_refund_events: {},
          unmapped_payment_events: {},
        },
      };
    }

    try {
      const res = await fetch(endpoint, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });

      const schema = await res.json();
      return {
        dryRun: false,
        httpStatus: res.status,
        ok: res.ok,
        definitions: schema.definitions || {},
        paths: schema.paths || {},
      };
    } catch (err) {
      return {
        dryRun: false,
        httpStatus: 0,
        ok: false,
        error: this._sanitizeError(err),
      };
    }
  }
}
