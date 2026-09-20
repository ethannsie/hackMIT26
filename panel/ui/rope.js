/* Isolated touchscreen controller. Game rendering stays on the big display. */
(() => {
  const view = document.querySelector('#view-rope');
  const status = document.querySelector('#rope-status');
  const stars = document.querySelector('#rope-stars');
  const retry = document.querySelector('#rope-retry');
  let busy = false;
  retry.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/rope/control', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'restart' }),
      });
      if (!res.ok) throw new Error('Restart failed');
      status.textContent = 'Fresh candy. Make your cut!';
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
      status.textContent = !game.connected ? 'Waiting for the main display. Open the physics app on the big screen.'
        : game.outcome === 'won' ? 'Sweet success! Tap Restart to play again.'
        : game.outcome === 'lost' ? 'The candy missed! Tap Restart for another try.'
        : game.tracked ? 'Hand detected. Sweep your fingertip across the rope!'
        : 'Show one hand to the camera. Watch for the cursor on the big screen.';
    } catch { status.textContent = 'Panel disconnected. Reconnecting…'; retry.disabled = true; }
    finally { busy = false; }
  }
  new MutationObserver(refresh).observe(view, { attributes: true, attributeFilter: ['hidden'] });
  setInterval(refresh, 1000);
})();
