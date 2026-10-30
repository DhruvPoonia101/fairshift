import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { COMMON_CATEGORIES, SECTORS } from '../src/config/sectors.js';
import { DISPUTE } from '../src/config/constants.js';
import { AUDIT_ACTIONS } from '../src/services/audit.js';
import { COMPLIANCE_REASON_KEYS, COMPLIANCE_STATUS } from '../src/services/compliance.js';
import { COMPONENT_IDS } from '../src/services/decentWork.js';
import { FATIGUE_RULES } from '../src/services/fatigue.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (lang) => JSON.parse(readFileSync(path.join(root, 'public', 'i18n', `${lang}.json`), 'utf8'));
const en = load('en');
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

function sourceFiles(dir, extension) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full, extension);
    return full.endsWith(extension) ? [full] : [];
  });
}

test('Hindi and Tamil define exactly the same keys as English', () => {
  for (const lang of ['hi', 'ta']) {
    const other = load(lang);
    assert.deepEqual(Object.keys(other).sort(), Object.keys(en).sort(), `${lang} keys match`);
  }
});

test('translations keep the same {placeholders} as English', () => {
  for (const lang of ['hi', 'ta']) {
    const other = load(lang);
    for (const [key, text] of Object.entries(en)) {
      assert.deepEqual(placeholders(other[key]), placeholders(text), `${lang}:${key}`);
    }
  }
});

test('no translation is empty', () => {
  for (const lang of ['en', 'hi', 'ta']) {
    for (const [key, text] of Object.entries(load(lang))) assert.ok(text.trim().length > 0, `${lang}:${key}`);
  }
});

test('every literal t("key") used by the browser code exists in the dictionary', () => {
  const missing = [];
  for (const file of sourceFiles(path.join(root, 'public'), '.js')) {
    const code = readFileSync(file, 'utf8');
    for (const match of code.matchAll(/\bt\(\s*'([A-Za-z0-9_.-]+)'/g)) {
      if (!(match[1] in en)) missing.push(`${path.relative(root, file)}: ${match[1]}`);
    }
  }
  for (const file of sourceFiles(path.join(root, 'public'), '.html')) {
    const html = readFileSync(file, 'utf8');
    for (const match of html.matchAll(/data-i18n(?:-attr)?="(?:[a-z-]+:)?([A-Za-z0-9_.-]+)"/g)) {
      if (!(match[1] in en)) missing.push(`${path.relative(root, file)}: ${match[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('dynamic keys: every category, role, fatigue rule and API error code has a label', () => {
  const needed = [];
  for (const category of COMMON_CATEGORIES) needed.push(`cat.${category.id}`);
  for (const sector of Object.values(SECTORS)) {
    needed.push(`sector.${sector.id}`, `landing.industry.${sector.id}.who`, `landing.demoHint.${sector.id}`);
    for (const role of sector.roles) needed.push(`role.${role.id}`);
    for (const hazard of sector.hazardCategories) needed.push(`cat.${hazard.id}`);
  }
  for (const rule of Object.values(FATIGUE_RULES)) needed.push(`fatigue.rule.${rule}`, `rest.reason.${rule}`);
  for (const key of ['absenteeism', 'fatigue', 'late', 'grievance', 'dispute', 'new_joiner']) needed.push(`reason.${key}`);
  for (const key of ['regular', 'overtime', 'pf', 'esi', 'esi_not_applicable', 'advance']) {
    needed.push(`payslip.line.${key}`, `payslip.explain.${key}`);
  }

  for (const key of COMPLIANCE_REASON_KEYS) needed.push(`compliance.reason.${key}`);
  for (const status of Object.values(COMPLIANCE_STATUS)) needed.push(`compliance.${status}`, `complianceAdmin.status.${status}`);
  for (const action of AUDIT_ACTIONS) needed.push(`dispute.timeline.${action}`);
  for (const category of DISPUTE.CATEGORIES) needed.push(`dispute.cat.${category}`);
  for (const status of ['submitted', 'under_review', 'approved', 'rejected']) needed.push(`dispute.status.${status}`);
  for (const actor of ['worker', 'admin', 'system']) needed.push(`dispute.by.${actor}`);
  for (const id of COMPONENT_IDS) needed.push(`dws.component.${id}`, `dws.driver.${id}`, `dws.how.${id}`);
  for (const band of ['healthy', 'needs_attention', 'at_risk', 'unknown']) needed.push(`dws.band.${band}`);

  const codes = new Set(['too_large', 'bad_json', 'server_error']);
  for (const file of sourceFiles(path.join(root, 'src'), '.js')) {
    const code = readFileSync(file, 'utf8');
    for (const m of code.matchAll(/(?:unprocessable|conflict|badRequest)\(\s*'([a-z_]+)'/g)) codes.add(m[1]);
    for (const m of code.matchAll(/AppError\(\s*\d+,\s*'([a-z_]+)'/g)) codes.add(m[1]);
  }
  for (const code of codes) needed.push(`err.${code}`);

  assert.deepEqual(needed.filter((key) => !(key in en)), []);
});
