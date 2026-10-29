// Letterhead 2 UI harness: real app against local IMAP (Gmail flavor) + SMTP + mock Gemini. Takes screenshots.
const fs = require('fs'), path = require('path');
const OUT = process.env.SHOTS || '/workspace/letterhead-screens';
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
module.exports = (win, { nativeTheme, getWired }) => {
  const wc = win.webContents;
  const js = code => wc.executeJavaScript(code + '\n;0');
  const ev = code => wc.executeJavaScript(code);
  const shot = async (name, keepToasts) => { if (!keepToasts) await js("document.querySelectorAll('.toast').forEach(t=>t.remove())"); await sleep(500); const img = await wc.capturePage(); fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG()); console.log('[shot]', name); };
  const until = async (expr, ms = 60000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev('!!(' + expr + ')')) return true; await sleep(200); } throw new Error('timeout: ' + expr); };
  const app = require('electron').app;
  const ok = (c, m) => { console.log((c ? '[ok] ' : '[FAIL] ') + m); if (!c) process.exitCode = 1; };
  wc.on('console-message', (e, lvl, msg) => { if (lvl >= 2) console.log('[renderer]', msg); });
  wc.once('did-finish-load', async () => {
    try {
      await until('document.body.dataset.ready==="1"');
      await js('window.confirm=()=>true;');
      await js(`lh.settings.save({ signature: 'Shabd Warar<br>Junior, Lincoln High School', undoSeconds: 2, cap: 500 }).then(()=>lh.settings.get()).then(s=>Object.assign(S.settings,s))`);
      await js(`lh.account.save({ preset:'custom', host:'127.0.0.1', port:2526, security:'none', user:'tester@example.com', fromName:'Shabd Warar', fromEmail:'tester@example.com', pass:'abcdabcdabcdabcd', imapHost:'127.0.0.1', imapPort:1993, imapSecurity:'none' }).then(a=>{S.account=a; renderAcctChip();})`);
      await until('S.account && S.account.hasPassword');
      await js(`go('mail')`);
      await until(`M.list.length > 8`, 40000);
      await until(`M.status && M.status.idle`, 20000).catch(() => {});
      await sleep(1500); await js('LH2.loadList(true)'); await sleep(600);
      ok(await ev(`M.list.length`) >= 10, 'inbox lists conversations: ' + await ev('M.list.length'));
      ok(await ev(`!!M.status.gmail`), 'Gmail extensions detected');
      await shot('40-inbox');
      // open the Maya thread
      await js(`(function(){const i=M.list.findIndex(t=>/Summer research/.test(t.subject)); document.querySelectorAll('#m-list .mrow')[i].click();})()`);
      await until(`M.thread.length===4 && document.querySelector('.mail-frame')`, 20000); await sleep(1200);
      await js(`(function(){const c=[...document.querySelectorAll('.msg.collapsed')].filter(a=>/Maya/.test(a.textContent)).pop(); if(c) c.querySelector('.msg-h').click();})()`);
      await until(`document.querySelector('.img-bar')`, 20000).then(() => ok(true, 'remote images blocked with a Show images bar')).catch(() => ok(false, 'remote images blocked with a Show images bar'));
      await sleep(800);
      ok(await ev(`(()=>{const fr=[...document.querySelectorAll('.mail-frame')].map(f=>f.contentDocument); return fr.every(d=>!d.querySelector('script')) && fr.some(d=>[...d.images].some(i=>i.src.startsWith('data:'))) && !fr.some(d=>[...d.images].some(i=>/^https?:/.test(i.src))); })()`), 'iframes: no scripts, inline cid image shown, remote images not loaded');
      ok(await ev(`document.querySelector('.mail-frame').getAttribute('sandbox')`) === 'allow-same-origin allow-popups allow-popups-to-escape-sandbox', 'iframe sandbox has no allow-scripts');
      await shot('41-thread');
      // AI on with the mock provider
      await js(`lh.settings.save({ aiEnabled: true, aiProvider: 'gemini', aboutMe: 'Junior at Lincoln High School, interested in brain computer interfaces.' }).then(()=>lh.settings.get()).then(s=>Object.assign(S.settings,s))`);
      await ev(`lh.ai.setKey('gemini', 'test-key-123')`);
      await js(`go('ai')`); await sleep(400);
      await js(`document.querySelector('#st-window').value='500'; document.querySelector('#st-run').click()`);
      await until(`(document.querySelector('#st-status').textContent||'').startsWith('Learned from')`, 60000);
      await js(`document.querySelector('#ai-test').click()`); await until(`/Works/.test(document.querySelector('#ai-test-out').textContent)`, 20000);
      await shot('42-assistant-setup');
      await js(`document.querySelector('#view-ai').scrollTop = 9999`);
      // auto reply rule for the lab
      await js(`saveSetting('autoReply', { enabled: true, dailyLimit: 5, rules: [{ id:'r1', name:'Stanford lab', enabled:true, senders:['@stanford.example'], labels:[], reviewMin:30 }, { id:'r2', name:'Coach', enabled:false, senders:['coach@school.example'], labels:[], reviewMin:60 }] }).then(()=>LH2A.onTab('ai'))`);
      await sleep(700); await js(`document.querySelector('#view-ai').scrollTop = 9999`); await shot('43-auto-reply-rules');
      // back to the thread, draft a reply
      await js(`go('mail')`); await sleep(300);
      await js(`(function(){const i=M.list.findIndex(t=>/Summer research/.test(t.subject)); document.querySelectorAll('#m-list .mrow')[i].click();})()`);
      await until(`document.querySelector('[data-ai=default]')`, 20000);
      await js(`document.querySelector('[data-ai=default]').click()`);
      await until(`document.querySelector('#ai-text')`, 30000); await sleep(400);
      await js(`document.querySelector('#r-scroll').scrollTop = 99999`);
      ok(/^Hi Dr\. Okafor,/.test(await ev(`document.querySelector('#ai-text').innerText`)), 'AI reply drafted in his voice');
      await shot('44-ai-reply');
      // Shorter
      await js(`document.querySelector('[data-ai=shorter]').click()`); await sleep(300); await until(`document.querySelector('#ai-text')`, 30000);
      const shortTxt = await ev(`document.querySelector('#ai-text').innerText`); ok(shortTxt.length < 200, 'Shorter: ' + JSON.stringify(shortTxt));
      // Edit in composer
      await js(`document.querySelector('[data-ai=edit]').click()`); await until(`!document.querySelector('#composer').classList.contains('hidden')`, 10000); await sleep(500);
      ok((await ev(`document.querySelector('#c-to').innerText`)).includes('Maya'), 'composer reply addressed to Maya');
      await shot('45-compose-reply');
      await js(`document.querySelector('#c-close').click()`); await sleep(1500);
      // new message with autocomplete chips
      await js(`LH2.compose({})`); await sleep(300);
      await js(`(function(){const i=document.querySelector('#c-to input'); i.value='pri'; i.dispatchEvent(new Event('input'));})()`); await until(`document.querySelector('.ac-pop')`, 5000);
      await shot('46-compose-autocomplete');
      await js(`(function(){const i=document.querySelector('#c-to input'); i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}));})()`); await sleep(200);
      await js(`document.querySelector('#c-subject').value='Thank you for the reading list'; document.querySelector('#c-subject').dispatchEvent(new Event('input')); const ed=document.querySelector('#c-editor'); ed.focus(); ed.innerHTML='<div>Hi Dr. Raman,</div><div><br></div><div>Thank you so much for the reading list! I started the <b>Willett 2021</b> paper last night and I already have a few questions.</div><div><br></div><div>Best,</div><div>Shabd</div>' + ed.innerHTML; ed.dispatchEvent(new Event('input'))`);
      await sleep(3800);
      ok(/Saved to Drafts/.test(await ev(`document.querySelector('#c-state').textContent`)), 'draft autosaved to Drafts');
      await shot('47-compose-new');
      await js(`document.querySelector('#c-send').click()`); await sleep(300); await shot('48-undo-send', true);
      await sleep(3500);
      const sent = fs.readdirSync('/tmp/mail2526').filter(f => f.includes('praman')).length; ok(sent >= 1, 'sent through SMTP after the undo window');
      // send the AI reply straight from the card
      await js(`(function(){const i=M.list.findIndex(t=>/Summer research/.test(t.subject)); if(i>=0) document.querySelectorAll('#m-list .mrow')[i].click();})()`);
      await until(`document.querySelector('#ai-text')`, 20000);
      const before = fs.readdirSync('/tmp/mail2526').length;
      await js(`document.querySelector('[data-ai=send]').click()`); await sleep(4000);
      const eml = fs.readdirSync('/tmp/mail2526').filter(f => f.endsWith('.eml')).sort().pop();
      const raw = fs.readFileSync('/tmp/mail2526/' + eml, 'utf8');
      ok(fs.readdirSync('/tmp/mail2526').length > before && /In-Reply-To: <t1d@stanford.example>/.test(raw) && /Junior, Lincoln High School/.test(raw) && !/Auto-Submitted/.test(raw), 'AI reply sent from the card with reply headers and signature, not marked automatic');
      // keyboard: j, e (archive)
      await js(`document.activeElement && document.activeElement.blur()`);
      const n0 = await ev('M.list.length');
      await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'j'}))`); await sleep(800);
      const subj = await ev(`(M.list.find(t=>t.thread===M.sel)||{}).subject`);
      await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'e'}))`); await sleep(1500);
      ok(await ev('M.list.length') === n0 - 1 && !(await ev(`M.list.some(t=>t.subject===${JSON.stringify(subj)})`)), `j then e archived "${subj}"`);
      await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'?'}))`); await sleep(300); await shot('49-shortcuts');
      await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
      // search
      await js(`(function(){const s=document.querySelector('#m-search'); s.value='from:praman@ucsd.example'; s.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}));})()`);
      await until(`M.search && M.list.length`, 20000); ok(await ev(`M.list.some(t=>/reading list/.test(t.subject))`), 'Gmail search from: works in the UI');
      await js(`(function(){const s=document.querySelector('#m-search'); s.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));})()`); await sleep(800);
      // new mail arrives over IDLE from a Stanford sender: auto reply scheduled
      const { ImapFlow } = require('imapflow');
      const c = new ImapFlow({ host: '127.0.0.1', port: 1993, secure: false, auth: { user: 'tester@example.com', pass: 'abcdabcdabcdabcd' }, logger: false }); await c.connect();
      await c.append('INBOX', `From: Lab Manager <labmgr@stanford.example>\r\nTo: Shabd Warar <tester@example.com>\r\nSubject: Zoom link for Thursday\r\nMessage-ID: <zoom1@stanford.example>\r\nDate: ${new Date().toUTCString()}\r\nContent-Type: text/plain\r\n\r\nHi Shabd,\r\n\r\nDr. Okafor asked me to set up the 30 minute call for Thursday at 4 PM. Can you confirm that still works for you?\r\n\r\nThanks,\r\nJordan`, []);
      await c.append('INBOX', `From: Daniel Reyes <dreyes@mit.example>\r\nTo: Shabd Warar <tester@example.com>\r\nSubject: Re: Kalman filter code\r\nMessage-ID: <kal2@mit.example>\r\nDate: ${new Date().toUTCString()}\r\nContent-Type: text/plain\r\n\r\nHey Shabd, happy to share the Kalman filter notebook. Want me to send it over or walk you through it on a call?\r\n\r\nDaniel`, []);
      await c.logout();
      await until(`M.list.some(t=>/Zoom link/.test(t.subject))`, 20000);
      ok(true, 'new mail appeared in the list through IDLE');
      const w = getWired(); const t0 = Date.now(); while (Date.now() - t0 < 30000) { const l = w.assistant.list(); if (l.some(s => /Zoom link/.test(s.subject) && s.status === 'scheduled') && l.some(s => /Kalman filter code/.test(s.subject) && s.status === 'ready')) break; await sleep(300); }
      const l = w.assistant.list();
      ok(l.some(s => /Zoom link/.test(s.subject) && s.status === 'scheduled'), 'Stanford mail: automatic reply scheduled for review');
      ok(l.some(s => /Kalman filter code/.test(s.subject) && s.status === 'ready'), 'other personal mail: suggested reply drafted, not scheduled');
      await sleep(600); await js('LH2.loadList(true)'); await sleep(500);
      await shot('50-inbox-new-mail');
      await js(`go('assist')`); await sleep(1200); await shot('51-suggested-replies');
      await js(`go('settings')`); await sleep(400); await shot('52-settings');
      // dark mode
      nativeTheme.themeSource = 'dark'; await sleep(400);
      await js(`go('mail')`); await sleep(300);
      await js(`(function(){const i=M.list.findIndex(t=>/Zoom link/.test(t.subject)); document.querySelectorAll('#m-list .mrow')[i].click();})()`);
      await until(`document.querySelector('#ai-text')`, 20000); await sleep(800); await shot('53-dark-auto-reply-waiting');
      await js(`(function(){const i=M.list.findIndex(t=>/Summer research/.test(t.subject)); document.querySelectorAll('#m-list .mrow')[i].click();})()`);
      await until(`M.thread.length>=4`, 20000); await sleep(600);
      await js(`(function(){const c=[...document.querySelectorAll('.msg.collapsed')].filter(a=>/Maya/.test(a.textContent)).pop(); if(c) c.querySelector('.msg-h').click();})()`);
      await until(`document.querySelector('.img-bar')`, 20000); await sleep(600);
      await shot('54-dark-thread');
      await js(`document.querySelector('.img-bar [data-images]').click()`); await sleep(800);
      ok(await ev(`[...document.querySelectorAll('.mail-frame')].some(f=>[...f.contentDocument.images].some(i=>/^https:/.test(i.src)))`), 'Show images loads remote images for that email only');
      await js(`go('assist')`); await sleep(900); await shot('55-dark-suggested');
      await js(`go('ai')`); await sleep(600); await shot('56-dark-assistant');
      // Stop the auto reply from the queue
      const k = l.find(s => /Zoom link/.test(s.subject)).k;
      await ev(`lh.assist.hold(${JSON.stringify(k)})`);
      ok(w.assistant.list().find(s => s.k === k).status === 'ready', 'Stop keeps it as a normal suggestion');
      console.log('HARNESS OK');
    } catch (e) { console.log('HARNESS FAIL', e.stack || e); process.exitCode = 1; }
    setTimeout(() => app.exit(process.exitCode || 0), 300);
  });
};
