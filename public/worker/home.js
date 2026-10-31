import { ApiError } from '../shared/api.js';
import { cancelButton, chip, field, h, iconButton, openDialog, showError, toast, busy } from '../shared/dom.js';
import { dayLabel, hoursMinutes, timeIst } from '../shared/format.js';
import { icon } from '../shared/icons.js';
import { t } from '../shared/i18n.js';
import { overlayToday } from '../shared/actions.js';
import { outbox } from '../shared/outbox.js';
import { outboxPanel, staleNotice } from '../shared/outbox-ui.js';

const NS = 'http://www.w3.org/2000/svg';
const BAR_FULL_MINUTES = 12 * 60;
const SCAN_INTERVAL_MS = 300;
const GEO_TIMEOUT_MS = 6000;
const CODE_DIGITS = 6;
const CODE_PATTERN = /^\d{6}$/;
const NO_COPY = { status: 'not_started', since: null, totalMinutes: 0, overtimeMinutes: 0, rest: { level: 'none', flags: [] }, recent: [] };
const canScan = 'BarcodeDetector' in window && Boolean(navigator.mediaDevices?.getUserMedia);

/** Current position, or null if unavailable or refused (the geofence check is optional). */
function getPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { timeout: GEO_TIMEOUT_MS, maximumAge: 60_000 },
    );
    return undefined;
  });
}

function bar(minutes) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 8');
  svg.setAttribute('class', 'bar');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  for (const [cls, width] of [['track', 100], ['fill', Math.min(100, (minutes / BAR_FULL_MINUTES) * 100)]]) {
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('class', cls);
    rect.setAttribute('height', '8');
    rect.setAttribute('rx', '4');
    rect.setAttribute('width', String(width));
    svg.append(rect);
  }
  return svg;
}

function restNotice(rest) {
  if (rest.level === 'none') return null;
  const reasons = rest.flags.map((f) =>
    h('li', { text: t(`rest.reason.${f.rule}`, { ...f.params, time: hoursMinutes(f.params.minutes ?? 0) }) }),
  );
  return h(
    'section',
    { class: 'banner', role: 'note', 'aria-labelledby': 'rest-title' },
    icon('moon'),
    h('div', { class: 'stack-sm' }, h('strong', { id: 'rest-title', text: t('rest.title') }), h('p', { text: t(`rest.body.${rest.level}`) }), h('ul', {}, ...reasons)),
  );
}

function statusCard(today) {
  const text = {
    not_started: t('home.notStarted'),
    working: t('home.working', { time: today.since ? timeIst(today.since) : '' }),
    done: t('home.done', { time: hoursMinutes(today.totalMinutes) }),
  }[today.status];
  return h(
    'section',
    { class: `card status-card ${today.status}`, 'aria-labelledby': 'status-title' },
    icon(today.status === 'done' ? 'check' : 'clock'),
    h(
      'div',
      { class: 'stack-sm' },
      h('h2', { id: 'status-title', text }),
      today.totalMinutes > 0 ? h('p', { class: 'muted', text: t('home.sofar', { time: hoursMinutes(today.totalMinutes) }) }) : null,
      today.overtimeMinutes > 0 ? chip('info', 'clock', t('home.overtime', { time: hoursMinutes(today.overtimeMinutes) })) : null,
      today.pending ? chip('info', 'clock', t('outbox.status.queued')) : null,
    ),
  );
}

function weekList(recent) {
  const rows = recent.map((d) =>
    h(
      'li',
      { class: 'weekrow' },
      h('span', { class: 'weekday', text: dayLabel(d.date) }),
      bar(d.totalMinutes),
      h('span', { text: d.totalMinutes > 0 ? hoursMinutes(d.totalMinutes) : t('home.noRecord') }),
      d.overtimeMinutes > 0 ? chip('info', 'clock', t('home.overtime', { time: hoursMinutes(d.overtimeMinutes) })) : null,
    ),
  );
  return h('section', { class: 'card', 'aria-labelledby': 'week-title' }, h('h2', { id: 'week-title', class: 'row' }, icon('calendar'), t('home.week')), h('ul', {}, ...rows));
}

function openCodeDialog(submit) {
  const input = h('input', {
    id: 'code-input',
    inputmode: 'numeric',
    autocomplete: 'one-time-code',
    maxlength: CODE_DIGITS,
    pattern: `\\d{${CODE_DIGITS}}`,
    required: true,
  });
  openDialog({
    title: t('home.enterCode'),
    body: [field(t('home.codeLabel'), input, t('home.codeHint'))],
    actions: (close) => [
      cancelButton(close),
      iconButton('check', t('common.send'), {
        class: 'btn btn-primary',
        onclick: () => {
          const code = input.value.trim();
          if (!CODE_PATTERN.test(code)) {
            input.focus();
            toast(t('err.invalid_code'), 'alert');
            return;
          }
          close();
          submit({ method: 'code', code });
        },
      }),
    ],
  });
}

function openScanner(submit) {
  const video = h('video', { playsinline: '', muted: '', 'aria-label': t('home.scanLabel') });
  const status = h('p', { class: 'muted', role: 'status', text: t('home.scanHelp') });
  let stream = null;
  let timer = null;
  const stop = () => {
    clearInterval(timer);
    stream?.getTracks().forEach((track) => track.stop());
  };
  const { close } = openDialog({
    title: t('home.scan'),
    body: [status, video],
    actions: (closeDialog) => [cancelButton(closeDialog)],
    onClose: stop,
  });
  navigator.mediaDevices
    .getUserMedia({ video: { facingMode: 'environment' } })
    .then((media) => {
      stream = media;
      video.srcObject = media;
      video.play();
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      timer = setInterval(async () => {
        const codes = await detector.detect(video).catch(() => []);
        if (codes.length > 0) {
          close();
          submit({ method: 'qr', token: codes[0].rawValue });
        }
      }, SCAN_INTERVAL_MS);
    })
    .catch(() => {
      status.textContent = t('home.scanDenied');
    });
}

/** Worker home: today's status, one big check-in/out button, rest notice and the last 7 days. */
export async function renderHome(session, rerender) {
  // Works with no signal: the last good copy of today is shown, and what the worker does is kept in the outbox.
  let copy;
  try {
    copy = await outbox.cachedApi('/attendance/today');
  } catch (error) {
    if (error instanceof ApiError) throw error;
    copy = { data: NO_COPY, stale: true, savedAt: null, none: true };
  }
  const today = overlayToday(copy.data, outbox.items());

  /** Check in or out: sent now when there is a signal, otherwise saved with the time and place it happened. */
  async function act(kind, payload) {
    try {
      const { status } = await outbox.submit(kind, payload);
      const done = kind === 'checkin' ? 'home.checkedIn' : 'home.checkedOut';
      toast(t(status === 'sent' ? done : 'outbox.savedToast'), status === 'sent' ? 'check' : 'clock');
      rerender();
    } catch (error) {
      showError(error);
    }
  }
  const submit = (body) => act('checkin', body);

  const main = iconButton(
    today.status === 'working' ? 'logout' : 'check',
    t(today.status === 'working' ? 'home.leaving' : 'home.atWork'),
    { class: 'btn btn-primary btn-lg btn-block' },
  );
  main.addEventListener('click', () =>
    busy(main, async () => {
      if (today.status === 'working') {
        await act('checkout', {});
        return;
      }
      const position = await getPosition(); // where the worker is when they tap, not when it is sent later
      if (!position) toast(t('home.noLocation'), 'info');
      await submit({ method: 'button', ...position });
    }),
  );

  return h(
    'div',
    { class: 'stack' },
    h('h1', { text: t('home.greeting', { name: session.user.name }) }),
    h('p', { class: 'muted row' }, icon('pin'), `${session.user.site ?? ''}`),
    copy.stale ? (copy.none ? h('div', { class: 'banner', role: 'note' }, icon('wifiOff'), h('p', { text: t('outbox.noCopy') })) : staleNotice(copy.savedAt)) : null,
    restNotice(today.rest),
    statusCard(today),
    main,
    today.status === 'working'
      ? null
      : h(
          'div',
          { class: 'row' },
          canScan ? iconButton('qr', t('home.scan'), { onclick: () => openScanner(submit) }) : null,
          iconButton('lock', t('home.enterCode'), { onclick: () => openCodeDialog(submit) }),
        ),
    outboxPanel(),
    today.recent.length > 0 ? weekList(today.recent) : null,
    h('a', { class: 'btn btn-block', href: '#records' }, icon('alert'), t('home.contestLink')),
  );
}
