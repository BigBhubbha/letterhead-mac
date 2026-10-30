/* errors in this window go to the log in Settings > Help */
const BENIGN = /ResizeObserver loop/;
window.addEventListener('error', e => { if (BENIGN.test(e.message || '')) return; try { lh.diag.report('window', (e.error && e.error.stack) || e.message + ' at ' + e.filename + ':' + e.lineno); } catch (er) { /* preload missing */ } });
window.addEventListener('unhandledrejection', e => { try { const r = e.reason; lh.diag.report('promise', (r && (r.stack || r.message)) || String(r)); } catch (er) { /* preload missing */ } });
'use strict';
/* Letterhead renderer */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const normKey = k => String(k).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const isEmail = s => /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/.test(String(s || '').trim());
const TOKEN = /\{\{\s*([^}|]+?)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g;
const fmtN = n => Number(n).toLocaleString('en-US');
const fmtSize = b => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
const ICON_OK = '<svg viewBox="0 0 12 12"><path d="M2.5 6.2 5 8.5l4.5-5"/></svg>';
const ICON_NO = '<svg viewBox="0 0 12 12"><path d="M3.5 3.5l5 5M8.5 3.5l-5 5"/></svg>';
const ICON_WARN = '<svg viewBox="0 0 12 12"><path d="M6 3v3.6M6 8.8v.1"/></svg>';

const PRESETS = {
  gmail: { host: 'smtp.gmail.com', port: 465, security: 'ssl', imapHost: 'imap.gmail.com', imapPort: 993, imapSecurity: 'ssl', passLabel: 'App password', passPh: '16 characters from Google', userPh: 'you@gmail.com' },
  icloud: { host: 'smtp.mail.me.com', port: 587, security: 'starttls', imapHost: 'imap.mail.me.com', imapPort: 993, imapSecurity: 'ssl', passLabel: 'App-specific password', passPh: 'xxxx-xxxx-xxxx-xxxx', userPh: 'you@icloud.com' },
  custom: { host: '', port: 465, security: 'ssl', imapHost: '', imapPort: 993, imapSecurity: 'ssl', passLabel: 'Password', passPh: 'Your SMTP password or app password', userPh: 'you@example.com' },
};

const S = {
  tab: 'account', preset: 'gmail', account: null,
  recipients: [], columns: [], invalid: 0, dupes: 0, sourceName: '',
  draft: { subject: '', body: '', attachments: [] },
  send: { mode: 'interval', every: 2, unit: 'min', jitter: 25 },
  settings: { cap: 500, delDraft: true, saveSent: true }, source: 'merge',
  drafts: { loaded: false, loading: false, error: null, folder: null, sentFolder: null, gmail: false, list: [], sel: new Set(), focus: null, stale: true }, usage: { count: 0, oldest: null },
  pv: 0, run: null, testedThisSession: false,
};

/* ---------------- toasts ---------------- */
function toast(msg, bad) {
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : '');
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = 0; setTimeout(() => t.remove(), 300); }, bad ? 6000 : 3200);
}

/* ---------------- navigation ---------------- */
function go(tab) {
  S.tab = tab;
  $$('.nav-item').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  $$('.view').forEach(v => v.classList.toggle('on', v.id === 'view-' + tab));
  if (tab === 'letter') renderLetter();
  if (tab === 'send') renderSend();
  if (tab === 'drafts') { if (S.drafts.stale && !S.drafts.loading) loadDrafts(); else renderDrafts(); }
  if (tab === 'settings') renderSettings();
  if (tab === 'schedule') renderSchedule();
  if (window.LH2) LH2.onTab(tab);
}
$$('.nav-item').forEach(b => b.addEventListener('click', () => go(b.dataset.tab)));
document.addEventListener('click', e => { const a = e.target.closest('[data-ext]'); if (a) { e.preventDefault(); lh.openExternal(a.dataset.ext); } });

/* ---------------- help: error log and diagnostics ---------------- */
async function showLog() {
  const r = await lh.diag.log();
  const lines = (r.lines || []).slice(-300);
  $('#d-lines').textContent = lines.length ? lines.join('\n') : 'Nothing logged yet.';
  $('#d-lines').innerHTML = $('#d-lines').innerHTML.replace(/^(.*? ERROR .*)$/gm, '<b class="err">$1</b>');
  $('#d-veil').classList.remove('hidden'); $('#d-lines').scrollTop = 1e9;
}
async function copyDiag() { const r = await lh.diag.copy(); toast(r && r.ok ? 'Diagnostics copied. Paste them into a message.' : 'Could not copy diagnostics.', !(r && r.ok)); }
$('#d-view').addEventListener('click', showLog);
$('#d-refresh').addEventListener('click', showLog);
$('#d-copy').addEventListener('click', copyDiag);
$('#d-copy2').addEventListener('click', copyDiag);
$('#d-reveal').addEventListener('click', () => lh.diag.reveal());
$('#d-close').addEventListener('click', () => $('#d-veil').classList.add('hidden'));
$('#d-veil').addEventListener('click', e => { if (e.target.id === 'd-veil') $('#d-veil').classList.add('hidden'); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#d-veil').classList.contains('hidden')) $('#d-veil').classList.add('hidden'); });

/* ---------------- persistence ---------------- */
let saveT = null;
function persist() {
  clearTimeout(saveT);
  saveT = setTimeout(() => lh.draft.save({ draft: S.draft, recipients: S.recipients, columns: S.columns, invalid: S.invalid, dupes: S.dupes, sourceName: S.sourceName, send: S.send }), 400);
}

/* ---------------- sidebar ---------------- */
async function refreshUsage() { S.usage = await lh.usage.get(); renderMeter(); }
function renderMeter() {
  const cap = Number(S.settings.cap) || 0, n = S.usage.count;
  $('#meter-text').textContent = cap ? `${fmtN(n)} of ${fmtN(cap)}` : `${fmtN(n)} sent`;
  const f = $('#meter-fill'), pct = cap ? Math.min(100, n / cap * 100) : 0;
  f.style.width = pct + '%';
  f.className = pct >= 100 ? 'full' : pct >= 80 ? 'warn' : '';
}
function renderAcctChip() {
  const a = S.account, ok = !!(a && a.hasPassword);
  $('#acct-chip').classList.toggle('ok', ok);
  $('#acct-chip-text').textContent = ok ? (a.email || a.user) : 'Not connected';
  $('#nav-acct-dot').classList.toggle('ok', ok);
}
function renderNavCount() { const n = validRecipients().length; $('#nav-rcpt-count').textContent = n ? fmtN(n) : ''; }

/* ---------------- account ---------------- */
function setPreset(p) {
  S.preset = p;
  $$('#preset-seg button').forEach(b => b.classList.toggle('on', b.dataset.preset === p));
  $('#view-account').classList.toggle('preset-custom', p === 'custom');
  const P = PRESETS[p];
  $('#a-pass-label').textContent = P.passLabel;
  $('#a-pass').placeholder = (S.account && S.account.hasPassword && S.account.preset === p) ? 'Saved. Type a new one to replace it.' : P.passPh;
  $('#a-user').placeholder = P.userPh;
  ['gmail', 'icloud', 'custom'].forEach(k => $('#guide-' + k).classList.toggle('hidden', k !== p));
  if (p !== 'custom') { $('#a-host').value = P.host; $('#a-port').value = P.port; $('#a-security').value = P.security; }
}
$$('#preset-seg button').forEach(b => b.addEventListener('click', () => setPreset(b.dataset.preset)));
$('#a-pass-toggle').addEventListener('click', () => { const i = $('#a-pass'); i.type = i.type === 'password' ? 'text' : 'password'; $('#a-pass-toggle').textContent = i.type === 'password' ? 'Show' : 'Hide'; });

function formAccount() {
  const P = PRESETS[S.preset];
  const email = $('#a-user').value.trim(), login = S.preset === 'custom' ? $('#a-login').value.trim() : '';
  let pass = $('#a-pass').value;
  if (S.preset === 'gmail') pass = pass.replace(/\s+/g, '');
  const alias = $('#a-fromEmail').value.trim();
  return {
    preset: S.preset,
    host: S.preset === 'custom' ? $('#a-host').value.trim() : P.host,
    port: Number(S.preset === 'custom' ? $('#a-port').value : P.port) || 465,
    security: S.preset === 'custom' ? $('#a-security').value : P.security,
    email, login, alias, user: login || email, fromEmail: alias || email,
    fromName: $('#a-fromName').value.trim(), replyTo: $('#a-replyTo').value.trim(), pass,
    imapHost: S.preset === 'custom' ? ($('#a-imapHost').value.trim() || $('#a-host').value.trim().replace(/^(smtp|mail|outgoing)\./i, 'imap.')) : P.imapHost,
    imapPort: Number(S.preset === 'custom' ? $('#a-imapPort').value : P.imapPort) || 993,
    imapSecurity: S.preset === 'custom' ? $('#a-imapSecurity').value : P.imapSecurity,
  };
}
function fillAccount(a) {
  if (!a) { setPreset('gmail'); return; }
  setPreset(a.preset || 'gmail');
  $('#a-fromName').value = a.fromName || '';
  $('#a-user').value = a.email || a.user || '';
  $('#a-login').value = a.login || '';
  $('#a-fromEmail').value = a.alias || '';
  $('#a-replyTo').value = a.replyTo || '';
  if (a.preset === 'custom') { $('#a-host').value = a.host || ''; $('#a-port').value = a.port || ''; $('#a-security').value = a.security || 'ssl'; $('#a-imapHost').value = a.imapHost || ''; $('#a-imapPort').value = a.imapPort || ''; $('#a-imapSecurity').value = a.imapSecurity || 'ssl'; }
  $('#a-pass').value = '';
  setStatus(a.hasPassword ? 'ok' : null, a.hasPassword ? `Saved. ${a.encrypted ? 'Your password is encrypted with your Mac\'s Keychain.' : 'Password stored on this computer.'}` : '');
}
function setStatus(kind, text) {
  $('#a-status').innerHTML = text ? `<div class="${kind === 'ok' ? 'ok' : kind === 'bad' ? 'bad' : ''}">${esc(text)}</div>` : '';
}
function checkForm(a, needPass) {
  if (!isEmail(a.email)) return 'Enter the email address you send from.';
  if (!a.host) return 'Enter your SMTP server.';
  if (needPass && !a.pass && !(S.account && S.account.hasPassword)) return 'Enter your app password.';
  if (S.preset === 'gmail' && a.pass && a.pass.length !== 16) return 'Google app passwords are 16 letters. Check that the whole code was pasted.';
  return null;
}
$('#a-verify').addEventListener('click', async () => {
  const a = formAccount(), err = checkForm(a, true);
  if (err) return setStatus('bad', err);
  setStatus(null, 'Contacting ' + a.host + '...');
  $('#a-verify').disabled = true;
  const r = await lh.account.verify(a);
  $('#a-verify').disabled = false;
  if (!r.ok) return setStatus('bad', r.error);
  setStatus(null, 'Sending works. Checking your Drafts folder over IMAP...');
  const im = await lh.drafts.verify(a);
  setStatus('ok', 'Sending works. ' + (im.ok ? (im.drafts ? `Drafts folder found: ${im.drafts}.` : 'Reading mail works, but no Drafts folder was found.') : 'Drafts could not be read: ' + im.error));
});
$('#a-save').addEventListener('click', async () => {
  const a = formAccount(), err = checkForm(a, true);
  if (err) return setStatus('bad', err);
  $('#a-save').disabled = true;
  setStatus(null, 'Checking the login before saving...');
  const r = await lh.account.verify(a);
  $('#a-save').disabled = false;
  if (!r.ok) return setStatus('bad', r.error + ' Nothing was saved.');
  S.account = await lh.account.save(a);
  fillAccount(S.account); renderAcctChip(); S.drafts.stale = true;
  toast('Account saved');
  const im = await lh.drafts.verify();
  setStatus('ok', `Saved. ${S.account.encrypted ? 'Your password is encrypted with your Mac\'s Keychain.' : 'Password stored on this computer.'} ` + (im.ok ? (im.drafts ? `Drafts folder: ${im.drafts}.` : 'No Drafts folder found over IMAP.') : 'Drafts are not available yet: ' + im.error));
});
$('#a-forget').addEventListener('click', async () => {
  if (!confirm('Forget this account and its saved password?')) return;
  S.account = await lh.account.clear(); fillAccount(null);
  ['#a-fromName', '#a-user', '#a-login', '#a-fromEmail', '#a-replyTo'].forEach(s => $(s).value = '');
  setStatus(null, ''); renderAcctChip();
});

/* ---------------- recipients ---------------- */
const EMAIL_KEYS = ['email', 'e_mail', 'email_address', 'emailaddress', 'mail', 'address'];
function splitName(full) {
  const p = String(full || '').trim().replace(/\s+/g, ' ').split(' ');
  if (!p[0]) return {};
  return { first_name: p[0], last_name: p.length > 1 ? p[p.length - 1] : '' };
}
function parseList(text) {
  text = String(text || '').replace(/^\uFEFF/, '');
  const res = Papa.parse(text.trim(), { skipEmptyLines: 'greedy' });
  let rows = res.data.map(r => r.map(c => String(c).trim()));
  if (!rows.length) return { columns: [], items: [] };
  const first = rows[0];
  const hasHeader = !first.some(c => isEmail(c) || /<[^>]+@[^>]+>/.test(c));
  let columns, items = [];
  if (hasHeader) {
    const seen = {};
    columns = first.map((h, i) => { let k = normKey(h) || 'column_' + (i + 1); if (seen[k]) k += '_' + (++seen[k]); else seen[k] = 1; return k; });
    rows = rows.slice(1);
    let ei = columns.findIndex(k => EMAIL_KEYS.includes(k));
    if (ei < 0) { let best = -1, bestN = 0; columns.forEach((k, i) => { const n = rows.filter(r => isEmail(r[i])).length; if (n > bestN) { bestN = n; best = i; } }); ei = best; }
    if (ei < 0) return { columns, items: [], error: 'Could not find a column with email addresses. Name one of the columns "email".' };
    for (const r of rows) {
      const f = {}; columns.forEach((k, i) => f[k] = r[i] != null ? r[i] : '');
      f.email = String(r[ei] || '').trim();
      items.push({ email: f.email, fields: f });
    }
    if (columns[ei] !== 'email') columns = ['email', ...columns.filter((k, i) => i !== ei)];
  } else {
    columns = ['email'];
    const wide = Math.max(...rows.map(r => r.length));
    if (wide > 1) for (let i = 1; i < wide; i++) columns.push('column_' + (i + 1));
    for (const r of rows) {
      // a row may be "Name <addr>" or "addr, more"
      const cells = r.length === 1 ? r[0].split(/[;,]\s*(?=[^@]*@)/) : [r.join(',')];
      for (const c0 of (r.length === 1 ? cells : [null])) {
        const f = {};
        if (c0 != null) {
          const m = c0.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
          if (m) { f.email = m[2].trim(); if (m[1]) { f.name = m[1].trim(); Object.assign(f, splitName(f.name)); } }
          else f.email = c0.trim();
        } else {
          f.email = r[0];
          r.slice(1).forEach((v, i) => f['column_' + (i + 2)] = v);
        }
        items.push({ email: f.email, fields: f });
      }
    }
    if (items.some(i => i.fields.name)) columns.push('name', 'first_name', 'last_name');
  }
  // derive first/last name from a full name column when missing
  if (columns.includes('name') && !columns.includes('first_name')) {
    columns.push('first_name', 'last_name');
    items.forEach(i => Object.assign(i.fields, splitName(i.fields.name), { ...(i.fields.first_name ? { first_name: i.fields.first_name } : {}) }));
  }
  columns = [...new Set(columns)];
  return { columns, items };
}
function setRecipients(parsed, append, sourceName) {
  if (parsed.error) { toast(parsed.error, true); return; }
  let items = append ? [...S.recipients, ...parsed.items] : parsed.items;
  const cols = append ? [...new Set([...S.columns, ...parsed.columns])] : parsed.columns;
  const seen = new Set(); let dupes = 0; const out = [];
  for (const it of items) {
    const k = it.email.toLowerCase();
    if (k && seen.has(k)) { dupes++; continue; }
    seen.add(k); out.push(it);
  }
  S.recipients = out; S.columns = cols; S.dupes = (append ? S.dupes : 0) + dupes;
  S.invalid = out.filter(i => !isEmail(i.email)).length;
  if (sourceName) S.sourceName = sourceName; else if (!append) S.sourceName = 'Pasted list';
  S.pv = 0;
  persist(); renderRecipients(); renderNavCount();
  toast(`${fmtN(parsed.items.length)} ${parsed.items.length === 1 ? 'row' : 'rows'} ${append ? 'added' : 'loaded'}${dupes ? `, ${dupes} duplicate${dupes === 1 ? '' : 's'} removed` : ''}`);
}
const validRecipients = () => S.recipients.filter(r => isEmail(r.email));

function renderRecipients() {
  const n = S.recipients.length, has = n > 0;
  $('#r-empty').classList.toggle('hidden', has);
  $('#r-table-wrap').classList.toggle('hidden', !has);
  $('#r-clear').classList.toggle('hidden', !has);
  if (!has) { $('#r-summary').innerHTML = ''; return; }
  const v = validRecipients().length;
  let h = `<span class="pill"><b>${fmtN(v)}</b> ready to send</span>`;
  if (S.invalid) h += `<span class="pill bad"><b>${S.invalid}</b> invalid, will be skipped</span>`;
  if (S.dupes) h += `<span class="pill warn"><b>${S.dupes}</b> duplicate${S.dupes === 1 ? '' : 's'} removed</span>`;
  if (S.sourceName) h += `<span class="pill">from ${esc(S.sourceName)}</span>`;
  h += `<span class="grow"></span><span class="hint">Merge fields:</span>` + S.columns.map(c => `<span class="pill field">{{${esc(c)}}}</span>`).join('');
  $('#r-summary').innerHTML = h;
  const cols = S.columns;
  const max = Math.min(n, 2000);
  let t = '<table><thead><tr><th></th>' + cols.map(c => `<th><code>${esc(c)}</code></th>`).join('') + '<th></th></tr></thead><tbody>';
  for (let i = 0; i < max; i++) {
    const r = S.recipients[i];
    t += `<tr><td class="n">${i + 1}</td>` + cols.map(c => {
      const val = c === 'email' ? r.email : r.fields[c];
      return `<td class="${c === 'email' && !isEmail(val) ? 'bad' : ''}" title="${esc(val)}">${esc(val)}</td>`;
    }).join('') + `<td class="x"><button class="ghost sm" data-rm="${i}" title="Remove">×</button></td></tr>`;
  }
  t += '</tbody></table>';
  if (n > max) t += `<div class="hint" style="padding:10px 14px">Showing the first ${fmtN(max)} of ${fmtN(n)}.</div>`;
  $('#r-table').innerHTML = t;
}
$('#r-table').addEventListener('click', e => {
  const b = e.target.closest('[data-rm]'); if (!b) return;
  S.recipients.splice(Number(b.dataset.rm), 1);
  S.invalid = S.recipients.filter(i => !isEmail(i.email)).length;
  persist(); renderRecipients(); renderNavCount();
});
async function importCsv() {
  const f = await lh.csvOpen(); if (!f) return;
  setRecipients(parseList(f.text), false, f.name); go('recipients');
}
$('#r-import').addEventListener('click', importCsv);
$('#r-paste-toggle').addEventListener('click', () => { $('#r-paste-card').classList.toggle('hidden'); $('#r-paste').focus(); });
$('#r-paste-cancel').addEventListener('click', () => $('#r-paste-card').classList.add('hidden'));
$('#r-paste-replace').addEventListener('click', () => { setRecipients(parseList($('#r-paste').value), false); $('#r-paste').value = ''; $('#r-paste-card').classList.add('hidden'); });
$('#r-paste-append').addEventListener('click', () => { setRecipients(parseList($('#r-paste').value), true); $('#r-paste').value = ''; $('#r-paste-card').classList.add('hidden'); });
$('#r-clear').addEventListener('click', () => { if (!confirm('Clear all recipients?')) return; S.recipients = []; S.columns = []; S.invalid = S.dupes = 0; S.sourceName = ''; persist(); renderRecipients(); renderNavCount(); });

// drag and drop CSV anywhere
let dragDepth = 0;
window.addEventListener('dragenter', e => { if ([...e.dataTransfer.types].includes('Files')) { dragDepth++; $('#dropveil').classList.add('on'); } });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#dropveil').classList.remove('on'); } });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', async e => {
  e.preventDefault(); dragDepth = 0; $('#dropveil').classList.remove('on');
  const f = e.dataTransfer.files[0]; if (!f) return;
  if (!/\.(csv|tsv|txt)$/i.test(f.name)) return toast('Drop a .csv file to import recipients.', true);
  setRecipients(parseList(await f.text()), false, f.name); go('recipients');
});

/* ---------------- letter ---------------- */
function mergeMarked(tpl, fields, missing) {
  let out = '', last = 0;
  String(tpl || '').replace(TOKEN, (m, key, fb, idx) => {
    out += esc(tpl.slice(last, idx)); last = idx + m.length;
    const v = fields[normKey(key)];
    if (v != null && String(v).trim() !== '') out += `<span class="m">${esc(String(v).trim())}</span>`;
    else if (fb != null) out += `<span class="m fb">${esc(fb)}</span>`;
    else { out += `<span class="miss">{{${esc(normKey(key))}}}</span>`; missing && missing.add(normKey(key)); }
    return m;
  });
  return out + esc(String(tpl || '').slice(last));
}
function tokensIn(tpl) { const s = new Set(); String(tpl || '').replace(TOKEN, (m, k, fb) => { s.add(normKey(k)); return m; }); return s; }

function renderChips() {
  const cols = S.columns.length ? S.columns : ['email', 'first_name', 'last_name', 'university'];
  $('#l-chips').innerHTML = '<span class="lbl">Insert</span>' + cols.map(c => `<button data-ins="${esc(c)}">{{${esc(c)}}}</button>`).join('');
}
let lastFocus = 'body';
$('#l-subject').addEventListener('focus', () => lastFocus = 'subject');
$('#l-body').addEventListener('focus', () => lastFocus = 'body');
$('#l-chips').addEventListener('mousedown', e => { if (e.target.closest('[data-ins]')) e.preventDefault(); });
$('#l-chips').addEventListener('click', e => {
  const b = e.target.closest('[data-ins]'); if (!b) return;
  const el = lastFocus === 'subject' ? $('#l-subject') : $('#l-body');
  const tok = `{{${b.dataset.ins}}}`;
  el.focus();
  const s = el.selectionStart ?? el.value.length, en = el.selectionEnd ?? s;
  el.setRangeText(tok, s, en, 'end');
  el.dispatchEvent(new Event('input'));
});
['#l-subject', '#l-body'].forEach(s => $(s).addEventListener('input', () => {
  S.draft.subject = $('#l-subject').value; S.draft.body = $('#l-body').value; persist(); renderPreview();
}));
function renderAttachments() {
  const list = S.draft.attachments || [];
  $('#l-attach-list').innerHTML = list.map((a, i) => `<span class="att ${a.missing ? 'missing' : ''}">${esc(a.name)} <small>${a.missing ? 'file not found' : fmtSize(a.size)}</small><button data-rma="${i}" title="Remove">×</button></span>`).join('');
}
$('#l-attach-list').addEventListener('click', e => { const b = e.target.closest('[data-rma]'); if (!b) return; S.draft.attachments.splice(Number(b.dataset.rma), 1); persist(); renderAttachments(); renderPreview(); });
async function attach() {
  const files = await lh.attachPick(); if (!files.length) return;
  const have = new Set(S.draft.attachments.map(a => a.path));
  S.draft.attachments.push(...files.filter(f => !have.has(f.path)));
  persist(); renderAttachments(); renderPreview();
}
$('#l-attach').addEventListener('click', attach);

function renderLetter() {
  $('#l-subject').value = S.draft.subject; $('#l-body').value = S.draft.body;
  renderChips(); renderAttachments(); renderPreview();
}
function fromLine() {
  const a = S.account; if (!a) return '<span class="ph">Connect an account first</span>';
  const addr = a.alias || a.email || a.user;
  return a.fromName ? `${esc(a.fromName)} <span style="color:#9A8F83">&lt;${esc(addr)}&gt;</span>` : esc(addr);
}
function renderPreview() {
  const list = validRecipients();
  const n = list.length;
  if (S.pv >= n) S.pv = Math.max(0, n - 1);
  const r = n ? list[S.pv] : { email: 'recipient@university.edu', fields: {} };
  $('#pv-who').innerHTML = n ? `<b>${S.pv + 1}</b> of ${fmtN(n)} &nbsp;·&nbsp; ${esc(r.email)}` : 'Sample preview. Add recipients to see real values.';
  $('#pv-stamp-n').textContent = n ? S.pv + 1 : '1';
  $('#pv-from').innerHTML = fromLine();
  $('#pv-to').textContent = r.email;
  const missing = new Set();
  $('#pv-subject').innerHTML = S.draft.subject ? mergeMarked(S.draft.subject, r.fields, missing) : '<span class="ph">No subject yet</span>';
  $('#pv-body').innerHTML = S.draft.body ? mergeMarked(S.draft.body, r.fields, missing) : '<span class="ph">Your letter will appear here as each person will read it.</span>';
  $('#pv-attach').innerHTML = (S.draft.attachments || []).map(a => `<span>Attached: ${esc(a.name)}</span>`).join('');
  $('#pv-prev').disabled = S.pv <= 0; $('#pv-next').disabled = S.pv >= n - 1;
  // warnings across the whole list
  const warn = mergeWarnings();
  $('#pv-warn').innerHTML = warn.length ? `<div>${warn.map(esc).join('<br>')}</div>` : '';
}
function mergeWarnings() {
  const tpl = S.draft.subject + '\n' + S.draft.body, toks = tokensIn(tpl), out = [];
  if (!S.recipients.length) return out;
  const unknown = [...toks].filter(t => !S.columns.includes(t));
  if (unknown.length) out.push(`Not a column in your list: ${unknown.map(u => '{{' + u + '}}').join(', ')}. These come out blank unless they have a fallback.`);
  const counts = {};
  for (const r of validRecipients()) {
    String(tpl).replace(TOKEN, (m, k, fb) => { const key = normKey(k); const v = r.fields[key]; if (S.columns.includes(key) && fb == null && (v == null || String(v).trim() === '')) counts[key] = (counts[key] || 0) + 1; return m; });
  }
  for (const [k, c] of Object.entries(counts)) out.push(`${c} recipient${c === 1 ? ' has' : 's have'} an empty ${k}. Fill the cell or add a fallback like {{${k}|...}}.`);
  return out;
}
function missingCount() {
  const tpl = S.draft.subject + '\n' + S.draft.body; let n = 0;
  for (const r of validRecipients()) { let miss = false; String(tpl).replace(TOKEN, (m, k, fb) => { const v = r.fields[normKey(k)]; if (fb == null && (v == null || String(v).trim() === '')) miss = true; return m; }); if (miss) n++; }
  return n;
}
$('#pv-prev').addEventListener('click', () => { S.pv--; renderPreview(); });
$('#pv-next').addEventListener('click', () => { S.pv++; renderPreview(); });
document.addEventListener('keydown', e => {
  if (S.tab !== 'letter' || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  if (e.key === 'ArrowLeft' && S.pv > 0) { S.pv--; renderPreview(); }
  if (e.key === 'ArrowRight' && S.pv < validRecipients().length - 1) { S.pv++; renderPreview(); }
});

async function sendTest() {
  if (!S.account || !S.account.hasPassword) { toast('Connect an account first.', true); return go('account'); }
  if (!S.draft.subject.trim() && !S.draft.body.trim()) return toast('Write the letter first.', true);
  const list = validRecipients(), r = list[S.pv] || list[0] || { fields: {} };
  const btns = [$('#l-test'), $('#s-test')]; btns.forEach(b => b.disabled = true);
  toast('Sending a test to ' + (S.account.alias || S.account.email || S.account.user) + '...');
  const res = await lh.sendTest({ template: tplForSend(), fields: r.fields });
  btns.forEach(b => b.disabled = false);
  if (res.ok) { S.testedThisSession = true; toast(`Test sent to ${res.to}, filled in for ${r.email || 'a sample recipient'}.`); refreshUsage(); if (S.tab === 'send') renderSend(); }
  else toast(res.error, true);
}
const tplForSend = () => ({ subject: S.draft.subject, body: S.draft.body, attachments: (S.draft.attachments || []).filter(a => !a.missing).map(a => a.path) });
$('#l-test').addEventListener('click', sendTest);
$('#s-test').addEventListener('click', sendTest);

/* ---------------- drafts ---------------- */
const D = S.drafts;
const sendableDrafts = () => D.list.filter(d => d.recipients.length && !d.unreadable);
const selectedDrafts = () => sendableDrafts().filter(d => D.sel.has(d.uid));
const addrShort = a => a.name ? a.name : a.address;
function fmtWhen(t) {
  if (!t) return '';
  const d = new Date(t), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
async function loadDrafts() {
  if (!S.account || !S.account.hasPassword) { D.error = 'noacct'; D.loaded = false; renderDrafts(); return; }
  D.loading = true; D.error = null; renderDrafts();
  const r = await lh.drafts.list();
  D.loading = false; D.stale = false;
  if (!r.ok) { D.error = r.error; D.loaded = false; renderDrafts(); return; }
  const prevSel = D.loaded ? new Set(D.sel) : null;
  Object.assign(D, { loaded: true, folder: r.folder, sentFolder: r.sentFolder, gmail: r.gmail, list: r.drafts });
  const uids = new Set(r.drafts.map(d => d.uid));
  D.sel = new Set(prevSel ? [...prevSel].filter(u => uids.has(u)) : sendableDrafts().map(d => d.uid));
  if (!uids.has(D.focus)) D.focus = r.drafts.length ? r.drafts[0].uid : null;
  renderDrafts(); renderNavDrafts();
}
function renderNavDrafts() { $('#nav-drafts-count').textContent = D.loaded && D.list.length ? fmtN(D.list.length) : ''; }
function draftState(html) { $('#d-state').innerHTML = html; $('#d-state').classList.remove('hidden'); $('#d-main').classList.add('hidden'); }
function renderDrafts() {
  const sendBtn = $('#d-send');
  sendBtn.disabled = true; sendBtn.textContent = 'Send selected';
  if (D.error === 'noacct') { $('#d-summary').innerHTML = ''; return draftState(`<svg viewBox="0 0 160 110" class="ill"><rect x="30" y="34" width="100" height="64" rx="6"/><path d="M30 46l14-20h72l14 20"/><path d="M62 66h36"/></svg><h3>Connect your account first</h3><p>Letterhead reads your Drafts folder with the same email address and app password you use for sending.</p><p style="margin-top:14px"><button class="primary" data-go="account">Go to Account</button></p>`); }
  if (D.loading && !D.loaded) { $('#d-summary').innerHTML = '<span class="pill">Opening your Drafts folder...</span>'; $('#d-state').classList.add('hidden'); $('#d-main').classList.remove('hidden'); $('#d-list').innerHTML = [1, 2, 3, 4].map(() => '<div class="drow"><span></span><div><div class="skel" style="width:40%"></div><div class="skel" style="width:75%;height:15px"></div><div class="skel" style="width:90%"></div></div><span></span></div>').join(''); $('#d-pv').innerHTML = '<div class="skel" style="width:50%"></div><div class="skel" style="width:70%"></div><div class="skel" style="width:85%;margin-top:30px"></div><div class="skel" style="width:80%"></div>'; return; }
  if (D.error) {
    const g = S.account && S.account.preset === 'gmail';
    $('#d-summary').innerHTML = '';
    return draftState(`<svg viewBox="0 0 160 110" class="ill"><rect x="30" y="34" width="100" height="64" rx="6"/><path d="M30 46l14-20h72l14 20"/><circle cx="122" cy="34" r="12" class="ill-accent"/><path d="M122 28v7M122 39v.5" style="stroke:var(--accent)"/></svg><h3>Could not open your drafts</h3><p class="err">${esc(D.error)}</p>
      <ul class="tips">${g ? '<li>Use the same App Password that works for sending. Google accepts it for IMAP too.</li><li>Personal Gmail accounts have IMAP on by default. School or work accounts can have it turned off by an admin.</li>' : '<li>Check the IMAP server and port on the Account tab. Most providers use port 993 with SSL/TLS.</li>'}<li>Then click Refresh.</li></ul>`);
  }
  if (!D.loaded) return draftState('');
  $('#d-state').classList.add('hidden'); $('#d-main').classList.remove('hidden');
  if (!D.list.length) {
    $('#d-summary').innerHTML = `<span class="pill">${esc(D.folder)}</span>`;
    return draftState(`<svg viewBox="0 0 160 110" class="ill"><rect x="30" y="34" width="100" height="64" rx="6"/><path d="M30 46l14-20h72l14 20"/><path d="M62 66h36"/></svg><h3>Your Drafts folder is empty</h3><p>Write emails in Gmail or your mail app and leave them as drafts. They show up here after you click Refresh.</p>`);
  }
  const ok = sendableDrafts(), flagged = D.list.length - ok.length, sel = selectedDrafts();
  const rcpts = sel.reduce((n, d) => n + d.recipients.length, 0);
  $('#d-summary').innerHTML = `<label class="selall"><input type="checkbox" class="cbx" id="d-all"${sel.length && sel.length === ok.length ? ' checked' : ''}> Select all</label>` +
    `<span class="pill"><b>${fmtN(D.list.length)}</b> draft${D.list.length === 1 ? '' : 's'} in ${esc(D.folder)}</span>` +
    `<span class="pill"><b>${fmtN(sel.length)}</b> selected, ${fmtN(rcpts)} recipient${rcpts === 1 ? '' : 's'}</span>` +
    (flagged ? `<span class="pill bad"><b>${flagged}</b> without a recipient, will be skipped</span>` : '') + (D.loading ? '<span class="pill">Refreshing...</span>' : '');
  const all = $('#d-all'); if (all) all.indeterminate = sel.length > 0 && sel.length < ok.length;
  $('#d-list').innerHTML = D.list.map(d => {
    const flag = !d.recipients.length || d.unreadable;
    const first = [...d.to, ...d.cc, ...d.bcc][0];
    const more = d.recipients.length - 1;
    const who = first ? `${esc(addrShort(first))}${more > 0 ? ` <small>+${more}</small>` : ''}` : '<span style="color:var(--fail)">No recipient</span>';
    const tags = [];
    if (flag) tags.push(`<span class="tag bad">${d.unreadable ? 'Could not be read' : 'No recipient, will be skipped'}</span>`);
    if (d.cc.length) tags.push(`<span class="tag cc">Cc ${d.cc.length}</span>`);
    if (d.bcc.length) tags.push(`<span class="tag cc">Bcc ${d.bcc.length}</span>`);
    d.attachments.forEach(a => tags.push(`<span class="tag">${esc(a.filename)} &middot; ${fmtSize(a.size)}</span>`));
    return `<div class="drow${D.focus === d.uid ? ' focus' : ''}${flag ? ' flag' : ''}" data-uid="${d.uid}">
      <input type="checkbox" class="cbx" data-sel="${d.uid}"${D.sel.has(d.uid) && !flag ? ' checked' : ''}${flag ? ' disabled' : ''} aria-label="Select draft">
      <div style="min-width:0"><div class="who">${who}</div><div class="subj">${d.subject ? esc(d.subject) : '<span style="color:var(--ink-3)">(no subject)</span>'}</div><div class="snip">${esc(d.snippet) || '&nbsp;'}</div>${tags.length ? `<div class="tags">${tags.join('')}</div>` : ''}</div>
      <div class="meta"><span>${fmtWhen(d.date)}</span></div></div>`;
  }).join('');
  renderDraftPreview();
  sendBtn.disabled = !sel.length;
  sendBtn.textContent = sel.length ? `Send ${fmtN(sel.length)} draft${sel.length === 1 ? '' : 's'}` : 'Send selected';
}
function renderDraftPreview() {
  const d = D.list.find(x => x.uid === D.focus), el = $('#d-pv');
  if (!d) { el.innerHTML = ''; return; }
  const line = l => l.length ? l.map(a => a.name ? `${esc(a.name)} <span style="color:#9A8F83">&lt;${esc(a.address)}&gt;</span>` : esc(a.address)).join(', ') : '';
  const rows = [['From', d.from ? line([d.from]) : fromLine()], ['To', line(d.to) || '<span class="miss">none</span>']];
  if (d.cc.length) rows.push(['Cc', line(d.cc)]);
  if (d.bcc.length) rows.push(['Bcc', line(d.bcc)]);
  rows.push(['Subject', `<span class="pv-subj">${esc(d.subject) || '<span class="ph">(no subject)</span>'}</span>`]);
  el.innerHTML = `<div class="stamp" aria-hidden="true"><div class="stamp-in">DRAFT</div></div><dl class="hdrs">${rows.map(r => `<dt>${r[0]}</dt><dd>${r[1]}</dd>`).join('')}</dl>
    <div class="pv-body">${esc(d.text || '') || '<span class="ph">(empty body)</span>'}</div>
    ${d.attachments.length ? `<div class="pv-attach">${d.attachments.map(a => `<span>Attached: ${esc(a.filename)}</span>`).join('')}</div>` : ''}
    ${d.hasHtml ? '<div class="htmlnote">Formatted version included. It is sent exactly as written, this preview shows the plain text.</div>' : ''}`;
}
$('#d-list').addEventListener('click', e => {
  const cb = e.target.closest('[data-sel]');
  if (cb) { const u = Number(cb.dataset.sel); cb.checked ? D.sel.add(u) : D.sel.delete(u); renderDrafts(); return; }
  const row = e.target.closest('.drow[data-uid]'); if (!row) return;
  D.focus = Number(row.dataset.uid); $$('.drow').forEach(r => r.classList.toggle('focus', r === row)); renderDraftPreview();
});
$('#d-summary').addEventListener('change', e => { if (e.target.id === 'd-all') { D.sel = e.target.checked ? new Set(sendableDrafts().map(d => d.uid)) : new Set(); renderDrafts(); } });
$('#d-state').addEventListener('click', e => { const a = e.target.closest('[data-go]'); if (a) go(a.dataset.go); });
$('#d-refresh').addEventListener('click', () => loadDrafts());
$('#d-send').addEventListener('click', () => { S.source = 'drafts'; go('send'); });

/* ---------------- send setup ---------------- */
function intervalMs() { return Math.max(1, Number(S.send.every) || 1) * (S.send.unit === 'min' ? 60000 : 1000); }
function fmtDur(ms) {
  const m = Math.round(ms / 60000);
  if (ms < 60000) return Math.max(1, Math.round(ms / 1000)) + ' seconds';
  if (m < 60) return m + (m === 1 ? ' minute' : ' minutes');
  const h = Math.floor(m / 60), r = m % 60;
  return h + (h === 1 ? ' hour' : ' hours') + (r ? ' ' + r + ' min' : '');
}
function renderModes() {
  $$('.mode').forEach(m => { m.classList.toggle('on', m.dataset.mode === S.send.mode); m.querySelector('input').checked = m.dataset.mode === S.send.mode; });
  $('#s-every').value = S.send.every; $('#s-unit').value = S.send.unit; $('#s-jitter').value = S.send.jitter;
}
$$('.mode').forEach(m => m.addEventListener('click', e => { if (e.target.closest('input[type=number],select')) { S.send.mode = m.dataset.mode; } else S.send.mode = m.dataset.mode; persist(); renderModes(); renderSetupInfo(); }));
['#s-every', '#s-unit', '#s-jitter'].forEach(s => $(s).addEventListener('input', () => {
  S.send.every = Math.max(1, Number($('#s-every').value) || 1); S.send.unit = $('#s-unit').value;
  S.send.jitter = Math.min(90, Math.max(0, Number($('#s-jitter').value) || 0)); persist(); renderSetupInfo();
}));

$$('#s-source button').forEach(b => b.addEventListener('click', () => { S.source = b.dataset.source; renderSetupInfo(); if (S.source === 'drafts' && (D.stale || !D.loaded)) loadDrafts().then(renderSetupInfo); }));
function draftChecks() {
  const a = S.account, sel = selectedDrafts(), flagged = D.list.length - sendableDrafts().length, rc = sel.reduce((n, d) => n + d.recipients.length, 0);
  const c = [];
  c.push(a && a.hasPassword ? { k: 'ok', t: 'Account connected', d: (a.fromName ? a.fromName + ', ' : '') + (a.alias || a.email || a.user) } : { k: 'no', t: 'No account connected', d: '<a href="#" data-go="account">Connect one</a>', html: true });
  if (!D.loaded) c.push({ k: 'no', t: 'Drafts not loaded', d: '<a href="#" data-go="drafts">Open the Drafts tab</a>', html: true });
  else c.push(sel.length ? { k: 'ok', t: `${fmtN(sel.length)} draft${sel.length === 1 ? '' : 's'} selected`, d: `${fmtN(rc)} recipient${rc === 1 ? '' : 's'} across To, Cc and Bcc` } : { k: 'no', t: 'No drafts selected', d: '<a href="#" data-go="drafts">Pick some on the Drafts tab</a>', html: true });
  if (flagged) c.push({ k: 'warn', t: `${flagged} draft${flagged === 1 ? '' : 's'} without a recipient`, d: 'Left in your Drafts folder, not sent' });
  c.push({ k: 'ok', t: 'Sent as written', d: 'Subject, body, formatting and attachments come straight from each draft' });
  c.push({ k: 'ok', t: S.settings.delDraft ? 'Drafts are removed after sending' : 'Drafts are kept after sending', d: D.gmail ? 'Gmail files a copy in Sent by itself' : (S.settings.saveSent && D.sentFolder ? `A copy is saved to ${D.sentFolder}` : 'No copy is saved to Sent') });
  return c;
}
function checks() {
  if (S.source === 'drafts') return draftChecks();
  const a = S.account, list = validRecipients(), miss = missingCount(), atts = S.draft.attachments || [];
  const size = atts.reduce((t, x) => t + (x.size || 0), 0);
  const c = [];
  c.push(a && a.hasPassword ? { k: 'ok', t: 'Account connected', d: (a.fromName ? a.fromName + ', ' : '') + (a.alias || a.email || a.user) } : { k: 'no', t: 'No account connected', d: '<a href="#" data-go="account">Connect one</a>', html: true });
  c.push(list.length ? { k: S.invalid ? 'warn' : 'ok', t: `${fmtN(list.length)} recipient${list.length === 1 ? '' : 's'}`, d: S.invalid ? `${S.invalid} invalid address${S.invalid === 1 ? '' : 'es'} will be skipped` : 'All addresses look valid' } : { k: 'no', t: 'No recipients', d: '<a href="#" data-go="recipients">Add some</a>', html: true });
  c.push(S.draft.subject.trim() && S.draft.body.trim() ? { k: 'ok', t: 'Letter written', d: esc(S.draft.subject.slice(0, 70)), html: true } : { k: 'no', t: 'Letter not finished', d: '<a href="#" data-go="letter">Add a subject and body</a>', html: true });
  if (list.length && (S.draft.subject || S.draft.body)) c.push(miss ? { k: 'warn', t: `${miss} letter${miss === 1 ? '' : 's'} with blank fields`, d: '<a href="#" data-go="letter">Review in the preview</a>', html: true } : { k: 'ok', t: 'Every merge field fills in', d: 'Checked against each recipient' });
  if (atts.length) c.push(atts.some(x => x.missing) ? { k: 'no', t: 'An attachment is missing', d: 'Re-attach it on the Letter tab' } : { k: size > 20 * 1048576 ? 'warn' : 'ok', t: `${atts.length} attachment${atts.length === 1 ? '' : 's'}, ${fmtSize(size)}`, d: size > 20 * 1048576 ? 'Large files may be rejected. Gmail allows up to 25 MB per message.' : atts.map(x => esc(x.name)).join(', '), html: true });
  c.push(S.testedThisSession ? { k: 'ok', t: 'Test sent to yourself', d: 'Check how it looks in your inbox' } : { k: 'warn', t: 'No test sent yet', d: 'Optional, and worth a look before a big list' });
  return c;
}
function renderSetupInfo() {
  const cs = checks();
  $('#s-checks').innerHTML = cs.map(x => `<div class="chk ${x.k}"><span class="mk">${x.k === 'ok' ? ICON_OK : x.k === 'no' ? ICON_NO : ICON_WARN}</span><div><b>${esc(x.t)}</b><small>${x.html ? x.d : esc(x.d)}</small></div></div>`).join('');
  $$('#s-source button').forEach(b => b.classList.toggle('on', b.dataset.source === S.source));
  $('#s-test').classList.toggle('hidden', S.source === 'drafts');
  const isD = S.source === 'drafts', sel = isD ? selectedDrafts() : null;
  const n = isD ? sel.length : validRecipients().length, cap = Number(S.settings.cap) || 0, left = cap ? Math.max(0, cap - S.usage.count) : Infinity;
  const rc = isD ? sel.reduce((t, d) => t + d.recipients.length, 0) : n;
  const pace = S.send.mode === 'burst' ? 'All at once' : `One every ${S.send.every} ${S.send.unit === 'min' ? (S.send.every == 1 ? 'minute' : 'minutes') : (S.send.every == 1 ? 'second' : 'seconds')}${S.send.jitter ? `, varied by up to ${S.send.jitter}%` : ''}`;
  const est = S.send.mode === 'burst' ? 'Depends on your server, usually a second or two each' : n > 1 ? 'About ' + fmtDur((Math.min(n, left) - 1) * intervalMs()) : 'Immediate';
  $('#s-glance').innerHTML = (isD ? `<dt>Drafts</dt><dd>${fmtN(n)}</dd>` : '') + `<dt>Recipients</dt><dd>${fmtN(rc)}</dd><dt>Pace</dt><dd>${esc(pace)}</dd><dt>Time to finish</dt><dd>${esc(est)}</dd><dt>Cap room</dt><dd>${cap ? `${fmtN(left)} of ${fmtN(cap)} left in the last 24 hours` : 'No cap set'}</dd>`;
  $('#s-capwarn').innerHTML = cap && rc > left ? `<div>Your daily cap leaves room for ${fmtN(left)} more. Sending will pause after that, and you can resume once the 24 hour window frees up.</div>` : '';
  const blockers = cs.filter(x => x.k === 'no').length;
  $('#s-start').disabled = blockers > 0 || n === 0;
  $('#s-start').textContent = n ? `Send ${fmtN(n)} ${isD ? (n === 1 ? 'draft' : 'drafts') : (n === 1 ? 'email' : 'emails')}` : 'Start sending';
}
$('#s-checks').addEventListener('click', e => { const a = e.target.closest('[data-go]'); if (a) { e.preventDefault(); go(a.dataset.go); } });

/* ---------------- running ---------------- */
let countTimer = null;
function renderSend() {
  const running = !!S.run;
  $('#s-setup').classList.toggle('hidden', running);
  $('#s-run').classList.toggle('hidden', !running);
  if (!running) {
    $('#s-title').textContent = 'Ready to send'; $('#s-lede').textContent = 'Pick a pace, check the list, then start.';
    ['#s-new', '#s-export', '#s-retry', '#s-cancel', '#s-pause'].forEach(s => $(s).classList.add('hidden'));
    renderModes(); renderSetupInfo(); return;
  }
  renderRunHead(); renderRunTable();
}
function renderRunHead() {
  const r = S.run, st = r.stats, live = ['running', 'waiting', 'paused'].includes(r.state);
  $('#t-sent').textContent = fmtN(st.sent); $('#t-failed').textContent = fmtN(st.failed); $('#t-left').textContent = fmtN(st.queued + st.sending);
  const done = st.sent + st.failed + st.skipped;
  $('#t-bar').style.width = (st.total ? done / st.total * 100 : 0) + '%';
  const titles = { running: 'Sending', waiting: 'Sending', paused: 'Paused', done: 'All done', cancelled: 'Stopped' };
  $('#s-title').textContent = (titles[r.state] || 'Sending') + (r.batchName ? `: ${r.batchName}` : '');
  $('#s-lede').textContent = r.state === 'done' ? `${fmtN(st.sent)} sent${st.failed ? `, ${fmtN(st.failed)} failed` : ''}. Export the results to keep a record.` : r.state === 'cancelled' ? 'Stopped early. Anything already sent stays sent.' : r.state === 'paused' ? 'Nothing goes out while paused. Resume when you are ready.' : r.mode === 'burst' ? `Sending ${S.runSource === 'drafts' ? 'your drafts ' : ''}back to back. Keep Letterhead open until it finishes.` : 'Sending on your interval. Keep Letterhead open while it runs.';
  const stEl = $('#t-status');
  stEl.className = 'run-status' + (r.state === 'paused' ? ' paused' : '');
  stEl.textContent = r.state === 'paused' ? (r.pauseReason && r.pauseReason !== 'user' ? r.pauseReason : 'Paused. Nothing goes out until you resume.') : r.state === 'running' ? 'Handing the next letter to the server...' : r.state === 'waiting' ? 'Waiting for the next slot.' : `${fmtN(done)} of ${fmtN(st.total)} handled.`;
  $('#s-pause').classList.toggle('hidden', !live);
  $('#s-pause').textContent = r.state === 'paused' ? 'Resume' : 'Pause';
  $('#s-cancel').classList.toggle('hidden', !live);
  $('#s-retry').classList.toggle('hidden', !(st.failed + st.skipped) || (live && r.state !== 'paused'));
  $('#s-export').classList.toggle('hidden', false);
  $('#s-new').classList.toggle('hidden', live);
  $('#nav-send-pulse').classList.toggle('on', r.state === 'running' || r.state === 'waiting');
  // stamps
  const box = $('#t-stamps');
  if (r.items.length <= 160) {
    if (box.childElementCount !== r.items.length) box.innerHTML = r.items.map(() => '<i></i>').join('');
    r.items.forEach((it, i) => { box.children[i].className = it.status; });
    box.classList.remove('hidden');
  } else box.classList.add('hidden');
  tickCountdown();
}
function tickCountdown() {
  const r = S.run, el = $('#t-count');
  if (!r || !r.nextAt || r.state !== 'waiting') { el.classList.add('idle'); $('#t-count-v').textContent = !r ? '' : r.state === 'running' ? 'Now' : r.state === 'paused' ? 'On hold' : r.state === 'done' ? 'Finished' : r.state === 'cancelled' ? 'Stopped' : ''; return; }
  el.classList.remove('idle');
  const s = Math.max(0, Math.ceil((r.nextAt - Date.now()) / 1000));
  $('#t-count-v').textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
const fmtTime = t => t ? new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '';
function rowHtml(it) {
  const name = it.fields.first_name || it.fields.name ? esc([it.fields.first_name || it.fields.name, it.fields.first_name ? it.fields.last_name : ''].filter(Boolean).join(' ')) : '';
  const label = { queued: 'Waiting', sending: 'Sending', sent: 'Sent', failed: 'Failed', skipped: 'Skipped' }[it.status];
  const second = S.runSource === 'drafts' ? esc(it.fields.subject || '') : name;
  return `<td class="n">${it.id + 1}</td><td class="rcpt">${esc(it.email)}${it.error ? `<span class="sub-err">${esc(it.error)}</span>` : ''}${it.note && !it.error ? `<span class="sub-note">${esc(it.note.charAt(0).toUpperCase() + it.note.slice(1))}</span>` : ''}</td><td class="${S.runSource === 'drafts' ? 'rcpt' : ''}">${second}</td><td><span class="st ${it.status}">${label}</span></td><td class="time">${fmtTime(it.sentAt)}</td>`;
}
function renderRunTable() {
  const items = S.run.items;
  $('#t-table').innerHTML = `<table><thead><tr><th></th><th>Recipient</th><th>${S.runSource === 'drafts' ? 'Draft' : 'Name'}</th><th>Status</th><th>Sent at</th></tr></thead><tbody>` +
    items.map(it => `<tr id="row-${it.id}">${rowHtml(it)}</tr>`).join('') + '</tbody></table>';
}
function addLog(l) {
  const b = $('#t-log'); const d = document.createElement('div'); d.className = l.kind;
  d.innerHTML = `<time>${new Date(l.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</time><span>${l.email ? `<b>${esc(l.email)}</b> ` : ''}${esc(l.text)}</span>`;
  const stick = b.scrollTop + b.clientHeight >= b.scrollHeight - 20;
  b.appendChild(d); if (stick) b.scrollTop = b.scrollHeight;
}
lh.on('campaign:update', u => {
  const live = ['running', 'waiting', 'paused'].includes(u.state);
  if (!S.run || (live && (u.batchId || null) !== (S.run.batchId || null))) {
    // a batch started in the background, or a new one took over: load it into the Send view
    if (S._loadingRun) return; S._loadingRun = true;
    lh.campaign.snapshot().then(s => { S._loadingRun = false; if (!s) return; S.run = s; S.runSource = s.source; S._notified = !!s.batchId; $('#t-log').innerHTML = ''; if (S.tab === 'send') renderSend(); $('#nav-send-pulse').classList.toggle('on', s.state === 'running' || s.state === 'waiting'); });
    return;
  }
  Object.assign(S.run, { state: u.state, pauseReason: u.pauseReason, nextAt: u.nextAt, stats: u.stats });
  if (u.item) { S.run.items[u.item.id] = u.item; const row = document.getElementById('row-' + u.item.id); if (row) row.innerHTML = rowHtml(u.item); if (u.item.status === 'sending' && row) { const w = row.closest('.table-wrap'), top = row.offsetTop - 34, bot = row.offsetTop + row.offsetHeight; if (top < w.scrollTop || bot > w.scrollTop + w.clientHeight) w.scrollTop = Math.max(0, top - w.clientHeight / 2); } }
  else if (S.run.items.some(i => i.status === 'queued') && S.tab === 'send') { /* retry may change many rows */ lh.campaign.snapshot().then(s => { if (s) { S.run = s; renderRunTable(); renderRunHead(); } }); }
  if (S.tab === 'send') renderRunHead(); else $('#nav-send-pulse').classList.toggle('on', u.state === 'running' || u.state === 'waiting');
  if (u.item && u.item.status === 'sent') refreshUsage();
  if ((u.state === 'done' || u.state === 'cancelled') && S.runSource === 'drafts') { D.stale = true; }
  if (u.state === 'done' && !S._notified && !u.batchId) { S._notified = true; new Notification('Letterhead', { body: `Finished. ${u.stats.sent} sent, ${u.stats.failed} failed.`, silent: true }); }
});
lh.on('campaign:log', addLog);
setInterval(() => { if (S.run && S.tab === 'send') tickCountdown(); }, 250);

$('#s-start').addEventListener('click', async () => {
  const isD = S.source === 'drafts';
  const list = isD ? selectedDrafts() : validRecipients();
  if (!list.length) return;
  const pace = S.send.mode === 'burst' ? 'all at once' : `one every ${S.send.every} ${S.send.unit === 'min' ? 'min' : 'sec'}`;
  const what = isD ? `${list.length} draft${list.length === 1 ? '' : 's'}` : `${list.length} email${list.length === 1 ? '' : 's'}`;
  if (!confirm(`Send ${what} from ${S.account.alias || S.account.email || S.account.user}, ${pace}?${isD && S.settings.delDraft ? ' Each draft is removed after it sends.' : ''}`)) return;
  const base = { mode: S.send.mode, intervalMs: intervalMs(), jitterPct: S.send.jitter, dailyCap: Number(S.settings.cap) || 0 };
  const cfg = isD
    ? { ...base, source: 'drafts', recipients: list.map(d => ({ email: d.recipients[0] + (d.recipients.length > 1 ? ` +${d.recipients.length - 1}` : ''), fields: { subject: d.subject }, meta: { uid: d.uid, recipients: d.recipients } })),
        draftsCfg: { folder: D.folder, sentFolder: D.sentFolder, gmail: D.gmail, deleteDraft: !!S.settings.delDraft, saveSent: !!S.settings.saveSent } }
    : { ...base, template: tplForSend(), recipients: list.map(r => ({ email: r.email, fields: r.fields })) };
  S.runSource = isD ? 'drafts' : 'merge';
  const r = await lh.campaign.start(cfg);
  if (!r.ok) return toast(r.error, true);
  S.run = r.snapshot; S._notified = false; $('#t-log').innerHTML = '';
  renderSend();
});
$('#s-pause').addEventListener('click', togglePause);
async function togglePause() { if (!S.run) return; if (S.run.state === 'paused') await lh.campaign.resume(); else if (['running', 'waiting'].includes(S.run.state)) await lh.campaign.pause(); }
$('#s-cancel').addEventListener('click', async () => { if (confirm('Stop sending? Letters already sent cannot be recalled.')) await lh.campaign.cancel(); });
async function retry() { if (!S.run) return; const n = await lh.campaign.retry(); if (!n) toast('Nothing to retry.'); S._notified = false; const s = await lh.campaign.snapshot(); if (s) { S.run = s; renderRunTable(); renderRunHead(); } }
$('#s-retry').addEventListener('click', retry);
async function exportCsv() { const p = await lh.campaign.exportCsv(); if (p) toast('Saved ' + p.split('/').pop()); else if (!S.run) toast('Nothing to export yet. Results appear after a send.'); }
$('#s-export').addEventListener('click', exportCsv);
$('#s-new').addEventListener('click', async () => { if (await lh.campaign.clear()) { S.run = null; renderSend(); } });

/* ---------------- settings ---------------- */
function renderSettings() {
  if ($('#d-where') && S.info) $('#d-where').textContent = (S.info.appPath ? `Installed at ${S.info.appPath}. ` : '') + 'Letterhead keeps a log of errors on this Mac. Nothing is sent anywhere.';
  renderUpdate();
  $('#set-cap').value = S.settings.cap; $('#set-delDraft').checked = !!S.settings.delDraft; $('#set-saveSent').checked = !!S.settings.saveSent;
  const u = S.usage, frees = u.oldest ? new Date(u.oldest + 86400000) : null;
  $('#set-usage').innerHTML = `<b>${fmtN(u.count)}</b> sent from Letterhead in the last 24 hours.` + (frees ? ` The oldest of those drops off the count at ${frees.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.` : '');
}
$$('[data-cap]').forEach(b => b.addEventListener('click', () => { $('#set-cap').value = b.dataset.cap; }));
$('#set-save').addEventListener('click', async () => { S.settings.cap = Math.max(0, Number($('#set-cap').value) || 0); S.settings.delDraft = $('#set-delDraft').checked; S.settings.saveSent = $('#set-saveSent').checked; await lh.settings.save(S.settings); renderMeter(); toast('Settings saved'); });
$('#set-reset').addEventListener('click', async () => { if (!confirm('Reset the 24 hour counter? This does not change what your provider counts.')) return; S.usage = await lh.usage.reset(); renderMeter(); renderSettings(); });


/* ---------------- time zones ---------------- */
const pad2 = n => String(n).padStart(2, '0');
const SYS_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago';
function tzParts(t, tz) {
  const p = {}; new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' }).formatToParts(new Date(t)).forEach(x => { p[x.type] = x.value; });
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second, wd: p.weekday };
}
function tzOffset(t, tz) { const p = tzParts(t, tz); return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(t / 1000) * 1000; }
function zonedToEpoch(date, time, tz) {
  const [y, m, d] = String(date).split('-').map(Number), [h, mi] = String(time).split(':').map(Number);
  if (!y || !m || !d || isNaN(h) || isNaN(mi)) return NaN;
  const g = Date.UTC(y, m - 1, d, h, mi); let t = g - tzOffset(g, tz); t = g - tzOffset(t, tz); return t;
}
function epochToZoned(t, tz) { const p = tzParts(t, tz); return { date: `${p.y}-${pad2(p.m)}-${pad2(p.d)}`, time: `${pad2(p.h)}:${pad2(p.mi)}`, wd: p.wd }; }
const addDays = (date, n) => { const [y, m, d] = date.split('-').map(Number); const x = new Date(Date.UTC(y, m - 1, d + n)); return `${x.getUTCFullYear()}-${pad2(x.getUTCMonth() + 1)}-${pad2(x.getUTCDate())}`; };
const tzAbbr = (t, tz) => (new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date(t)).find(x => x.type === 'timeZoneName') || {}).value || tz;
const tzLong = (t, tz) => (new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longGeneric' }).formatToParts(new Date(t)).find(x => x.type === 'timeZoneName') || {}).value || tz;
function fmtAt(t, tz, withZone) {
  tz = tz || SYS_TZ;
  const s = new Date(t).toLocaleString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return withZone || tz !== SYS_TZ ? `${s} ${tzAbbr(t, tz)}` : s;
}
const fmtClock = (t, tz) => new Date(t).toLocaleTimeString('en-US', { timeZone: tz || SYS_TZ, hour: 'numeric', minute: '2-digit' });
function fmtUntil(ms) {
  if (ms <= 0) return 'now';
  const s = Math.ceil(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d >= 1) return `in ${d} d ${h % 24} h`;
  if (h >= 1) return `in ${h} h ${pad2(m % 60)} min`;
  if (m >= 1) return `in ${m} min ${pad2(s % 60)} s`;
  return `in ${s} s`;
}
const TZ_CHOICES = () => [...new Set([SYS_TZ, 'America/Chicago', 'America/New_York', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu', 'Europe/London', 'Europe/Paris', 'Asia/Kolkata', 'Asia/Shanghai', 'Asia/Tokyo', 'Australia/Sydney', 'UTC'])];

/* ---------------- schedule ---------------- */
S.batches = []; S.missed = new Set(); S.power = null; S.upd = null; S.info = {};
const KIND_ICON = { merge: '<svg viewBox="0 0 16 16"><path d="M3 4.5h10v7H3z"/><path d="m3 4.5 5 4 5-4"/></svg>', drafts: '<svg viewBox="0 0 16 16"><path d="M3 6h10v6.5H3zM3 6l2-2.5h6L13 6"/></svg>' };
const paceText = b => b.mode === 'burst' ? 'All at once' : `One every ${fmtDur(b.intervalMs).replace(/^1 (minute|second)$/, '$1').replace(/^(\d+) seconds$/, '$1 s').replace(/^(\d+) minutes$/, '$1 min')}${b.jitterPct ? `, ±${b.jitterPct}%` : ''}`;
const STATUS_LABEL = { scheduled: 'Scheduled', queued: 'Up next', sending: 'Sending', paused: 'Paused', missed: 'Missed', done: 'Done', failed: 'Failed', cancelled: 'Cancelled' };
function batchCount(b) { const n = b.stats ? b.stats.total : 0; return `${fmtN(n)} ${b.kind === 'drafts' ? (n === 1 ? 'draft' : 'drafts') : (n === 1 ? 'email' : 'emails')}`; }
function missedText(b) {
  const at = fmtAt(b.scheduledAt, b.tz);
  if (b.missedReason === 'interrupted') { const s = b.stats || {}; return `Letterhead stopped partway through. ${fmtN(s.sent || 0)} of ${fmtN(s.total || 0)} sent.`; }
  if (b.missedReason === 'asleep') return `Your Mac was asleep at ${at}.`;
  return `Letterhead was not open at ${at}.`;
}
function renderNavSched() {
  const n = S.batches.filter(b => ['scheduled', 'queued', 'sending', 'paused', 'missed'].includes(b.status)).length;
  $('#nav-sched-count').textContent = n ? fmtN(n) : '';
}
function batchHtml(b) {
  const tz = b.tz || SYS_TZ, z = tzParts(b.scheduledAt, tz), st = b.stats || { total: 0 };
  const fin = ['done', 'failed', 'cancelled'].includes(b.status), live = ['sending', 'paused'].includes(b.status);
  const month = new Date(b.scheduledAt).toLocaleString('en-US', { timeZone: tz, month: 'short' });
  let sub = '', subK = '', right = '';
  const handled = (st.sent || 0) + (st.failed || 0) + (st.skipped || 0);
  if (b.status === 'scheduled') { right = `<div class="b-count" data-until="${b.scheduledAt}">${fmtUntil(b.scheduledAt - Date.now())}</div>`; sub = `Starts ${fmtAt(b.scheduledAt, tz)}${tz !== SYS_TZ ? `, which is ${fmtClock(b.scheduledAt, SYS_TZ)} ${tzAbbr(b.scheduledAt, SYS_TZ)} here` : ''}`; }
  else if (b.status === 'queued') sub = b.queueAhead ? `Starts as soon as ${esc(b.queueAhead)} finishes` : 'Starting…';
  else if (b.status === 'sending') { right = `<div class="b-count">${fmtN(st.sent || 0)}<small>of ${fmtN(st.total)} sent</small></div>`; sub = b.nextAt && b.nextAt > Date.now() ? `Next email <span data-until="${b.nextAt}">${fmtUntil(b.nextAt - Date.now())}</span>` : 'Sending now'; }
  else if (b.status === 'paused') { right = `<div class="b-count">${fmtN(st.sent || 0)}<small>of ${fmtN(st.total)} sent</small></div>`; sub = b.pauseReason && b.pauseReason !== 'user' ? esc(b.pauseReason) : 'Paused. Nothing goes out until you resume.'; subK = 'warn'; }
  else if (b.status === 'missed') { sub = esc(missedText(b)) + ' Nothing was sent on its own.'; subK = 'warn'; }
  else if (b.status === 'done') sub = `${fmtN(st.sent || 0)} sent${st.failed ? `, ${fmtN(st.failed)} failed` : ''}${st.skipped ? `, ${fmtN(st.skipped)} skipped` : ''}. Finished ${b.finishedAt ? fmtAt(b.finishedAt) : ''}`;
  else if (b.status === 'failed') { sub = esc(b.lastError || `${fmtN(st.failed || 0)} failed, none sent.`); subK = 'bad'; }
  else if (b.status === 'cancelled') sub = handled ? `Stopped after ${fmtN(st.sent || 0)} sent.` : 'Cancelled before it started.';
  const A = (act, label, cls = 'ghost') => `<button class="${cls}" data-bact="${act}" data-id="${b.id}">${label}</button>`;
  const acts = [];
  if (b.status === 'scheduled' || b.status === 'queued') acts.push(A('edit', 'Edit'), A('dup', 'Duplicate'), A('now', 'Send now'), A('cancel', 'Cancel'));
  if (b.status === 'sending') acts.push(A('view', 'View'), A('pause', 'Pause'), A('cancel', 'Cancel'));
  if (b.status === 'paused') acts.push(A('view', 'View'), A('resume', 'Resume', 'secondary'), A('cancel', 'Cancel'));
  if (b.status === 'missed') acts.push(A('cancel', 'Cancel'), A('edit', 'Reschedule'), A('now', b.missedReason === 'interrupted' ? 'Resume now' : 'Send now', 'secondary'));
  if (fin) { if (b.items || handled) acts.push(A('export', 'Export')); if ((st.failed || 0) + (st.skipped || 0) && b.status !== 'cancelled') acts.push(A('retry', 'Retry failed')); acts.push(A('dup', 'Duplicate'), A('edit', b.status === 'cancelled' ? 'Schedule again' : 'Reschedule'), A('del', 'Delete')); }
  const bar = live || (fin && st.total) ? `<div class="b-bar"><i style="width:${st.total ? handled / st.total * 100 : 0}%"></i></div>` : '';
  return `<div class="card batch ${live ? 'live' : ''} ${b.status === 'missed' ? 'missed' : ''} ${fin ? 'finished' : ''}" id="batch-${b.id}">
    <div class="cal"><span class="m">${esc(month)}</span><span class="d">${z.d}</span><span class="t">${esc(fmtClock(b.scheduledAt, tz))}</span></div>
    <div class="b-main"><div class="b-name">${esc(b.name)} <span class="bp ${b.status}">${STATUS_LABEL[b.status] || b.status}</span></div>
      <div class="b-meta"><span>${b.kind === 'drafts' ? 'Drafts' : 'Mail merge'}</span><span class="sep">/</span><span>${batchCount(b)}</span><span class="sep">/</span><span>${esc(paceText(b))}</span>${tz !== SYS_TZ ? `<span class="sep">/</span><span>${esc(tzAbbr(b.scheduledAt, tz))}</span>` : ''}</div>
      <div class="b-sub ${subK}">${sub}</div>${bar}
      <div class="b-acts">${acts.join('')}</div></div>
    <div class="b-right">${right}</div></div>`;
}
function renderSchedule() {
  renderNavSched(); renderAwake();
  const box = $('#b-list'); if (!box) return;
  const order = { sending: 0, paused: 0, queued: 1, missed: 2, scheduled: 3 };
  const upcoming = S.batches.filter(b => b.status in order).sort((a, b) => order[a.status] - order[b.status] || a.scheduledAt - b.scheduledAt);
  const past = S.batches.filter(b => !(b.status in order)).sort((a, b) => (b.finishedAt || b.scheduledAt) - (a.finishedAt || a.scheduledAt));
  if (!S.batches.length) {
    box.innerHTML = `<div class="card b-empty"><svg viewBox="0 0 64 64"><rect x="10" y="14" width="44" height="40" rx="5"/><path d="M10 25h44M21 9v9M43 9v9"/><path d="M22 38l8 5 13-11" stroke-linecap="round" stroke-linejoin="round"/></svg><h3>Nothing scheduled yet</h3><p>Set up a list and letter, or pick drafts, then schedule them as a batch. Make as many as you like, each with its own day and time.</p><button class="primary" data-bact="new">New batch</button></div>`;
    return;
  }
  box.innerHTML = (upcoming.length ? `<div class="b-group">Upcoming</div>` + upcoming.map(batchHtml).join('') : '') + (past.length ? `<div class="b-group">Finished</div>` + past.map(batchHtml).join('') : '');
}
function tickSchedule() {
  $$('[data-until]').forEach(el => { const t = Number(el.dataset.until); el.textContent = fmtUntil(t - Date.now()); });
}
setInterval(() => { if (S.tab === 'schedule') tickSchedule(); }, 1000);
lh.on('batches:update', list => { S.batches = list; if (S.tab === 'schedule') renderSchedule(); else renderNavSched(); renderMissed(); refreshUsage(); });
$('#view-schedule').addEventListener('click', async e => {
  const btn = e.target.closest('[data-bact]'); if (!btn) return;
  const id = btn.dataset.id, act = btn.dataset.bact, b = S.batches.find(x => x.id === id);
  const show = r => { if (r && r.ok === false) toast(r.error, true); return r; };
  if (act === 'new') return openEditor();
  if (act === 'edit') return openEditor(id);
  if (act === 'dup') { const r = show(await lh.batches.duplicate(id)); if (r.ok) { toast('Duplicated. Set its time, then save.'); openEditor(r.value.id); } return; }
  if (act === 'now') { if (!confirm(`Start "${b.name}" now? ${batchCount(b)}, ${paceText(b).toLowerCase()}.`)) return; show(await lh.batches.sendNow(id)); return; }
  if (act === 'cancel') { if (!confirm(b.status === 'sending' || b.status === 'paused' ? `Stop "${b.name}"? Letters already sent cannot be recalled.` : `Cancel "${b.name}"? It stays in the list so you can schedule it again.`)) return; show(await lh.batches.cancel(id)); return; }
  if (act === 'pause') return show(await lh.batches.pause(id));
  if (act === 'resume') return show(await lh.batches.resume(id));
  if (act === 'view') return go('send');
  if (act === 'retry') { const r = show(await lh.batches.retry(id)); if (r.ok) toast(r.value ? `${r.value} queued again` : 'Nothing to retry.'); return; }
  if (act === 'export') { const p = await lh.batches.exportCsv(id); if (p) toast('Saved ' + p.split('/').pop()); return; }
  if (act === 'del') { if (!confirm(`Delete "${b.name}" from the list? Its results go with it.`)) return; show(await lh.batches.remove(id)); }
});
$('#b-new').addEventListener('click', () => openEditor());

/* ---------------- batch editor ---------------- */
let E = null;
function snapshotMerge() {
  return { recipients: validRecipients().map(r => ({ email: r.email, fields: r.fields })), columns: S.columns, subject: S.draft.subject, body: S.draft.body, attachments: (S.draft.attachments || []).filter(a => !a.missing).map(a => a.path), sourceName: S.sourceName || '' };
}
function snapshotDrafts() {
  return { folder: D.folder, sentFolder: D.sentFolder, gmail: D.gmail, items: selectedDrafts().map(d => ({ uid: d.uid, messageId: d.messageId, subject: d.subject, recipients: d.recipients })) };
}
function defaultName(kind, content) {
  if (kind === 'drafts') { const n = (content.items || []).length; return n ? `${n} draft${n === 1 ? '' : 's'}` : 'Drafts'; }
  const src = (content.sourceName || '').replace(/\.(csv|tsv|txt)$/i, '').replace(/[_-]+/g, ' ').trim();
  return src ? src.charAt(0).toUpperCase() + src.slice(1) : 'Mail merge';
}
async function openEditor(id, opts = {}) {
  let b = id ? await lh.batches.get(id) : null;
  const now = Date.now();
  if (b) E = { id: b.id, kind: b.kind, merge: b.merge, drafts: b.drafts, tz: b.tz || SYS_TZ, mode: b.mode, every: b.intervalMs % 60000 === 0 ? b.intervalMs / 60000 : Math.round(b.intervalMs / 1000), unit: b.intervalMs % 60000 === 0 ? 'min' : 'sec', jitter: b.jitterPct, name: b.name, status: b.status, at: b.status === 'scheduled' && b.scheduledAt > now ? b.scheduledAt : null, started: !!(b.items && b.items.some(i => i.status === 'sent')) };
  else {
    const kind = opts.kind || (S.source === 'drafts' && D.loaded && D.sel.size ? 'drafts' : 'merge');
    E = { id: null, kind, merge: snapshotMerge(), drafts: D.loaded ? snapshotDrafts() : null, tz: SYS_TZ, mode: S.send.mode, every: S.send.every, unit: S.send.unit, jitter: S.send.jitter, name: '', at: null };
  }
  const start = E.at || (() => { const z = epochToZoned(now + 86400000, E.tz); return zonedToEpoch(z.date, '08:00', E.tz); })();
  const z = epochToZoned(start, E.tz);
  $('#be-eyebrow').textContent = E.id ? (E.status === 'missed' ? 'Missed batch' : 'Edit batch') : 'New batch';
  $('#be-title').textContent = E.id ? (E.status === 'scheduled' ? 'Change this batch' : 'Pick a new time') : 'Schedule a batch';
  $('#be-save').textContent = E.id ? 'Save batch' : 'Schedule batch';
  $('#be-name').value = E.name; $('#be-name').placeholder = defaultName(E.kind, E.kind === 'drafts' ? E.drafts || {} : E.merge || {});
  $('#be-tz').innerHTML = TZ_CHOICES().map(tz => `<option value="${tz}">${esc(tzLong(now, tz))}${tz === 'UTC' ? '' : ', ' + esc(tz.split('/').pop().replace(/_/g, ' '))}${tz === SYS_TZ ? ' (this Mac)' : ''}</option>`).join('');
  $('#be-tz').value = E.tz; $('#be-date').value = z.date; $('#be-time').value = z.time;
  $('#be-every').value = E.every; $('#be-unit').value = E.unit; $('#be-jitter').value = E.jitter;
  $('#be-err').classList.add('hidden');
  renderEditor();
  $('#b-veil').classList.remove('hidden');
  setTimeout(() => (E.id ? $('#be-date') : $('#be-name')).focus(), 50);
  if (E.kind === 'drafts' && !E.id && !D.loaded && !D.loading) loadDrafts().then(() => { if (E && !E.id) { E.drafts = snapshotDrafts(); renderEditor(); } });
}
function editorAt() { return zonedToEpoch($('#be-date').value, $('#be-time').value, $('#be-tz').value); }
function editorIntervalMs() { return Math.max(1, Number($('#be-every').value) || 1) * ($('#be-unit').value === 'min' ? 60000 : 1000); }
function renderEditor() {
  if (!E) return;
  $$('#be-kind button').forEach(b => { b.classList.toggle('on', b.dataset.kind === E.kind); b.disabled = !!E.id && b.dataset.kind !== E.kind; });
  $$('#be-mode button').forEach(b => b.classList.toggle('on', b.dataset.mode === E.mode));
  $('#be-int').classList.toggle('hidden', E.mode !== 'interval');
  // what
  let w = '';
  if (E.kind === 'merge') {
    const m = E.merge || {}, n = (m.recipients || []).length, att = (m.attachments || []).length;
    if (!n || !String(m.subject || '').trim() || !String(m.body || '').trim()) w = `<span class="bad">${!n ? 'No recipients yet.' : 'The letter needs a subject and a body.'}</span> Fill in the <a href="#" data-be-go="recipients">Recipients</a> and <a href="#" data-be-go="letter">Letter</a> tabs, then come back.`;
    else w = `<b>${fmtN(n)} recipient${n === 1 ? '' : 's'}</b>${m.sourceName ? ` from ${esc(m.sourceName)}` : ''}, letter <b>${esc(String(m.subject).slice(0, 70))}</b>${att ? `, ${att} attachment${att === 1 ? '' : 's'}` : ''}.<br>${E.id ? 'This is the copy saved with the batch.' : 'A copy of your current list and letter is saved with this batch, so later edits on those tabs do not change it.'}`;
  } else {
    const d = E.drafts || { items: [] }, n = (d.items || []).length, rc = (d.items || []).reduce((t, x) => t + x.recipients.length, 0);
    if (!D.loaded && !E.id && D.loading) w = 'Loading your drafts…';
    else if (!n) w = `<span class="bad">No drafts selected.</span> Pick the drafts for this batch on the <a href="#" data-be-go="drafts">Drafts</a> tab, then come back.`;
    else w = `<b>${fmtN(n)} draft${n === 1 ? '' : 's'}</b> to ${fmtN(rc)} recipient${rc === 1 ? '' : 's'}: ${esc(d.items.slice(0, 3).map(x => x.subject || '(no subject)').join(', '))}${n > 3 ? `, and ${n - 3} more` : ''}.<br>Each one is read fresh from your Drafts folder when it sends, so small edits you make before then go out too.`;
  }
  if (E.id && !E.started && E.status !== 'sending') w += `<div><button type="button" class="ghost sm" id="be-refresh">Replace with what is on the ${E.kind === 'drafts' ? 'Drafts tab' : 'Recipients and Letter tabs'} now</button></div>`;
  $('#be-what').innerHTML = w;
  // chips
  const tz = $('#be-tz').value, now = Date.now(), today = epochToZoned(now, tz).date;
  const chips = [];
  const inHour = Math.ceil((now + 3600000) / 300000) * 300000; chips.push(['In 1 hour', inHour]);
  const tonight = zonedToEpoch(today, '20:00', tz); if (tonight > now + 600000) chips.push(['Tonight, 8:00 PM', tonight]);
  chips.push(['Tomorrow, 8:00 AM', zonedToEpoch(addDays(today, 1), '08:00', tz)]);
  const wdIdx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(epochToZoned(now, tz).wd);
  const toMon = ((8 - wdIdx) % 7) || 7; chips.push(['Monday, 9:00 AM', zonedToEpoch(addDays(today, toMon), '09:00', tz)]);
  $('#be-chips').innerHTML = chips.map(([l, t]) => `<button type="button" data-at="${t}">${l}</button>`).join('');
  // when
  const at = editorAt();
  $('#be-when').innerHTML = isNaN(at) ? 'Pick a date and time.' : at < now - 30000 ? '<span style="color:var(--fail)">That time has already passed.</span>' : `Starts <b>${esc(fmtAt(at, tz, true))}</b>, ${fmtUntil(at - now)}${tz !== SYS_TZ ? `. That is ${esc(fmtAt(at, SYS_TZ, true))} on this Mac.` : '.'}`;
  // estimate
  const n = E.kind === 'drafts' ? ((E.drafts || {}).items || []).length : ((E.merge || {}).recipients || []).length;
  const iv = editorIntervalMs();
  $('#be-est').textContent = !n ? '' : E.mode === 'burst' ? `${fmtN(n)} back to back, usually a second or two each.` : n > 1 ? `About ${fmtDur((n - 1) * iv)} for ${fmtN(n)}${isNaN(at) ? '' : `, done around ${fmtClock(at + (n - 1) * iv, tz)}`}.` : 'Just one, sent at the start time.';
}
$('#b-sheet').addEventListener('click', e => {
  const k = e.target.closest('#be-kind button'); if (k && !k.disabled) { E.kind = k.dataset.kind; if (!E.id) { E.merge = snapshotMerge(); E.drafts = D.loaded ? snapshotDrafts() : null; if (E.kind === 'drafts' && !D.loaded && !D.loading) loadDrafts().then(() => { if (E) { E.drafts = snapshotDrafts(); renderEditor(); } }); } $('#be-name').placeholder = defaultName(E.kind, E.kind === 'drafts' ? E.drafts || {} : E.merge || {}); renderEditor(); return; }
  const m = e.target.closest('#be-mode button'); if (m) { E.mode = m.dataset.mode; renderEditor(); return; }
  const c = e.target.closest('#be-chips button'); if (c) { const z = epochToZoned(Number(c.dataset.at), $('#be-tz').value); $('#be-date').value = z.date; $('#be-time').value = z.time; renderEditor(); return; }
  const g = e.target.closest('[data-be-go]'); if (g) { e.preventDefault(); closeEditor(); go(g.dataset.beGo); return; }
  if (e.target.id === 'be-refresh') { if (E.kind === 'drafts') E.drafts = snapshotDrafts(); else E.merge = snapshotMerge(); renderEditor(); }
});
['#be-date', '#be-time', '#be-every', '#be-unit', '#be-jitter'].forEach(s => $(s).addEventListener('input', renderEditor));
$('#be-tz').addEventListener('change', e => {
  // keep the same wall clock time when switching zones, that is what people usually mean
  renderEditor();
});
function closeEditor() { $('#b-veil').classList.add('hidden'); E = null; }
$('#be-cancel').addEventListener('click', closeEditor);
$('#b-veil').addEventListener('mousedown', e => { if (e.target.id === 'b-veil') closeEditor(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (E) closeEditor(); else if (!$('#m-veil').classList.contains('hidden')) closeMissed(); } });
$('#b-sheet').addEventListener('submit', async e => {
  e.preventDefault();
  const err = t => { $('#be-err').textContent = t; $('#be-err').classList.remove('hidden'); };
  const at = editorAt(), tz = $('#be-tz').value;
  if (isNaN(at)) return err('Pick a date and time.');
  if (at < Date.now() - 30000) return err('That time has already passed. Pick a later one, or use Send now on the Schedule tab.');
  const content = E.kind === 'drafts' ? E.drafts : E.merge;
  if (E.kind === 'merge' && (!content || !content.recipients.length || !String(content.subject || '').trim() || !String(content.body || '').trim())) return err('This batch needs recipients and a finished letter.');
  if (E.kind === 'drafts' && (!content || !content.items.length)) return err('Select at least one draft on the Drafts tab.');
  const r = await lh.batches.save({ id: E.id, name: $('#be-name').value.trim() || $('#be-name').placeholder, kind: E.kind, merge: E.kind === 'merge' ? content : null, drafts: E.kind === 'drafts' ? content : null, scheduledAt: at, tz, mode: E.mode, intervalMs: editorIntervalMs(), jitterPct: Math.min(90, Math.max(0, Number($('#be-jitter').value) || 0)) });
  if (!r.ok) return err(r.error);
  closeEditor(); toast(`Scheduled for ${fmtAt(at, tz)}`);
  S.missed.delete(r.value.id);
  if (S.tab !== 'schedule') go('schedule');
});
$('#s-later').addEventListener('click', () => openEditor(null, { kind: S.source }));

/* ---------------- missed batches ---------------- */
lh.on('batches:missed', ids => { ids.forEach(i => S.missed.add(i)); lh.batches.list().then(l => { S.batches = l; renderSchedule(); renderMissed(true); }); });
function renderMissed(open) {
  const list = S.batches.filter(b => S.missed.has(b.id) && b.status === 'missed');
  if (!list.length) { closeMissed(); return; }
  $('#m-title').textContent = list.length === 1 ? `"${list[0].name}" missed its time` : `${list.length} batches missed their time`;
  $('#m-list').innerHTML = list.map(b => `<div class="m-item"><div><b>${esc(b.name)}</b><small>${esc(missedText(b))} ${batchCount(b)}, ${esc(paceText(b).toLowerCase())}.</small></div><div class="row"><button class="ghost sm" data-mact="cancel" data-id="${b.id}">Cancel batch</button><button class="secondary sm" data-mact="edit" data-id="${b.id}">Reschedule</button><button class="primary sm" data-mact="now" data-id="${b.id}">${b.missedReason === 'interrupted' ? 'Resume now' : 'Send now'}</button></div></div>`).join('');
  if (open) $('#m-veil').classList.remove('hidden');
}
function closeMissed() { $('#m-veil').classList.add('hidden'); }
$('#m-later').addEventListener('click', () => { closeMissed(); S.missed.clear(); go('schedule'); });
$('#m-list').addEventListener('click', async e => {
  const btn = e.target.closest('[data-mact]'); if (!btn) return;
  const id = btn.dataset.id, act = btn.dataset.mact;
  if (act === 'edit') { closeMissed(); go('schedule'); return openEditor(id); }
  const r = act === 'now' ? await lh.batches.sendNow(id) : await lh.batches.cancel(id);
  if (r && r.ok === false) return toast(r.error, true);
  S.missed.delete(id); renderMissed();
  if (act === 'now') toast('Starting now');
});

/* ---------------- keep awake ---------------- */
function renderAwake() {
  const p = S.power || {}, chip = $('#awake-chip');
  const lidOn = p.lid === 'on', stale = p.stale || (p.sleepDisabled && p.lid !== 'on');
  chip.classList.toggle('hidden', !(p.awake || lidOn || stale));
  chip.classList.toggle('lid', lidOn); chip.classList.toggle('warn', !!stale && !lidOn);
  $('#awake-text').textContent = lidOn ? 'Awake with the lid closed' : stale ? 'Sleep is still turned off' : 'Keeping your Mac awake';
  if (!$('#set-keepAwake')) return;
  $('#set-keepAwake').checked = !!S.settings.keepAwake; $('#set-keepAwakeLid').checked = !!S.settings.keepAwakeLid;
  $('#set-keepAwakeLid').disabled = !S.settings.keepAwake; $('#lid-row').style.opacity = S.settings.keepAwake ? 1 : .5;
  $('#lead-row').classList.toggle('hidden', !(S.settings.keepAwake && S.settings.keepAwakeLid));
  $$('#set-lidLead button').forEach(b => b.classList.toggle('on', Number(b.dataset.lead) === Number(S.settings.lidLeadMin || 0)));
  $('#set-openAtLogin').checked = !!S.info.openAtLogin;
  const box = $('#lid-state'); let html = '', cls = '';
  const MOON = '<svg viewBox="0 0 16 16"><path d="M10.8 2.6a5.6 5.6 0 1 0 2.6 8.6A4.6 4.6 0 0 1 10.8 2.6z"/></svg>', WARN = '<svg viewBox="0 0 16 16"><path d="M8 2.5 14 13H2z"/><path d="M8 6.5v3M8 11.2v.1"/></svg>';
  if (lidOn) { cls = 'on'; html = MOON + '<span><b>Lid-closed mode is on.</b> Your Mac will not sleep, even with the lid shut. Sleep turns back on by itself when the queue finishes or Letterhead quits.</span>'; }
  else if (p.lid === 'asking') html = MOON + '<span>Waiting for your Mac password…</span>';
  else if (stale) { cls = 'warn'; html = WARN + '<span>Your Mac is still set to never sleep, likely left over from an earlier session. Click <b>Restore normal sleep</b> to turn sleep back on.</span>'; }
  else if ((p.lid === 'declined' || p.lid === 'error') && S.settings.keepAwakeLid) { cls = 'warn'; html = WARN + `<span>${esc(p.lidError || 'Could not turn on lid-closed mode.')} Turn the switch off and on to try again.</span>`; }
  else if (p.lid === 'unsupported' && S.settings.keepAwakeLid) { cls = 'warn'; html = WARN + '<span>Lid-closed mode works on a Mac only.</span>'; }
  else if (S.settings.keepAwake && S.settings.keepAwakeLid) html = MOON + `<span>Lid-closed mode turns on ${Number(S.settings.lidLeadMin || 0) ? '15 minutes before the next batch' : 'as soon as a batch is scheduled'}, after one password prompt.</span>`;
  box.className = 'lid-state ' + cls; box.innerHTML = html; box.classList.toggle('hidden', !html);
  $('#lid-warm').classList.toggle('hidden', !(S.settings.keepAwake && S.settings.keepAwakeLid));
}
lh.on('power:status', st => { S.power = st; renderAwake(); });
async function saveSetting(k, v) { S.settings[k] = v; await lh.settings.save({ [k]: v }); renderAwake(); }
$('#set-keepAwake').addEventListener('change', e => saveSetting('keepAwake', e.target.checked));
$('#set-keepAwakeLid').addEventListener('change', e => saveSetting('keepAwakeLid', e.target.checked));
$('#set-lidLead').addEventListener('click', e => { const b = e.target.closest('button'); if (b) saveSetting('lidLeadMin', Number(b.dataset.lead)); });
$('#set-openAtLogin').addEventListener('change', async e => { S.info.openAtLogin = await lh.app.setOpenAtLogin(e.target.checked); if (e.target.checked && !S.info.openAtLogin && S.info.platform === 'darwin') toast('macOS did not allow it. Add Letterhead in System Settings > General > Login Items.', true); renderAwake(); });
$('#pw-restore').addEventListener('click', async () => { const r = await lh.power.restore(); if (r && r.ok) { if (S.settings.keepAwakeLid) await saveSetting('keepAwakeLid', false); toast('Normal sleep restored'); } else if (r) toast(r.error || 'Could not restore sleep', true); });
$('#awake-chip').addEventListener('click', () => go('schedule'));

/* ---------------- updates ---------------- */
function renderUpdate() {
  const u = S.upd || {};
  const bar = $('#upd-bar');
  bar.classList.toggle('hidden', !((u.status === 'ready' || u.status === 'blocked') && !S.updDismissed));
  if (u.status === 'ready' || u.status === 'blocked') {
    $('#upd-text').innerHTML = u.canInstall === false ? esc(u.installNote || 'This copy of Letterhead cannot update itself.') : `<b>Letterhead ${esc(u.version)}</b> is ready. Restart to finish updating.`;
    $('#upd-go').classList.toggle('hidden', u.canInstall === false);
  }
  if (!$('#u-version')) return;
  $('#u-version').textContent = `Letterhead ${S.info.version || ''}`;
  const last = u.lastChecked ? ` Last checked ${fmtAt(u.lastChecked)}.` : '';
  const txt = { idle: 'Checks for a new version when Letterhead opens and every few hours.' + last, checking: 'Checking for updates…', uptodate: 'You have the latest version.' + last,
    downloading: `Downloading version ${u.version}… ${Math.round((u.progress || 0) * 100)}%`, ready: u.canInstall === false ? (u.installNote || '') : `Version ${u.version} is downloaded. Restart Letterhead to install it.`, error: `Could not update: ${u.error || 'unknown error'}`, blocked: `Version ${u.version} is available. ${u.installNote || ''}` }[u.status || 'idle'];
  const rb = u.rollback && u.rollback.version && u.status !== 'ready' ? ` Version ${u.rollback.version} did not start on this Mac, so Letterhead kept this version.` : '';
  $('#u-status').textContent = txt + rb;
  $('#u-bar').classList.toggle('hidden', u.status !== 'downloading'); $('#u-fill').style.width = Math.round((u.progress || 0) * 100) + '%';
  $('#u-check').textContent = u.status === 'ready' && u.canInstall !== false ? 'Restart now' : 'Check now';
  $('#u-check').disabled = u.status === 'checking' || u.status === 'downloading';
  $('#set-autoUpdate').checked = S.settings.autoUpdate !== false; $('#set-installOnQuit').checked = S.settings.installOnQuit !== false;
}
lh.on('update:state', st => { S.upd = st; renderUpdate(); });
async function installUpdate() { const r = await lh.update.install(); if (r && !r.ok) toast(r.error, true); else if (r && r.waiting) toast('Letterhead restarts to update as soon as the current send finishes.'); }
$('#upd-go').addEventListener('click', installUpdate);
$('#upd-later').addEventListener('click', () => { S.updDismissed = true; renderUpdate(); toast('It installs next time you quit Letterhead.'); });
$('#u-check').addEventListener('click', async () => { if (S.upd && S.upd.status === 'ready') return installUpdate(); S.upd = await lh.update.check(); renderUpdate(); });
$('#set-autoUpdate').addEventListener('change', e => saveSetting('autoUpdate', e.target.checked));
$('#set-installOnQuit').addEventListener('change', e => saveSetting('installOnQuit', e.target.checked));

/* ---------------- menu ---------------- */
lh.on('menu', m => {
  if (m.tab) return go(m.tab);
  ({ import: importCsv, attach: () => { go('letter'); attach(); }, export: exportCsv, test: sendTest, toggle: togglePause, retry, newBatch: () => { go('schedule'); openEditor(); }, compose: () => window.LH2 && LH2.compose(m.mailto ? { mailto: m.mailto } : {}) }[m.action] || (() => {}))();
});

/* ---------------- boot ---------------- */
(async function boot() {
  // each step can fail on its own (a damaged file, a missing service) without leaving a blank window
  const safe = async (what, p, fallback) => { try { const v = await p; return v === undefined ? fallback : v; } catch (e) { lh.diag.report('startup ' + what, (e && (e.stack || e.message)) || String(e)); S.bootErrors = (S.bootErrors || 0) + 1; return fallback; } };
  if (lh.platform === 'darwin') document.documentElement.classList.add('mac');
  S.account = await safe('account', lh.account.get(), null);
  const st = await safe('settings', lh.settings.get(), null); if (st) S.settings = { ...S.settings, ...st };
  const d = await safe('draft', lh.draft.get(), null);
  if (d) {
    Object.assign(S.draft, d.draft || {}); S.recipients = d.recipients || []; S.columns = d.columns || [];
    S.invalid = d.invalid || 0; S.dupes = d.dupes || 0; S.sourceName = d.sourceName || ''; Object.assign(S.send, d.send || {});
    if (S.draft.attachments && S.draft.attachments.length) S.draft.attachments = await safe('attachments', lh.attachStat(S.draft.attachments.map(a => a.path)), []);
  }
  S.info = await safe('info', lh.app.info(), {}); S.batches = await safe('batches', lh.batches.list(), []) || []; S.upd = await safe('update', lh.update.state(), null); S.power = await safe('power', lh.power.status(), null);
  S.run = await safe('campaign', lh.campaign.snapshot(), null);
  if (S.run && S.run.source) S.runSource = S.run.source;
  for (const [what, fn] of [['account', () => { fillAccount(S.account); renderAcctChip(); }], ['recipients', () => { renderRecipients(); renderNavCount(); }]]) { try { fn(); } catch (e) { lh.diag.report('startup ' + what, e.stack || e.message); S.bootErrors = (S.bootErrors || 0) + 1; } }
  await safe('usage', refreshUsage(), null);
  const start = new URLSearchParams(location.search).get('tab') || (S.account && S.account.hasPassword ? (S.settings.mailEnabled === false ? (S.recipients.length ? 'letter' : 'recipients') : 'mail') : 'account');
  try { go(start); } catch (e) { lh.diag.report('startup screen ' + start, e.stack || e.message); try { go('settings'); } catch (e2) { /* nothing else to try */ } }
  for (const fn of [renderNavSched, renderAwake, renderUpdate]) { try { fn(); } catch (e) { lh.diag.report('startup ' + fn.name, e.stack || e.message); } }
  if (S.bootErrors) toast('Part of Letterhead did not load. Settings > Help > View error log has the details.', true);
  document.body.dataset.ready = '1';
})();
