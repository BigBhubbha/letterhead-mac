'use strict';
/* Letterhead 2: reply assistant UI (reader card, Suggested replies, Assistant settings, mail settings) */
(function () {
const { call } = LH2;
const escT = s => esc(s);
const textToHtml = t => String(t || '').trim().split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
const markPh = t => esc(t).replace(/\[([^\]\n]{1,80})\]/g, '<mark class="ph">[$1]</mark>');
const A = { status: null, list: [], cands: [], log: [], streams: new Map(), card: null, profile: null, progress: null };
const tz = () => (typeof tzAbbr === 'function' ? tzAbbr(Date.now(), SYS_TZ) : '');
const clock = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const aiOn = () => !!S.settings.aiEnabled;
const hasKey = () => A.status && A.status.keys && A.status.keys[S.settings.aiProvider || 'gemini'] && A.status.keys[S.settings.aiProvider || 'gemini'].saved;
const ICON_SPARK = '<svg viewBox="0 0 16 16"><path d="M8 2.5l1.2 3 3 1.2-3 1.2L8 11l-1.2-3.1-3-1.2 3-1.2z"/><path d="M12.3 10.6l.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5z"/></svg>';
const isBulky = m => !!m.bulk;
async function loadStatus() { try { A.status = await call(lh.ai.status()); } catch (e) {} $('#nav-ai-dot').classList.toggle('ok', aiOn() && !!hasKey()); }

/* ---------- reader card ---------- */
function targetOf(msgs) { const last = msgs[msgs.length - 1]; if (!last || LH2.isMe(last.fromAddr) || isBulky(last) || last.draft) return null; return last; }
async function readerCard(msgs, repaintOnly) {
  const el = document.getElementById('ai-card'); if (!el) return;
  const m = targetOf(msgs);
  if (!m) { el.innerHTML = ''; A.card = null; return; }
  if (!aiOn() || !hasKey()) { el.innerHTML = `<div class="ai-card muted">${ICON_SPARK}<span>Want a reply drafted in your voice?</span><button class="link-btn" data-go-ai>Set up the reply assistant</button></div>`; el.querySelector('[data-go-ai]').onclick = () => go('ai'); return; }
  let s = A.card && A.card.id === m.id ? A.card.s : null;
  if (!repaintOnly || !s) { try { s = await call(lh.assist.suggestion(m.id)); } catch (e) { s = null; } }
  A.card = { id: m.id, s, m };
  paintCard();
}
function paintCard() {
  const el = document.getElementById('ai-card'); if (!el || !A.card) return;
  const { s, m, id } = A.card; const stream = A.streams.get(id);
  const who = m.fromName || m.fromAddr;
  if (stream != null || (s && s.status === 'working')) {
    el.innerHTML = `<div class="ai-card working"><div class="ai-h">${ICON_SPARK}<b>Writing a reply in your voice</b><span class="grow"></span><span class="dots"><i></i><i></i><i></i></span></div><div class="ai-text stream">${stream ? markPh(stream) : '<span class="shimmer">Reading the conversation and your past replies…</span>'}</div></div>`;
    return;
  }
  if (!s || s.status === 'dismissed' || s.status === 'pending' || (s.status === 'sent' && !s.draft)) {
    el.innerHTML = `<div class="ai-card idle">${ICON_SPARK}<span>Draft a reply to ${esc(who)} in your voice</span><span class="grow"></span><button class="secondary sm" data-ai="default">Draft reply</button></div>`;
  } else if (s.status === 'error' && !s.draft) {
    el.innerHTML = `<div class="ai-card err">${ICON_SPARK}<span>${esc(s.error || 'The assistant could not write this one.')}</span><span class="grow"></span><button class="secondary sm" data-ai="default">Try again</button></div>`;
  } else if (s.status === 'sent') {
    el.innerHTML = `<div class="ai-card sent">${ICON_SPARK}<span>${s.auto ? 'Automatic reply sent' : 'Reply sent'} ${s.updatedAt ? 'at ' + clock(s.updatedAt) + ' ' + tz() : ''}.</span></div>`;
  } else {
    const sched = s.status === 'scheduled' && s.sendAt;
    el.innerHTML = `<div class="ai-card ready ${sched ? 'sched' : ''}">
      <div class="ai-h">${ICON_SPARK}<b>${sched ? 'Automatic reply waiting' : 'Suggested reply'}</b><span class="ai-model">${esc(s.model || '')}</span><span class="grow"></span>${sched ? `<span class="chip warn" id="ai-count">Sends at ${clock(s.sendAt)} ${tz()}</span>` : ''}<button class="icon-btn sm" data-ai="dismiss" title="Dismiss">${'<svg viewBox="0 0 16 16"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>'}</button></div>
      ${sched ? `<div class="ai-note">Rule “${esc(s.rule || '')}” will send this to ${esc(m.fromAddr)}. Stop it to keep it as a normal suggestion.</div>` : ''}
      ${s.error ? `<div class="ai-note warn">${esc(s.error)}</div>` : ''}
      <div class="ai-text selectable" id="ai-text" contenteditable="true" spellcheck="true">${markPh(s.draft || '')}</div>
      ${/\[[^\]\n]{1,80}\]/.test(s.draft || '') ? '<div class="ai-note">Fill in the parts in [brackets] before sending.</div>' : ''}
      <div class="ai-actions">
        ${sched ? '<button class="primary sm" data-ai="hold">Stop</button><button class="secondary sm" data-ai="send">Send now</button>' : '<button class="primary sm" data-ai="send">Send</button>'}
        <button class="secondary sm" data-ai="edit">Edit in composer</button>
        <span class="sep"></span>
        <button class="ghost sm" data-ai="regenerate">Regenerate</button><button class="ghost sm" data-ai="shorter">Shorter</button><button class="ghost sm" data-ai="formal">More formal</button>
      </div>
      <div class="ai-foot">Written by AI from your style. Read it before you send.</div>
    </div>`;
    const t = document.getElementById('ai-text');
    let saveT = null; t.addEventListener('input', () => { clearTimeout(saveT); saveT = setTimeout(() => { A.card.s.draft = t.innerText; call(lh.assist.setDraft(s.k, t.innerText)).catch(() => {}); }, 600); });
  }
  el.querySelectorAll('[data-ai]').forEach(b => b.onclick = () => cardAction(b.dataset.ai));
}
async function cardAction(op) {
  const { s, m, id } = A.card || {}; if (!A.card) return;
  const textNow = () => { const t = document.getElementById('ai-text'); return t ? t.innerText.trim() : (s && s.draft) || ''; };
  if (op === 'dismiss') { await call(lh.assist.dismiss(s.k)).catch(() => {}); A.card.s = { ...s, status: 'dismissed' }; return paintCard(); }
  if (op === 'hold') { A.card.s = await call(lh.assist.hold(s.k)); toast('Stopped. It will not send by itself.'); return paintCard(); }
  if (op === 'edit') { const txt = textNow(); return LH2.reply('reply', m, txt, { suggestionKey: s.k, ai: true }); }
  if (op === 'send') {
    const txt = textNow(); if (!txt) return;
    if (/\[[^\]\n]{1,80}\]/.test(txt) && !confirm('There is still something in [brackets]. Send anyway?')) return;
    if (s.status === 'scheduled') await call(lh.assist.hold(s.k)).catch(() => {});
    await call(lh.assist.setDraft(s.k, txt)).catch(() => {});
    // build the same reply the composer would, with the quote and signature, and send with undo
    const fake = await buildReply(m, txt, s.k);
    A.card.s = { ...s, status: 'sent', draft: txt, updatedAt: Date.now() }; paintCard();
    return LH2.sendWithUndo(fake, { label: 'Reply sent.' });
  }
  // draft / variants
  const variant = op === 'default' ? 'default' : op;
  if (s && s.draft && document.getElementById('ai-text')) await call(lh.assist.setDraft(s.k, textNow())).catch(() => {});
  const sid = Math.random().toString(36).slice(2); A.streams.set(id, ''); A.sid = sid; paintCard();
  try { A.card.s = await call(lh.assist.draft(id, { variant, stream: sid })); }
  catch (e) { toast(e.message, true); try { A.card.s = await call(lh.assist.suggestion(id)); } catch (e2) {} }
  A.streams.delete(id); if (A.card && A.card.id === id) paintCard();
}
async function buildReply(m, txt, key) {
  let b = LH2.M.bodies.get(m.id); if (!b) { try { b = await call(lh.mail.body(m.folder, m.uid)); } catch (e) {} }
  const base = String(m.subject || '').replace(/^\s*((re|fwd?)\s*:\s*)+/i, '');
  const sig = S.settings.signature ? `<div class="lh-sig"><br>${S.settings.signature}</div>` : '';
  const head = `On ${new Date(m.date).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}, ${esc(m.fromName ? `${m.fromName} <${m.fromAddr}>` : m.fromAddr)} wrote:`;
  const inner = b && b.html ? LH2.sanitize(b.html, b, false).html : `<div style="white-space:pre-wrap">${esc(b ? b.text : m.snippet)}</div>`;
  return { to: [m.replyTo || (m.fromName ? `${m.fromName} <${m.fromAddr}>` : m.fromAddr)], cc: [], bcc: [], subject: 'Re: ' + base, html: textToHtml(txt) + sig + `<br><div class="lh-quote"><div>${head}</div><blockquote type="cite">${inner}</blockquote></div>`, attachments: [], inReplyTo: m.msgid, references: [...(m.refs || []), m.msgid].filter(Boolean), replyOf: m.id, suggestionKey: key };
}
lh.on('assist:delta', d => { if (!A.streams.has(d.id)) return; A.streams.set(d.id, A.streams.get(d.id) + d.t); if (A.card && A.card.id === d.id) { const el = document.querySelector('.ai-text.stream'); if (el) el.innerHTML = markPh(A.streams.get(d.id)); else paintCard(); } });
lh.on('assist:changed', s => {
  if (A.card && s && A.card.s && A.card.s.k === s.k && !A.streams.has(A.card.id)) { A.card.s = s; paintCard(); }
  else if (A.card && s && !A.card.s && s.msgid === A.card.m.msgid && !A.streams.has(A.card.id)) { A.card.s = s; paintCard(); }
  if (S.tab === 'assist') renderQueueSoon(); else countSoon();
});
lh.on('assist:log', () => { if (S.tab === 'ai') renderLog(); });

/* ---------- Suggested replies ---------- */
let qT = null; const renderQueueSoon = () => { clearTimeout(qT); qT = setTimeout(renderQueue, 300); };
let cT = null; const countSoon = () => { clearTimeout(cT); cT = setTimeout(updateCount, 500); };
async function updateCount() { try { A.list = await call(lh.assist.list()); } catch (e) { A.list = []; } const n = A.list.filter(s => ['ready', 'scheduled'].includes(s.status)).length; $('#nav-assist-count').textContent = n ? n : ''; }
async function renderQueue() {
  const el = $('#as-body');
  if (!aiOn() || !hasKey()) { el.innerHTML = `<div class="card empty-big">${ICON_SPARK}<h3>The reply assistant is off</h3><p>Turn it on and add a free Gemini key, and Letterhead drafts replies for new mail in your own style. You check every one before it goes.</p><button class="primary" data-goai>Set it up</button></div>`; el.querySelector('[data-goai]').onclick = () => go('ai'); return; }
  try { [A.list, A.cands] = await Promise.all([call(lh.assist.list()), call(lh.assist.candidates())]); } catch (e) { A.list = []; A.cands = []; }
  updateCountFrom();
  const groups = [['scheduled', 'Automatic replies waiting'], ['ready', 'Ready for you'], ['working', 'Writing'], ['pending', 'Writing'], ['error', 'Could not write'], ['sent', 'Sent recently']];
  const out = [];
  for (const [st, title] of groups) {
    const items = A.list.filter(s => s.status === st && !s.gone); if (!items.length) continue;
    if (st === 'pending' && A.list.some(s => s.status === 'working')) { /* merged with writing */ }
    out.push(`<div class="q-group"><div class="nav-label">${title}</div>${items.map(qCard).join('')}</div>`);
  }
  if (A.cands.length) out.push(`<div class="q-group"><div class="nav-label">Might need a reply</div><div class="card q-cands">${A.cands.slice(0, 12).map(c => `<div class="q-cand">${LH2.avatar(c.fromName, c.fromAddr, 'sm')}<div><b>${esc(c.fromName || c.fromAddr)}</b><span>${esc(c.subject)}</span></div><span class="grow"></span><small>${esc(LH2.when(c.date))}</small><button class="ghost sm" data-open="${esc(c.thread)}|${esc(c.folder)}">Open</button></div>`).join('')}<div class="actions"><span class="hint grow">Each draft is one request to your AI provider.</span><button class="secondary sm" id="q-draftall">Draft replies for these</button></div></div></div>`);
  if (!out.length) out.push(`<div class="card empty-big">${ICON_SPARK}<h3>Nothing waiting</h3><p>When personal mail arrives, a suggested reply shows up here and in the conversation.</p></div>`);
  el.innerHTML = out.join('');
  el.querySelectorAll('[data-q]').forEach(b => b.onclick = () => qAction(b.dataset.q, b.dataset.k));
  el.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { const [t, f] = b.dataset.open.split('|'); LH2.selectThread(t, f); });
  el.querySelectorAll('.q-text').forEach(t => { let st = null; t.addEventListener('input', () => { clearTimeout(st); st = setTimeout(() => call(lh.assist.setDraft(t.dataset.k, t.innerText)).catch(() => {}), 600); }); });
  const da = $('#q-draftall'); if (da) da.onclick = async () => { await call(lh.assist.queueBacklog(A.cands.slice(0, 12).map(c => c.id))); toast('Drafting in the background.'); setTimeout(renderQueue, 800); };
  tickCountdowns();
}
function updateCountFrom() { const n = A.list.filter(s => ['ready', 'scheduled'].includes(s.status)).length; $('#nav-assist-count').textContent = n ? n : ''; }
function qCard(s) {
  const sched = s.status === 'scheduled';
  const body = s.status === 'working' || s.status === 'pending' ? '<div class="q-text muted"><span class="shimmer">Writing…</span></div>' : s.status === 'error' ? `<div class="q-text muted">${esc(s.error || '')}</div>` : `<div class="q-text selectable" contenteditable="${s.status === 'sent' ? 'false' : 'true'}" data-k="${esc(s.k)}">${markPh(s.draft || '')}</div>`;
  const acts = s.status === 'sent' ? `<button class="ghost sm" data-q="open" data-k="${esc(s.k)}">Open conversation</button>` :
    sched ? `<button class="primary sm" data-q="hold" data-k="${esc(s.k)}">Stop</button><button class="secondary sm" data-q="send" data-k="${esc(s.k)}">Send now</button><button class="ghost sm" data-q="open" data-k="${esc(s.k)}">Open conversation</button>` :
    s.status === 'ready' ? `<button class="primary sm" data-q="send" data-k="${esc(s.k)}">Send</button><button class="secondary sm" data-q="open" data-k="${esc(s.k)}">Open conversation</button><button class="ghost sm" data-q="regenerate" data-k="${esc(s.k)}">Regenerate</button><button class="ghost sm" data-q="dismiss" data-k="${esc(s.k)}">Dismiss</button>` :
    s.status === 'error' ? `<button class="secondary sm" data-q="regenerate" data-k="${esc(s.k)}">Try again</button><button class="ghost sm" data-q="dismiss" data-k="${esc(s.k)}">Dismiss</button>` : '';
  return `<div class="card q-card ${s.status}">
    <div class="q-h">${LH2.avatar(s.fromName, s.fromAddr, 'sm')}<div class="q-who"><b>${esc(s.fromName || s.fromAddr)}</b><span>${esc(s.subject || '')}</span></div><span class="grow"></span>
    ${sched ? `<span class="chip warn" data-count="${s.sendAt}">Sends at ${clock(s.sendAt)} ${tz()}</span>` : s.status === 'sent' ? `<span class="chip ok">${s.auto ? 'Sent automatically' : 'Sent'}</span>` : `<small>${esc(LH2.when(s.date))}</small>`}</div>
    ${sched ? `<div class="ai-note">Rule “${esc(s.rule || '')}”. Edit the text below and it sends your version.</div>` : ''}
    ${s.snippet ? `<div class="q-orig">“${esc(s.snippet.slice(0, 180))}${s.snippet.length > 180 ? '…' : ''}”</div>` : ''}
    ${body}
    <div class="ai-actions">${acts}</div>
  </div>`;
}
function tickCountdowns() {
  document.querySelectorAll('[data-count]').forEach(c => { const ms = Number(c.dataset.count) - Date.now(); c.textContent = ms > 0 ? `Sends in ${ms > 3600e3 ? Math.round(ms / 3600e3) + ' h' : Math.max(1, Math.ceil(ms / 60000)) + ' min'}, at ${clock(Number(c.dataset.count))} ${tz()}` : 'Sending…'; });
  const ac = document.getElementById('ai-count'); if (ac && A.card && A.card.s && A.card.s.sendAt) { const ms = A.card.s.sendAt - Date.now(); ac.textContent = ms > 0 ? `Sends in ${Math.max(1, Math.ceil(ms / 60000))} min, at ${clock(A.card.s.sendAt)} ${tz()}` : 'Sending…'; }
}
setInterval(tickCountdowns, 15000);
async function qAction(op, k) {
  const s = A.list.find(x => x.k === k); if (!s) return;
  if (op === 'open') return LH2.selectThread(s.thread, s.folder);
  if (op === 'dismiss') { await call(lh.assist.dismiss(k)); return renderQueue(); }
  if (op === 'hold') { await call(lh.assist.hold(k)); toast('Stopped. It will not send by itself.'); return renderQueue(); }
  if (op === 'regenerate') { if (!s.messageId) return toast('That email is no longer in your mailbox.', true); call(lh.assist.draft(s.messageId, { variant: s.draft ? 'regenerate' : 'default' })).catch(e => toast(e.message, true)).finally(renderQueue); setTimeout(renderQueue, 200); return; }
  if (op === 'send') {
    const t = document.querySelector(`.q-text[data-k="${CSS.escape(k)}"]`); const txt = t ? t.innerText.trim() : s.draft;
    if (/\[[^\]\n]{1,80}\]/.test(txt) && !confirm('There is still something in [brackets]. Send anyway?')) return;
    if (s.status === 'scheduled') await call(lh.assist.hold(k)).catch(() => {});
    await call(lh.assist.setDraft(k, txt)).catch(() => {});
    let row = null; try { const th = await call(lh.mail.thread(s.thread)); row = th.find(m => m.id === s.messageId) || th.filter(m => !LH2.isMe(m.fromAddr)).pop(); } catch (e) {}
    if (!row) return toast('That email is no longer in your mailbox.', true);
    const p = await buildReply(row, txt, k);
    LH2.sendWithUndo(p, { label: 'Reply sent.' }); setTimeout(renderQueue, 7000); return;
  }
}
$('#as-refresh').addEventListener('click', renderQueue);

/* ---------- Assistant settings ---------- */
function renderAI() {
  const st = S.settings; const p = st.aiProvider || 'gemini';
  $('#ai-enabled').checked = !!st.aiEnabled; $('#ai-provider').value = p;
  const k = A.status && A.status.keys[p];
  $('#ai-key').value = ''; $('#ai-key').placeholder = k && k.saved ? `Saved key ending in ${k.tail}` : p === 'gemini' ? 'Paste your Gemini API key' : 'Paste your API key';
  $('#ai-key-status').textContent = k && k.saved ? `Saved, ending in ${k.tail}. ${k.encrypted ? 'Encrypted with your macOS Keychain.' : 'Stored on this computer.'} Models: ${(A.status.models[p] || []).slice(0, 2).join(', then ')}.` : 'No key saved yet.';
  $('#ai-key-remove').classList.toggle('hidden', !(k && k.saved));
  $('#ai-keyhelp').classList.toggle('hidden', p !== 'gemini');
  $('#ai-terms').classList.toggle('hidden', p !== 'gemini');
  $('#ai-autoDraft').checked = st.autoDraft !== false; $('#ai-autoDraftDaily').value = st.autoDraftDaily || 40;
  const ar = Object.assign({ enabled: false, rules: [], dailyLimit: 10 }, st.autoReply || {});
  $('#ar-enabled').checked = !!ar.enabled; $('#ar-limit').value = ar.dailyLimit;
  $('#st-window').value = String(st.indexWindow || 1000);
  $('#st-about').value = st.aboutMe || '';
  renderRules(); renderProfile(); renderLog();
  document.querySelectorAll('#view-ai .needs-ai').forEach(x => x.classList.toggle('dim', !st.aiEnabled));
}
async function renderProfile() {
  try { A.profile = await call(lh.style.profile()); A.progress = await call(lh.style.progress()); } catch (e) {}
  const p = A.profile || {}, g = A.progress || {};
  const busy = ['listing', 'reading', 'describing'].includes(g.state);
  $('#st-run').disabled = busy || !aiOn(); $('#st-run').textContent = busy ? 'Working…' : p.count ? 'Update my style profile' : 'Build my style profile';
  $('#st-bar').classList.toggle('hidden', !busy);
  const pct = g.state === 'reading' && g.total ? Math.round(100 * g.done / g.total) : g.state === 'describing' && g.steps ? Math.round(100 * g.step / g.steps) : g.state === 'listing' ? 3 : 100;
  $('#st-fill').style.width = pct + '%';
  $('#st-status').textContent = g.state === 'listing' ? 'Finding your sent mail…' : g.state === 'reading' ? `Reading sent mail: ${fmtN(g.done || 0)} of ${fmtN(g.total || 0)}` : g.state === 'describing' ? `Describing your tone, step ${g.step} of ${g.steps}. Small batches to stay inside the free quota.` : g.state === 'error' ? 'Stopped: ' + g.error + '. Run it again to pick up where it left off.' : g.toneError ? `Your measured habits are saved. The tone step stopped: ${g.toneError} Run it again later to finish it.` : p.indexedAt ? `Learned from ${fmtN(p.indexedCount || p.count || 0)} sent emails on ${new Date(p.indexedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}.` : !aiOn() ? 'Turn on the assistant first.' : '';
  const box = $('#st-profile');
  if (!p.stats && !p.tone) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="prof-cols">
    <div><div class="eyebrow">Your tone</div>${p.tone ? `<div class="prof-tone selectable" id="st-tone" contenteditable="true" spellcheck="true">${esc(p.tone)}</div><small class="hint">Edit this if something is off. The assistant follows it.</small>` : '<p class="hint">Not described yet. It needs your API key and a few minutes of free quota.</p>'}</div>
    <div><div class="eyebrow">Measured on this Mac</div><div class="prof-stats selectable">${esc(p.statsText || '').replace(/\n/g, '<br>')}</div></div></div>`;
}
let progT = null;
lh.on('style:progress', g => { A.progress = g; clearTimeout(progT); progT = setTimeout(() => { if (S.tab === 'ai') renderProfile(); }, 120); });
lh.on('style:profile', () => { if (S.tab === 'ai') renderProfile(); });
function renderRules() {
  const ar = Object.assign({ enabled: false, rules: [], dailyLimit: 10 }, S.settings.autoReply || {});
  $('#ar-rules').innerHTML = ar.rules.length ? ar.rules.map((r, i) => `<div class="rule ${r.enabled ? '' : 'off'}" data-r="${i}">
    <div class="rule-h"><label class="tgl sm"><input type="checkbox" data-f="enabled" ${r.enabled ? 'checked' : ''}><i></i></label><input class="rule-name" data-f="name" value="${esc(r.name || '')}" placeholder="Rule name"><span class="grow"></span><button class="ghost sm" data-del="${i}">Remove</button></div>
    <div class="grid2">
      <label class="fld"><span>From these senders</span><input data-f="senders" value="${esc((r.senders || []).join(', '))}" placeholder="mom@example.com, @stanford.edu" spellcheck="false"></label>
      <label class="fld"><span>Or with these labels</span><input data-f="labels" value="${esc((r.labels || []).join(', '))}" placeholder="Research" spellcheck="false"></label>
    </div>
    <div class="row"><label class="fld inline"><span>Wait</span><select data-f="reviewMin">${[10, 30, 60, 120, 240, 480].map(m => `<option value="${m}" ${Number(r.reviewMin || 30) === m ? 'selected' : ''}>${m < 60 ? m + ' minutes' : m / 60 + (m === 60 ? ' hour' : ' hours')}</option>`).join('')}</select><span>before sending, so I can stop it</span></label></div>
    <div class="row"><label class="chk"><input type="checkbox" data-f="anyone" ${r.anyone ? 'checked' : ''}> Anyone at all, when no senders or labels are listed</label></div>
    ${!(r.senders || []).length && !(r.labels || []).length && !r.anyone ? '<small class="hint warn-t">Add a sender or label. A rule with neither matches nobody.</small>' : ''}
  </div>`).join('') : '<p class="hint">No rules yet. Example: reply automatically to @stanford.edu after 30 minutes.</p>';
  $('#ar-rules').querySelectorAll('[data-r]').forEach(row => {
    const i = Number(row.dataset.r);
    row.querySelectorAll('[data-f]').forEach(inp => inp.addEventListener('change', () => {
      const ar2 = Object.assign({ enabled: false, rules: [], dailyLimit: 10 }, S.settings.autoReply || {}); const r = ar2.rules[i]; const f = inp.dataset.f;
      r[f] = inp.type === 'checkbox' ? inp.checked : f === 'senders' || f === 'labels' ? inp.value.split(/[,\s]+/).map(x => x.trim()).filter(Boolean) : f === 'reviewMin' ? Number(inp.value) : inp.value;
      saveSetting('autoReply', ar2).then(renderRules);
    }));
    row.querySelector('[data-del]').onclick = () => { const ar2 = Object.assign({}, S.settings.autoReply); ar2.rules = ar2.rules.filter((_, j) => j !== i); saveSetting('autoReply', ar2).then(renderRules); };
  });
}
async function renderLog() {
  try { A.log = await call(lh.assist.autolog()); } catch (e) { A.log = []; }
  const W = { sent: 'Sent', skipped: 'Skipped', held: 'Held', cancelled: 'Stopped', failed: 'Failed' };
  $('#ar-log').innerHTML = A.log.length ? `<table class="logt"><tbody>${A.log.slice(0, 40).map(l => `<tr><td>${esc(new Date(l.t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</td><td><span class="chip ${l.status === 'sent' ? 'ok' : l.status === 'failed' ? 'bad' : ''}">${W[l.status] || l.status}</span></td><td>${esc(l.toAddr)}</td><td class="t-sub">${esc(l.subject || '')}</td><td class="t-why">${esc(l.reason || l.rule || '')}</td></tr>`).join('')}</tbody></table>` : '<p class="hint">Nothing yet. Every automatic reply, and every one that was skipped or stopped, is listed here.</p>';
}
$('#ai-enabled').addEventListener('change', async e => {
  if (e.target.checked && !confirm('Turn on the reply assistant?\n\nTo write replies, Letterhead sends the email you are answering, earlier messages in that conversation, a few of your past replies and your style notes to the AI provider you choose. Your index and style profile stay on this Mac.')) { e.target.checked = false; return; }
  await saveSetting('aiEnabled', e.target.checked); await loadStatus(); renderAI();
});
$('#ai-provider').addEventListener('change', async e => { await saveSetting('aiProvider', e.target.value); renderAI(); });
$('#ai-key-save').addEventListener('click', async () => {
  const v = $('#ai-key').value.trim(); if (!v) return toast('Paste a key first.', true);
  try { A.status.keys = await call(lh.ai.setKey($('#ai-provider').value, v)); toast('Key saved.'); await loadStatus(); renderAI(); } catch (e) { toast(e.message, true); }
});
$('#ai-key').addEventListener('keydown', e => { if (e.key === 'Enter') $('#ai-key-save').click(); });
$('#ai-key-remove').addEventListener('click', async () => { if (!confirm('Remove the saved key?')) return; await call(lh.ai.setKey($('#ai-provider').value, '')); await loadStatus(); renderAI(); });
$('#ai-test').addEventListener('click', async () => {
  const out = $('#ai-test-out'); out.textContent = 'Asking…'; out.className = 'hint grow'; const t0 = Date.now();
  try { const r = await call(lh.ai.test()); out.textContent = `Works. ${r.model} answered in ${((Date.now() - t0) / 1000).toFixed(1)} s: “${r.text.slice(0, 80)}”`; out.className = 'hint grow ok-t'; }
  catch (e) { out.textContent = e.message; out.className = 'hint grow warn-t'; }
});
$('#st-run').addEventListener('click', async () => { if (!hasKey()) toast('Your habits are measured on this Mac. Add a key to also describe your tone.'); await call(lh.style.index(Number($('#st-window').value))); setTimeout(renderProfile, 300); });
$('#st-save').addEventListener('click', async () => { await saveSetting('aboutMe', $('#st-about').value.trim()); const t = document.getElementById('st-tone'); if (t) await call(lh.style.saveProfile({ tone: t.innerText.trim() })); toast('Saved.'); });
$('#st-clear').addEventListener('click', async () => { if (!confirm('Delete your style profile and the index of your sent mail from this Mac?')) return; await call(lh.style.clear()); renderProfile(); toast('Deleted.'); });
$('#ai-autoDraft').addEventListener('change', e => saveSetting('autoDraft', e.target.checked));
$('#ai-autoDraftDaily').addEventListener('change', e => saveSetting('autoDraftDaily', Math.max(0, Number(e.target.value) || 0)));
$('#ar-enabled').addEventListener('change', async e => {
  const ar = Object.assign({ enabled: false, rules: [], dailyLimit: 10 }, S.settings.autoReply || {});
  if (e.target.checked) {
    if (!aiOn()) { e.target.checked = false; return toast('Turn on the reply assistant first.', true); }
    if (!confirm('Turn on automatic replies?\n\nLetterhead will send replies written by AI, under your name, to mail that matches your rules, after the waiting time you set. You can stop any of them in Suggested replies before they go.')) { e.target.checked = false; return; }
  }
  ar.enabled = e.target.checked; await saveSetting('autoReply', ar); renderRules();
});
$('#ar-limit').addEventListener('change', e => { const ar = Object.assign({ enabled: false, rules: [], dailyLimit: 10 }, S.settings.autoReply || {}); ar.dailyLimit = Math.max(1, Math.min(100, Number(e.target.value) || 10)); saveSetting('autoReply', ar); });
$('#ar-add').addEventListener('click', () => { const ar = Object.assign({ enabled: false, rules: [], dailyLimit: 10 }, S.settings.autoReply || {}); ar.rules = [...(ar.rules || []), { id: Math.random().toString(36).slice(2, 8), name: 'New rule', enabled: true, senders: [], labels: [], reviewMin: 30, anyone: false }]; saveSetting('autoReply', ar).then(renderRules); });

/* ---------- mail settings on the Settings tab ---------- */
function renderMailSettings() {
  const st = S.settings;
  $('#set-mailEnabled').checked = st.mailEnabled !== false; $('#set-notifyMail').checked = st.notifyMail !== false; $('#set-dockBadge').checked = st.dockBadge !== false; $('#set-showImages').checked = !!st.showImages;
  const sig = $('#set-signature'); if (document.activeElement !== sig) sig.innerHTML = st.signature || '';
}
for (const k of ['mailEnabled', 'notifyMail', 'dockBadge', 'showImages']) $('#set-' + k).addEventListener('change', e => saveSetting(k, e.target.checked));
let sigT = null; $('#set-signature').addEventListener('input', e => { clearTimeout(sigT); sigT = setTimeout(() => saveSetting('signature', LH2.sanitize(e.target.innerHTML, {}, true).html), 500); });

function onTab(tab) {
  if (tab === 'assist') renderQueue();
  if (tab === 'ai') loadStatus().then(renderAI);
  if (tab === 'settings') renderMailSettings();
}
window.LH2A = { readerCard, onTab, refresh: () => { if (S.tab === 'assist') renderQueue(); countSoon(); }, textToHtml };
loadStatus().then(updateCount);
if (S.tab === 'ai' || S.tab === 'assist') onTab(S.tab);
})();
