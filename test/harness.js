// Drives the real UI headlessly, takes screenshots, and exercises both send modes.
const fs = require('fs'), path = require('path');
const OUT = process.env.SHOTS || '/workspace/letterhead-screens';
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
module.exports = (win, { nativeTheme }) => {
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
      // 1. Account, Gmail preset, filled but unsaved
      await js(`go('account'); document.querySelector('#a-fromName').value='Shabd Warar'; document.querySelector('#a-user').value='shabd.warar@gmail.com'; document.querySelector('#a-pass').value='abcdefghijklmnop'`);
      await shot('01-account-gmail');
      // Save a real account pointing at the local test server via the Other SMTP preset
      await js(`setPreset('custom'); document.querySelector('#a-user').value='tester@example.com'; document.querySelector('#a-host').value='127.0.0.1'; document.querySelector('#a-port').value='2525'; document.querySelector('#a-security').value='none'; document.querySelector('#a-imapHost').value='127.0.0.1'; document.querySelector('#a-imapPort').value='1143'; document.querySelector('#a-imapSecurity').value='none'; document.querySelector('#a-pass').value='abcdabcdabcdabcd'; document.querySelector('#a-save').click()`);
      await until(`!!(S.account && S.account.hasPassword)`);
      await shot('02-account-custom-saved');
      // 2. Recipients
      await js(`go('recipients')`); await shot('03-recipients-empty');
      const csv = fs.readFileSync(path.join(__dirname, 'researchers.csv'), 'utf8');
      await js(`setRecipients(parseList(${JSON.stringify(csv)}), false, 'researchers.csv')`);
      await shot('04-recipients-imported');
      await js(`document.querySelector('#r-paste-toggle').click(); document.querySelector('#r-paste').value='Grace Hopper <grace@navy.example>\\nalan@turing.example'`);
      await js(`document.querySelector('#r-paste-append').click()`);
      // 3. Letter
      await js(`S.draft.subject='High school researcher interested in your {{research_area|lab}} work';
        S.draft.body='Dear Dr. {{last_name}},\\n\\nMy name is Shabd Warar, and I am a junior in high school. I recently read your paper "{{paper}}" and was struck by how it approached {{research_area}}.\\n\\nI would love to help in your lab at {{university}} as a research assistant this summer, even in a small way. My resume is attached.\\n\\nThank you for your time,\\nShabd'; persist()`);
      await js(`lh.attachStat([${JSON.stringify(path.join(__dirname, 'Shabd_Warar_Resume.pdf'))}]).then(a=>{S.draft.attachments=a; persist();})`);
      await js(`go('letter')`); await shot('05-letter-preview');
      await js(`S.pv=5; renderPreview()`); await shot('06-letter-preview-missing-field');
      // test send to self through the UI
      await js(`S.pv=0; document.querySelector('#l-test').click()`);
      await until('S.testedThisSession===true', 15000);
      // 4. Send setup, interval mode
      await js(`S.send={mode:'interval',every:3,unit:'sec',jitter:20}; persist(); go('send')`);
      await shot('07-send-setup-interval');
      await js(`document.querySelector('#s-start').click()`);
      await until(`S.run && S.run.state==='waiting'`);
      await sleep(1200); await shot('08-sending-interval');
      await js(`document.querySelector('#s-pause').click()`); await until(`S.run.state==='paused'`); await shot('09-paused');
      await sleep(1500);
      await js(`document.querySelector('#s-pause').click()`);
      await until(`S.run && S.run.state==='done'`, 120000); await shot('10-interval-done');
      await js(`document.querySelector('#s-retry').click()`); await until(`S.run.state==='done' && S.run.items.find(i=>i.email.startsWith('bounce')).attempts===2`, 20000);
      await js(`document.querySelector('#s-export').click()`); await sleep(500);
      // 5. Burst mode
      await js(`document.querySelector('#s-new').click()`); await sleep(300);
      await js(`S.send.mode='burst'; persist(); renderSend()`); await shot('11-send-setup-burst');
      await js(`document.querySelector('#s-start').click()`);
      await until(`S.run && S.run.state==='done'`, 60000); await shot('12-burst-done');
      // 6. Drafts
      await js(`document.querySelector('#s-new').click()`); await sleep(300);
      await js(`go('drafts')`); await until('S.drafts.loaded===true', 20000); await shot('16-drafts-list');
      await js(`document.querySelector('.drow[data-uid="2"] [data-sel]').click()`); await sleep(100);
      await js(`document.querySelector('.drow[data-uid="3"]').click()`); await shot('17-drafts-no-recipient');
      await js(`document.querySelector('.drow[data-uid="5"]').click()`); await shot('18-drafts-bcc-preview');
      await js(`document.querySelector('.drow[data-uid="1"]').click()`);
      await js(`S.send={mode:'interval',every:2,unit:'sec',jitter:20}; persist(); document.querySelector('#d-send').click()`); await sleep(300);
      await shot('19-send-setup-drafts');
      await js(`document.querySelector('#s-start').click()`);
      await until(`S.run && S.run.state==='waiting'`, 20000); await sleep(600); await shot('20-sending-drafts');
      await until(`S.run && S.run.state==='done'`, 60000); await sleep(300); await shot('21-drafts-done');
      await js(`go('drafts')`); await until('S.drafts.loaded===true && !S.drafts.loading', 20000); await sleep(300); await shot('22-drafts-after-send');
      console.log('[drafts-left]', await ev(`JSON.stringify(S.drafts.list.map(d=>d.uid+':'+d.subject))`));
      // 7. Settings and dark mode
      await js(`go('settings')`); await shot('13-settings');
      nativeTheme.themeSource = 'dark'; await sleep(300);
      await js(`go('letter')`); await shot('14-letter-dark');
      await js(`go('send')`); await shot('15-send-dark');
      await js(`go('drafts')`); await shot('23-drafts-dark');
      const res = await ev(`JSON.stringify({run:S.run.stats, mode:S.run.mode})`);
      console.log('[result]', res);
      console.log('HARNESS OK');
    } catch (e) { console.log('HARNESS FAIL', e.stack || e); }
    app.exit(0);
  });
};
