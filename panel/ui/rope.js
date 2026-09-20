/* Isolated touchscreen controller. Game rendering stays on the big display. */
(() => {
  const view = document.querySelector('#view-rope');
  const status = document.querySelector('#rope-status');
  const stars = document.querySelector('#rope-stars');
  const retry = document.querySelector('#rope-retry');
  const cut = document.createElement('button');
  cut.className = 'act';
  cut.innerHTML = '<span class="act-label">✂ Cut rope</span>';
  const next = document.createElement('button');
  next.id = 'rope-next'; next.className = 'act'; next.hidden = true;
  next.innerHTML = '<span class="act-label">Next level →</span>';
  retry.before(cut, next);
  let busy = false, pending = false, level = 1;
  cut.addEventListener('click', () => control('cut'));
  next.addEventListener('click', () => control(level === 2 ? 'replay' : 'next'));
  retry.addEventListener('click', () => control('restart'));
  async function control(action) {
    if (pending) return;
    pending = true; cut.disabled = retry.disabled = next.disabled = true;
    try {
      const res = await fetch('/api/rope/control', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) });
      if (!res.ok) throw new Error('Control failed');
      status.textContent = action === 'next' ? 'Starting Drop & bounce…' : action === 'replay' ? 'Back to Swing & soar…' : action === 'restart' ? 'Fresh candy. Watch the motion, then cut.' : 'Rope cut. Let physics finish!';
    } catch { status.textContent = 'Control unavailable. Check the display and try again.'; }
    finally { setTimeout(() => { pending = false; refresh(); }, 1200); }
  }
  view.querySelector('.rope-intro > p').textContent = 'Swipe your index finger through the rope. Gravity and momentum do the rest.';
  const levels = view.querySelector('.rope-levels');
  levels.setAttribute('aria-label', 'Two playable levels; levels three through five coming later');
  levels.innerHTML = '<span>01 · Swing & soar</span><span>02 · Drop & bounce</span><span>03–05 · Later</span>';
  async function refresh() {
    if (view.hidden || busy || pending) return;
    busy = true;
    try {
      const res = await fetch('/api/rope/status');
      if (!res.ok) throw new Error('No status');
      const game = await res.json();
      level = game.level;
      next.querySelector('.act-label').textContent = level === 2 ? 'Replay levels ↻' : 'Next level →';
      const collected = game.connected ? (game.stars || 0) : 0;
      stars.textContent = '★'.repeat(collected) + '☆'.repeat(3 - collected);
      retry.disabled = !game.connected;
      cut.disabled = !game.connected || game.cuts > 0 || game.outcome !== 'playing';
      next.hidden = !game.connected || game.outcome !== 'won';
      next.disabled = next.hidden;
      levels.querySelectorAll('span').forEach((span, i) => span.classList.toggle('active', game.connected && i + 1 === game.level));
      status.textContent = !game.connected ? 'Waiting for the main display. Open the physics app on the big screen.'
        : game.outcome === 'won' ? (game.level === 1 ? 'Sweet success! Tap Next level for Drop & bounce.' : 'Both puzzles complete! Replay levels, retry this puzzle, or Exit.')
        : game.outcome === 'lost' ? 'The candy missed! Tap Restart and try another cut timing.'
        : game.tracked ? (game.level === 1 ? 'Cut while the candy swings right. The blue arrow shows its velocity.' : 'Cut the rope. Watch gravity accelerate the candy into the bumper.')
        : 'Show one hand to the camera. Point your index finger to cut.';
    } catch {
      status.textContent = 'Panel disconnected. Reconnecting…';
      cut.disabled = retry.disabled = next.disabled = true;
    } finally { busy = false; }
  }
  new MutationObserver(refresh).observe(view, { attributes: true, attributeFilter: ['hidden'] });
  setInterval(refresh, 1000);
  refresh();
})();
