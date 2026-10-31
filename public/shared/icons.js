const NS = 'http://www.w3.org/2000/svg';

/** Inline SVG icons (24x24 stroke paths). No images, no icon font, no network. */
const PATHS = {
  home: ['M3 11l9-8 9 8', 'M5 10v10h14V10', 'M10 20v-6h4v6'],
  // The rupee sign (a clean stroke glyph, no font needed): two bars, the bowl, and the leg.
  rupee: ['M7 4.5h10', 'M7 8.5h10', 'M7 4.5h3.5a4 4 0 0 1 0 8H7', 'M7 12.5l8 7'],
  alert: ['M12 3l10 18H2L12 3z', 'M12 10v5', 'M12 18h.01'],
  smile: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M8 14s1.5 2 4 2 4-2 4-2', 'M9 9h.01', 'M15 9h.01'],
  badge: ['M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12z', 'M8.5 14L7 22l5-3 5 3-1.5-8'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2'],
  check: ['M4 12l5 5L20 6'],
  x: ['M6 6l12 12', 'M18 6L6 18'],
  plus: ['M12 5v14', 'M5 12h14'],
  logout: ['M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
  mic: ['M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z', 'M5 11a7 7 0 0 0 14 0', 'M12 18v3'],
  speaker: ['M4 9v6h4l5 4V5L8 9H4z', 'M16 9a4 4 0 0 1 0 6', 'M19 6a8 8 0 0 1 0 12'],
  shield: ['M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z', 'M9 12l2 2 4-4'],
  ladder: ['M7 3v18', 'M17 3v18', 'M7 7h10', 'M7 12h10', 'M7 17h10'],
  bolt: ['M13 2L4 14h7l-1 8 9-12h-7l1-8z'],
  helmet: ['M3 16a9 9 0 0 1 18 0', 'M2 16h20v3H2z', 'M12 7v5'],
  sun: ['M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M12 2v2', 'M12 20v2', 'M2 12h2', 'M20 12h2', 'M5 5l1.5 1.5', 'M17.5 17.5L19 19', 'M5 19l1.5-1.5', 'M17.5 6.5L19 5'],
  gear: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19 12l2-1-1-3-2 .5-1.5-1.5.5-2-3-1-1 2h-2l-1-2-3 1 .5 2L6 8.5 4 8l-1 3 2 1v1l-2 1 1 3 2-.5L7.5 18l-.5 2 3 1 1-2h2l1 2 3-1-.5-2 1.5-1.5 2 .5 1-3-2-1v-1z'],
  droplet: ['M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z'],
  flask: ['M9 3h6', 'M10 3v6L4 20h16l-6-11V3', 'M7 15h10'],
  flame: ['M12 22c4 0 7-3 7-7 0-5-5-7-5-12-3 2-8 6-8 12 0 4 3 7 6 7z', 'M12 22c-2 0-3-1.5-3-3 0-2 3-3 3-6 2 2 3 4 3 6 0 1.5-1 3-3 3z'],
  bed: ['M3 19V6', 'M3 14h18v5', 'M21 14v-2a3 3 0 0 0-3-3h-7v5', 'M7 11h.01'],
  user: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4 21a8 8 0 0 1 16 0'],
  users: ['M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z', 'M2 20a7 7 0 0 1 14 0', 'M16 4.5a3.5 3.5 0 0 1 0 6', 'M18 14a7 7 0 0 1 4 6'],
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  eyeOff: ['M3 3l18 18', 'M10.5 5.2A9 9 0 0 1 12 5c5 0 9 4.5 10 7a13 13 0 0 1-3 4.2', 'M6.5 6.6C4 8.1 2.5 10.3 2 12c1 2.5 5 7 10 7a9 9 0 0 0 3.5-.7', 'M9.9 9.9a3 3 0 0 0 4.2 4.2'],
  qr: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M3 14h7v7H3z', 'M14 14h3v3h-3z', 'M20 14v.01', 'M14 20h3', 'M20 17v4'],
  pin: ['M12 22s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z', 'M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'],
  chart: ['M4 20V10', 'M10 20V4', 'M16 20v-8', 'M22 20H2'],
  moon: ['M20 14.5A8 8 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z'],
  trend: ['M3 7l6 6 4-4 8 8', 'M21 11v6h-6'],
  print: ['M7 9V3h10v6', 'M7 17H4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-3', 'M7 14h10v7H7z'],
  share: ['M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M8.7 10.7l6.6-3.4', 'M8.7 13.3l6.6 3.4'],
  globe: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M3 12h18', 'M12 3a14 14 0 0 1 0 18', 'M12 3a14 14 0 0 0 0 18'],
  hand: ['M7 11V6a1.5 1.5 0 0 1 3 0v5', 'M10 11V4.5a1.5 1.5 0 0 1 3 0V11', 'M13 11V6a1.5 1.5 0 0 1 3 0v8c0 4-2 7-6 7-3 0-4.5-2-6-5l-1.5-3a1.5 1.5 0 0 1 2.5-1.5L7 14'],
  piggy: ['M19 11c0-3.5-3-6-7-6S5 7.5 5 11c0 2 1 3.5 2.5 4.5V19h3v-1.5h3V19h3v-3.5c1-.700 1.5-1.5 1.5-1.5l2-1v-2.5l-2 .500z', 'M15 10h.01'],
  calendar: ['M4 6h16v14H4z', 'M4 10h16', 'M8 3v4', 'M16 3v4'],
  building: ['M4 21V4h10v17', 'M14 9h6v12', 'M8 8h2', 'M8 12h2', 'M8 16h2', 'M2 21h20'],
  lock: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 8 0v4'],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v5', 'M12 8h.01'],
  copy: ['M9 9h11v11H9z', 'M5 15V4h11'],
  dash: ['M6 12h12'],
  compass: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M15.5 8.5l-2 5-5 2 2-5 5-2z'],
  arrowLeft: ['M19 12H5', 'M11 6l-6 6 6 6'],
  camera: ['M4 8h3l2-3h6l2 3h3v11H4z', 'M12 10.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 0 0 0-7z'],
  download: ['M12 4v11', 'M7 11l5 5 5-5', 'M5 20h14'],
  refresh: ['M20 12a8 8 0 1 1-2.5-5.8', 'M20 4v5h-5'],
  wifiOff: ['M3 3l18 18', 'M8.5 16.5a5 5 0 0 1 7 0', 'M5 12.5a10 10 0 0 1 4-2.3', 'M15 10.2a10 10 0 0 1 4 2.3', 'M2 8.8a15 15 0 0 1 4-2.5', 'M12 20h.01'],
  list: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
  scale: ['M12 3v18', 'M5 21h14', 'M5 6h14', 'M5 6l-3 7a3 3 0 0 0 6 0L5 6z', 'M19 6l-3 7a3 3 0 0 0 6 0l-3-7z'],
  heart: ['M12 21s-8-5.5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.5-8 11-8 11z', 'M7 12h3l1.5-2.5L13 14l1-2h3'],
  syringe: ['M18 2l4 4', 'M20 4l-3 3', 'M15 7l-9 9v3h3l9-9', 'M11 11l2 2', 'M3 21l3-3'],
  virus: ['M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z', 'M12 2v3', 'M12 19v3', 'M2 12h3', 'M19 12h3', 'M5 5l2 2', 'M17 17l2 2', 'M5 19l2-2', 'M17 7l2-2'],
  monitor: ['M3 4h18v12H3z', 'M8 20h8', 'M12 16v4', 'M6 10h3l1.5-3 2 6 1.5-3h2'],
};

/**
 * One colour per feature: pay = saffron, report = coral red, speak up = teal, skills = indigo, check-in = emerald,
 * rest = violet, language = sky blue, payroll = amber. The colours are tokens in base.css (--ic-*).
 */
const TONE_OF = {
  rupee: 'pay',
  alert: 'report', helmet: 'report', ladder: 'report', bolt: 'report', flame: 'report', droplet: 'report', flask: 'report', syringe: 'report', virus: 'report', monitor: 'report',
  eyeOff: 'speak', mic: 'speak', speaker: 'speak', smile: 'speak', users: 'speak',
  badge: 'skills', scale: 'skills', chart: 'skills', trend: 'skills',
  qr: 'checkin', clock: 'checkin', pin: 'checkin', calendar: 'checkin', home: 'checkin',
  moon: 'rest', bed: 'rest',
  globe: 'lang',
  download: 'payroll', list: 'payroll',
};

/** The tone name (a data-tone value) for an icon, or null when it has none (it then keeps the plain accent). */
export const toneOf = (name) => TONE_OF[name] ?? null;

/** @param {string} name key of PATHS */
export function icon(name, className = '') {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `icon ${className}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const d of PATHS[name] ?? PATHS.info) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}
