'use strict';
// --smoke-test: run by the release workflow on a real Mac before anything is published.
// Fresh data folder, no account. Visits every screen, opens the composer, the shortcuts sheet and
// the error log, saves settings, and checks the window rendered and nothing logged an error.
const fs = require('fs');
module.exports = function smoke(win, { app, diag, getWired, getScheduler, out, startedAt }) {
  const res = { version: app.getVersion(), platform: process.platform, arch: process.arch, checks: [], ok: false };
  const check = (name, pass, detail) => { res.checks.push({ name, pass: !!pass, detail: detail === undefined ? undefined : String(detail).slice(0, 300) }); };
  const js = code => win.webContents.executeJavaScript(code, true);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const finish = code => {
    res.ok = code === 0; res.ms = Date.now() - startedAt;
    const text = JSON.stringify(res, null, 1);
    if (out) { try { fs.writeFileSync(out, text); } catch (e) { /* stdout still has it */ } }
    process.stdout.write(res.checks.map(c => `  ${c.pass ? 'ok  ' : 'FAIL'} ${c.name}${c.detail && !c.pass ? ' : ' + c.detail : ''}`).join('\n') + '\nSMOKE RESULT ' + (res.ok ? 'PASS' : 'FAIL') + ` (${res.ms} ms)\n`);
    setTimeout(() => app.exit(code), 100);
  };
  const timer = setTimeout(() => { check('finished within 90 s', false); finish(3); }, 90000);
  win.webContents.once('did-finish-load', async () => {
    try {
      // wait for the window's own startup to finish (it picks its first screen at the end)
      const t0 = Date.now(); while (!(await js(`document.body.dataset.ready === '1'`)) && Date.now() - t0 < 30000) await sleep(200);
      check('startup finished', await js(`document.body.dataset.ready === '1'`), `${Date.now() - t0} ms`);
      await sleep(500);
      for (let i = 0; i < 50 && !win.isDestroyed() && !win.isVisible(); i++) await sleep(200); // ready-to-show can land after load
      check('window created and visible', !win.isDestroyed() && (win.isVisible() || process.env.LETTERHEAD_SMOKE_HIDDEN), `visible=${win.isVisible()}`);
      check('mail engine started (SQLite wasm loaded)', !!getWired());
      check('scheduler loaded', !!getScheduler());
      const tabs = ['mail', 'assist', 'ai', 'account', 'recipients', 'letter', 'drafts', 'send', 'schedule', 'settings'];
      for (const t of tabs) {
        await js(`go(${JSON.stringify(t)})`); await sleep(500);
        const r = await js(`(() => { const v = document.querySelector('#view-' + ${JSON.stringify(t)}); if (!v) return 'missing'; const b = v.getBoundingClientRect(); return v.classList.contains('on') && b.width > 300 && b.height > 300 && v.innerText.trim().length > 20 ? 'ok' : 'empty ' + Math.round(b.width) + 'x' + Math.round(b.height); })()`);
        check('screen ' + t, r === 'ok', r);
      }
      await js(`go('mail'); LH2.compose({ to: [] })`); await sleep(600);
      check('composer opens', await js(`!document.querySelector('#composer').classList.contains('hidden')`));
      await js(`document.querySelector('#c-close').click()`); await sleep(400);
      check('composer closes', await js(`document.querySelector('#composer').classList.contains('hidden')`));
      await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }))`); await sleep(300);
      const keys = await js(`!document.querySelector('#k-veil').classList.contains('hidden')`);
      check('keyboard shortcuts sheet opens', keys);
      await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); document.querySelector('#k-veil').classList.add('hidden')`);
      await js(`go('settings')`); await sleep(300);
      const saved = await js(`lh.settings.save({ smokeTest: true }).then(() => lh.settings.get()).then(s => s && s.smokeTest === true)`);
      check('settings save and load', saved);
      const logOk = await js(`lh.diag.log().then(r => Array.isArray(r.lines))`);
      check('error log readable', logOk);
      const hasDiagUi = await js(`!!document.querySelector('#d-copy') && !!document.querySelector('#d-view')`);
      check('diagnostics buttons present', hasDiagUi);
      await js(`document.querySelector('#d-view').click()`); await sleep(500);
      check('error log viewer opens', await js(`!document.querySelector('#d-veil').classList.contains('hidden') && document.querySelector('#d-lines').innerText.length > 0`));
      await js(`document.querySelector('#d-close').click()`);
      const errs = diag.tail(500).filter(l => / ERROR /.test(l) && Date.parse(l.slice(1, 25)) >= startedAt);
      check('no errors logged', errs.length === 0, errs.slice(0, 5).join(' | '));
      clearTimeout(timer);
      finish(res.checks.every(c => c.pass) ? 0 : 1);
    } catch (e) { clearTimeout(timer); check('smoke script ran', false, e.stack || e.message); finish(1); }
  });
};
