// Round 3 UI: schedule, batch editor, background batch, missed modal, update banner, keep-awake.
const fs = require('fs'), path = require('path');
const OUT = process.env.SHOTS || '/workspace/letterhead-screens';
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
module.exports = (win, { nativeTheme, getScheduler, getUpdater }) => {
  const wc = win.webContents;
  const js = code => wc.executeJavaScript(code + '\n;0');
  const ev = code => wc.executeJavaScript(code);
  const shot = async name => { await wc.executeJavaScript("document.querySelectorAll('.toast').forEach(t=>t.remove());0"); await sleep(450); const img = await wc.capturePage(); fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG()); console.log('[shot]', name); };
  const until = async (expr, ms = 60000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev('!!(' + expr + ')')) return true; await sleep(200); } throw new Error('timeout: ' + expr); };
  const app = require('electron').app;
  wc.on('console-message', (e, lvl, msg) => { if (lvl >= 2) console.log('[renderer]', msg); });
  wc.once('did-finish-load', async () => {
    try {
      await until('document.body.dataset.ready==="1"');
      await js('window.confirm=()=>true; window.Notification=function(){};');
      await js(`setPreset('custom'); document.querySelector('#a-fromName').value='Shabd Warar'; document.querySelector('#a-user').value='tester@example.com'; document.querySelector('#a-host').value='127.0.0.1'; document.querySelector('#a-port').value='2525'; document.querySelector('#a-security').value='none'; document.querySelector('#a-imapHost').value='127.0.0.1'; document.querySelector('#a-imapPort').value='1143'; document.querySelector('#a-imapSecurity').value='none'; document.querySelector('#a-pass').value='abcdabcdabcdabcd'; document.querySelector('#a-save').click()`);
      await until(`!!(S.account && S.account.hasPassword)`);
      const csv = fs.readFileSync(path.join(__dirname, 'researchers.csv'), 'utf8');
      await js(`setRecipients(parseList(${JSON.stringify(csv)}), false, 'stanford_neuro.csv')`);
      await js(`S.draft.subject='High school researcher interested in your {{research_area|lab}} work';
        S.draft.body='Dear Dr. {{last_name}},\\n\\nMy name is Shabd Warar, and I am a junior in high school. I recently read your paper "{{paper}}".\\n\\nThank you for your time,\\nShabd'; persist()`);
      await js(`go('schedule')`); await shot('24-schedule-empty');
      // editor for a merge batch
      await js(`S.send={mode:'interval',every:2,unit:'sec',jitter:10}; openEditor()`); await sleep(400);
      await js(`document.querySelector('#be-name').value='Stanford neuroscience labs'; renderEditor()`);
      await shot('25-batch-editor');
      // due in about 8 seconds
      await js(`const t=Date.now()+8000, z=epochToZoned(t, SYS_TZ); document.querySelector('#be-date').value=z.date; document.querySelector('#be-time').value=z.time; renderEditor()`);
      // the time input has minute precision, so save through the API with an exact time instead
      await js(`(async()=>{ const m=snapshotMerge(); await lh.batches.save({name:'Stanford neuroscience labs', kind:'merge', merge:m, scheduledAt:Date.now()+8000, tz:SYS_TZ, mode:'interval', intervalMs:2000, jitterPct:10}); closeEditor(); })()`);
      // a drafts batch later today and a merge batch tomorrow in New York time
      await js(`go('drafts')`); await until('S.drafts.loaded===true', 20000);
      await js(`D.sel=new Set([1,2]); renderDrafts()`);
      await js(`(async()=>{ await lh.batches.save({name:'MIT follow ups', kind:'drafts', drafts:snapshotDrafts(), scheduledAt:Date.now()+2*3600e3+17*60e3, tz:SYS_TZ, mode:'interval', intervalMs:120000, jitterPct:25});
        const z=epochToZoned(Date.now()+86400e3,'America/New_York');
        await lh.batches.save({name:'Columbia biology', kind:'merge', merge:snapshotMerge(), scheduledAt:zonedToEpoch(z.date,'09:30','America/New_York'), tz:'America/New_York', mode:'burst', intervalMs:60000, jitterPct:0}); })()`);
      await sleep(400); await js(`go('schedule')`); await shot('26-schedule-three-batches');
      // drafts editor view
      await js(`openEditor(S.batches.find(b=>b.name==='MIT follow ups').id)`); await sleep(500); await shot('27-batch-editor-drafts'); await js(`closeEditor()`);
      // background start
      await until(`S.batches.some(b=>b.name==='Stanford neuroscience labs' && b.status==='sending')`, 30000); await sleep(2500);
      await shot('28-schedule-batch-sending');
      await js(`go('send')`); await sleep(400); await shot('29-send-view-batch');
      await until(`S.batches.some(b=>b.name==='Stanford neuroscience labs' && b.status==='done')`, 120000);
      // missed: pretend the Mac slept through a batch
      const s = getScheduler();
      s.upsert({ name: 'Caltech chemistry', kind: 'merge', merge: { recipients: [{ email: 'a@caltech.example', fields: { first_name: 'Ana' } }, { email: 'b@caltech.example', fields: {} }], subject: 'Hi', body: 'Hello', attachments: [] }, scheduledAt: Date.now() - 45 * 60000, mode: 'interval', intervalMs: 60000, jitterPct: 20, tz: null });
      await sleep(200); s.tick(); await sleep(800);
      await js(`go('schedule')`); await sleep(200);
      await until(`!document.querySelector('#m-veil').classList.contains('hidden')`, 5000);
      await shot('30-missed-modal');
      await js(`document.querySelector('#m-later').click()`); await sleep(300);
      await shot('31-schedule-with-finished-and-missed');
      // keep awake toggles and a lid-closed indicator (status pushed as a Mac would report it)
      await js(`saveSetting('keepAwake', true).then(()=>saveSetting('keepAwakeLid', true))`); await sleep(400);
      wc.send('power:status', { awake: true, lid: 'on', lidError: null, sleepDisabled: true, stale: false, supported: true });
      await sleep(300); await shot('32-schedule-lid-closed-on');
      // update banner from a local feed
      const u = getUpdater(); if (u) { await u.check({ manual: true }); console.log('[update]', JSON.stringify(u.state)); }
      await until(`S.upd && S.upd.status==='ready'`, 20000);
      await js(`go('settings')`); await shot('33-settings-update-ready');
      nativeTheme.themeSource = 'dark'; await sleep(300);
      await js(`go('schedule')`); await shot('34-schedule-dark');
      console.log('[batches]', JSON.stringify(s.list().map(b => [b.name, b.status, b.stats]))); 
      console.log('HARNESS OK');
    } catch (e) { console.log('HARNESS FAIL', e.stack || e); }
    app.exit(0);
  });
};
