// Perf harness: the real app sends a large drafts batch on an interval against local servers
// while we sample CPU for every Electron process. Prints one JSON line "[perf] {...}".
// Env: PERF_DRAFTS (send count), PERF_INTERVAL_MS, PERF_TAB (schedule|send), PERF_IMAP_PORT, PERF_SMTP_PORT, PERF_MAX_S
const sleep = ms => new Promise(r => setTimeout(r, ms));
module.exports = (win, { getScheduler }) => {
  const { app } = require('electron');
  const wc = win.webContents;
  const ev = code => wc.executeJavaScript(code);
  const until = async (expr, ms = 60000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev('!!(' + expr + ')')) return true; await sleep(200); } throw new Error('timeout: ' + expr); };
  const N0 = 0; const N = Number(process.env.PERF_DRAFTS || 200), IV = Number(process.env.PERF_INTERVAL_MS || 1000), TAB = process.env.PERF_TAB || 'schedule';
  const cpuByType = () => { const o = {}; for (const m of app.getAppMetrics()) { const k = m.type === 'Tab' ? 'renderer' : m.type === 'Browser' ? 'main' : m.type; o[k] = (o[k] || 0) + (m.cpu.cumulativeCPUUsage || 0); } return o; };
  const memMain = () => process.memoryUsage().heapUsed;
  wc.once('did-finish-load', async () => {
    const out = { drafts: N, intervalMs: IV, tab: TAB };
    try {
      await until('document.body.dataset.ready==="1"');
      await ev('window.confirm=()=>true; window.Notification=function(){}; 0');
      await ev(`lh.account.save({ preset:'custom', host:'127.0.0.1', port:${process.env.PERF_SMTP_PORT || 2527}, security:'none', user:'tester@example.com', fromName:'Shabd Warar', fromEmail:'tester@example.com', pass:'abcdabcdabcdabcd', imapHost:'127.0.0.1', imapPort:${process.env.PERF_IMAP_PORT || 1995}, imapSecurity:'none', allowInsecure:true }).then(()=>0)`);
      await ev(`lh.settings.save({ cap: 0, delDraft: true, saveSent: true, aiEnabled: true, indexWindow: 2000 }).then(()=>0)`);
      const drafts = require('../../src/drafts');
      const acct = { host: '127.0.0.1', user: 'tester@example.com', pass: 'abcdabcdabcdabcd', imapHost: '127.0.0.1', imapPort: Number(process.env.PERF_IMAP_PORT || 1995), imapSecurity: 'none', allowInsecure: true };
      const t0l = Date.now(); const list = await drafts.listDrafts(acct); out.listDraftsMs = Date.now() - t0l;
      // same shape the window sends (snapshotDrafts in app.js)
      const items = list.drafts.slice(0, N).map(d => ({ uid: d.uid, messageId: d.messageId, subject: d.subject, recipients: d.recipients }));
      // let any background start-up work (mail sync, indexing) settle so we measure the send itself
      await sleep(Number(process.env.PERF_SETTLE_MS || 20000));
      await ev(`go(${JSON.stringify(TAB)}); 0`);
      if (process.env.PERF_HIDE) { win.hide(); out.hidden = true; await sleep(1000); }
      const sch = getScheduler();
      const c0 = cpuByType(), t0 = Date.now(), m0 = memMain();
      sch.upsert({ name: 'perf', kind: 'drafts', drafts: { folder: list.folder, sentFolder: list.sentFolder, gmail: list.gmail, items }, scheduledAt: Date.now(), mode: 'interval', intervalMs: IV, jitterPct: 0 });
      let ipcBytes = 0; const origSend = wc.send.bind(wc); wc.send = (ch, p) => { try { ipcBytes += JSON.stringify(p === undefined ? null : p).length; } catch (e) {} return origSend(ch, p); };
      const maxS = Number(process.env.PERF_MAX_S || 900);
      while (Date.now() - t0 < maxS * 1000) { await sleep(1000); const b = sch.batches.find(x => x.name === 'perf'); if (b && ['done', 'failed', 'cancelled'].includes(b.status)) break; }
      const secs = (Date.now() - t0) / 1000, c1 = cpuByType();
      const b = sch.batches.find(x => x.name === 'perf'); const st = b && b.stats ? b.stats : {};
      out.status = b && b.status; out.sent = st.sent; out.failed = st.failed; out.wallS = +secs.toFixed(1);
      out.cpuS = {}; let tot = 0; for (const k of Object.keys(c1)) { out.cpuS[k] = +((c1[k] - (c0[k] || 0)) / 1).toFixed(2); tot += c1[k] - (c0[k] || 0); }
      // cumulativeCPUUsage is in seconds of CPU
      out.cpuTotalS = +tot.toFixed(2); out.avgCpuPct = +(tot / secs * 100).toFixed(1); out.cpuMsPerEmail = st.sent ? Math.round(tot / st.sent * 1000) : null;
      out.ipcKB = Math.round(ipcBytes / 1024); out.heapGrowthMB = +((memMain() - m0) / 1048576).toFixed(1);
      // idle cost between sends: 30 s with nothing to do after the batch
      const i0 = cpuByType(); await sleep(30000); const i1 = cpuByType(); let it = 0; for (const k of Object.keys(i1)) it += i1[k] - (i0[k] || 0); out.idleCpuPct = +(it / 30 * 100).toFixed(1);
      const fs = require('fs'), path = require('path'); const dir = app.getPath('userData');
      out.dataFiles = {}; for (const f of fs.readdirSync(dir)) { try { const s = fs.statSync(path.join(dir, f)); out.dataFiles[f] = s.isDirectory() ? 'dir' : Math.round(s.size / 1024) + 'KB'; } catch (e) {} }
    } catch (e) { out.error = e.stack || String(e); }
    console.log('[perf] ' + JSON.stringify(out));
    app.exit(0);
  });
};
