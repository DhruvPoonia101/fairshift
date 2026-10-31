import { DISPUTE, MINUTES_PER_HOUR, PAYROLL, WAGE_RULES_NOTE } from './constants.js';

/**
 * Sector configuration. Adding a sector (a factory, say) means adding an entry here plus translated
 * labels in public/i18n and demo data in src/store/seed.js; no service or route code changes.
 * Display labels are translation keys on the client: sector.<id>, term.<id>.*, role.*, cat.*.
 *
 * `decentWorkWeights` optionally overrides the Decent Work Score weights (see src/services/decentWork.js).
 * `fatigue` optionally overrides the default rest rules (see src/services/fatigue.js). All numbers
 * are configurable defaults for the demo, not statements of what any law requires.
 */

/** Categories every workplace needs for pay and conduct complaints. */
export const COMMON_CATEGORIES = Object.freeze([
  { id: 'pay', icon: 'rupee', kind: 'grievance' },
  { id: 'hours', icon: 'clock', kind: 'grievance' },
  { id: 'behaviour', icon: 'user', kind: 'grievance' },
  { id: 'facilities', icon: 'droplet', kind: 'grievance' },
  { id: 'other', icon: 'more', kind: 'grievance' },
]);

/** `minSeverity` lifts reports in categories that are serious by nature, whatever the wording. */
const hazard = (id, icon, minSeverity = 'medium') => ({ id, icon, kind: 'hazard', minSeverity });

const hours = (n) => n * MINUTES_PER_HOUR;

/** Minimum wage and overtime rule for a sector. Illustrative defaults: check the current notification for your state. */
const wageRules = (minDailyWagePaise) => ({
  minDailyWagePaise,
  minHourlyWagePaise: null,
  overtimeMultiplierPct: PAYROLL.DEFAULT_OVERTIME_MULTIPLIER_PCT,
  note: WAGE_RULES_NOTE,
});

export const SECTORS = Object.freeze({
  construction: {
    id: 'construction',
    icon: 'building',
    orgName: 'BuildRight Constructions',
    wageType: 'contract_daily',
    geofenceRadiusMeters: 150,
    disputeWindowDays: DISPUTE.WINDOW_DAYS,
    wageRules: wageRules(55_000),
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
    icon: 'users',
    orgName: 'Greenfield College',
    wageType: 'daily_on_roll',
    geofenceRadiusMeters: 300,
    disputeWindowDays: DISPUTE.WINDOW_DAYS,
    wageRules: wageRules(45_000),
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
  hospital: {
    id: 'hospital',
    icon: 'heart',
    orgName: 'CityCare Hospital',
    wageType: 'daily_on_roll',
    geofenceRadiusMeters: 200,
    disputeWindowDays: DISPUTE.WINDOW_DAYS,
    wageRules: wageRules(55_000),
    roles: [
      { id: 'nurse', dailyWagePaise: 110_000 },
      { id: 'ward_staff', dailyWagePaise: 60_000 },
    ],
    hazardCategories: [
      hazard('needle_stick', 'syringe', 'high'),
      hazard('patient_aggression', 'hand', 'high'),
      hazard('equipment_fault', 'monitor'),
      hazard('infection_exposure', 'virus', 'high'),
    ],
    shifts: [
      { id: 'morning', startMinute: 7 * 60 },
      { id: 'evening', startMinute: 15 * 60 },
      { id: 'night', startMinute: 21 * 60 },
    ],
    // Departments are the check-in sites: each has its own daily QR and code.
    sites: [
      { id: 'site-hos-1', name: 'ICU', lat: 13.0674, lng: 80.2376 },
      { id: 'site-hos-2', name: 'Emergency', lat: 13.0677, lng: 80.2379 },
      { id: 'site-hos-3', name: 'General Ward', lat: 13.0671, lng: 80.2373 },
    ],
    // Stricter than the defaults, plus night-shift rules. Change the numbers, not the code.
    fatigue: {
      weekAmberMinutes: hours(44),
      weekRedMinutes: hours(54),
      minRestMinutes: hours(12),
      maxConsecutiveDays: 6,
      night: {
        startMinute: hours(20), // a shift that starts from 20:00 to 06:00 counts as a night shift
        endMinute: hours(6),
        maxConsecutive: 3,
        restAfterMinutes: hours(24), // rest needed between a night shift and the next non-night shift
      },
    },
  },
});

/** Every demo sign-in: `worker-<sector>` and `admin-<sector>`. */
export const DEMO_ROLES = Object.freeze(Object.keys(SECTORS).flatMap((id) => [`worker-${id}`, `admin-${id}`]));

export const orgIdFor = (sectorId) => `org-${sectorId}`;

/** The sectors offered on the sign-in screen. */
export const sectorChoices = () => Object.values(SECTORS).map((s) => ({ id: s.id, orgId: orgIdFor(s.id), icon: s.icon }));

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
    icon: sector.icon,
    wageType: sector.wageType,
    geofenceRadiusMeters: sector.geofenceRadiusMeters,
    overtimeMultiplierPct: sector.wageRules.overtimeMultiplierPct,
    disputeWindowDays: sector.disputeWindowDays,
    categories: categoriesFor(sectorId),
    roles: sector.roles.map((r) => r.id),
    shifts: sector.shifts.map((s) => ({ id: s.id, startMinute: s.startMinute })),
  };
}
