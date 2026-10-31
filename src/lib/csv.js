/**
 * Small CSV writer for the payroll export. Two things matter more than the format:
 *
 * 1. CSV injection. A spreadsheet treats a cell that starts with = + - @ (or a tab or carriage return) as a formula,
 *    so a worker called `=HYPERLINK(...)` would run code on the employer's machine. Such a cell gets a leading
 *    apostrophe, which spreadsheets show as plain text.
 * 2. Quoting. A cell with a comma, a quote or a line break is wrapped in quotes and its quotes are doubled.
 */

const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;
const MINUTES_PER_HOUR = 60;

/** One cell, as text. Numbers and null are accepted; null is an empty cell. */
export function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Integer paise as rupees with two decimals: 123456 -> "1234.56". Money is never a float inside the app. */
export function rupees(paise) {
  const whole = Math.round(paise);
  const sign = whole < 0 ? '-' : '';
  const abs = Math.abs(whole);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Minutes as hours with two decimals: 510 -> "8.50". */
export function hoursFromMinutes(minutes) {
  return (Math.round((minutes / MINUTES_PER_HOUR) * 100) / 100).toFixed(2);
}

/**
 * @param {string[]} header
 * @param {Array<Array<string | number | null>>} rows
 * @returns {string} UTF-8 text with a byte-order mark (so Excel reads Hindi and Tamil names correctly) and CRLF lines
 */
export function toCsv(header, rows) {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}
