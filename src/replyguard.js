'use strict';
// Letterhead only sends new emails. Anything that looks like a reply (or a forward of a
// thread) is refused, checked on the exact bytes about to go out. When in doubt, refuse.

// RFC 2047 encoded words (=?charset?B|Q?...?=). Unknown charsets throw, which fails closed.
function decodeWords(v) {
  return String(v).replace(/\?=\s+=\?/g, '?==?').replace(/=\?([^?]+)\?([bqBQ])\?([^?]*)\?=/g, (m, cs, enc, txt) => {
    const bytes = enc.toUpperCase() === 'B' ? Buffer.from(txt, 'base64')
      : Buffer.from(txt.replace(/_/g, ' ').replace(/=([0-9a-fA-F]{2})/g, (x, h) => String.fromCharCode(parseInt(h, 16))), 'binary');
    return new TextDecoder(cs.split('*')[0].trim().toLowerCase(), { fatal: true }).decode(bytes);
  });
}

// Reply / forward prefixes in many languages, matched case-insensitively at the start of the
// subject (after brackets like "[list]"), with optional counters such as "Re[2]:" or "RE(3):".
const PREFIXES = [
  're', 'r', 'aw', 'sv', 'vs', 'antw', 'antwort', 'odp', 'rif', 'ref', 'res', 'resp', 'rv', 'ynt', 'vá', 'va', 'atb', 'v', 'bls',
  'fw', 'fwd', 'tr', 'wg', 'enc', 'i', 'pd', 'fs', 'vl', 'továbbítás', 'doorst',
  'отв', 'ответ', 'на', 'пер', 'πρθ', 'απ', 'σχετ', 'הועבר', 'השב', 'תשובה', 'رد', 'إعادة توجيه', 'ح',
  '回复', '回覆', '答复', '答覆', '转发', '轉寄', '返信', '転送', '회신', '답장', '전달', 'جواب',
];
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PREFIX_RE = new RegExp('^\\s*(?:\\[[^\\]]*\\]\\s*)*(?:' + PREFIXES.map(esc).join('|') + ')\\s*(?:\\[\\d+\\]|\\(\\d+\\)|\\d+)?\\s*[:：]', 'iu');

function subjectReason(subject) {
  if (subject == null) return null;
  let s = String(subject).normalize('NFKC');
  if (PREFIX_RE.test(s)) return 'Subject starts like a reply or forward ("' + s.trim().slice(0, 40) + '")';
  return null;
}

function decodeSubject(v) {
  if (!/=\?/.test(v)) return v;
  return decodeWords(v);
}

// Unfolded header blocks of a raw RFC 822 message. Throws when there is no usable header.
function headerBlocks(raw) {
  const s = Buffer.isBuffer(raw) ? raw.toString('binary') : String(raw == null ? '' : raw);
  let i = s.indexOf('\r\n\r\n'); if (i < 0) i = s.indexOf('\n\n');
  const head = i < 0 ? s : s.slice(0, i);
  const blocks = [];
  for (const l of head.split(/\r?\n/)) {
    if (/^[ \t]/.test(l) && blocks.length) blocks[blocks.length - 1] += ' ' + l.trim();
    else if (l.length) blocks.push(l);
  }
  const out = [];
  for (const b of blocks) {
    const c = b.indexOf(':');
    if (c <= 0) throw new Error('malformed header line');
    out.push({ name: b.slice(0, c).trim().toLowerCase(), value: b.slice(c + 1).trim() });
  }
  if (!out.length) throw new Error('no headers');
  return out;
}

const THREAD_HEADERS = new Set(['in-reply-to', 'references', 'thread-index', 'thread-topic', 'x-forwarded-message-id', 'resent-from', 'resent-to', 'resent-message-id', 'resent-date']);

// Returns null when this raw message is a plain new email, otherwise a reason string.
function rawReplyReason(raw) {
  let hs;
  try { hs = headerBlocks(raw); } catch (e) { return 'Could not read the draft headers safely (' + e.message + '), so it was not sent'; }
  for (const h of hs) {
    if (THREAD_HEADERS.has(h.name) && h.name !== 'thread-topic' && h.value) return 'Draft is a reply (' + h.name.replace(/(^|-)\w/g, m => m.toUpperCase()) + ' header)';
  }
  const subs = hs.filter(h => h.name === 'subject');
  if (subs.length > 1) return 'Draft has more than one Subject header, so it was not sent';
  if (subs.length) {
    let v; try { v = decodeSubject(Buffer.from(subs[0].value, 'binary').toString('utf8')); } catch (e) { return 'Could not decode the subject safely, so it was not sent'; }
    const r = subjectReason(v); if (r) return r;
  }
  return null;
}

// For nodemailer message objects (letter batches, test sends).
function messageReplyReason(msg) {
  if (!msg || typeof msg !== 'object') return 'Message could not be checked, so it was not sent';
  if (msg.raw != null) return rawReplyReason(msg.raw);
  if (msg.inReplyTo || msg.references) return 'Message is a reply (In-Reply-To/References)';
  const hdr = msg.headers || {};
  const entries = Array.isArray(hdr) ? hdr.map(h => [h.key, h.value]) : Object.entries(hdr);
  for (const [k, v] of entries) if (THREAD_HEADERS.has(String(k).toLowerCase()) && v) return 'Message is a reply (' + k + ' header)';
  return subjectReason(msg.subject);
}

class ReplyBlocked extends Error { constructor(reason) { super(reason); this.replyBlocked = true; } }

module.exports = { subjectReason, rawReplyReason, messageReplyReason, ReplyBlocked, headerBlocks };
