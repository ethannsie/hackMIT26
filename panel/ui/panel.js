/**
 * Panel front end.
 *
 * The server owns the truth: every button posts an intent and the UI redraws
 * from the state that comes back over SSE. Nothing here keeps its own copy of
 * whether a capture is pending, which is why the panel and the main app can
 * never disagree about it — and why a reloaded panel comes back mid-scan
 * exactly where it was.
 */

const $ = (sel) => document.querySelector(sel);

const els = {
  modeChip: $('#mode-chip'),
  camChip: $('#cam-chip'),
  linkChip: $('#link-chip'),
  views: {
    home: $('#view-home'),
    scan: $('#view-scan'),
    hand: $('#view-hand'),
    system: $('#view-system'),
  },
  homeHandSub: $('#home-hand-sub'),
  homeSaved: $('#home-saved'),
  scanLive: $('#scan-live'),
  scanFrozen: $('#scan-frozen'),
  scanBadge: $('#scan-badge'),
  scanFlash: $('#scan-flash'),
  scanHint: $('#scan-hint'),
  captureBtn: $('#btn-capture'),
  captureLabel: $('#capture-label'),
  saveBtn: $('#btn-save'),
  handFeed: $('#hand-feed'),
  handNote: $('#hand-note'),
  handHint: $('#hand-hint'),
  shutdownBtn: $('#btn-shutdown'),
  shutdownHint: $('#shutdown-hint'),
  goodbye: $('#goodbye'),
  toast: $('#toast'),
};

/** Last state from the server. Read-only as far as this file is concerned. */
let state = null;
let toastTimer = null;

// --- server talk -----------------------------------------------------------

async function post(path, body) {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `${res.status}`);
    return data;
  } catch (err) {
    toast(err.message, 'error');
    throw err;
  }
}

function connect() {
  const source = new EventSource('/api/events');

  source.addEventListener('open', () => setLink(true));
  source.addEventListener('error', () => {
    setLink(false);
    // EventSource retries on its own; re-creating it here would stack
    // reconnects on a flaky link instead of fixing anything.
  });

  source.addEventListener('state', (e) => render(JSON.parse(e.data)));
  source.addEventListener('scan:captured', (e) => {
    const data = JSON.parse(e.data);
    flash();
    render(data);
    toast(data.recapture ? 'Recaptured' : 'Captured — press 2 to save', 'ok');
  });
  source.addEventListener('scan:saved', (e) => {
    const data = JSON.parse(e.data);
    render(data);
    toast(`Saved ${data.file}`, 'ok');
  });
  source.addEventListener('system:shutdown', (e) => {
    render(JSON.parse(e.data));
    els.goodbye.hidden = false;
  });
}

function setLink(up) {
  els.linkChip.textContent = up ? 'linked' : 'offline';
  els.linkChip.className = `chip ${up ? 'ok' : 'error'}`;
}

// --- rendering -------------------------------------------------------------

function render(next) {
  const previousView = state?.view;
  state = next;

  for (const [name, el] of Object.entries(els.views)) {
    el.hidden = name !== state.view;
  }
  if (previousView !== state.view) onViewChange(previousView, state.view);

  // Header.
  els.modeChip.textContent = `mode ${state.app_mode}`;
  els.modeChip.className = `chip ${state.app_mode === 'sandbox' ? 'ok' : ''}`;

  const cam = state.camera;
  if (!cam.camera_ok) {
    els.camChip.textContent = 'camera down';
    els.camChip.className = 'chip error';
  } else {
    els.camChip.textContent = `camera ${cam.fps} fps`;
    els.camChip.className = 'chip ok';
  }

  // Home.
  els.homeHandSub.textContent = state.hand_wanted
    ? 'tracking live'
    : state.hand_switch === 'off'
      ? 'switched off'
      : 'idle until sandbox';
  document.querySelector('[data-go="hand"]').classList.toggle('live', state.hand_wanted);
  els.homeSaved.textContent = state.scan.last_saved
    ? `${state.scan.saved_count} scan${state.scan.saved_count === 1 ? '' : 's'} · last ${state.scan.last_saved}`
    : 'no scans yet';

  // Scan.
  const pending = state.scan.has_pending;
  els.scanFrozen.hidden = !pending;
  els.scanLive.hidden = pending;
  els.scanBadge.hidden = !pending;
  els.captureLabel.textContent = pending ? 'Recapture' : 'Capture';
  els.saveBtn.disabled = !pending;
  if (!cam.camera_ok) {
    setHint(els.scanHint, 'No camera. Check the USB webcam on the GX10.', 'error');
    els.captureBtn.disabled = true;
  } else {
    els.captureBtn.disabled = false;
    setHint(
      els.scanHint,
      pending ? 'Press 2 to save and solve, or 1 to retake.' : 'Frame the problem, then press 1.',
      pending ? 'ok' : '',
    );
  }

  // Hand.
  for (const seg of document.querySelectorAll('[data-switch]')) {
    seg.classList.toggle('on', seg.dataset.switch === state.hand_switch);
  }
  renderHandNote(cam);

  els.shutdownBtn.disabled = !state.shutdown_allowed;
  if (!state.shutdown_allowed) {
    setHint(els.shutdownHint, 'Shutdown is disabled on this box (PANEL_ALLOW_SHUTDOWN=0).', 'warn');
  }
  if (state.shutting_down) els.goodbye.hidden = false;
}

function renderHandNote(cam) {
  let note = '';
  if (!cam.mediapipe) {
    note = 'MediaPipe is not installed on this box — run panel/setup.sh.';
  } else if (!cam.model) {
    note = 'hand_landmarker.task is missing — run panel/setup.sh.';
  } else if (!cam.camera_ok) {
    note = 'No camera.';
  } else if (!cam.tracking_active) {
    note = 'Tracking is off. Choose “Always on”, or switch the app to sandbox.';
  } else if (!cam.hand_visible) {
    note = 'Show one hand to the camera.';
  }
  els.handNote.textContent = note;
  els.handNote.hidden = note === '';

  els.handHint.textContent =
    state.hand_switch === 'auto'
      ? 'Auto follows the app: on in sandbox, off in problem mode.'
      : state.hand_switch === 'on'
        ? 'Overlay stays on whatever the app is doing.'
        : 'Overlay stays off, even in sandbox.';
}

function setHint(el, text, tone = '') {
  el.textContent = text;
  el.className = `hint ${tone}`.trim();
}

function toast(text, tone = '') {
  els.toast.textContent = text;
  els.toast.className = `toast ${tone}`.trim();
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2600);
}

function flash() {
  els.scanFlash.classList.remove('fire');
  void els.scanFlash.offsetWidth; // restart the animation
  els.scanFlash.classList.add('fire');
}

// --- streams ---------------------------------------------------------------

/**
 * MJPEG connections stay open for as long as the <img> has a src, and a
 * browser only allows a handful per origin. Attaching on enter and detaching
 * on leave is what keeps a panel that has been poked at for an hour from
 * running out of sockets and silently freezing its own preview.
 */
function attach(img, url) {
  if (img.dataset.attached === '1') return;
  img.src = `${url}?t=${Date.now()}`;
  img.dataset.attached = '1';
}

function detach(img) {
  if (img.dataset.attached !== '1') return;
  img.src = '';
  img.removeAttribute('src');
  img.dataset.attached = '0';
}

function onViewChange(from, to) {
  if (from === 'scan') detach(els.scanLive);
  if (from === 'hand') detach(els.handFeed);
  if (to === 'scan') attach(els.scanLive, '/stream/raw.mjpg');
  if (to === 'hand') attach(els.handFeed, '/stream/hand.mjpg');
  if (to === 'scan') els.scanFrozen.src = `/api/scan/pending.jpg?t=${Date.now()}`;
}

// A backgrounded kiosk tab still pays for its MJPEG streams. Drop them.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    detach(els.scanLive);
    detach(els.handFeed);
  } else if (state) {
    onViewChange(null, state.view);
  }
});

// --- intents ---------------------------------------------------------------

const go = (view) => post('/api/view', { view });

async function capture() {
  if (els.captureBtn.disabled) return;
  const data = await post('/api/scan/capture');
  // Freeze immediately rather than waiting for the SSE round trip: at 88 px
  // the button must feel instant or the operator presses it twice.
  els.scanFrozen.src = `/api/scan/pending.jpg?t=${Date.now()}`;
  return data;
}

async function save() {
  if (els.saveBtn.disabled) return;
  return post('/api/scan/save');
}

for (const btn of document.querySelectorAll('[data-go]')) {
  btn.addEventListener('click', () => {
    if (btn.dataset.go === 'scan') post('/api/scan/start');
    else go(btn.dataset.go);
  });
}

for (const seg of document.querySelectorAll('[data-switch]')) {
  seg.addEventListener('click', () => post('/api/hand/switch', { switch: seg.dataset.switch }));
}

els.captureBtn.addEventListener('click', capture);
els.saveBtn.addEventListener('click', save);

// 1 and 2 on a keypad do exactly what the two big buttons do. The panel is a
// touchscreen, but a USB keypad next to it is faster and does not smear the
// screen a judge is looking at.
window.addEventListener('keydown', (e) => {
  if (e.repeat || !state) return;
  if (e.key === '1') {
    if (state.view !== 'scan') post('/api/scan/start').then(capture);
    else capture();
  } else if (e.key === '2' && state.view === 'scan') {
    save();
  } else if (e.key === 'Escape') {
    go('home');
  } else if (e.key === 'h' || e.key === 'H') {
    go('hand');
  }
});

// --- hold to shut down -----------------------------------------------------

/**
 * Two seconds of contact, with the bar as the receipt. A confirm dialog would
 * be one tap away from powering off the machine mid-demo; a hold cannot be
 * triggered by a sleeve, and letting go cancels it.
 */
const HOLD_MS = 2000;
let holdStart = 0;
let holdRaf = 0;
const holdFill = els.shutdownBtn.querySelector('.hold-fill');

function holdBegin(e) {
  e.preventDefault();
  if (els.shutdownBtn.disabled || holdStart) return;
  holdStart = performance.now();
  const tick = () => {
    const progress = Math.min(1, (performance.now() - holdStart) / HOLD_MS);
    holdFill.style.width = `${progress * 100}%`;
    if (progress >= 1) {
      els.shutdownBtn.classList.add('done');
      holdEnd(null, true);
      post('/api/system/shutdown', { confirm: true });
      return;
    }
    holdRaf = requestAnimationFrame(tick);
  };
  holdRaf = requestAnimationFrame(tick);
  setHint(els.shutdownHint, 'Keep holding…', 'warn');
}

function holdEnd(_e, fired = false) {
  if (!holdStart) return;
  holdStart = 0;
  cancelAnimationFrame(holdRaf);
  if (!fired) {
    holdFill.style.width = '0%';
    setHint(els.shutdownHint, 'Hold for 2 seconds. A tap does nothing.');
  }
}

els.shutdownBtn.addEventListener('pointerdown', holdBegin);
els.shutdownBtn.addEventListener('pointerup', holdEnd);
els.shutdownBtn.addEventListener('pointercancel', holdEnd);
els.shutdownBtn.addEventListener('pointerleave', holdEnd);

// --- boot ------------------------------------------------------------------

fetch('/api/state')
  .then((r) => r.json())
  .then(render)
  .catch(() => setLink(false))
  .finally(connect);
