// Controls for the live table-climb demo. The simulator and the policy load only when asked for.
const $ = id => document.getElementById(id);
const root = $('live-demo');
if (root) {
  const sliders = {
    dx: {el: $('live-dx'), out: $('live-dx-out'), lo: -0.04, hi: 0.04, show: v => `${Math.round(55 + 100*v)} cm`},
    dy: {el: $('live-dy'), out: $('live-dy-out'), lo: -0.08, hi: 0.08, show: v => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(100*v))} cm`},
    dz: {el: $('live-dz'), out: $('live-dz-out'), lo: -0.03, hi: 0.03, show: v => `${(75 + 100*v).toFixed(1)} cm`},
    friction: {el: $('live-friction'), out: $('live-friction-out'), lo: 0.5, hi: 1.1, show: v => v.toFixed(2)},
  };
  const params = () => Object.fromEntries(Object.entries(sliders).map(([k, s]) => [k, parseFloat(s.el.value)]));
  const refresh = () => { for (const s of Object.values(sliders)) s.out.textContent = s.show(parseFloat(s.el.value)); };
  for (const s of Object.values(sliders)) s.el.addEventListener('input', () => { refresh(); if (demo && !demo.running) demo.reset(params()); });
  refresh();

  const status = $('live-status'), bar = $('live-progress'), overlay = $('live-overlay'), loadBtn = $('live-load');
  const controls = ['live-deploy', 'live-reset', 'live-random', 'live-dx', 'live-dy', 'live-dz', 'live-friction'].map($);
  const messages = {
    ready: 'Ready. Press Deploy policy.',
    climbing: 'Climbing',
    standing: 'Standing on the table.',
    notstanding: 'On the table, but not fully standing.',
    fell: 'The robot fell. Try another table.',
  };
  const ui = {
    canvas: $('live-canvas'), params,
    loading: pct => { loadBtn.disabled = true; loadBtn.textContent = pct < 100 ? `Loading ${pct}%` : 'Starting'; },
    status: (state, step, T) => {
      const secs = (Math.min(step, T) * 0.02).toFixed(1);
      status.textContent = state === 'climbing' ? `${messages.climbing}: ${secs} s of ${(T*0.02).toFixed(1)} s` : messages[state];
      status.dataset.state = state;
      bar.style.width = `${Math.min(100, 100*step/T)}%`;
    },
  };
  let demo = null, loading = null;
  const ensure = () => loading ??= import('./live.js').then(m => m.start(ui)).then(d => {
    demo = d; d.speed = parseFloat(root.dataset.simSpeed || '1'); overlay.hidden = true; controls.forEach(c => { c.disabled = false; }); return d;
  }).catch(err => {
    console.error(err); loading = null; loadBtn.disabled = false; loadBtn.textContent = 'Load live simulation';
    status.textContent = 'The simulation could not start in this browser. A recent desktop Chrome, Edge, Firefox or Safari works best.';
  });
  loadBtn.addEventListener('click', ensure);
  $('live-deploy').addEventListener('click', async () => { const d = await ensure(); d?.deploy(params()); });
  $('live-reset').addEventListener('click', () => demo?.reset(params()));
  $('live-random').addEventListener('click', () => {
    for (const s of Object.values(sliders)) s.el.value = (s.lo + Math.random()*(s.hi - s.lo)).toFixed(3);
    refresh(); demo?.reset(params());
  });
  root.querySelectorAll('button[data-sim-speed]').forEach(b => b.addEventListener('click', () => {
    root.querySelectorAll('button[data-sim-speed]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    if (demo) demo.speed = parseFloat(b.dataset.simSpeed);
    root.dataset.simSpeed = b.dataset.simSpeed;
  }));
}
