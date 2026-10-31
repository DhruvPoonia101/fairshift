/** Tiny i18n: JSON dictionaries, {placeholders}, sector-specific terms, language persisted locally. */
import { money, number } from './format.js';

export const LANGUAGES = [
  { code: 'en', label: 'English', locale: 'en-IN' },
  { code: 'hi', label: 'हिन्दी', locale: 'hi-IN' },
  { code: 'ta', label: 'தமிழ்', locale: 'ta-IN' },
];
const STORAGE_KEY = 'fairshift.lang';

let lang = 'en';
let sector = null;
let dictionary = {};
let fallback = {};

function readStored() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function pickInitialLanguage() {
  const stored = readStored();
  if (LANGUAGES.some((l) => l.code === stored)) return stored;
  const browser = (navigator.language || 'en').slice(0, 2);
  return LANGUAGES.some((l) => l.code === browser) ? browser : 'en';
}

async function load(code) {
  const response = await fetch(`/i18n/${code}.json`);
  return response.ok ? response.json() : {};
}

export const currentLanguage = () => LANGUAGES.find((l) => l.code === lang);
export const currentLocale = () => currentLanguage().locale;

/** Terms like "site" change per sector: term.<sector>.site wins over term.site. */
export function setSector(sectorId) {
  sector = sectorId;
}

function formatParam(name, value) {
  if (typeof value === 'number') return name.endsWith('Paise') ? money(value) : number(value);
  return String(value ?? '');
}

/**
 * @param {string} key
 * @param {Record<string, string | number>} [params]
 */
export function t(key, params) {
  const sectorKey = sector && key.startsWith('term.') ? `term.${sector}.${key.slice(5)}` : null;
  const template = (sectorKey && dictionary[sectorKey]) ?? dictionary[key] ?? fallback[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name) => formatParam(name, params?.[name]));
}

/** Translates static markup: data-i18n="key" and data-i18n-attr="aria-label:key;title:key". */
export function applyTranslations(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split(':');
      el.setAttribute(attr, t(key));
    }
  }
  const title = document.querySelector('title[data-i18n]');
  if (title) document.title = t(title.dataset.i18n);
}

export async function initI18n() {
  lang = pickInitialLanguage();
  [fallback, dictionary] = await Promise.all([load('en'), lang === 'en' ? null : load(lang)]);
  if (lang === 'en') dictionary = fallback;
  document.documentElement.lang = lang;
  applyTranslations();
}

async function setLanguage(code) {
  lang = code;
  dictionary = code === 'en' ? fallback : await load(code);
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // Storage may be blocked (private mode); the choice then lasts for this page only.
  }
  document.documentElement.lang = code;
  applyTranslations();
  document.dispatchEvent(new CustomEvent('langchange'));
}

/** Fills `container` with a labelled language <select>. */
export function mountLanguageSwitcher(container) {
  const select = document.createElement('select');
  select.id = 'lang-select';
  for (const l of LANGUAGES) {
    const option = document.createElement('option');
    option.value = l.code;
    option.textContent = l.label;
    option.lang = l.code;
    select.append(option);
  }
  select.value = lang;
  select.addEventListener('change', () => setLanguage(select.value));
  const label = document.createElement('label');
  label.htmlFor = 'lang-select';
  label.className = 'visually-hidden';
  label.dataset.i18n = 'common.language';
  label.textContent = t('common.language');
  container.replaceChildren(label, select);
}
