'use strict';
/* Letterhead 2: mail client (list, reader, composer, shortcuts) */
(function () {
const call = async p => { const r = await p; if (!r || !r.ok) throw new Error(r ? r.error : 'No answer'); return r.value; };
const SPECIAL = {
  '\\Inbox': ['Inbox', '<path d="M3.5 11.5h3.2l1.1 2h4.4l1.1-2h3.2"/><path d="M3.5 11.5 5.6 5h8.8l2.1 6.5v4h-13z"/>'],
  '__starred': ['Starred', '<path d="m10 3.6 1.9 4 4.3.5-3.2 2.9.9 4.3-3.9-2.2-3.9 2.2.9-4.3-3.2-2.9 4.3-.5z"/>'],
  '\\Flagged': ['Starred', '<path d="m10 3.6 1.9 4 4.3.5-3.2 2.9.9 4.3-3.9-2.2-3.9 2.2.9-4.3-3.2-2.9 4.3-.5z"/>'],
  '\\Sent': ['Sent', '<path d="M3 9.6 16.8 3.4 13.6 16.6 9.6 11.2z"/><path d="M9.6 11.2 16.8 3.4"/>'],
  '\\Drafts': ['Drafts', '<path d="M4 3.5h8.5L16 7v9.5H4z"/><path d="M12.5 3.5V7H16"/>'],
  '\\All': ['All Mail', '<rect x="3.5" y="4" width="13" height="4" rx="1"/><path d="M4.5 8v7.5h11V8M8 11h4"/>'],
  '\\Archive': ['Archive', '<rect x="3.5" y="4" width="13" height="4" rx="1"/><path d="M4.5 8v7.5h11V8M8 11h4"/>'],
  '\\Junk': ['Spam', '<path d="M10 3.5 16.5 15h-13z"/><path d="M10 8.2v3.2M10 13.2v.1"/>'],
  '\\Trash': ['Trash', '<path d="M4.5 6h11M8 6V4.5h4V6M5.8 6l.7 10h7l.7-10"/>'],
};
const ORDER = ['\\Inbox', '\\Flagged', '\\Sent', '\\Drafts', '\\All', '\\Archive', '\\Junk', '\\Trash'];
const ICON = {
  archive: '<svg viewBox="0 0 16 16"><rect x="2.5" y="3" width="11" height="3.2" rx=".8"/><path d="M3.3 6.2v6.3h9.4V6.2M6.5 9h3"/></svg>',
  trash: '<svg viewBox="0 0 16 16"><path d="M3.5 4.8h9M6.4 4.8V3.5h3.2v1.3M4.6 4.8l.6 8h5.6l.6-8"/></svg>',
  spam: '<svg viewBox="0 0 16 16"><path d="M8 2.8 13.6 12.8H2.4z"/><path d="M8 6.6v2.6M8 10.8v.1"/></svg>',
  unread: '<svg viewBox="0 0 16 16"><rect x="2.5" y="4" width="11" height="8.5" rx="1.2"/><path d="m2.8 4.6 5.2 4 5.2-4"/></svg>',
  star: '<svg viewBox="0 0 16 16"><path d="m8 2.6 1.6 3.3 3.6.4-2.7 2.4.8 3.6L8 10.5l-3.3 1.8.8-3.6-2.7-2.4 3.6-.4z"/></svg>',
  label: '<svg viewBox="0 0 16 16"><path d="M2.8 3.2h5.6l4.8 4.8-5.2 5.2-5.2-5.2z"/><circle cx="5.6" cy="5.9" r=".9"/></svg>',
  move: '<svg viewBox="0 0 16 16"><path d="M2.5 4.5h4l1.2 1.4h5.8v6.6h-11z"/><path d="M7 9.2h4M9.6 7.6l1.6 1.6-1.6 1.6"/></svg>',
  reply: '<svg viewBox="0 0 16 16"><path d="M6.5 4 2.8 7.6l3.7 3.6"/><path d="M3 7.6h6.2c2.4 0 4 1.6 4 4.4"/></svg>',
  replyAll: '<svg viewBox="0 0 16 16"><path d="M7.5 4 3.8 7.6l3.7 3.6M4.6 4 .9 7.6l3.7 3.6"/><path d="M4 7.6h5.6c2.4 0 4 1.6 4 4.4"/></svg>',
  forward: '<svg viewBox="0 0 16 16"><path d="M9.5 4l3.7 3.6-3.7 3.6"/><path d="M13 7.6H6.8c-2.4 0-4 1.6-4 4.4"/></svg>',
  clip: '<svg viewBox="0 0 16 16"><path d="M12.6 7.6 8 12.2a3 3 0 0 1-4.2-4.2l4.9-4.9a2 2 0 0 1 2.8 2.8L6.7 10.7a1 1 0 0 1-1.4-1.4l4.3-4.3"/></svg>',
  back: '<svg viewBox="0 0 16 16"><path d="M9.8 3.5 5.3 8l4.5 4.5"/></svg>',
  spark: '<svg viewBox="0 0 16 16"><path d="M8 2.5l1.2 3 3 1.2-3 1.2L8 11l-1.2-3.1-3-1.2 3-1.2z"/><path d="M12.3 10.6l.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5z"/></svg>',
  x: '<svg viewBox="0 0 16 16"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>',
  min: '<svg viewBox="0 0 16 16"><path d="M4 8.5h8"/></svg>',
  expand: '<svg viewBox="0 0 16 16"><path d="M9.5 3.5h3v3M6.5 12.5h-3v-3M12.5 3.5 9 7M3.5 12.5 7 9"/></svg>',
};
const M = { folder: null, folders: [], list: [], total: 0, sel: null, idx: -1, checked: new Set(), search: null, thread: [], bodies: new Map(), show: new Set(), status: null, expanded: new Set(), quotes: new Set(), loading: false, more: false };
window.M = M;
const PALETTE = ['#B4472E', '#56744F', '#A8742A', '#6B5B95', '#2F6F7E', '#9C3B6A', '#7A6A3A', '#3E5F8A'];
const avColor = s => { let h = 0; for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };
const initials = (n, a) => { const w = String(n || a || '?').replace(/^(dr|mr|mrs|ms|prof|professor)\.?\s+/i, '').trim().split(/\s+/); return ((w[0] || '?')[0] + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase(); };
const avatar = (n, a, cls = '') => `<span class="av ${cls}" style="background:${avColor(a || n)}">${esc(initials(n, a))}</span>`;
function when(t) {
  const d = new Date(t), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const y = new Date(now); y.setDate(now.getDate() - 1); if (d.toDateString() === y.toDateString()) return 'Yesterday';
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return d.toLocaleDateString([], { month: 'numeric', day: 'numeric', year: '2-digit' });
}
const fullWhen = t => new Date(t).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const me = () => { const a = S.account || {}; return [a.fromEmail, a.user, a.email, a.alias].filter(Boolean).map(x => x.toLowerCase()); };
const isMe = a => me().includes(String(a || '').toLowerCase());
const fmtAddr = a => a.name ? `${a.name} <${a.address}>` : a.address;
const special = use => (M.folders.find(f => f.special === use) || {}).path;
const inboxPath = () => special('\\Inbox') || 'INBOX';
const starredPath = () => special('\\Flagged') || '__starred';
const folderName = p => { if (p === '__starred') return 'Starred'; const f = M.folders.find(x => x.path === p); if (!f) return p; if (SPECIAL[f.special]) return f.special === '\\All' && !/all/i.test(f.name) ? f.name : SPECIAL[f.special][0]; return f.path.replace(/^\[(Gmail|Google Mail)\]\//, ''); };
const isFolder = use => M.folder && M.folder === special(use);
const inTab = () => S.tab === 'mail';

/* ---------- sidebar ---------- */
async function loadFolders() {
  try { M.folders = await call(lh.mail.folders()); } catch (e) { M.folders = []; }
  if (!M.folder || (M.folder !== '__starred' && !M.folders.some(f => f.path === M.folder))) M.folder = inboxPath();
  renderNav();
}
function navBtn(path, name, svg, count, cls = '') {
  const on = S.tab === 'mail' && M.folder === path && !M.search;
  return `<button class="nav-item ${on ? 'on' : ''} ${cls}" data-folder="${esc(path)}"><svg viewBox="0 0 20 20">${svg}</svg><span>${esc(name)}</span><em class="badge">${count ? fmtN(count) : ''}</em></button>`;
}
function renderNav() {
  const out = [];
  const seen = new Set();
  for (const use of ORDER) {
    let f = M.folders.find(x => x.special === use);
    if (use === '\\Flagged') { out.push(navBtn(starredPath(), 'Starred', SPECIAL['\\Flagged'][1], 0)); if (f) seen.add(f.path); continue; }
    if (!f || seen.has(f.path)) continue; seen.add(f.path);
    if (use === '\\Archive' && M.folders.some(x => x.special === '\\All')) continue;
    const count = use === '\\Inbox' ? f.unreadCached : use === '\\Drafts' ? f.total : use === '\\Junk' ? f.unreadCached : 0;
    out.push(navBtn(f.path, use === '\\All' ? 'All Mail' : SPECIAL[use][0], SPECIAL[use][1], count));
  }
  if (!M.folders.length) out.push(`<button class="nav-item ${S.tab === 'mail' ? 'on' : ''}" data-folder="INBOX"><svg viewBox="0 0 20 20">${SPECIAL['\\Inbox'][1]}</svg><span>Inbox</span><em class="badge"></em></button>`);
  $('#nav-folders').innerHTML = out.join('');
  const labels = M.folders.filter(f => f.isLabel || (!f.special && !/^\[(gmail|google mail)\]$/i.test(f.path) && f.path.toUpperCase() !== 'INBOX' && !seen.has(f.path) && !/^\[(gmail|google mail)\]\//i.test(f.path)));
  $('#nav-labels').innerHTML = labels.length ? `<div class="nav-sub">Labels</div>` + labels.map(f => navBtn(f.path, folderName(f.path), '<path d="M4 4.5h6.8l5 5.5-5 5.5H4z"/>', f.unreadCached, 'lbl')).join('') : '';
  const inbox = M.folders.find(f => f.special === '\\Inbox');
  document.title = inbox && inbox.unreadCached ? `Letterhead (${inbox.unreadCached})` : 'Letterhead';
}
$('#nav').addEventListener('click', e => { const b = e.target.closest('[data-folder]'); if (!b) return; openFolder(b.dataset.folder); });
$('#compose-btn').addEventListener('click', () => compose({}));

/* ---------- list ---------- */
async function openFolder(path) {
  M.search = null; $('#m-search').value = ''; M.folder = path; M.sel = null; M.idx = -1; M.checked.clear(); M.list = [];
  if (S.tab !== 'mail') go('mail'); else { renderNav(); renderList(); renderReader(); }
  lh.mail.select(path);
  await loadList();
  lh.mail.sync(path).then(() => loadList(true)).catch(() => {});
}
async function loadList(keep) {
  if (M.search) return;
  const folder = M.folder || inboxPath();
  try {
    const r = await call(lh.mail.threads(folder, { offset: 0, limit: Math.max(60, keep ? M.list.length : 0) }));
    M.list = r.items; M.total = r.total; M.complete = r.complete;
  } catch (e) { M.list = []; M.total = 0; }
  if (M.sel) M.idx = M.list.findIndex(x => x.thread === M.sel);
  renderList();
}
function rowHtml(t, i) {
  const unread = t.unread > 0, sel = t.thread === M.sel, chk = M.checked.has(t.thread);
  const isSent = isFolder('\\Sent') || isFolder('\\Drafts');
  const who = isSent ? 'To: ' + ((t.to || []).map(a => a.name || a.address).join(', ') || '(no recipient)') : (t.people || [t.fromName || t.fromAddr]).join(', ');
  const chip = t.suggestion === 'ready' ? '<span class="chip ai">Reply drafted</span>' : t.suggestion === 'scheduled' ? '<span class="chip ai warn">Auto-reply waiting</span>' : t.draft ? '<span class="chip draft">Draft</span>' : '';
  const labels = (t.labels || []).filter(l => !/^\\/.test(l)).slice(0, 2).map(l => `<span class="chip lbl">${esc(l)}</span>`).join('');
  return `<div class="mrow ${unread ? 'unread' : ''} ${sel ? 'sel' : ''} ${chk ? 'chk' : ''}" data-i="${i}" data-thread="${esc(t.thread)}">
    <button class="mcheck" data-check="${esc(t.thread)}" title="Select (x)">${chk ? ICON_OK : avatar(t.fromName, t.fromAddr, 'sm')}</button>
    <div class="mrow-main">
      <div class="mrow-top"><span class="who">${esc(who)}</span>${t.count > 1 ? `<span class="n">${t.count}</span>` : ''}<span class="grow"></span>${t.hasAtt ? `<span class="ico">${ICON.clip}</span>` : ''}<span class="when">${esc(when(t.last || t.date))}</span></div>
      <div class="mrow-sub"><span class="subj">${esc(t.subject || '(no subject)')}</span>${chip}${labels}</div>
      <div class="snip">${esc(t.snippet || '')}</div>
    </div>
    <button class="mstar ${t.flagged ? 'on' : ''}" data-star="${esc(t.thread)}" title="Star (s)">${ICON.star}</button>
  </div>`;
}
function renderList() {
  const title = M.search ? `Results for “${M.search}”` : folderName(M.folder || inboxPath());
  $('#m-title').textContent = title;
  const unread = M.list.filter(t => t.unread).length;
  $('#m-count').textContent = M.search ? `${M.list.length}` : M.total ? `${fmtN(M.total)}${unread ? ` · ${unread} unread` : ''}` : '';
  const el = $('#m-list');
  if (!M.list.length) {
    const st = M.status || {};
    el.innerHTML = `<div class="m-empty">${st.state === 'connecting' || (st.state === 'online' && !M.folders.length) ? '<div class="spin"></div><p>Loading your mail…</p>' : M.search ? '<p>No conversations match.</p><small>Gmail search works here: from:, to:, subject:, has:attachment, older_than:7d.</small>' : !S.account || !S.account.hasPassword ? '<p>Connect your account to see your mail.</p><button class="primary sm" data-go="account">Set up account</button>' : '<p>Nothing here.</p>'}</div>`;
  } else {
    el.innerHTML = M.list.map(rowHtml).join('') + (M.search ? '' : M.list.length < M.total || !M.complete ? `<div class="m-more"><button class="ghost sm" id="m-more">${M.more ? 'Loading…' : 'Load older conversations'}</button></div>` : '<div class="m-end">That is everything.</div>');
  }
  $('#m-bulk').classList.toggle('hidden', !M.checked.size);
  $('#m-bulk-n').textContent = `${M.checked.size} selected`;
  renderNav();
}
$('#m-list').addEventListener('click', e => {
  const g = e.target.closest('[data-go]'); if (g) return go(g.dataset.go);
  const st = e.target.closest('[data-star]'); if (st) { e.stopPropagation(); const t = M.list.find(x => x.thread === st.dataset.star); return act(t.flagged ? 'unstar' : 'star', t); }
  const ck = e.target.closest('[data-check]'); if (ck) { e.stopPropagation(); toggleCheck(ck.dataset.check); return; }
  if (e.target.id === 'm-more') return loadMore();
  const r = e.target.closest('.mrow'); if (!r) return;
  if (e.metaKey || e.shiftKey) return toggleCheck(r.dataset.thread);
  selectIdx(Number(r.dataset.i), true);
});
$('#m-list').addEventListener('scroll', e => { const el = e.target; if (el.scrollTop + el.clientHeight > el.scrollHeight - 300) loadMore(); });
function toggleCheck(k) { if (M.checked.has(k)) M.checked.delete(k); else M.checked.add(k); renderList(); }
async function loadMore() {
  if (M.more || M.search) return;
  if (M.list.length < M.total) {
    M.more = true;
    try { const r = await call(lh.mail.threads(M.folder, { offset: M.list.length, limit: 60 })); M.list.push(...r.items.filter(x => !M.list.some(y => y.thread === x.thread))); M.total = r.total; } catch (e) {}
    M.more = false; renderList(); return;
  }
  if (M.complete) return;
  M.more = true; renderList();
  try { await call(lh.mail.more(M.folder)); } catch (e) { toast(e.message, true); }
  M.more = false; await loadList(true);
}
$('#m-bulk').addEventListener('click', async e => {
  const b = e.target.closest('[data-bulk]'); if (!b) return;
  const op = b.dataset.bulk; if (op === 'clear') { M.checked.clear(); return renderList(); }
  const threads = [...M.checked]; M.checked.clear();
  for (const t of threads) { const row = M.list.find(x => x.thread === t); if (row) await act(op, row, { quiet: true, noAdvance: true }); }
  toast(`${threads.length} conversation${threads.length === 1 ? '' : 's'} ${({ archive: 'archived', trash: 'moved to Trash', read: 'marked read', unread: 'marked unread' })[op]}.`);
  loadList(true);
});

/* search */
$('#m-search').addEventListener('keydown', async e => {
  if (e.key === 'Escape') { e.target.value = ''; e.target.blur(); if (M.search) { M.search = null; loadList(); } return; }
  if (e.key !== 'Enter') return;
  const q = e.target.value.trim(); if (!q) { M.search = null; return loadList(); }
  M.search = q; M.list = []; M.sel = null; renderList(); renderReader();
  $('#m-list').innerHTML = '<div class="m-empty"><div class="spin"></div><p>Searching…</p></div>';
  try { const r = await call(lh.mail.search(q)); if (M.search !== q) return; M.list = r.items.map(x => ({ ...x, last: x.date })); M.total = M.list.length; if (!r.server) toast('Searched mail on this Mac only. The server search did not answer.'); }
  catch (er) { toast(er.message, true); M.list = []; }
  renderList();
});
$('#m-refresh').addEventListener('click', async () => { const b = $('#m-refresh'); b.classList.add('spinning'); try { await call(lh.mail.sync(M.folder || inboxPath())); await loadList(true); } catch (e) { toast(e.message, true); } b.classList.remove('spinning'); });

/* ---------- reader ---------- */
function selectIdx(i, open) {
  if (i < 0 || i >= M.list.length) return;
  M.idx = i; const t = M.list[i]; M.sel = t.thread;
  $$('#m-list .mrow').forEach(r => r.classList.toggle('sel', Number(r.dataset.i) === i));
  const row = $(`#m-list .mrow[data-i="${i}"]`); if (row) row.scrollIntoView({ block: 'nearest' });
  if (open !== false) openThread(t);
}
async function openThread(t, { quiet } = {}) {
  if (t.draft && isFolder('\\Drafts')) return openDraft(t);
  const key = t.thread;
  if (!quiet) { M.thread = []; M.expanded.clear(); M.quotes.clear(); renderReader(true); }
  let msgs = [];
  try { msgs = await call(lh.mail.thread(key)); } catch (e) { toast(e.message, true); }
  if (M.sel !== key) return;
  if (!msgs.length) msgs = [t];
  M.thread = msgs;
  if (!quiet) { msgs.forEach((m, i) => { if (!m.seen || i === msgs.length - 1) M.expanded.add(m.id); }); }
  renderReader();
  for (const m of msgs.filter(x => M.expanded.has(x.id))) loadBody(m);
  const unread = msgs.filter(m => !m.seen);
  if (unread.length) { call(lh.mail.action({ op: 'read', ids: unread.map(m => m.id) })).catch(() => {}); const li = M.list.find(x => x.thread === key); if (li) { li.unread = 0; renderList(); } }
  if (window.LH2A) LH2A.readerCard(msgs);
}
async function loadBody(m) {
  if (M.bodies.has(m.id)) return paintBody(m);
  try { const b = await call(lh.mail.body(m.folder, m.uid)); M.bodies.set(m.id, b); if (M.bodies.size > 120) M.bodies.delete(M.bodies.keys().next().value); }
  catch (e) { M.bodies.set(m.id, { error: e.message }); }
  paintBody(m);
}
function recipientsLine(m) {
  const list = [...(m.to || []), ...(m.cc || [])].map(a => isMe(a.address) ? 'me' : (a.name || a.address));
  return list.length ? 'to ' + list.slice(0, 4).join(', ') + (list.length > 4 ? ` and ${list.length - 4} more` : '') : '';
}
function renderReader(loading) {
  const el = $('#m-reader');
  if (!M.sel) {
    const inbox = M.folders.find(f => f.special === '\\Inbox');
    el.innerHTML = `<div class="r-empty"><svg viewBox="0 0 64 64" class="r-empty-art"><rect x="10" y="16" width="44" height="32" rx="4"/><path d="m12 19 20 15 20-15"/></svg><p>${M.list.length ? 'Pick a conversation to read it.' : ''}</p><small>${inbox && inbox.synced ? 'Checked ' + new Date(inbox.synced).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''}</small><div class="kbd-hint">Press <kbd>?</kbd> for keyboard shortcuts</div></div>`;
    return;
  }
  const t = M.list.find(x => x.thread === M.sel) || M.thread[M.thread.length - 1] || {};
  const msgs = M.thread;
  const subject = (msgs[0] || t).subject || '(no subject)';
  const inTrash = isFolder('\\Trash'), inSpam = isFolder('\\Junk');
  const flagged = msgs.some(m => m.flagged) || t.flagged;
  const labels = [...new Set(msgs.flatMap(m => m.labels || []).filter(l => !/^\\/.test(l)))];
  el.innerHTML = `
    <div class="r-bar">
      <button class="icon-btn" data-act="archive" title="Archive (e)">${ICON.archive}</button>
      <button class="icon-btn" data-act="spam" title="${inSpam ? 'Not spam' : 'Report spam (!)'}">${ICON.spam}</button>
      <button class="icon-btn" data-act="trash" title="${inTrash ? 'Delete forever' : 'Delete (#)'}">${ICON.trash}</button>
      <span class="sep"></span>
      <button class="icon-btn" data-act="unread" title="Mark unread (Shift U)">${ICON.unread}</button>
      <button class="icon-btn ${flagged ? 'on' : ''}" data-act="${flagged ? 'unstar' : 'star'}" title="Star (s)">${ICON.star}</button>
      <button class="icon-btn" data-act="move" title="Move to">${ICON.move}</button>
      <button class="icon-btn" data-act="label" title="Label">${ICON.label}</button>
      <span class="grow"></span>
      <span class="r-pos">${M.idx >= 0 ? `${M.idx + 1} of ${fmtN(M.total || M.list.length)}` : ''}</span>
    </div>
    <div class="r-scroll" id="r-scroll">
      <h1 class="r-subj selectable">${esc(subject)}</h1>
      <div class="r-labels">${labels.map(l => `<span class="chip lbl">${esc(l)}</span>`).join('')}${inSpam ? '<span class="chip warn">Spam</span>' : ''}</div>
      ${loading && !msgs.length ? '<div class="r-loading"><div class="spin"></div></div>' : msgs.map(msgHtml).join('')}
      <div id="ai-card"></div>
      <div class="r-actions">
        <button class="secondary" data-reply="reply">${ICON.reply}<span>Reply</span></button>
        ${msgs.length && [...(msgs[msgs.length - 1].to || []), ...(msgs[msgs.length - 1].cc || [])].length > 1 ? `<button class="secondary" data-reply="replyAll">${ICON.replyAll}<span>Reply all</span></button>` : ''}
        <button class="secondary" data-reply="forward">${ICON.forward}<span>Forward</span></button>
      </div>
    </div>`;
  for (const m of msgs) if (M.expanded.has(m.id) && M.bodies.has(m.id)) paintBody(m);
  if (window.LH2A && msgs.length) LH2A.readerCard(msgs, true);
}
function msgHtml(m, i) {
  const open = M.expanded.has(m.id);
  const name = isMe(m.fromAddr) ? 'Me' : (m.fromName || m.fromAddr);
  if (!open) return `<article class="msg collapsed" data-mid="${m.id}"><div class="msg-h">${avatar(m.fromName, m.fromAddr)}<div class="msg-who"><b>${esc(name)}</b><span class="snip">${esc(m.snippet || '')}</span></div><span class="when">${esc(when(m.date))}</span></div></article>`;
  return `<article class="msg" data-mid="${m.id}">
    <div class="msg-h">${avatar(m.fromName, m.fromAddr)}
      <div class="msg-who"><b class="selectable">${esc(name)}</b> <span class="addr selectable">${esc(isMe(m.fromAddr) ? '' : '<' + m.fromAddr + '>')}</span><div class="to">${esc(recipientsLine(m))}</div></div>
      <span class="when" title="${esc(fullWhen(m.date))}">${esc(fullWhen(m.date))}</span>
      <button class="icon-btn sm" data-reply="reply" data-of="${m.id}" title="Reply">${ICON.reply}</button>
    </div>
    <div class="msg-b" id="mb-${m.id}"><div class="r-loading"><div class="spin"></div></div></div>
  </article>`;
}
$('#m-reader').addEventListener('click', e => {
  const a = e.target.closest('[data-act]'); if (a) return act(a.dataset.act, null, { anchor: a });
  const rp = e.target.closest('[data-reply]'); if (rp) { const of = rp.dataset.of ? M.thread.find(m => String(m.id) === rp.dataset.of) : null; return reply(rp.dataset.reply, of); }
  const att = e.target.closest('[data-att]'); if (att) { const [mid, idx, how] = att.dataset.att.split(':'); const m = M.thread.find(x => String(x.id) === mid); return call(lh.mail.attachment(m.folder, m.uid, Number(idx), how)).then(p => { if (how === 'save' && p) toast('Saved to ' + p.split('/').slice(-2).join('/')); }).catch(er => toast(er.message, true)); }
  const im = e.target.closest('[data-images]'); if (im) { const [mid, always] = im.dataset.images.split(':'); const m = M.thread.find(x => String(x.id) === mid); M.show.add(m.id); if (always) { const list = [...new Set([...(S.settings.imageSenders || []), m.fromAddr.toLowerCase()])]; saveSetting('imageSenders', list); } return paintBody(m); }
  const q = e.target.closest('[data-quote]'); if (q) { const id = Number(q.dataset.quote); if (M.quotes.has(id)) M.quotes.delete(id); else M.quotes.add(id); return paintBody(M.thread.find(m => m.id === id)); }
  const h = e.target.closest('.msg-h'); if (h && !e.target.closest('button')) { const id = Number(h.parentElement.dataset.mid); const m = M.thread.find(x => x.id === id); if (M.expanded.has(id) && M.thread.length > 1 && m !== M.thread[M.thread.length - 1]) M.expanded.delete(id); else M.expanded.add(id); const art = h.parentElement; art.outerHTML = msgHtml(m); if (M.expanded.has(id)) loadBody(m); }
});

/* ---------- safe HTML ---------- */
const REMOTE = /^\s*(https?:)?\/\//i;
function sanitize(html, b, showImages) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,iframe,frame,frameset,object,embed,applet,form,input,button,select,textarea,link,meta,base,noscript,portal,dialog').forEach(n => n.remove());
  let remote = 0;
  const cid = new Map((b.attachments || []).filter(a => a.cid && a.dataUrl).map(a => [a.cid.toLowerCase(), a.dataUrl]));
  doc.querySelectorAll('*').forEach(el => {
    for (const at of [...el.attributes]) {
      const n = at.name.toLowerCase(), v = at.value;
      if (n.startsWith('on') || n === 'srcset' || n === 'formaction' || n === 'ping') { el.removeAttribute(at.name); continue; }
      if ((n === 'href' || n === 'src' || n === 'background' || n === 'poster' || n === 'xlink:href') && /^\s*(javascript|vbscript|data:text\/html|file):/i.test(v)) { el.removeAttribute(at.name); continue; }
      if ((n === 'src' || n === 'background' || n === 'poster') && /^cid:/i.test(v)) { const d = cid.get(v.slice(4).replace(/^<|>$/g, '').toLowerCase()); if (d) el.setAttribute(at.name, d); else el.removeAttribute(at.name); continue; }
      if ((n === 'src' || n === 'background' || n === 'poster') && REMOTE.test(v)) { remote++; if (!showImages) { el.setAttribute('data-blocked', v); el.removeAttribute(at.name); } continue; }
      if (n === 'style' && /url\(\s*['"]?\s*(https?:)?\/\//i.test(v)) { remote++; if (!showImages) el.setAttribute('style', v.replace(/url\([^)]*\)/gi, 'none')); }
    }
    if (el.tagName === 'A') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
  });
  doc.querySelectorAll('style').forEach(st => { if (/url\(\s*['"]?\s*(https?:)?\/\//i.test(st.textContent)) { remote++; if (!showImages) st.textContent = st.textContent.replace(/url\([^)]*\)/gi, 'none'); } st.textContent = st.textContent.replace(/@import[^;]+;/gi, ''); });
  return { html: doc.body ? doc.body.innerHTML : '', remote, hasQuote: !!doc.querySelector('.gmail_quote, blockquote[type=cite], .lh-quote, #appendonsend, .yahoo_quoted') };
}
function frameDoc(inner, showImages, hideQuotes) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: ${showImages ? 'https: http:' : ''}; style-src 'unsafe-inline'; font-src data:"><base target="_blank"><style>
  html,body{margin:0;padding:0;background:transparent}
  body{font:14px/1.55 -apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif;color:#26221E;word-wrap:break-word;overflow-wrap:anywhere;padding:2px 2px 6px}
  img{max-width:100%;height:auto} table{max-width:100%} pre{white-space:pre-wrap}
  a{color:#9C3B25} blockquote{margin:0 0 0 .6em;padding-left:.8em;border-left:2px solid #DDD1BF;color:#5E554B}
  ${showImages ? '' : 'img[data-blocked]{display:none!important}'}
  ${hideQuotes ? '.gmail_quote,blockquote[type=cite],.lh-quote,#appendonsend,.yahoo_quoted{display:none!important}' : ''}
  #lh-root{display:flow-root}
  </style></head><body><div id="lh-root">${inner}</div></body></html>`;
}
const linkify = s => esc(s).replace(/\bhttps?:\/\/[^\s<>"')]+/g, u => `<a href="${u}" data-href="${u}">${u}</a>`).replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, a => `<a href="mailto:${a}" data-href="mailto:${a}">${a}</a>`);
function splitQuoted(text) {
  const m = /^\s*On .{5,200}wrote:\s*$/m.exec(text) || /^-{2,} ?(Original Message|Forwarded message) ?-{2,}/mi.exec(text);
  if (m && m.index > 0) return [text.slice(0, m.index).trimEnd(), text.slice(m.index)];
  const lines = text.split('\n'); let i = lines.length; while (i > 0 && /^\s*(>|$)/.test(lines[i - 1])) i--;
  if (i < lines.length && lines.slice(i).some(l => l.startsWith('>'))) return [lines.slice(0, i).join('\n').trimEnd(), lines.slice(i).join('\n')];
  return [text, ''];
}
function openHref(href) {
  if (!href) return;
  if (/^mailto:/i.test(href)) return compose({ mailto: href });
  if (/^https?:/i.test(href)) return lh.mail.openLink(href);
}
function paintBody(m) {
  const box = document.getElementById('mb-' + m.id); if (!box) return;
  const b = M.bodies.get(m.id); if (!b) return;
  if (b.error) { box.innerHTML = `<div class="m-err">${esc(b.error)} <button class="ghost sm" data-retry="${m.id}">Try again</button></div>`; box.querySelector('[data-retry]').onclick = () => { M.bodies.delete(m.id); loadBody(m); }; return; }
  const trusted = S.settings.showImages || (S.settings.imageSenders || []).includes(String(m.fromAddr).toLowerCase()) || M.show.has(m.id);
  const multi = M.thread.length > 1, hideQ = multi && !M.quotes.has(m.id);
  let html = '', remote = 0, hasQuote = false, plain = null;
  if (b.html) { const s = sanitize(b.html, b, trusted); html = s.html; remote = s.remote; hasQuote = s.hasQuote; }
  else { const [main, q] = splitQuoted(b.text || ''); plain = main; hasQuote = !!q; if (q && !hideQ) plain = b.text; }
  const atts = (b.attachments || []).filter(a => !a.inline || !a.dataUrl);
  const parts = [];
  if (remote && !trusted) parts.push(`<div class="img-bar">${ICON.spam.replace('spam', '')}<span>Images are hidden so the sender cannot tell you opened this.</span><button class="ghost sm" data-images="${m.id}">Show images</button><button class="ghost sm" data-images="${m.id}:1">Always from this sender</button></div>`);
  if (b.html) parts.push(`<div class="mail-paper"><iframe class="mail-frame" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" title="Email"></iframe></div>`);
  else parts.push(`<div class="mail-text selectable">${linkify(plain || '')}</div>`);
  if (hasQuote && multi) parts.push(`<button class="quote-tog" data-quote="${m.id}" title="${M.quotes.has(m.id) ? 'Hide' : 'Show'} quoted text">•••</button>`);
  if (atts.length) parts.push(`<div class="atts">${atts.map(a => `<div class="att"><span class="att-ico">${/pdf/.test(a.contentType) ? 'PDF' : /image/.test(a.contentType) ? 'IMG' : /word|document/.test(a.contentType) ? 'DOC' : /sheet|excel|csv/.test(a.contentType) ? 'XLS' : 'FILE'}</span><div class="att-meta"><b title="${esc(a.filename)}">${esc(a.filename)}</b><small>${fmtSize(a.size || 0)}</small></div><button class="ghost sm" data-att="${m.id}:${a.index}:open">Open</button><button class="ghost sm" data-att="${m.id}:${a.index}:save">Save</button></div>`).join('')}</div>`);
  box.innerHTML = parts.join('');
  box.querySelectorAll('.mail-text a[data-href]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); openHref(a.dataset.href); }));
  const f = box.querySelector('iframe');
  if (f) {
    f.addEventListener('load', () => {
      const d = f.contentDocument; if (!d) return;
      // size the frame to its content: measure our own wrapper (its height never depends on the
      // frame's height, unlike body with height:100% newsletters), and stop if it keeps changing
      const root = d.getElementById('lh-root') || d.body;
      let lastH = 0, raf = 0, n = 0, t0 = Date.now(); const fit = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if (Date.now() - t0 > 4000) { t0 = Date.now(); n = 0; } if (++n > 40) return; const h = Math.max(40, Math.ceil(root.getBoundingClientRect().height + 10)); if (Math.abs(h - lastH) > 2) { lastH = h; f.style.height = h + 'px'; } }); };
      fit(); setTimeout(fit, 120); setTimeout(fit, 600);
      try { new ResizeObserver(fit).observe(root); } catch (e) {}
      d.addEventListener('click', e => { const a = e.target.closest && e.target.closest('a[href]'); if (a) { e.preventDefault(); openHref(a.getAttribute('href')); } });
    });
    f.srcdoc = frameDoc(html, trusted, hideQ);
  }
}

/* ---------- actions ---------- */
async function act(op, row, o = {}) {
  const t = row || M.list.find(x => x.thread === M.sel) || (M.thread.length ? { thread: M.sel } : null);
  if (!t) return;
  const folder = M.search ? (M.thread[M.thread.length - 1] || t).folder : (M.folder === '__starred' ? (t.folder || inboxPath()) : M.folder);
  if (op === 'move' || op === 'label') return pickFolder(op, t, folder, o.anchor);
  if (op === 'trash' && isFolder('\\Trash')) { if (!confirm('Delete this conversation forever? This cannot be undone.')) return; op = 'trash'; o.arg = 'forever'; }
  if (op === 'spam' && isFolder('\\Junk')) op = 'notspam';
  const leaves = ['archive', 'trash', 'spam', 'notspam', 'move'].includes(op);
  const idx = M.list.findIndex(x => x.thread === t.thread);
  if (leaves && !M.search) { M.list = M.list.filter(x => x.thread !== t.thread); M.total = Math.max(0, M.total - 1); }
  else { const li = M.list.find(x => x.thread === t.thread); if (li) { if (op === 'read') li.unread = 0; if (op === 'unread') li.unread = 1; if (op === 'star') li.flagged = true; if (op === 'unstar') li.flagged = false; } }
  if (leaves && t.thread === M.sel && !o.noAdvance) { const next = M.list[Math.min(idx, M.list.length - 1)]; M.sel = null; if (next && idx >= 0) { selectIdx(M.list.indexOf(next)); } else renderReader(); }
  if (op === 'unread' && t.thread === M.sel) { M.sel = null; renderReader(); }
  if ((op === 'star' || op === 'unstar') && t.thread === M.sel) { M.thread.forEach(m => m.flagged = op === 'star'); renderReader(); }
  renderList();
  try {
    await call(lh.mail.action({ op, thread: t.thread, folder, arg: o.arg }));
    if (!o.quiet) { const msg = { archive: 'Archived.', trash: o.arg === 'forever' ? 'Deleted forever.' : 'Moved to Trash.', spam: 'Reported as spam.', notspam: 'Moved to Inbox.', move: `Moved to ${folderName(o.arg)}.`, label: `Labeled ${folderName(o.arg)}.` }[op]; if (msg) toast(msg); }
  } catch (e) { toast(e.message, true); loadList(true); }
}
function pickFolder(op, t, folder, anchor) {
  document.querySelectorAll('.popmenu').forEach(p => p.remove());
  const opts = M.folders.filter(f => f.path !== folder && (op === 'label' ? (f.isLabel || !f.special) && !/^\[(gmail|google mail)\]$/i.test(f.path) : ['\\Inbox', '\\Archive', '\\All', '\\Junk', '\\Trash'].includes(f.special) || f.isLabel || !f.special));
  const pop = document.createElement('div'); pop.className = 'popmenu';
  pop.innerHTML = `<div class="pm-h">${op === 'label' ? 'Label as' : 'Move to'}</div>` + opts.map(f => `<button data-p="${esc(f.path)}">${esc(folderName(f.path))}</button>`).join('') + (op === 'label' ? `<div class="pm-new"><input placeholder="New label" id="pm-new"></div>` : '');
  document.body.appendChild(pop);
  const r = (anchor || $('#m-reader')).getBoundingClientRect(); pop.style.left = Math.min(r.left, innerWidth - 230) + 'px'; pop.style.top = (r.bottom + 6) + 'px';
  const done = () => pop.remove();
  pop.addEventListener('click', e => { const b = e.target.closest('[data-p]'); if (!b) return; done(); const gm = M.status && M.status.gmail; act(op === 'label' && gm ? 'label' : 'move', t, { arg: b.dataset.p }); });
  const inp = pop.querySelector('#pm-new'); if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter' && inp.value.trim()) { done(); act('label', t, { arg: inp.value.trim() }).then(loadFolders); } });
  setTimeout(() => document.addEventListener('mousedown', function off(e) { if (!pop.contains(e.target)) { done(); document.removeEventListener('mousedown', off); } }), 0);
}
// re-route move/label through act with arg
const _act = act;
act = async function (op, row, o = {}) { if ((op === 'move' || op === 'label') && o.arg) { return actWithArg(op, row, o); } return _act(op, row, o); };
async function actWithArg(op, row, o) {
  const t = row || M.list.find(x => x.thread === M.sel) || { thread: M.sel };
  const folder = M.folder === '__starred' || M.search ? (M.thread[M.thread.length - 1] || t).folder : M.folder;
  if (op === 'move') { const idx = M.list.findIndex(x => x.thread === t.thread); M.list = M.list.filter(x => x.thread !== t.thread); if (t.thread === M.sel) { const next = M.list[Math.min(idx, M.list.length - 1)]; M.sel = null; if (next) selectIdx(M.list.indexOf(next)); else renderReader(); } renderList(); }
  try { await call(lh.mail.action({ op, thread: t.thread, folder, arg: o.arg })); toast(op === 'move' ? `Moved to ${folderName(o.arg)}.` : `Labeled ${o.arg}.`); if (op === 'label' && t.thread === M.sel) openThread(t, { quiet: true }); }
  catch (e) { toast(e.message, true); loadList(true); }
}

/* ---------- composer ---------- */
let C = null, saveT2 = null;
const sigHtml = () => S.settings.signature ? `<div class="lh-sig"><br>${S.settings.signature}</div>` : '';
const addrList = arr => (arr || []).map(a => typeof a === 'string' ? { address: a, name: '' } : a);
function quoteBlock(m, b) {
  const head = `On ${new Date(m.date).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}, ${esc(m.fromName ? `${m.fromName} <${m.fromAddr}>` : m.fromAddr)} wrote:`;
  const inner = b && b.html ? sanitize(b.html, b, false).html : `<div style="white-space:pre-wrap">${esc(b ? b.text : m.snippet)}</div>`;
  return `<div class="lh-quote"><div>${head}</div><blockquote type="cite">${inner}</blockquote></div>`;
}
async function reply(mode, of, bodyText, extra = {}) {
  const msgs = M.thread; if (!msgs.length) return;
  const target = of || [...msgs].reverse().find(m => !isMe(m.fromAddr)) || msgs[msgs.length - 1];
  let b = M.bodies.get(target.id); if (!b) { try { b = await call(lh.mail.body(target.folder, target.uid)); M.bodies.set(target.id, b); } catch (e) {} }
  const fromMe = isMe(target.fromAddr);
  let to = [], cc = [];
  const replyTo = target.replyTo && target.replyTo.toLowerCase() !== String(target.fromAddr).toLowerCase() ? [{ address: target.replyTo, name: '' }] : [{ address: target.fromAddr, name: target.fromName }];
  if (mode === 'reply') to = fromMe ? addrList(target.to) : replyTo;
  if (mode === 'replyAll') { to = fromMe ? addrList(target.to) : [...replyTo, ...addrList(target.to).filter(a => !isMe(a.address))]; cc = addrList(target.cc).filter(a => !isMe(a.address)); }
  const dedupe = l => { const s = new Set(); return l.filter(a => { const k = a.address.toLowerCase(); if (s.has(k)) return false; s.add(k); return true; }); };
  to = dedupe(to); cc = dedupe(cc).filter(a => !to.some(x => x.address.toLowerCase() === a.address.toLowerCase()));
  const base = String(target.subject || '').replace(/^\s*((re|fwd?|aw|wg)\s*:\s*)+/i, '');
  if (mode === 'forward') {
    const atts = (b && b.attachments || []).filter(a => !a.inline);
    const head = `<div class="lh-quote"><div>---------- Forwarded message ---------<br>From: ${esc(fmtAddr({ name: target.fromName, address: target.fromAddr }))}<br>Date: ${esc(fullWhen(target.date))}<br>Subject: ${esc(target.subject)}<br>To: ${esc((target.to || []).map(fmtAddr).join(', '))}</div><br>${b && b.html ? sanitize(b.html, b, false).html : `<div style="white-space:pre-wrap">${esc(b ? b.text : '')}</div>`}</div>`;
    return compose({ mode, subject: 'Fwd: ' + base, html: '<div><br></div>' + sigHtml() + '<br>' + head, forward: { folder: target.folder, uid: target.uid, indexes: atts.map(a => a.index) }, fwdAtts: atts });
  }
  const refs = [...(target.refs || []), target.msgid].filter(Boolean);
  const bodyHtml = bodyText ? (window.LH2A ? LH2A.textToHtml(bodyText) : `<div>${esc(bodyText)}</div>`) : '<div><br></div>';
  return compose({ mode, to, cc, subject: 'Re: ' + base, html: bodyHtml + sigHtml() + '<br>' + quoteBlock(target, b), inReplyTo: target.msgid, references: refs, replyOf: target.id, ...extra });
}
function parseMailto(u) {
  try { const url = new URL(u); const q = url.searchParams; return { to: decodeURIComponent(url.pathname).split(',').filter(Boolean).map(a => ({ address: a.trim(), name: '' })), cc: (q.get('cc') || '').split(',').filter(Boolean).map(a => ({ address: a.trim(), name: '' })), subject: q.get('subject') || '', html: q.get('body') ? `<div style="white-space:pre-wrap">${esc(q.get('body'))}</div>` + sigHtml() : '<div><br></div>' + sigHtml() }; } catch (e) { return {}; }
}
async function openDraft(t) {
  let b = null; try { b = await call(lh.mail.body(t.folder, t.uid)); } catch (e) { return toast(e.message, true); }
  compose({ mode: 'draft', to: t.to, cc: t.cc, subject: t.subject, html: b.html || `<div style="white-space:pre-wrap">${esc(b.text)}</div>`, draft: { folder: t.folder, uid: t.uid }, messageId: t.msgid, inReplyTo: t.inReplyTo, references: t.refs });
}
function compose(o = {}) {
  if (C && C.dirty) { if (!confirm('Replace the email you are writing? It is saved in Drafts.')) return; }
  if (o.mailto) o = { ...parseMailto(o.mailto), ...o };
  C = { mode: o.mode || 'new', to: addrList(o.to), cc: addrList(o.cc), bcc: addrList(o.bcc), showCc: !!(o.cc && o.cc.length), showBcc: false, subject: o.subject || '', attachments: [], fwdAtts: o.fwdAtts || [], forward: o.forward || null,
    inReplyTo: o.inReplyTo || null, references: o.references || [], replyOf: o.replyOf || null, draft: o.draft || null, messageId: o.messageId || null, dirty: false, savedAt: null, suggestionKey: o.suggestionKey || null, min: false, big: false, ai: !!o.ai };
  const el = $('#composer'); el.classList.remove('hidden', 'min', 'big');
  const title = { new: 'New message', reply: 'Reply', replyAll: 'Reply all', forward: 'Forward', draft: 'Draft' }[C.mode];
  el.innerHTML = `
    <div class="c-head"><b id="c-title">${title}</b><span class="grow"></span><button class="icon-btn sm" id="c-min" title="Minimize">${ICON.min}</button><button class="icon-btn sm" id="c-big" title="Bigger">${ICON.expand}</button><button class="icon-btn sm" id="c-close" title="Close and save draft">${ICON.x}</button></div>
    <div class="c-body">
      <div class="c-row" data-field="to"><label>To</label><div class="chips-in" id="c-to"></div><button class="link-btn" id="c-ccb">Cc Bcc</button></div>
      <div class="c-row ${C.showCc ? '' : 'hidden'}" id="c-cc-row" data-field="cc"><label>Cc</label><div class="chips-in" id="c-cc"></div></div>
      <div class="c-row hidden" id="c-bcc-row" data-field="bcc"><label>Bcc</label><div class="chips-in" id="c-bcc"></div></div>
      <div class="c-row"><input id="c-subject" placeholder="Subject" value="${esc(C.subject)}" spellcheck="true"></div>
      ${C.ai ? '<div class="c-ai">' + ICON.spark + '<span>Drafted by the assistant in your style. Read it and fill in anything in [brackets] before sending.</span></div>' : ''}
      <div class="c-editor selectable" id="c-editor" contenteditable="true" spellcheck="true"></div>
      <div class="c-atts" id="c-atts"></div>
    </div>
    <div class="c-foot">
      <button class="primary" id="c-send">Send</button><span class="kbd-tip">⌘ Return</span>
      <div class="c-tools">
        <button class="icon-btn sm" data-cmd="bold" title="Bold (⌘B)"><b>B</b></button><button class="icon-btn sm" data-cmd="italic" title="Italic (⌘I)"><i>I</i></button><button class="icon-btn sm" data-cmd="underline" title="Underline (⌘U)"><u>U</u></button>
        <button class="icon-btn sm" data-cmd="link" title="Link (⌘K)"><svg viewBox="0 0 16 16"><path d="M7 9a2.6 2.6 0 0 0 3.7 0l2-2a2.6 2.6 0 0 0-3.7-3.7l-.8.8M9 7a2.6 2.6 0 0 0-3.7 0l-2 2A2.6 2.6 0 0 0 7 12.7l.8-.8"/></svg></button>
        <button class="icon-btn sm" data-cmd="insertUnorderedList" title="Bulleted list"><svg viewBox="0 0 16 16"><path d="M6 4.5h7M6 8h7M6 11.5h7M3 4.5h.01M3 8h.01M3 11.5h.01"/></svg></button>
        <button class="icon-btn sm" data-cmd="insertOrderedList" title="Numbered list"><svg viewBox="0 0 16 16"><path d="M6.5 4.5h6.5M6.5 8h6.5M6.5 11.5h6.5"/><text x="2" y="6" font-size="4.5" fill="currentColor" stroke="none">1</text><text x="2" y="13" font-size="4.5" fill="currentColor" stroke="none">2</text></svg></button>
        <button class="icon-btn sm" data-cmd="removeFormat" title="Clear formatting"><svg viewBox="0 0 16 16"><path d="M4 4h8M8 4l-2 8M4 12.5l8-8.5"/></svg></button>
        <button class="icon-btn sm" id="c-attach" title="Attach files">${ICON.clip}</button>
      </div>
      <span class="c-state" id="c-state"></span><span class="grow"></span>
      <button class="icon-btn sm" id="c-discard" title="Discard">${ICON.trash}</button>
    </div>
    <div class="c-link hidden" id="c-link"><input id="c-link-url" placeholder="https://"><button class="secondary sm" id="c-link-ok">Add link</button></div>`;
  const ed = $('#c-editor'); ed.innerHTML = o.html != null ? o.html : '<div><br></div>' + sigHtml();
  for (const f of ['to', 'cc', 'bcc']) chipInput(f);
  renderCAtts();
  const dirty = () => { C.dirty = true; clearTimeout(saveT2); saveT2 = setTimeout(saveDraftNow, 3000); setState('Editing'); };
  ed.addEventListener('input', dirty); $('#c-subject').addEventListener('input', e => { C.subject = e.target.value; dirty(); });
  ed.addEventListener('paste', e => { const html = e.clipboardData.getData('text/html'); if (html) { e.preventDefault(); const clean = sanitize(html, {}, true).html.replace(/ style="[^"]*"/g, '').replace(/ class="[^"]*"/g, ''); document.execCommand('insertHTML', false, clean); } });
  $('#c-ccb').onclick = () => { $('#c-cc-row').classList.remove('hidden'); $('#c-bcc-row').classList.remove('hidden'); $('#c-ccb').classList.add('hidden'); $('#c-cc input').focus(); };
  $('#c-min').onclick = () => el.classList.toggle('min'); $('#c-big').onclick = () => el.classList.toggle('big');
  $('#c-close').onclick = () => closeComposer(true);
  $('#c-discard').onclick = discard;
  $('#c-send').onclick = sendNow;
  $('#c-attach').onclick = async () => { const files = await lh.attachPick(); if (files && files.length) { C.attachments.push(...files); renderCAtts(); dirty(); } };
  el.querySelectorAll('[data-cmd]').forEach(b => b.addEventListener('mousedown', e => { e.preventDefault(); const c = b.dataset.cmd; if (c === 'link') return linkBox(); document.execCommand(c); dirty(); }));
  el.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); sendNow(); }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && document.activeElement === ed) { e.preventDefault(); linkBox(); }
    if (e.key === 'Escape' && !document.querySelector('.ac-pop')) { e.preventDefault(); closeComposer(true); }
  });
  el.ondragover = e => e.preventDefault();
  el.ondrop = e => { e.preventDefault(); const fs = [...e.dataTransfer.files].map(f => f.path).filter(Boolean); if (fs.length) lh.attachStat(fs).then(st => { C.attachments.push(...st.filter(x => !x.missing)); renderCAtts(); dirty(); }); };
  setTimeout(() => { if (!C.to.length) $('#c-to input').focus(); else { ed.focus(); const r = document.createRange(); r.setStart(ed, 0); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } }, 30);
  if (S.tab !== 'mail' && S.tab !== 'assist') { /* composer floats over any view */ }
}
let savedRange = null;
function linkBox() { const s = getSelection(); savedRange = s.rangeCount ? s.getRangeAt(0).cloneRange() : null; $('#c-link').classList.remove('hidden'); const i = $('#c-link-url'); i.value = ''; i.focus(); const ok = () => { const u = i.value.trim(); $('#c-link').classList.add('hidden'); if (!u) return; const ed = $('#c-editor'); ed.focus(); if (savedRange) { const s2 = getSelection(); s2.removeAllRanges(); s2.addRange(savedRange); } const url = /^(https?:|mailto:)/i.test(u) ? u : 'https://' + u; if (savedRange && !savedRange.collapsed) document.execCommand('createLink', false, url); else document.execCommand('insertHTML', false, `<a href="${esc(url)}">${esc(u)}</a>`); C.dirty = true; }; $('#c-link-ok').onclick = ok; i.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); ok(); } if (e.key === 'Escape') { e.stopPropagation(); $('#c-link').classList.add('hidden'); } }; }
function setState(t) { const s = $('#c-state'); if (s) s.textContent = t; }
function chipInput(field) {
  const box = $('#c-' + field);
  const render = () => {
    box.innerHTML = C[field].map((a, i) => `<span class="rchip ${isEmail(a.address) ? '' : 'bad'}" title="${esc(a.address)}">${esc(a.name || a.address)}<button data-rm="${i}">×</button></span>`).join('') + `<input spellcheck="false" autocomplete="off">`;
    const inp = box.querySelector('input');
    inp.addEventListener('keydown', e => {
      if (['Enter', ',', ';', 'Tab'].includes(e.key) && inp.value.trim()) { if (acPick(inp, field, e)) return; e.preventDefault(); add(inp.value); }
      else if (e.key === 'Backspace' && !inp.value && C[field].length) { C[field].pop(); render(); C.dirty = true; box.querySelector('input').focus(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { acMove(e.key === 'ArrowDown' ? 1 : -1); e.preventDefault(); }
      else if (e.key === 'Escape') { acClose(); }
    });
    inp.addEventListener('input', () => { if (/[,;]\s*$/.test(inp.value)) return add(inp.value); ac(inp, field); });
    inp.addEventListener('blur', () => setTimeout(() => { if (inp.value.trim() && document.activeElement !== inp) add(inp.value, true); acClose(); }, 150));
    inp.addEventListener('paste', e => { const t = e.clipboardData.getData('text'); if (/[,;\n]/.test(t)) { e.preventDefault(); add(t); } });
  };
  const add = (v, noFocus) => {
    for (const part of String(v).split(/[,;\n]+/)) { const s = part.trim(); if (!s) continue; const m = /^(.*?)\s*<([^>]+)>$/.exec(s); const a = m ? { name: m[1].replace(/^"|"$/g, '').trim(), address: m[2].trim() } : { name: '', address: s }; if (!C[field].some(x => x.address.toLowerCase() === a.address.toLowerCase())) C[field].push(a); }
    C.dirty = true; render(); acClose(); if (!noFocus) box.querySelector('input').focus();
  };
  box.addEventListener('click', e => { const rm = e.target.closest('[data-rm]'); if (rm) { C[field].splice(Number(rm.dataset.rm), 1); C.dirty = true; render(); } box.querySelector('input').focus(); });
  box._add = add; render();
}
let acState = null;
async function ac(inp, field) {
  const q = inp.value.trim(); if (q.length < 1) return acClose();
  let list = []; try { list = await call(lh.mail.contacts(q)); } catch (e) {}
  if (inp.value.trim() !== q) return;
  list = list.filter(c => !C[field].some(x => x.address === c.address)); if (!list.length) return acClose();
  acClose(); const pop = document.createElement('div'); pop.className = 'ac-pop';
  pop.innerHTML = list.map((c, i) => `<button data-i="${i}" class="${i === 0 ? 'on' : ''}">${avatar(c.name, c.address, 'xs')}<span><b>${esc(c.name || c.address)}</b>${c.name ? `<small>${esc(c.address)}</small>` : ''}</span></button>`).join('');
  const r = inp.getBoundingClientRect(); pop.style.left = r.left + 'px'; pop.style.top = r.bottom + 4 + 'px'; document.body.appendChild(pop);
  acState = { pop, list, i: 0, inp, field };
  pop.addEventListener('mousedown', e => { const b = e.target.closest('[data-i]'); if (!b) return; e.preventDefault(); const c = list[Number(b.dataset.i)]; inp.value = ''; $('#c-' + field)._add(c.name ? `${c.name} <${c.address}>` : c.address); });
}
function acMove(d) { if (!acState) return; acState.i = (acState.i + d + acState.list.length) % acState.list.length; acState.pop.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === acState.i)); }
function acPick(inp, field, e) { if (!acState || acState.inp !== inp) return false; e.preventDefault(); const c = acState.list[acState.i]; inp.value = ''; $('#c-' + field)._add(c.name ? `${c.name} <${c.address}>` : c.address); return true; }
function acClose() { document.querySelectorAll('.ac-pop').forEach(p => p.remove()); acState = null; }
function renderCAtts() {
  const el = $('#c-atts'); if (!el) return;
  el.innerHTML = [...C.attachments.map((a, i) => `<span class="cat">${ICON.clip}<b>${esc(a.name)}</b><small>${a.size ? fmtSize(a.size) : ''}</small><button data-ra="${i}">×</button></span>`),
    ...C.fwdAtts.map((a, i) => `<span class="cat">${ICON.clip}<b>${esc(a.filename)}</b><small>${fmtSize(a.size || 0)}</small><button data-rf="${i}">×</button></span>`)].join('');
  el.onclick = e => { const a = e.target.closest('[data-ra]'), f = e.target.closest('[data-rf]'); if (a) C.attachments.splice(Number(a.dataset.ra), 1); if (f) { const x = C.fwdAtts.splice(Number(f.dataset.rf), 1)[0]; if (C.forward) C.forward.indexes = C.forward.indexes.filter(i => i !== x.index); } renderCAtts(); };
}
function payload() {
  for (const f of ['to', 'cc', 'bcc']) { const i = document.querySelector(`#c-${f} input`); if (i && i.value.trim()) $('#c-' + f)._add(i.value, true); }
  const ed = $('#c-editor').cloneNode(true);
  return { to: C.to.map(fmtAddr), cc: C.cc.map(fmtAddr), bcc: C.bcc.map(fmtAddr), subject: $('#c-subject').value, html: ed.innerHTML, attachments: C.attachments.map(a => ({ path: a.path, filename: a.name })), forward: C.forward,
    inReplyTo: C.inReplyTo, references: C.references, replyOf: C.replyOf, draft: C.draft, messageId: C.messageId, suggestionKey: C.suggestionKey };
}
async function saveDraftNow() {
  if (!C || C.sending) return;
  const p = payload(); if (!p.to.length && !p.subject && !$('#c-editor').innerText.trim()) return;
  setState('Saving…');
  try { const r = await call(lh.mail.saveDraft(p)); if (!C) return; C.draft = { folder: r.folder, uid: r.uid }; C.messageId = r.messageId; C.savedAt = Date.now(); setState('Saved to Drafts ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })); }
  catch (e) { setState('Could not save draft'); }
}
async function closeComposer(save) {
  clearTimeout(saveT2);
  if (save && C && C.dirty) { await saveDraftNow(); toast('Saved to Drafts.'); }
  C = null; acClose(); $('#composer').classList.add('hidden'); $('#composer').innerHTML = '';
}
async function discard() {
  if (!C) return; const d = C.draft; clearTimeout(saveT2); C.dirty = false; closeComposer(false);
  if (d) call(lh.mail.deleteDraft(d)).catch(() => {}); toast('Draft discarded.');
}
function actionToast(msg, label, fn, ms) {
  const t = document.createElement('div'); t.className = 'toast act';
  t.innerHTML = `<span>${esc(msg)}</span><button>${esc(label)}</button>`;
  $('#toasts').appendChild(t);
  let done = false; const close = () => { if (done) return; done = true; t.style.transition = 'opacity .3s'; t.style.opacity = 0; setTimeout(() => t.remove(), 300); };
  t.querySelector('button').onclick = () => { if (!done) { fn(); close(); } };
  setTimeout(close, ms); return close;
}
async function sendNow() {
  if (!C) return;
  const p = payload();
  if (!p.to.length && !p.cc.length && !p.bcc.length) return toast('Add at least one recipient.', true);
  const bad = [...C.to, ...C.cc, ...C.bcc].filter(a => !isEmail(a.address)); if (bad.length) return toast('Check these addresses: ' + bad.map(a => a.address).join(', '), true);
  if (!p.subject.trim() && !confirm('Send without a subject?')) return;
  const txt = $('#c-editor').innerText;
  if (/\[[^\]\n]{2,60}\]/.test(txt.split(/On .{5,200}wrote:/)[0]) && !confirm('There is still something in [brackets]. Send anyway?')) return;
  if (/\battach(ed|ment)\b/i.test(txt.split(/On .{5,200}wrote:/)[0]) && !C.attachments.length && !C.fwdAtts.length && !confirm('You mention an attachment but none is attached. Send anyway?')) return;
  sendWithUndo(p, { reopen: { ...C } });
  clearTimeout(saveT2); C.sending = true; C = null; acClose(); $('#composer').classList.add('hidden');
}
function sendWithUndo(p, { reopen, label } = {}) {
  const secs = Number(S.settings.undoSeconds == null ? 5 : S.settings.undoSeconds);
  let undone = false;
  const go2 = async () => {
    if (undone) return;
    try { const r = await call(lh.mail.send(p)); toast(label || 'Sent.'); refreshUsage(); if (r.warnings && r.warnings.length) console.warn(r.warnings); if (M.sel) openThread(M.list.find(x => x.thread === M.sel) || { thread: M.sel }, { quiet: true }); if (window.LH2A) LH2A.refresh(); }
    catch (e) { toast('Not sent: ' + e.message, true); if (reopen) restore(p, reopen); }
  };
  if (!secs) return go2();
  const timer = setTimeout(go2, secs * 1000);
  actionToast('Sending…', 'Undo', () => { undone = true; clearTimeout(timer); if (reopen) restore(p, reopen); }, secs * 1000);
}
function restore(p, old) {
  compose({ mode: old.mode, to: old.to, cc: old.cc, bcc: old.bcc, subject: p.subject, html: p.html, forward: old.forward, fwdAtts: old.fwdAtts, inReplyTo: old.inReplyTo, references: old.references, replyOf: old.replyOf, draft: old.draft, messageId: old.messageId, suggestionKey: old.suggestionKey });
  C.attachments = old.attachments || []; renderCAtts(); C.dirty = true;
}

/* ---------- keyboard ---------- */
const typing = () => { const a = document.activeElement; return a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)); };
document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (typing()) return;
  if (!$('#k-veil').classList.contains('hidden')) { if (e.key === 'Escape' || e.key === '?') { $('#k-veil').classList.add('hidden'); e.preventDefault(); } return; }
  if (e.key === 'c') { e.preventDefault(); return compose({}); }
  if (e.key === '?') { e.preventDefault(); return showKeys(); }
  if (!inTab()) return;
  const k = e.key, cur = M.list.find(x => x.thread === M.sel);
  const map = {
    j: () => selectIdx(Math.min(M.list.length - 1, M.idx + 1)), k: () => selectIdx(Math.max(0, M.idx - 1)),
    ArrowDown: () => selectIdx(Math.min(M.list.length - 1, M.idx + 1)), ArrowUp: () => selectIdx(Math.max(0, M.idx - 1)),
    o: () => M.idx >= 0 && selectIdx(M.idx), Enter: () => M.idx >= 0 && selectIdx(M.idx),
    u: () => { M.sel = null; renderReader(); renderList(); }, Escape: () => { M.sel = null; renderReader(); renderList(); },
    e: () => cur && act('archive', cur), '#': () => cur && act('trash', cur), Delete: () => cur && act('trash', cur), Backspace: () => cur && act('trash', cur), '!': () => cur && act('spam', cur),
    s: () => cur && act(cur.flagged ? 'unstar' : 'star', cur), r: () => M.thread.length && reply('reply'), a: () => M.thread.length && reply('replyAll'), f: () => M.thread.length && reply('forward'),
    I: () => cur && act('read', cur), U: () => cur && act('unread', cur), x: () => cur && toggleCheck(cur.thread), '/': () => $('#m-search').focus(),
    v: () => cur && act('move', cur, { anchor: document.querySelector('[data-act=move]') }), l: () => cur && act('label', cur, { anchor: document.querySelector('[data-act=label]') }),
    g: () => { gPending = Date.now(); },
    i: () => { if (Date.now() - gPending < 1200) openFolder(inboxPath()); }, t: () => { if (Date.now() - gPending < 1200 && special('\\Sent')) openFolder(special('\\Sent')); },
    d: () => { if (Date.now() - gPending < 1200 && special('\\Drafts')) openFolder(special('\\Drafts')); },
  };
  const fn = map[k]; if (fn) { e.preventDefault(); fn(); }
});
let gPending = 0;
function showKeys() {
  const rows = [['j / k', 'Next / previous conversation'], ['o or Return', 'Open'], ['u or Esc', 'Back to the list'], ['e', 'Archive'], ['#', 'Delete'], ['!', 'Report spam'], ['s', 'Star or unstar'], ['Shift I / Shift U', 'Mark read / unread'], ['x', 'Select'], ['v / l', 'Move / label'], ['r', 'Reply'], ['a', 'Reply all'], ['f', 'Forward'], ['c', 'Compose'], ['/', 'Search'], ['g then i / t / d', 'Go to Inbox / Sent / Drafts'], ['⌘ Return', 'Send'], ['?', 'This list']];
  $('#k-sheet').innerHTML = `<div class="sheet-h"><div class="eyebrow">Mail</div><h2>Keyboard shortcuts</h2></div><div class="keys-grid">${rows.map(([a, b]) => `<div><kbd>${esc(a)}</kbd></div><div>${esc(b)}</div>`).join('')}</div><div class="actions sheet-f"><span class="grow"></span><button class="primary" id="k-close">Done</button></div>`;
  $('#k-veil').classList.remove('hidden'); $('#k-close').onclick = () => $('#k-veil').classList.add('hidden');
}

/* ---------- status + events ---------- */
function renderStatus() {
  const st = M.status || {}; const live = $('#m-live'), ban = $('#m-banner');
  const map = { connecting: ['Connecting…', 'busy'], online: [st.idle ? 'Live' : 'Up to date', 'ok'], offline: ['Offline', 'warn'], nosetup: ['Not set up', ''] };
  const [txt, cls] = map[st.state] || ['', ''];
  live.className = 'm-live ' + cls; live.textContent = txt;
  live.title = st.idle ? 'New mail appears as soon as it arrives.' : '';
  if (st.error && st.state === 'offline') { ban.classList.remove('hidden'); ban.innerHTML = `<span>${esc(st.error)}</span><button class="ghost sm" id="m-retry">Try again</button>`; $('#m-retry').onclick = () => lh.mail.restart(); }
  else ban.classList.add('hidden');
}
let chT = null;
lh.on('mail:status', s => { M.status = s; renderStatus(); });
lh.on('mail:folders', () => loadFolders());
lh.on('mail:changed', () => { clearTimeout(chT); chT = setTimeout(async () => { await loadFolders(); if (inTab()) { await loadList(true); if (M.sel && !C) { const t = M.list.find(x => x.thread === M.sel); if (t && M.thread.length && t.count !== M.thread.length) openThread(t, { quiet: true }); } } }, 250); });
lh.on('mail:new', list => { if (inTab() && !document.hasFocus()) {} });
lh.on('mail:open', async o => { if (S.tab !== 'mail') go('mail'); if (M.folder !== inboxPath()) { M.folder = inboxPath(); await loadList(); } const i = M.list.findIndex(x => x.thread === o.thread); if (i >= 0) selectIdx(i); else { M.sel = o.thread; openThread({ thread: o.thread, folder: o.folder }); } });

/* ---------- tabs ---------- */
let first = true;
async function onTab(tab) {
  document.body.classList.toggle('in-mail', tab === 'mail');
  renderNav();
  if (tab === 'mail') {
    if (first) { first = false; try { M.status = await call(lh.mail.status()); } catch (e) {} renderStatus(); await loadFolders(); await loadList(); renderReader(); if (M.status && !M.status.ready && S.account && S.account.hasPassword && S.settings.mailEnabled === false) { $('#m-banner').classList.remove('hidden'); $('#m-banner').innerHTML = '<span>Mail is turned off in Settings.</span>'; } }
    else { renderList(); }
  }
  if (window.LH2A) LH2A.onTab(tab);
}
window.LH2 = { onTab, compose, reply, openFolder, sendWithUndo, call, M, avatar, when, fullWhen, isMe, sanitize, loadList, openThread: t => openThread(t), selectThread: async (thread, folder) => { if (S.tab !== 'mail') go('mail'); const i = M.list.findIndex(x => x.thread === thread); if (i >= 0) return selectIdx(i); M.sel = thread; await openThread({ thread, folder }); } };
loadFolders();
if (S.tab) onTab(S.tab);
})();
