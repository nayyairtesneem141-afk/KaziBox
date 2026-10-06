/**
 * Lightweight, zero-dependency schema validation engine for KaziBox Integration API
 * Conforms to Zod-like schema definition and returns structured HTTP 422 field errors.
 */

export interface ValidationErrorDetail {
  field: string;
  message: string;
}

export class SchemaValidationError extends Error {
  public errors: ValidationErrorDetail[];
  constructor(errors: ValidationErrorDetail[]) {
    super('Schema validation failed');
    this.name = 'SchemaValidationError';
    this.errors = errors;
  }
}

export type ValidatorFn<T> = (value: unknown, fieldName: string) => { valid: boolean; value?: T; error?: string };

export const z = {
  string: (options: { min?: number; max?: number; required?: boolean } = {}) => {
    return (val: unknown, field: string) => {
      if (val === undefined || val === null || val === '') {
        if (options.required !== false) {
          return { valid: false, error: `${field} is required and must be a non-empty string.` };
        }
        return { valid: true, value: '' };
      }
      if (typeof val !== 'string') {
        return { valid: false, error: `${field} must be a string.` };
      }
      if (options.min !== undefined && val.length < options.min) {
        return { valid: false, error: `${field} must be at least ${options.min} characters.` };
      }
      if (options.max !== undefined && val.length > options.max) {
        return { valid: false, error: `${field} must be at most ${options.max} characters.` };
      }
      return { valid: true, value: val };
    };
  },

  number: (options: { min?: number; max?: number; positive?: boolean } = {}) => {
    return (val: unknown, field: string) => {
      const num = Number(val);
      if (val === undefined || val === null || isNaN(num)) {
        return { valid: false, error: `${field} must be a valid number.` };
      }
      if (options.positive && num <= 0) {
        return { valid: false, error: `${field} must be a positive number greater than 0.` };
      }
      if (options.min !== undefined && num < options.min) {
        return { valid: false, error: `${field} must be >= ${options.min}.` };
      }
      if (options.max !== undefined && num > options.max) {
        return { valid: false, error: `${field} must be <= ${options.max}.` };
      }
      return { valid: true, value: num };
    };
  },

  datetime: (options: { required?: boolean } = {}) => {
    return (val: unknown, field: string) => {
      if (val === undefined || val === null || val === '') {
        if (options.required === false) {
          return { valid: true, value: new Date().toISOString() };
        }
        return { valid: false, error: `${field} is required and must be an ISO-8601 date string.` };
      }
      if (typeof val !== 'string') {
        return { valid: false, error: `${field} must be an ISO-8601 date string.` };
      }
      const parsed = Date.parse(val);
      if (isNaN(parsed)) {
        return { valid: false, error: `${field} is not a valid date format.` };
      }
      return { valid: true, value: new Date(parsed).toISOString() };
    };
  },

  record: () => {
    return (val: unknown, field: string) => {
      if (val === undefined || val === null) {
        return { valid: true, value: {} };
      }
      if (typeof val !== 'object' || Array.isArray(val)) {
        return { valid: false, error: `${field} must be an object/record.` };
      }
      return { valid: true, value: val as Record<string, any> };
    };
  },

  object: <T extends Record<string, ValidatorFn<any>>>(shape: T) => {
    return {
      parse: (input: unknown): { [K in keyof T]: any } => {
        if (!input || typeof input !== 'object' || Array.isArray(input)) {
          throw new SchemaValidationError([{ field: 'body', message: 'Request body must be a JSON object.' }]);
        }

        const data = input as Record<string, any>;
        const result: Record<string, any> = {};
        const errors: ValidationErrorDetail[] = [];

        for (const [key, validator] of Object.entries(shape)) {
          const val = data[key];
          const check = validator(val, key);
          if (!check.valid) {
            errors.push({ field: key, message: check.error || `Invalid field: ${key}` });
          } else {
            result[key] = check.value;
          }
        }

        if (errors.length > 0) {
          throw new SchemaValidationError(errors);
        }

        return result as { [K in keyof T]: any };
      },

      safeParse: (input: unknown): { success: true; data: { [K in keyof T]: any } } | { success: false; errors: ValidationErrorDetail[] } => {
        try {
          const parsed = z.object(shape).parse(input);
          return { success: true, data: parsed };
        } catch (err) {
          if (err instanceof SchemaValidationError) {
            return { success: false, errors: err.errors };
          }
          return { success: false, errors: [{ field: 'unknown', message: String(err) }] };
        }
      },
    };
  },
};
