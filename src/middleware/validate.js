import { isDayKey, isMonthKey } from '../lib/time.js';
import { unprocessable } from '../lib/errors.js';

/**
 * Tiny schema validator. A schema maps field names to rules; a rule is `{ parse, optional? }`
 * where `parse` returns the cleaned value or throws a short reason. Unknown fields are dropped.
 */

const rule = (parse, optional = false) => ({ parse, optional });
const fail = (reason) => {
  throw new Error(reason);
};

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export const v = {
  /** Trimmed string within a length range. */
  string: ({ min = 1, max = 200, optional = false, pattern } = {}) =>
    rule((value) => {
      if (typeof value !== 'string') fail('type');
      const text = value.trim();
      if (text.length < min) fail('too_short');
      if (text.length > max) fail('too_long');
      if (pattern && !pattern.test(text)) fail('format');
      return text;
    }, optional),

  enum: (allowed, { optional = false } = {}) =>
    rule((value) => (allowed.includes(value) ? value : fail('not_allowed')), optional),

  int: ({ min = -Infinity, max = Infinity, optional = false } = {}) =>
    rule((value) => {
      if (!Number.isInteger(value)) fail('type');
      if (value < min || value > max) fail('out_of_range');
      return value;
    }, optional),

  number: ({ min = -Infinity, max = Infinity, optional = false } = {}) =>
    rule((value) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) fail('type');
      if (value < min || value > max) fail('out_of_range');
      return value;
    }, optional),

  boolean: ({ optional = false } = {}) =>
    rule((value) => (typeof value === 'boolean' ? value : fail('type')), optional),

  id: ({ optional = false } = {}) =>
    rule((value) => (typeof value === 'string' && ID_PATTERN.test(value) ? value : fail('format')), optional),

  dayKey: ({ optional = false } = {}) =>
    rule((value) => (isDayKey(value) ? value : fail('format')), optional),

  month: ({ optional = false } = {}) =>
    rule((value) => (isMonthKey(value) ? value : fail('format')), optional),
};

/**
 * @param {Record<string, {parse: Function, optional: boolean}>} schema
 * @param {unknown} input
 * @returns {object} cleaned values (only schema fields)
 * @throws {AppError} 422 listing the invalid fields (names and reasons only, never values)
 */
export function validate(schema, input) {
  const source = input !== null && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const clean = {};
  const fields = {};
  for (const [name, { parse, optional }] of Object.entries(schema)) {
    const value = source[name];
    if (value === undefined || value === null) {
      if (!optional) fields[name] = 'required';
      continue;
    }
    try {
      clean[name] = parse(value);
    } catch (error) {
      fields[name] = error.message;
    }
  }
  if (Object.keys(fields).length > 0) {
    throw unprocessable('invalid_input', 'Some fields are not valid.', { fields });
  }
  return clean;
}

export const validateBody = (schema) => (req, res, next) => {
  req.body = validate(schema, req.body);
  next();
};

export const validateParams = (schema) => (req, res, next) => {
  validate(schema, req.params);
  next();
};
