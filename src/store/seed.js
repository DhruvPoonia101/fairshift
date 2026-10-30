import { MS_PER_DAY, MS_PER_MINUTE } from '../config/constants.js';
import { SECTORS, findCategory, findShift } from '../config/sectors.js';
import { createPrng, hashString, randomToken } from '../lib/random.js';
import { addDays, dayKey, dayStartMs, monthKey, previousMonth, weekdayOf } from '../lib/time.js';
import { suggestSeverity } from '../services/grievance.js';

/**
 * Deterministic demo data. Dates are relative to "today" (IST) and all randomness comes from a
 * seeded PRNG, so two boots on the same day produce the same records.
 *
 * Profiles drive the story the demo tells:
 *  - amber / red: fatigued workers (amber is the demo worker, who has not checked in today)
 *  - attrA: attendance dropping, often late, an unresolved complaint
 *  - attrB: new joiner, late, disputed a payslip
 *  - nightRun: four night shifts in a row, then a morning shift two hours after the last one
 *  - overtime: long shifts every working day this week
 *
 * Seeding is idempotent: an org that already exists is left alone, and its org document is written
 * last, so a crash half way through is repaired by the next start. That makes it safe to run on
 * every boot and from several instances at once (ids are deterministic, so races only rewrite
 * identical documents).
 */

const SEED_DAYS = 62;
const ABSENT_CHANCE = 0.07;
const ABSENT_TODAY_CHANCE = 0.25;
const OVERTIME_CHANCE = 0.3;
const RECENT_NO_OVERTIME_DAYS = 7;
const NORMAL_SHIFT_MINUTES = 480;
const LONG_SHIFT_MINUTES = 618;
const AMBER_SHIFT_MINUTES = 500;
const NEW_JOINER_TENURE_DAYS = 35;
const OVERTIME_PROFILE_SHIFT_MINUTES = 630;
const NIGHT_RUN_NIGHTS = 4;
const MORNING_START_MINUTE = 7 * 60;
const WRITE_CONCURRENCY = 100;

const w = (name, role, profile, shiftId, siteIdx = 0) => ({ name, role, profile, shiftId, siteIdx });

const ORGS = [
  {
    id: 'org-construction',
    sector: 'construction',
    adminId: 'adm-con',
    adminName: 'Anita Menon',
    abbr: 'con',
    workers: [
      w('Ravi Kumar', 'mason', 'amber', 'day'),
      w('Suresh Patel', 'electrician', 'normal', 'day'),
      w('Mohan Das', 'helper', 'normal', 'day', 1),
      w('Arjun Singh', 'scaffolder', 'red', 'early'),
      w('Karthik Raja', 'mason', 'normal', 'day'),
      w('Murugan S', 'helper', 'normal', 'early', 1),
      w('Imran Sheikh', 'electrician', 'normal', 'day', 1),
      w('Lakshmi Devi', 'helper', 'attrB', 'day'),
      w('Deepak Nair', 'scaffolder', 'normal', 'day'),
      w('Bablu Mandal', 'helper', 'attrA', 'day', 1),
      w('Selvam P', 'mason', 'normal', 'early'),
      w('Anil Kumar', 'helper', 'normal', 'day', 1),
    ],
    expiring: { workerIndex: 8, title: 'Working at Height', issuer: 'State Construction Safety Board', daysLeft: 12 },
    certByRole: {
      mason: 'Masonry Skill Certificate',
      electrician: 'Electrical Safety (Wireman)',
      helper: 'Site Safety Basics',
      scaffolder: 'Working at Height',
    },
    grievances: [
      { who: 9, category: 'hours', text: 'We were made to stay late three days this week without any break.', ageDays: 10, status: 'open' },
      { who: 7, category: 'pay', text: 'Payslip looks wrong. My overtime hours seem less than what I worked.', ageDays: 3, status: 'in_review', source: 'payslip' },
      { anonymous: true, category: 'scaffolding', text: 'Scaffolding on level 4 has loose boards near the edge. Someone could fall.', ageDays: 2, status: 'open' },
      { anonymous: true, category: 'ppe', text: 'New workers get no helmets at the east gate.', ageDays: 20, status: 'resolved', note: 'Spare helmets issued at the east gate store. Supervisor checks daily.' },
      { who: 1, category: 'pay', text: 'My advance was deducted twice last month.', ageDays: 25, status: 'resolved', note: 'Duplicate deduction corrected in this month payslip.' },
    ],
    feedback: [
      ['manager', 4, 'Supervisor listens when we raise problems.'],
      ['manager', 2, 'Gets angry in front of everyone.'],
      ['manager', 3, ''],
      ['manager', 5, 'Helped me get my safety belt replaced.'],
      ['policies', 3, ''],
      ['policies', 2, 'Salary day keeps changing.'],
      ['conditions', 2, 'Drinking water is far from the work area.'],
      ['conditions', 2, 'Toilets are not clean.'],
      ['conditions', 3, 'Too hot in the afternoon, we need shade.'],
      ['conditions', 4, 'Good safety belts now.'],
    ],
  },
  {
    id: 'org-college',
    sector: 'college',
    adminId: 'adm-col',
    adminName: 'Rahul Verma',
    abbr: 'col',
    workers: [
      w('Sunita Devi', 'housekeeping', 'amber', 'morning'),
      w('Rajesh Kumar', 'security', 'normal', 'night'),
      w('Meena K', 'lab_attendant', 'normal', 'general'),
      w('Ganesh Iyer', 'mess_staff', 'red', 'morning', 1),
      w('Pooja Sharma', 'housekeeping', 'normal', 'morning'),
      w('Abdul Rahman', 'security', 'normal', 'night', 1),
      w('Kavitha R', 'mess_staff', 'normal', 'morning', 1),
      w('Vijay Kumar', 'gardener', 'attrB', 'general'),
      w('Shanti Bai', 'housekeeping', 'normal', 'morning', 1),
      w('Dinesh Yadav', 'gardener', 'attrA', 'general'),
      w('Priya Nair', 'lab_attendant', 'normal', 'general'),
      w('Ramu S', 'mess_staff', 'normal', 'morning', 1),
    ],
    expiring: { workerIndex: 10, title: 'Chemical Lab Safety', issuer: 'Greenfield Safety Cell', daysLeft: 9 },
    certByRole: {
      housekeeping: 'Hygiene and Sanitation Training',
      security: 'Fire Safety Basics',
      lab_attendant: 'Lab Housekeeping Basics',
      mess_staff: 'Food Safety (FSSAI Basic)',
      gardener: 'Pesticide Handling Basics',
    },
    grievances: [
      { who: 9, category: 'behaviour', text: 'The supervisor shouts at us in front of students.', ageDays: 10, status: 'open' },
      { who: 7, category: 'pay', text: 'Payslip looks wrong. A day I worked is missing.', ageDays: 3, status: 'in_review', source: 'payslip' },
      { anonymous: true, category: 'fire_exit', text: 'The fire exit on the hostel second floor is blocked by stored mattresses.', ageDays: 2, status: 'open' },
      { anonymous: true, category: 'wet_floor', text: 'Mess floor is slippery after washing and there is no warning sign.', ageDays: 18, status: 'resolved', note: 'Anti-slip mats and wet floor signs placed in the mess.' },
      { who: 2, category: 'facilities', text: 'There is no drinking water near the lab store.', ageDays: 22, status: 'resolved', note: 'Water cooler installed next to the lab store.' },
    ],
    feedback: [
      ['manager', 4, 'In-charge is fair about leave.'],
      ['manager', 3, ''],
      ['manager', 5, ''],
      ['policies', 3, 'Leave rules are not explained clearly.'],
      ['policies', 4, ''],
      ['policies', 2, 'Salary comes late some months.'],
      ['conditions', 2, 'Mess area is very hot.'],
      ['conditions', 3, 'We need a rest room for staff.'],
      ['conditions', 2, 'Wet floors near the canteen.'],
    ],
  },
  {
    id: 'org-hospital',
    sector: 'hospital',
    adminId: 'adm-hos',
    adminName: 'Dr. Kavita Rao',
    abbr: 'hos',
    offDays: 2,
    workers: [
      w('Priya Menon', 'nurse', 'amber', 'morning'),
      w('Anita Joseph', 'nurse', 'normal', 'night'),
      w('Farah Khan', 'nurse', 'red', 'evening', 1),
      w('Rohit Sharma', 'ward_staff', 'normal', 'morning', 1),
      w('Deepa Nair', 'nurse', 'nightRun', 'night'),
      w('Kumar S', 'ward_staff', 'overtime', 'morning', 2),
      w('Meera Iyer', 'nurse', 'normal', 'evening', 2),
      w('Sanjay Das', 'ward_staff', 'attrA', 'morning', 2),
      w('Lakshmi P', 'nurse', 'attrB', 'evening', 1),
      w('Imran Pasha', 'ward_staff', 'normal', 'night'),
    ],
    expiring: { workerIndex: 6, title: 'Basic Life Support (BLS)', issuer: 'CityCare Training Cell', daysLeft: 14 },
    certByRole: {
      nurse: 'Nursing Registration',
      ward_staff: 'Infection Control Training',
    },
    grievances: [
      { who: 7, category: 'hours', text: 'I was asked to cover the ward again right after a night shift, with no rest.', ageDays: 10, status: 'open' },
      { who: 8, category: 'pay', text: 'Payslip looks wrong. My night shift overtime hours are missing.', ageDays: 3, status: 'in_review', source: 'payslip' },
      { anonymous: true, category: 'needle_stick', text: 'The sharps bin in the ICU is overfilled. Someone could get a needle injury.', ageDays: 2, status: 'open' },
      { anonymous: true, category: 'infection_exposure', text: 'Isolation room signs were missing and visitors walked in without masks.', ageDays: 18, status: 'resolved', note: 'Signs and a mask dispenser were placed at the isolation room door.' },
      { who: 1, category: 'equipment_fault', text: 'The infusion pump alarm at ICU bed 4 keeps failing.', ageDays: 22, status: 'resolved', note: 'Pump replaced by the biomedical team.' },
    ],
    feedback: [
      ['manager', 4, 'Head nurse supports us on busy shifts.'],
      ['manager', 3, ''],
      ['manager', 5, ''],
      ['policies', 2, 'Shift swaps are hard to get approved.'],
      ['policies', 3, ''],
      ['conditions', 2, 'The night staff room is too small.'],
      ['conditions', 3, 'We run short of gloves at times.'],
      ['conditions', 4, 'Good equipment in the ICU.'],
      ['conditions', 3, ''],
    ],
  },
];

/** What a worker does on one day, or null for no shift. */
function planDay(profile, offset, weekday, weekOffs, shiftStart, prng) {
  const regular = () => ({ start: shiftStart + prng.int(-10, 5), minutes: NORMAL_SHIFT_MINUTES - prng.int(0, 10) });
  const onWeekOff = weekOffs.includes(weekday);
  // With two weekly off days fewer days remain, so the "drifting" workers attend every 2nd day, not every 3rd.
  const period = weekOffs.length > 1 ? 2 : 3;

  if (profile === 'red' && offset >= 1 && offset <= 8) {
    return { start: offset === 3 ? 12 * 60 : shiftStart, minutes: LONG_SHIFT_MINUTES };
  }
  if (profile === 'amber') {
    if (offset === 0 || offset === 7) return null;
    if (offset <= 6) return { start: shiftStart, minutes: AMBER_SHIFT_MINUTES };
  }
  if (profile === 'nightRun') {
    if (offset >= 2 && offset <= NIGHT_RUN_NIGHTS + 1) return { start: shiftStart, minutes: NORMAL_SHIFT_MINUTES };
    if (offset === 1) return { start: MORNING_START_MINUTE, minutes: NORMAL_SHIFT_MINUTES };
    if (offset === 0 || offset === NIGHT_RUN_NIGHTS + 2) return null; // today, and the day off before the run
  }
  if (profile === 'overtime' && offset >= 1 && offset <= 7) {
    return onWeekOff ? null : { start: shiftStart, minutes: OVERTIME_PROFILE_SHIFT_MINUTES };
  }
  if (profile === 'attrA' && offset <= 14) {
    if (offset === 0 || offset % period !== 0 || onWeekOff) return null;
    return { start: shiftStart + prng.int(25, 40), minutes: NORMAL_SHIFT_MINUTES };
  }
  if (profile === 'attrB' && offset >= 1 && offset <= 14 && offset % period === 0 && !onWeekOff) {
    return { start: shiftStart + prng.int(20, 35), minutes: NORMAL_SHIFT_MINUTES };
  }

  if (onWeekOff || prng.chance(ABSENT_CHANCE)) return null;
  if (offset === 0 && prng.chance(ABSENT_TODAY_CHANCE)) return null;
  const day = regular();
  if (offset > RECENT_NO_OVERTIME_DAYS && prng.chance(OVERTIME_CHANCE)) {
    day.minutes += prng.int(60, 120);
  }
  return day;
}

function buildShifts({ spec, worker, profile, weekOffs, orgId, today, nowMs, prng, counter }) {
  const shifts = [];
  const shiftStart = findShift(spec.sector, worker.shiftId).startMinute;
  for (let offset = SEED_DAYS; offset >= 0; offset -= 1) {
    const date = addDays(today, -offset);
    if (date < worker.joinedOn) continue;
    const plan = planDay(profile, offset, weekdayOf(date), weekOffs, shiftStart, prng);
    if (!plan) continue;
    const checkIn = dayStartMs(date) + plan.start * MS_PER_MINUTE;
    if (checkIn >= nowMs) continue;
    const plannedEnd = checkIn + plan.minutes * MS_PER_MINUTE;
    counter.n += 1;
    shifts.push({
      id: `sh-${spec.abbr}-${counter.n}`,
      orgId,
      workerId: worker.id,
      siteId: worker.siteId,
      checkIn,
      checkOut: plannedEnd > nowMs ? null : plannedEnd,
      method: 'qr',
      geoVerified: false,
    });
  }
  return shifts;
}

function passportFor(spec, worker, index, today, orgId) {
  const entry = (n, type, title, issuer, issuedAgo, expiresIn, verified = true) => ({
    id: `pp-${worker.id}-${n}`,
    orgId,
    workerId: worker.id,
    type,
    title,
    issuer,
    issuedOn: addDays(today, -issuedAgo),
    expiresOn: expiresIn === null ? null : addDays(today, expiresIn),
    verified,
    verifiedBy: verified ? spec.adminId : null,
  });
  const entries = [
    entry(1, 'training', 'Workplace Safety Induction', 'Employer', 150 + index * 7, null),
  ];
  const expiring = spec.expiring.workerIndex === index;
  const title = expiring ? spec.expiring.title : spec.certByRole[worker.role];
  entries.push(
    entry(2, 'certification', title, expiring ? spec.expiring.issuer : 'Skill Council', 330, expiring ? spec.expiring.daysLeft : 250 + index * 5),
  );
  if (worker.isDemo) {
    entries.push(entry(3, 'experience', `Six years of work as ${worker.role.replace('_', ' ')} (self-declared)`, 'Previous employers', 40, null, false));
  }
  return entries;
}

function advancesFor(worker, profile, nowMs, orgId) {
  const advance = (month, amountPaise, note) => ({
    id: `adv-${worker.id}-${month}`,
    orgId,
    workerId: worker.id,
    month,
    amountPaise,
    note,
  });
  if (worker.isDemo) return [advance(monthKey(nowMs), 200_000, 'Medical advance')];
  if (profile === 'attrB') return [advance(previousMonth(monthKey(nowMs)), 100_000, 'Festival advance')];
  return [];
}

function grievanceDocs(spec, workers, nowMs) {
  return spec.grievances.map((g, index) => {
    const createdAt = nowMs - g.ageDays * MS_PER_DAY;
    const record = {
      id: `gr-${spec.abbr}-${index + 1}`,
      orgId: spec.id,
      category: g.category,
      text: g.text,
      severity: suggestSeverity(g.text, findCategory(spec.sector, g.category)),
      status: g.status,
      source: g.source ?? 'manual',
      month: g.source === 'payslip' ? previousMonth(monthKey(nowMs)) : null,
      anonymous: Boolean(g.anonymous),
      resolutionNote: g.note ?? '',
      createdAt: g.anonymous ? dayStartMs(dayKey(createdAt)) : createdAt,
      updatedAt: createdAt,
    };
    if (g.anonymous) record.trackingHash = randomToken();
    else record.workerId = workers[g.who].id;
    return { collection: 'grievances', doc: record };
  });
}

/** Every document of one demo org except the org record itself, as `{ collection, doc }` pairs. */
function orgDocs(spec, nowMs) {
  const today = dayKey(nowMs);
  const prng = createPrng(hashString(spec.id));
  const sector = SECTORS[spec.sector];
  const counter = { n: 0 };
  const out = [{ collection: 'admins', doc: { id: spec.adminId, orgId: spec.id, name: spec.adminName } }];
  for (const site of sector.sites) out.push({ collection: 'sites', doc: { ...site, orgId: spec.id } });

  const workers = [];
  for (const [index, ws] of spec.workers.entries()) {
    const roleDef = sector.roles.find((r) => r.id === ws.role);
    const offDays = spec.offDays ?? 1;
    const weekOffs = Array.from({ length: offDays }, (_, k) => (index * 3 + k * 3) % 7);
    const worker = {
      id: `w-${spec.abbr}-${String(index + 1).padStart(2, '0')}`,
      orgId: spec.id,
      name: ws.name,
      role: ws.role,
      dailyWagePaise: roleDef.dailyWagePaise,
      siteId: sector.sites[ws.siteIdx].id,
      shiftId: ws.shiftId,
      joinedOn: addDays(today, ws.profile === 'attrB' ? -NEW_JOINER_TENURE_DAYS : -prng.int(120, 900)),
      isDemo: ws.profile === 'amber',
      passportToken: null,
    };
    workers.push(worker);
    out.push({ collection: 'workers', doc: worker });
    const shifts = buildShifts({ spec, worker, profile: ws.profile, weekOffs, orgId: spec.id, today, nowMs, prng, counter });
    for (const doc of shifts) out.push({ collection: 'shifts', doc });
    for (const doc of passportFor(spec, worker, index, today, spec.id)) out.push({ collection: 'passportEntries', doc });
    for (const doc of advancesFor(worker, ws.profile, nowMs, spec.id)) out.push({ collection: 'advances', doc });
  }

  out.push(...grievanceDocs(spec, workers, nowMs));
  spec.feedback.forEach(([subject, rating, text], index) => {
    const n = index + 1;
    out.push({
      collection: 'feedback',
      doc: { id: `fb-${spec.abbr}-${n}`, orgId: spec.id, subject, rating, text, day: addDays(today, -(n % 20)) },
    });
  });
  return out;
}

/** Writes with bounded concurrency: fast on Firestore, harmless in memory. */
async function writeAll(store, writes) {
  for (let i = 0; i < writes.length; i += WRITE_CONCURRENCY) {
    await Promise.all(writes.slice(i, i + WRITE_CONCURRENCY).map(({ collection, doc }) => store[collection].insert(doc)));
  }
}

/**
 * Seeds every demo org that is not in the store yet (construction, college and hospital).
 * An existing org is never touched, so restarts keep live data. The org record goes in last: it
 * is the "this org is fully seeded" marker.
 * @param {object} store
 * @param {{ clock: { now: () => number } }} options
 * @returns {Promise<string[]>} ids of the orgs that were seeded
 */
export async function seedStore(store, { clock }) {
  const seeded = [];
  for (const spec of ORGS) {
    if (await store.orgs.get(spec.id, spec.id)) continue;
    await writeAll(store, orgDocs(spec, clock.now()));
    const sector = SECTORS[spec.sector];
    await store.orgs.insert({ id: spec.id, orgId: spec.id, name: sector.orgName, sector: spec.sector });
    seeded.push(spec.id);
  }
  return seeded;
}
