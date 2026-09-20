/* Touchscreen-only controls. Level names, hints and scores come from the game. */
(() => {
  const view = document.querySelector('#view-rope');
  const status = document.querySelector('#rope-status');
  const stars = document.querySelector('#rope-stars');
  const retry = document.querySelector('#rope-retry');
  const levels = view.querySelector('.rope-levels');
  let busy = false, pending = false, game = null;
  const cards = new Map();
  const cuts = [0, 1].map(index => {
    const button = document.createElement('button');
    button.className = 'act'; button.hidden = true;
    button.innerHTML = `<span class="act-label">✂ Cut rope ${index + 1}</span>`;
    button.addEventListener('click', () => control('cut', { rope: index }));
    retry.before(button);
    return button;
  });
  const next = document.createElement('button');
  next.id = 'rope-next'; next.className = 'act'; next.hidden = true;
  next.innerHTML = '<span class="act-label">Next level →</span>';
  retry.before(next);
  next.addEventListener('click', () => control(game?.level === game?.levelCount ? 'replay' : 'next'));
  retry.addEventListener('click', () => control('restart'));
  view.querySelector('.rope-intro > p').textContent = 'Choose a level below. Swipe your index finger through a rope to cut.';
  levels.setAttribute('aria-label', 'Choose any of the five physics levels');
  levels.setAttribute('role', 'group');
  levels.replaceChildren();

  function disableControls() {
    [...cuts, next, retry, ...cards.values()].forEach(button => { button.disabled = true; });
  }
  async function control(action, data = {}) {
    if (pending) return;
    pending = true; disableControls();
    try {
      const res = await fetch('/api/rope/control', { signal: AbortSignal.timeout(8000), method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, ...data }) });
      if (!res.ok) throw new Error('Control failed');
      status.textContent = action === 'select' ? `Starting level ${data.level}…`
        : action === 'next' ? 'Starting the next puzzle…'
        : action === 'replay' ? 'Back to Swing & soar…'
        : action === 'restart' ? 'Fresh candy. Watch the motion, then cut.' : 'Rope cut. Watch the motion!';
    } catch { status.textContent = 'Control unavailable. Check the display and try again.'; }
    finally { setTimeout(() => { pending = false; refresh(); }, action === 'cut' ? 150 : 1200); }
  }
  function render() {
    for (const level of game.levels || []) {
      let button = cards.get(level.id);
      if (!button) {
        button = document.createElement('button'); button.className = 'rope-level-card';
        button.innerHTML = '<b></b><span class="rope-level-name"></span><span class="rope-level-score"></span>';
        button.addEventListener('click', () => control('select', { level: level.id }));
        cards.set(level.id, button); levels.append(button);
      }
      button.querySelector('b').textContent = String(level.id).padStart(2, '0');
      button.querySelector('.rope-level-name').textContent = level.name;
      button.querySelector('.rope-level-score').textContent = level.best < 0 ? 'Not played' : '★'.repeat(level.best) + '☆'.repeat(3 - level.best);
      button.setAttribute('aria-label', `Level ${level.id}: ${level.name}. ${level.best < 0 ? 'Not completed' : `Best ${level.best} of 3 stars`}`);
      button.setAttribute('aria-pressed', String(game.level === level.id));
      button.disabled = !game.connected;
    }
    const collected = game.connected ? game.stars : 0;
    stars.textContent = '★'.repeat(collected || 0) + '☆'.repeat(3 - (collected || 0));
    retry.disabled = !game.connected;
    cuts.forEach((button, i) => {
      const rope = game.ropes?.[i];
      button.hidden = !rope;
      button.disabled = !game.connected || !rope || rope.cut || game.outcome !== 'playing';
      button.querySelector('.act-label').textContent = game.ropes?.length === 1 ? '✂ Cut rope' : `✂ Cut rope ${i + 1}`;
    });
    next.querySelector('.act-label').textContent = game.level === game.levelCount ? 'Replay levels ↻' : 'Next level →';
    next.hidden = !game.connected || game.outcome !== 'won'; next.disabled = next.hidden;
    const level = game.levels?.find(level => level.id === game.level);
    status.textContent = !game.connected ? 'Main display is offline. Start the app to choose a level.'
      : game.outcome === 'won' ? (game.level < game.levelCount ? 'Sweet success! Tap Next level or pick any puzzle below.' : 'Final level complete! Choose a puzzle, replay the levels, or Exit.')
      : game.outcome === 'lost' ? 'The candy missed! Restart or choose another level.'
      : `${level?.hint || 'Watch the motion, then cut.'} ${game.tracked ? '' : 'Show your hand to the camera.'}`;
  }
  async function refresh() {
    if (view.hidden || busy || pending) return;
    busy = true;
    try {
      const res = await fetch('/api/rope/status', { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error('No status');
      const result = await res.json();
      if (!pending) { game = result; render(); }
    } catch {
      status.textContent = 'Panel disconnected. Reconnecting…'; disableControls();
    } finally { busy = false; }
  }
  new MutationObserver(refresh).observe(view, { attributes: true, attributeFilter: ['hidden'] });
  setInterval(refresh, 1000);
  refresh();
})();
