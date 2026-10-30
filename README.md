# FairShift

**Transparent pay, safe reporting and fair shifts for employee-intensive workplaces.**
Built for Prompt Wars 2026 x SRM ACM, theme **UN SDG 8: Decent Work and Economic Growth**.

Construction sites, colleges, hospitals and factories still run on paper registers, spreadsheets and WhatsApp.
Workers cannot see how their pay was worked out, fear being identified when they complain, report hazards only after
someone is hurt, and lose their skills record every time they change jobs. Employers cannot see who is overworked or
about to quit until it is serious. FairShift is one codebase with **one worker app** (mobile first, icon first, English /
Hindi / Tamil, read-aloud and voice input) and **one employer dashboard**, configured per industry.

## Problem to feature mapping

| Pain point | Feature | Where in code |
| --- | --- | --- |
| Paper registers, disputed hours | **F1 Attendance**: daily rotating signed QR, 6-digit code, or "I'm at work" button with optional geofence; regular vs overtime computed per shift (works across midnight) | `src/services/attendance.js`, `src/services/qr.js`, `public/worker/home.js`, `public/admin/attendance.js` |
| "I don't know how my salary was calculated" | **F2 Transparent payslip**: every line (daily wage, overtime x2.0, PF 12%, ESI 0.75% only if gross <= Rs 21,000, advances) with icon, plain-words explanation, per-day table, read-aloud and a pre-filled "Something looks wrong" | `src/services/payroll.js`, `public/shared/payslip.js` |
| Fear of being identified | **F3 Grievance + hazard reporting**: icon categories, text or voice, optional anonymous mode that stores **no worker id**, random tracking code, open / in review / resolved with a visible note, rule-based severity | `src/services/grievance.js`, `public/worker/report.js`, `public/admin/grievances.js` |
| Hazards unreported until injury | Hazard categories per sector (scaffolding, electrical, PPE, heat, machinery / wet floor, chemical lab, fire exit...) with auto-suggested severity | `src/config/sectors.js`, `suggestSeverity()` |
| Burnout, unsafe hours | **F6 Fatigue alerts**: >10 h in a day, >48 h / >60 h in a week, <11 h rest, 7 days without a rest day; per-sector overrides and night-shift rules. Admin list plus a gentle "please rest" notice for the worker | `src/services/fatigue.js` |
| Employers see problems too late | **F7 Dashboard**: KPIs, 14-day inline-SVG trend, grievance table, fatigue list, explainable attrition-risk list ("who needs a supportive check-in") | `src/services/insights.js`, `src/services/attrition.js`, `public/admin/` |
| Cannot speak up about managers | **F4 Anonymous feedback**: emoji ratings stored with no worker id, no IP, day-only timestamp; admin sees a group only when it has >= 3 answers (k-anonymity) | `src/services/feedback.js` |
| Skills restart from zero | **F5 Skill passport**: training, certificates, experience, employer verification, expiry warnings, read-only share link `/p/:token` and print view | `src/services/passport.js`, `public/passport/` |
| Regional languages, low literacy, cheap phones | **F8**: en / hi / ta JSON dictionaries, voice input in `en-IN` / `hi-IN` / `ta-IN`, read-aloud, icon + text everywhere, <60 KB JS and ~10 KB CSS per page, no framework or CDN | `public/i18n/`, `public/shared/i18n.js`, `public/shared/voice.js` |

## SDG 8 alignment

- **8.5 Decent work and equal pay for work of equal value**: every payslip line is explained and disputable in one tap; overtime is computed by one rule for everyone.
- **8.8 Safe and secure working environments**: hazard reporting by icon or voice, anonymous option with status tracking, fatigue limits, certificate expiry warnings (e.g. working at height).
- **8.2 Productivity through diversification, technology and innovation** and **8.3 Decent job creation / formalisation**: replaces paper and WhatsApp with a verified attendance and skills record that workers carry to their next job, and lets small employers formalise records without ERP software.

## Three industries, one codebase

| | Construction (BuildRight Constructions) | College (Greenfield College) | Hospital (CityCare Hospital) |
| --- | --- | --- | --- |
| Who | Masons, electricians, helpers, scaffolders on contract-daily wages | Housekeeping, security, lab attendants, mess staff, gardeners | Nurses and ward staff on morning, evening and night shifts |
| Check-in | Site QR at each building site (150 m geofence) | QR per campus block (300 m geofence), night guards crossing midnight | QR per department: ICU, Emergency, General Ward (200 m geofence) |
| Hazards | Scaffolding / height, electrical, missing PPE, heat, machinery | Wet floor, chemical lab, electrical, hostel safety, blocked fire exit | Needle-stick, patient aggression, equipment fault, infection exposure |
| Fatigue rules | Defaults (48 / 60 h week, 11 h rest) | Defaults | Stricter, plus night rules: max 3 night shifts in a row, 24 h rest between a night shift and a day shift |
| Demo story | Fatigued scaffolder, new joiner who disputed a payslip, Working-at-Height certificate expiring | Fatigued mess worker, night guards, Chemical Lab Safety certificate expiring | Four nights then a morning shift, an overtime case, a red fatigue case, BLS certificate expiring |

Everything sector-specific lives in [`src/config/sectors.js`](src/config/sectors.js): roles and wages, hazard categories (with an optional minimum severity), shift patterns, departments / sites, geofence radius, overtime multiplier and the fatigue thresholds. The sign-in screen, demo logins, category pickers and the fatigue engine all read from it. A new sector (a factory, say) needs a config entry, translated labels in `public/i18n/*.json` and demo data in `src/store/seed.js`; no service or route code changes. The hospital numbers (12 h rest, 54 h week, 24 h rest after nights...) are **configurable defaults for the demo, not statements of what any law requires**.

## Architecture

```
server.js                start + graceful SIGTERM only
src/app.js               Express app factory (store, clock and limits injected, so it is testable)
src/config/              env.js, sectors.js, constants.js (named constants, no magic numbers)
src/store/               repository.js (contract), memory.js and firestore.js (implementations), index.js (DATA_STORE switch), seed.js
src/services/            attendance, qr, payroll, fatigue, attrition, grievance, feedback, passport, insights
src/routes/              one file per resource
src/middleware/          auth, validate, security, errors
public/                  index.html, worker/, admin/, passport/, shared/ (css + js), i18n/*.json
tests/                   unit + API tests (node:test, no test framework)
```

- **Stateless process.** Nothing is kept on disk; all state sits behind the repository interface.
- **Multi-tenant by construction.** Every record has an `orgId`, every repository method takes it, and every route reads it from the signed session, never from the request.
- **Pluggable store.** Services and routes only see the repository contract in `src/store/repository.js` (`insert`, `get`, `update`, `query`, `findBy` per collection). `DATA_STORE=memory` (default) or `DATA_STORE=firestore` picks the implementation, and the same contract tests run against both (see Persistence). A Cloud SQL adapter would implement the same five methods with one table per collection and an `org_id` column.
- **Time.** All day-boundary logic is IST (UTC+05:30) in `src/lib/time.js`; services receive an injected clock, so tests are deterministic.
- **Money.** Integer paise only. The browser formats with `Intl.NumberFormat` (INR) in the user's locale.

## Security measures

- `helmet` with a strict CSP (`default-src 'self'`, no inline script or style, no external origins), `Permissions-Policy` limited to camera / microphone / geolocation for our own origin.
- Signed JWT in an `httpOnly`, `SameSite=Strict` cookie (`Secure` in production). Cross-site writes are also rejected by an Origin check and a JSON-only body rule.
- `express-rate-limit`: global limit plus tighter limits on login and report / feedback endpoints; `trust proxy` set for Cloud Run. Limits are per instance (in memory).
- 10 KB JSON body limit; server-side validation of every field (type, length, enum, id, date) in `src/middleware/validate.js`; error responses list field names and reasons, never values.
- Authorization on every route: workers read only their own data, admins only their own org; checked by tests (cross-worker and cross-org requests).
- Output is always written with `textContent` / `createElement`, never `innerHTML` with user data.
- Generic 500 responses (no stack traces), no request-body logging, no access log containing tracking codes (the code travels in a POST body).
- No secrets in the repo: `SESSION_SECRET` is generated at boot if absent, `ADMIN_PASSWORD` comes only from the environment (constant-time compare; login disabled if unset and `DEMO_MODE=false`), `.env.example` holds placeholders only, `.env` is git- and docker-ignored.
- `GEMINI_API_KEY` (optional) is sent in a header, never in a URL, and never logged.

## Accessibility measures

- WCAG AA colour contrast, verified by `tests/contrast.test.js` for the light and dark themes (4.5:1 text, 3:1 borders and focus ring).
- Skip-to-content link, landmarks (`header`, `nav`, `main`), every input has a `<label>`, visible `:focus-visible` outline, `aria-current` on the active tab / section, `aria-live` regions for status and toasts.
- Fully keyboard operable: native `<dialog>` for modals (focus trap, Esc closes, focus returns), radio groups for category and rating pickers, no keyboard traps.
- 48 px minimum touch targets, `rem` units (text scales), works at 320 px width without horizontal scroll, respects `prefers-reduced-motion` and `prefers-color-scheme`.
- Status is never colour-only: every chip pairs an icon with a word; every screen is icon + text.
- Charts are inline SVG with a text label and a "show as table" alternative.

## Demo guide

```bash
npm install
DEMO_MODE=true npm start        # http://localhost:8080
```

In demo mode (`DEMO_MODE=true`) the **I'm at work** button skips the geofence distance check so judges can check in from anywhere; with `DEMO_MODE=false` the geofence is enforced as usual, and if location is unavailable the app suggests **Type code**.

Open `/` and press **I am a worker** or **I am an employer**; the demo buttons sign you in instantly
(`POST /api/demo-login/:role` for `worker-construction`, `worker-college`, `admin-construction`, `admin-college`).

**Two-minute click path**

1. Worker (construction): the home screen already shows a gentle rest notice. Tap **I'm at work** (or **Type code** with the code from the employer screen).
2. **Pay**: read the payslip, tap **Read all aloud**, then **Something looks wrong** and send.
3. **Report**: pick **Scaffolding or height**, type or speak, tick **Report without my name**, send. Note the secret code, then check its status further down the page.
4. **Feedback** and **Passport**: rate, add a skill, **Create link** and open the print view.
5. Switch language (top right) to Hindi or Tamil on any screen.
6. Employer: **Overview** (KPIs, 14-day trend), **Reports** (move your grievance to *Being checked*, then *Solved* with a note; the anonymous one shows no name), **People care** (fatigue list, attrition reasons), **Feedback** (the *Rules and pay policy* group is hidden: fewer than 3 answers), **Skills** (verify an entry), **Attendance** (QR and code), **Payslips**.
7. Repeat as college staff / college employer, and as the hospital nurse / hospital employer: **People care** shows the night-shift rules firing (a nurse with four nights in a row and only two hours of rest before a morning shift), and **Report** offers needle-stick, patient aggression, equipment fault and infection exposure.

## Run locally and test

```bash
npm install
npm start          # PORT defaults to 8080
npm test           # node:test, no extra dependencies
```

Requires Node 20+.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | Listen port (Cloud Run sets it) |
| `NODE_ENV` | `development` | `production` turns on the `Secure` cookie flag |
| `DEMO_MODE` | `false` in code and the Dockerfile, `true` in `.env.example` | One-click demo logins. **Set to `false` in production.** |
| `DATA_STORE` | `memory` | `memory` or `firestore` (see Persistence). Any other value stops the server at start-up |
| `GOOGLE_CLOUD_PROJECT` | unset | Optional Firestore project id; otherwise taken from the environment (Cloud Run sets it) |
| `FIRESTORE_EMULATOR_HOST` | unset | `host:port` of the Firestore emulator for local runs and the optional emulator tests; never set in production |
| `ADMIN_PASSWORD` | unset | Real employer login; if unset and `DEMO_MODE=false`, employer login is disabled |
| `SESSION_SECRET` | random per boot | Signs session cookies and QR tokens; set it (Secret Manager) if you run more than one instance |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | unset | Optional Gemini summary of anonymous feedback themes. Both are required; otherwise a rule-based theme counter is used |

Real worker authentication would be a phone OTP; this prototype only has demo worker logins.

## Cloud Run notes

- The container listens on `0.0.0.0:$PORT`, exposes `GET /healthz` (liveness, never touches the database) and `GET /health` (reports the data store in use; 503 `degraded` if it cannot be reached), handles `SIGTERM` gracefully, and runs as a non-root user.
- With the default `DATA_STORE=memory` the store is **in memory and re-seeded at start**, so use a **single instance** (`--max-instances=1`); data resets when the instance restarts. With `DATA_STORE=firestore` instances are stateless and `--max-instances` can be raised (see Persistence).
- The image defaults to `DEMO_MODE=false`; enable the demo with `--set-env-vars DEMO_MODE=true` only for the judged demo, and provide `SESSION_SECRET` / `ADMIN_PASSWORD` from Secret Manager, not from the image.

## Persistence (Firestore)

Set `DATA_STORE=firestore` to keep data in Cloud Firestore (Native mode) instead of memory. The adapter in `src/store/firestore.js` implements the repository contract exactly, so no route or service changes. It uses **Application Default Credentials** (the Cloud Run service account): no key file, and nothing secret in the repo or the image.

How it behaves:

- One collection per repository collection, prefixed `fairshift_`. A document's id is `<orgId>:<id>` and every document also stores `orgId`, so all reads are tenant-scoped.
- Queries use equality filters only, so **no composite indexes need deploying**; numeric range bounds are applied to the result in memory. At large scale, add composite indexes on `(orgId, <field>)` and push the range down.
- **Seeding is idempotent.** On start the server seeds a demo org (construction, college, hospital) only if it is missing. An existing org is never touched, so restarts keep live data; the org record is written last, so a crash half way is repaired on the next start. Several instances starting together write identical documents, so there are no duplicates. Demo dates are relative to the day an org was first seeded: to refresh them, delete that org's documents (or the `fairshift_` collections) and restart.
- **Errors are contained.** A Firestore failure is logged server-side (operation and error code only, never document data) and answered with a `503` JSON `{"error":{"code":"store_unavailable",...}}`. The process keeps running and recovers when Firestore does. If the database is down at start-up the server still starts and retries seeding in the background.
- `GET /health` returns `{"status":"ok","dataStore":"firestore"}`, or 503 `degraded`.

Enable it on Cloud Run (replace `PROJECT_ID`, `REGION` and the service name; choose the Firestore location that suits you):

```bash
# 1. Enable the API and create the database once per project
gcloud services enable firestore.googleapis.com --project PROJECT_ID
gcloud firestore databases create --project PROJECT_ID --location=asia-south1 --type=firestore-native

# 2. Let the Cloud Run service account read and write it
SA=$(gcloud run services describe fairshift --region REGION --project PROJECT_ID \
  --format='value(spec.template.spec.serviceAccountName)')   # empty = the default compute service account
gcloud projects add-iam-policy-binding PROJECT_ID --member="serviceAccount:${SA}" --role="roles/datastore.user"

# 3. Switch the service to Firestore
gcloud run services update fairshift --region REGION --project PROJECT_ID \
  --set-env-vars DATA_STORE=firestore,GOOGLE_CLOUD_PROJECT=PROJECT_ID

# 4. Optional, for more than one instance: sessions and QR codes are signed with SESSION_SECRET, so share one
printf '%s' "$(openssl rand -hex 32)" | gcloud secrets create fairshift-session-secret --data-file=- --project PROJECT_ID
gcloud secrets add-iam-policy-binding fairshift-session-secret --project PROJECT_ID \
  --member="serviceAccount:${SA}" --role="roles/secretmanager.secretAccessor"
gcloud run services update fairshift --region REGION --project PROJECT_ID \
  --set-secrets SESSION_SECRET=fairshift-session-secret:latest --max-instances=10
```

Once Firestore is the data store, `--max-instances` can be raised above 1 (rate limits stay per instance).

Try it locally against the emulator (no credentials needed):

```bash
gcloud emulators firestore start --host-port=127.0.0.1:8681
FIRESTORE_EMULATOR_HOST=127.0.0.1:8681 DATA_STORE=firestore GOOGLE_CLOUD_PROJECT=demo-fairshift npm start
FIRESTORE_EMULATOR_HOST=127.0.0.1:8681 npm test      # also runs the repository contract against the emulator
```

Without `FIRESTORE_EMULATOR_HOST`, `npm test` needs no credentials: the contract runs against the memory store and against the Firestore adapter using a small fake client (`tests/fake-firestore.js`), and the emulator suite is skipped.

## Assumptions

- All workers in all three sectors are paid a **daily rate**; the sector `wageType` (`contract_daily`, `daily_on_roll`) is a label shown to users. Monthly-salary staff are not modelled.
- Paid time is elapsed time between check-in and check-out (no unpaid breaks). Regular hours are the first 8 hours of **each shift**, the rest is overtime at 2.0x (configurable per sector; the Factories Act 1948 s.59 prescribes double rate for factories). A shift belongs to the IST day it started.
- PF is 12% of regular (non-overtime) pay with no wage ceiling; ESI is 0.75% of gross only when monthly gross <= Rs 21,000; advances are recovered only up to what is left after PF and ESI and the rest carries forward. These are simplifications of the real statutory rules.
- Seed data covers 62 days so last month's payslip is meaningful, and is generated from a seeded PRNG relative to today (IST). The demo worker (the "amber" fatigue case) deliberately has not checked in today.
- An open shift older than 18 hours is treated as forgotten and closed automatically.
- Attrition-risk points and fatigue thresholds are transparent heuristics, not a validated predictive model. Anonymous grievances and feedback are never inputs.
- Hindi and Tamil strings were drafted with AI assistance and should be reviewed by native speakers before real use.

## Known limitations (honest)

- **Anonymity is best-effort in this prototype.** The server stores no worker id on anonymous reports or feedback, drops the IP, and rounds time to the day, but the request still arrives on an authenticated session and passes through infrastructure logs (time, IP) that the app does not control. One worker can submit several feedback items. Production would use **blind tokens** (the worker obtains a one-time signed token that is not linked to their identity, then submits anonymously), an unauthenticated submission endpoint, and log scrubbing. Small groups can still be identifiable from the comment text itself.
- Geofence coordinates come from the phone and can be spoofed; QR + code + geofence together are a deterrent, not proof.
- Browser speech recognition may be processed on the browser vendor's servers. FairShift never receives or stores audio, only the text.
- QR scanning uses the `BarcodeDetector` API (Chrome on Android); other browsers fall back to typing the 6-digit code.
- Real worker sign-in (phone OTP), password reset and an audit log are out of scope for this prototype. Rate limits are per instance.
- The Firestore adapter is verified here against a fake client and the shared contract tests; the emulator suite is included but only runs when `FIRESTORE_EMULATOR_HOST` is set, so it has not been run against a live Firestore from this repo's test run.
- Not tested with a screen reader on real devices; contrast and keyboard behaviour are covered by design and by tests.
