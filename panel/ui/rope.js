/* Isolated touchscreen controller. Game rendering stays on the big display. */
(() => {
  const view = document.querySelector('#view-rope');
  const status = document.querySelector('#rope-status');
  const stars = document.querySelector('#rope-stars');
  const retry = document.querySelector('#rope-retry');
  const cut = document.createElement('button');
  cut.className = 'act';
  cut.innerHTML = '<span class="act-label">✂ Cut rope</span>';
  retry.before(cut);
  let busy = false;
  cut.addEventListener('click', () => control('cut'));
  async function control(action) {
    try {
      const res = await fetch('/api/rope/control', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) });
      if (!res.ok) throw new Error('Control failed');
    } catch { status.textContent = 'Panel disconnected. Try again.'; }
  }
  view.querySelector('.rope-intro > p').textContent = 'Pinch candy with thumb + index. Move it. Open your fingers to release.';
  view.querySelector('.rope-levels span').textContent = '01 · Swing & sling';
  retry.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/rope/control', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'restart' }),
      });
      if (!res.ok) throw new Error('Restart failed');
      status.textContent = 'Fresh candy. Pinch it to pick it up!';
    } catch { status.textContent = 'Panel disconnected. Try again.'; }
  });
  async function refresh() {
    if (view.hidden || busy) return;
    busy = true;
    try {
      const res = await fetch('/api/rope/status');
      if (!res.ok) throw new Error('No status');
      const game = await res.json();
      const collected = game.connected ? (game.stars || 0) : 0;
      stars.textContent = '★'.repeat(collected) + '☆'.repeat(3 - collected);
      retry.disabled = !game.connected;
      cut.disabled = !game.connected || game.cuts > 0 || game.outcome !== 'playing';
      status.textContent = !game.connected ? 'Waiting for the main display. Open the physics app on the big screen.'
        : game.outcome === 'won' ? 'Sweet success! Tap Restart to play again.'
        : game.outcome === 'lost' ? 'The candy missed! Tap Restart for another try.'
        : game.held ? 'Holding candy! Move to swing it; open thumb and index to release.'
        : game.tracked ? 'Pinch the candy to pick it up. Open your fingers to let go.'
        : 'Show one hand to the camera. Watch for your hand on the big screen.';
    } catch { status.textContent = 'Panel disconnected. Reconnecting…'; retry.disabled = true; }
    finally { busy = false; }
  }
  new MutationObserver(refresh).observe(view, { attributes: true, attributeFilter: ['hidden'] });
  setInterval(refresh, 1000);
})();
