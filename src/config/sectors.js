import { PAYROLL } from './constants.js';

/**
 * Sector configuration. Adding a hospital or factory means adding an entry here
 * (plus translated labels in public/i18n); no service code changes.
 * Display labels are translation keys on the client: term.<sector>.*, role.*, hazard.*, shift.*.
 */

/** Categories every workplace needs for pay and conduct complaints. */
export const COMMON_CATEGORIES = Object.freeze([
  { id: 'pay', icon: 'wallet', kind: 'grievance' },
  { id: 'hours', icon: 'clock', kind: 'grievance' },
  { id: 'behaviour', icon: 'user', kind: 'grievance' },
  { id: 'facilities', icon: 'droplet', kind: 'grievance' },
  { id: 'other', icon: 'more', kind: 'grievance' },
]);

const hazard = (id, icon) => ({ id, icon, kind: 'hazard' });

export const SECTORS = Object.freeze({
  construction: {
    id: 'construction',
    orgName: 'BuildRight Constructions',
    wageType: 'contract_daily',
    geofenceRadiusMeters: 150,
    overtimeMultiplierPct: PAYROLL.DEFAULT_OVERTIME_MULTIPLIER_PCT,
    roles: [
      { id: 'mason', dailyWagePaise: 90_000 },
      { id: 'electrician', dailyWagePaise: 100_000 },
      { id: 'helper', dailyWagePaise: 60_000 },
      { id: 'scaffolder', dailyWagePaise: 85_000 },
    ],
    hazardCategories: [
      hazard('scaffolding', 'ladder'),
      hazard('electrical', 'bolt'),
      hazard('ppe', 'helmet'),
      hazard('heat', 'sun'),
      hazard('machinery', 'gear'),
    ],
    shifts: [
      { id: 'day', startMinute: 8 * 60 },
      { id: 'early', startMinute: 6 * 60 },
    ],
    sites: [
      { id: 'site-con-1', name: 'Riverside Tower', lat: 12.9716, lng: 80.2209 },
      { id: 'site-con-2', name: 'Metro Depot Yard', lat: 12.9352, lng: 80.2131 },
    ],
  },
  college: {
    id: 'college',
    orgName: 'Greenfield College',
    wageType: 'daily_on_roll',
    geofenceRadiusMeters: 300,
    overtimeMultiplierPct: PAYROLL.DEFAULT_OVERTIME_MULTIPLIER_PCT,
    roles: [
      { id: 'housekeeping', dailyWagePaise: 50_000 },
      { id: 'security', dailyWagePaise: 65_000 },
      { id: 'lab_attendant', dailyWagePaise: 70_000 },
      { id: 'mess_staff', dailyWagePaise: 55_000 },
      { id: 'gardener', dailyWagePaise: 50_000 },
    ],
    hazardCategories: [
      hazard('wet_floor', 'droplet'),
      hazard('chemical_lab', 'flask'),
      hazard('electrical', 'bolt'),
      hazard('hostel_safety', 'bed'),
      hazard('fire_exit', 'flame'),
    ],
    shifts: [
      { id: 'general', startMinute: 9 * 60 },
      { id: 'morning', startMinute: 6 * 60 },
      { id: 'night', startMinute: 21 * 60 },
    ],
    sites: [
      { id: 'site-col-1', name: 'Main Academic Block', lat: 13.0827, lng: 80.2707 },
      { id: 'site-col-2', name: 'Hostel & Mess Block', lat: 13.0845, lng: 80.2731 },
    ],
  },
});

export function getSector(sectorId) {
  const sector = SECTORS[sectorId];
  if (!sector) throw new Error(`Unknown sector: ${sectorId}`);
  return sector;
}

/** Category definitions (common + hazards) valid for a sector. */
export function categoriesFor(sectorId) {
  return [...COMMON_CATEGORIES, ...getSector(sectorId).hazardCategories];
}

export function findCategory(sectorId, categoryId) {
  return categoriesFor(sectorId).find((c) => c.id === categoryId) ?? null;
}

export function findShift(sectorId, shiftId) {
  return getSector(sectorId).shifts.find((s) => s.id === shiftId) ?? null;
}

/** Public part of the sector config sent to the browser. */
export function publicSectorView(sectorId) {
  const sector = getSector(sectorId);
  return {
    id: sector.id,
    wageType: sector.wageType,
    geofenceRadiusMeters: sector.geofenceRadiusMeters,
    overtimeMultiplierPct: sector.overtimeMultiplierPct,
    categories: categoriesFor(sectorId),
    roles: sector.roles.map((r) => r.id),
    shifts: sector.shifts.map((s) => ({ id: s.id, startMinute: s.startMinute })),
  };
}
