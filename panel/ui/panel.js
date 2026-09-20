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
    graphs: $('#view-graphs'),
    ask: $('#view-ask'),
    rope: $('#view-rope'),
    system: $('#view-system'),
  },
  graphsCanvas: $('#graphs-canvas'),
  graphsScrub: $('#graphs-scrub'),
  graphsTime: $('#graphs-time'),
  graphsHint: $('#graphs-hint'),
  playBtn: $('#btn-play'),
  askStage: $('#ask-stage'),
  askPhaseLabel: $('#ask-phase-label'),
  askCount: $('#ask-count'),
  askHint: $('#ask-hint'),
  askHeard: $('#ask-heard'),
  askAnswer: $('#ask-answer'),
  askBtn: $('#btn-ask'),
  askLabel: $('#ask-label'),
  homeAskSub: $('#home-ask-sub'),
  playLabel: $('#play-label'),
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
  source.addEventListener('ask', (e) => renderAsk(JSON.parse(e.data)));
  source.addEventListener('sim', (e) => {
    sim = JSON.parse(e.data);
    if (state?.view === 'graphs') renderGraphs();
  });
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

let bootId = null;

function render(next) {
  // A restarted server means possibly new UI files; this page is the old
  // ones. Reload once rather than run stale script against a new API.
  if (bootId && next.boot_id && next.boot_id !== bootId) {
    location.reload();
    return;
  }
  bootId = next.boot_id ?? bootId;

  const previousView = state?.view;
  state = next;

  for (const [name, el] of Object.entries(els.views)) {
    el.hidden = name !== state.view;
  }
  if (previousView !== state.view) onViewChange(previousView, state.view);
  if (state.view === 'graphs') renderGraphs();
  if (state.ask) renderAsk(state.ask);

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

// --- graphs ----------------------------------------------------------------
//
// The app streams the tracked body's motion samples and its transport state
// here a few times a second (POST /api/sim/snapshot) while this view is open;
// the slider and play button go back as POST /api/sim/control. Same plots as
// the app's own drawer, redrawn for a 1024 px touchscreen.

let sim = null;
let scrubbing = false;        // finger on the slider: don't move it under them
let seekTimer = 0;
let pendingSeek = null;

const SERIES = { x: '#3987e5', y: '#d95926', mag: '#199e70' };
const CHARTS = [
  { title: 'Position', unit: 'm', series: [
    { label: 'x', color: SERIES.x, get: (s) => s.x_m },
    { label: 'y', color: SERIES.y, get: (s) => s.y_m } ] },
  { title: 'Velocity', unit: 'm/s', series: [
    { label: 'vx', color: SERIES.x, get: (s) => s.vx_ms },
    { label: 'vy', color: SERIES.y, get: (s) => s.vy_ms },
    { label: '|v|', color: SERIES.mag, get: (s) => Math.hypot(s.vx_ms, s.vy_ms) } ] },
  { title: 'Acceleration', unit: 'm/s²', series: [
    { label: 'ax', color: SERIES.x, get: (s) => s.ax_ms2 },
    { label: 'ay', color: SERIES.y, get: (s) => s.ay_ms2 } ] },
];

function niceStep(range, target = 3) {
  if (range <= 0 || !Number.isFinite(range)) return 1;
  const raw = range / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  return (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
}
function fmt(v) {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1000) return v.toExponential(1);
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

function renderGraphs() {
  const canvas = els.graphsCanvas;
  const dpr = window.devicePixelRatio || 1;
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  if (!cw || !ch) return;
  if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#12151c';
  ctx.fillRect(0, 0, cw, ch);

  // Transport row.
  const frames = sim?.frames ?? 0;
  els.graphsScrub.max = String(Math.max(0, frames - 1));
  els.graphsScrub.disabled = !sim || frames < 2;
  if (!scrubbing && sim) els.graphsScrub.value = String(sim.index ?? 0);
  els.graphsTime.textContent = `${(sim?.t_s ?? 0).toFixed(2)} s`;
  els.playLabel.textContent = sim?.running ? '❚❚' : '▶';
  els.playBtn.disabled = !sim;
  if (!sim) setHint(els.graphsHint, 'Waiting for the app… open it on the big screen.', 'warn');
  else if (frames < 2) setHint(els.graphsHint, 'No history yet — run the simulation.');
  else if (sim.running) setHint(els.graphsHint, `live · ${sim.label} · drag the slider to pause and scrub`, 'ok');
  else setHint(els.graphsHint, sim.scrubbing ? `paused at frame ${sim.index + 1} of ${frames} · ▶ resumes from here` : `paused · ${frames} frames · drag to scrub`);

  const data = sim?.samples ?? [];
  if (data.length < 2) {
    ctx.fillStyle = '#6e7681';
    ctx.font = '15px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(sim ? 'Run the simulation to plot motion' : 'No data from the app yet', cw / 2, ch / 2);
    ctx.textAlign = 'left';
    return;
  }

  const padL = 54, padR = 34, gap = 12, titleH = 18, axisH = 6;
  const each = (ch - gap * (CHARTS.length - 1)) / CHARTS.length;
  const plotH = each - titleH - axisH;
  const plotW = cw - padL - padR;
  const t0 = data[0].t_s, t1 = data[data.length - 1].t_s;
  const tSpan = Math.max(t1 - t0, 1e-6);

  CHARTS.forEach((chart, ci) => {
    const top = ci * (each + gap);
    const plotTop = top + titleH;
    ctx.fillStyle = '#c9d1d9';
    ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(chart.title, padL, top + 12);
    ctx.fillStyle = '#6e7681';
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText(chart.unit, padL + ctx.measureText(chart.title).width + 30, top + 12);

    let lo = Infinity, hi = -Infinity;
    for (const s of data) for (const ser of chart.series) {
      const v = ser.get(s);
      if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    }
    if (!Number.isFinite(lo)) { lo = -1; hi = 1; }
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    const padY = (hi - lo) * 0.12; lo -= padY; hi += padY;
    const sy = (v) => plotTop + plotH - ((v - lo) / (hi - lo)) * plotH;
    const sx = (t) => padL + ((t - t0) / tSpan) * plotW;

    const step = niceStep(hi - lo);
    ctx.strokeStyle = '#1e232c'; ctx.lineWidth = 1;
    ctx.fillStyle = '#6e7681'; ctx.font = '10px ui-monospace, monospace'; ctx.textAlign = 'right';
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      const y = sy(v);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
      ctx.fillText(fmt(v), padL - 6, y + 3);
    }
    ctx.textAlign = 'left';
    if (lo < 0 && hi > 0) {
      ctx.strokeStyle = '#30363d';
      ctx.beginPath(); ctx.moveTo(padL, sy(0)); ctx.lineTo(padL + plotW, sy(0)); ctx.stroke();
    }

    for (const ser of chart.series) {
      ctx.strokeStyle = ser.color; ctx.lineWidth = 2; ctx.lineJoin = 'round';
      ctx.beginPath();
      let started = false;
      for (const s of data) {
        const v = ser.get(s);
        if (!Number.isFinite(v)) continue;
        const x = sx(s.t_s), y = sy(v);
        if (started) ctx.lineTo(x, y); else { ctx.moveTo(x, y); started = true; }
      }
      ctx.stroke();
      const last = data[data.length - 1];
      ctx.fillStyle = ser.color; ctx.font = '600 10px ui-monospace, monospace';
      ctx.fillText(ser.label, padL + plotW + 5, sy(ser.get(last)) + 3);
    }

    // Cursor at the sim's current time, so plot and scene agree.
    if (sim && Number.isFinite(sim.t_s) && sim.t_s >= t0 && sim.t_s <= t1) {
      const x = sx(sim.t_s);
      ctx.strokeStyle = 'rgba(77, 163, 255, 0.7)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, plotTop); ctx.lineTo(x, plotTop + plotH); ctx.stroke();
    }
  });
}

function sendSeek(index) {
  pendingSeek = index;
  if (seekTimer) return;
  // ~20 Hz is plenty for a slider under a thumb, and keeps the app's
  // frame-apply from queueing behind touch events.
  seekTimer = window.setTimeout(() => {
    seekTimer = 0;
    const i = pendingSeek; pendingSeek = null;
    post('/api/sim/control', { action: 'seek', index: i });
  }, 50);
}

els.graphsScrub.addEventListener('pointerdown', () => { scrubbing = true; });
els.graphsScrub.addEventListener('input', () => sendSeek(Number(els.graphsScrub.value)));
for (const ev of ['pointerup', 'pointercancel']) {
  els.graphsScrub.addEventListener(ev, () => { scrubbing = false; });
}
els.playBtn.addEventListener('click', () => {
  if (!sim) return;
  post('/api/sim/control', { action: sim.running ? 'pause' : 'play' });
});
window.addEventListener('resize', () => { if (state?.view === 'graphs') renderGraphs(); });

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

// Tiles that act on the big screen rather than on this one. The server
// relays them to the app over SSE; the app does the work and shows the
// result there, so this only needs to say the request went through.
for (const btn of document.querySelectorAll('[data-app]')) {
  btn.addEventListener('click', async () => {
    const what = btn.dataset.app;
    await post(`/api/app/${what}`);
    toast('Writing a new problem on the big screen…', 'ok');
  });
}

// --- ask ---------------------------------------------------------------------
//
// The recording itself happens in the app (the mic is the webcam's and the
// app window owns it); this view is the visitor's view of it. Press 1 or the
// button to start, press again to stop: the app posts every phase change to
// /api/ask/state and it lands here as an `ask` event.

const ASK_PHASES = {
  idle:         { label: 'Ready',            btn: 'Start listening', hint: 'Press 1 (or the button) and ask your question out loud. Press again when you are done.' },
  listening:    { label: 'LISTENING',        btn: 'Stop and ask',    hint: 'Speak now. Press 1 again as soon as you finish the question.' },
  transcribing: { label: 'Working out what you said…', btn: 'Please wait', hint: '' },
  thinking:     { label: 'Thinking…',        btn: 'Please wait',     hint: 'The GX10 is writing an answer. It appears here and on the big screen.' },
  answered:     { label: 'Answered',         btn: 'Ask another',     hint: '' },
  error:        { label: 'That did not work', btn: 'Try again',      hint: '' },
};

let askPhase = 'idle';

function renderAsk(a) {
  askPhase = a.phase || 'idle';
  const spec = ASK_PHASES[askPhase] || ASK_PHASES.idle;
  els.askStage.dataset.phase = askPhase;
  els.askPhaseLabel.textContent = spec.label;
  els.askCount.textContent = askPhase === 'listening' && Number.isFinite(a.seconds_left) ? `${a.seconds_left} s` : '';
  els.askHint.textContent = askPhase === 'error' ? (a.error || 'Try again, closer to the camera.') : spec.hint;
  els.askHint.hidden = !els.askHint.textContent;
  els.askHeard.textContent = a.heard || '';
  els.askHeard.hidden = !a.heard;
  els.askAnswer.textContent = a.answer || '';
  els.askAnswer.hidden = !a.answer;
  els.askLabel.textContent = spec.btn;
  els.askBtn.disabled = askPhase === 'transcribing' || askPhase === 'thinking';
  els.askBtn.classList.toggle('listening', askPhase === 'listening');
  const busy = askPhase !== 'idle' && askPhase !== 'answered' && askPhase !== 'error';
  els.homeAskSub.textContent = busy ? `${spec.label.toLowerCase()} on the big screen` : 'speak to the webcam, answer on the big screen';
}

/** Press to start, press again to stop. */
function askToggle() {
  if (askPhase === 'transcribing' || askPhase === 'thinking') return;
  post('/api/app/ask', { action: askPhase === 'listening' ? 'stop' : 'start' });
}
els.askBtn.addEventListener('click', askToggle);

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
  if (e.key === '1' && state.view === 'ask') {
    askToggle();
  } else if (e.key === '1') {
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
