'use strict';
// AI providers behind one small interface: generate({ system, prompt, maxTokens, temperature, interactive }) -> { text, model, provider }.
// Gemini is the default. OpenAI and Anthropic keys work too. Keys come from the caller (Keychain), never from disk here.
// Gemini handling: pinned fast model first, fallbacks after, quota errors cool a model down and move on,
// interactive calls get a backup request if the first has not started answering after about 2 seconds.
const crypto = require('crypto');

const GEMINI_MODELS = ['gemini-3.1-flash-lite', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-flash-latest'];
const DEFAULTS = {
  gemini: { models: GEMINI_MODELS, base: 'https://generativelanguage.googleapis.com' },
  openai: { models: ['gpt-5-mini'], base: 'https://api.openai.com' },
  anthropic: { models: ['claude-haiku-4-5'], base: 'https://api.anthropic.com' },
};
const PROVIDER_NAMES = { gemini: 'Google Gemini', openai: 'OpenAI', anthropic: 'Anthropic' };

class AIError extends Error { constructor(msg, kind, extra) { super(msg); this.kind = kind; Object.assign(this, extra || {}); } }
const sleep = (ms, signal) => new Promise((res, rej) => { const t = setTimeout(res, ms); if (signal) signal.addEventListener('abort', () => { clearTimeout(t); rej(new AIError('Cancelled', 'abort')); }, { once: true }); });

function classify(status, body) {
  const s = String(body || '');
  if (status === 429 || /RESOURCE_EXHAUSTED|exceeded your current quota|rate limit|rate_limit/i.test(s)) {
    const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(s) || /retry in (\d+(?:\.\d+)?)s/i.exec(s);
    return { kind: 'quota', retryMs: m ? Math.ceil(parseFloat(m[1]) * 1000) : null };
  }
  if (status === 401 || status === 403 || /API key not valid|API_KEY_INVALID|invalid x-api-key|Incorrect API key|PERMISSION_DENIED/i.test(s)) return { kind: 'auth' };
  if (status === 404 || /is not found|not supported for generateContent|model_not_found|does not exist/i.test(s)) return { kind: 'model' };
  if (status === 400 && /thinking/i.test(s)) return { kind: 'thinking' };
  if (status >= 500 || status === 0) return { kind: 'server' };
  if (/SAFETY|blocked/i.test(s)) return { kind: 'blocked' };
  return { kind: 'bad' };
}
function friendly(e, provider) {
  const name = PROVIDER_NAMES[provider] || provider;
  if (e.kind === 'auth') return `${name} did not accept the API key. Check it in Settings.`;
  if (e.kind === 'quota') return `${name} says the free quota is used up for now. Letterhead will try again shortly, or you can add billing to your key.`;
  if (e.kind === 'model') return `None of the ${name} models Letterhead tried are available to this key.`;
  if (e.kind === 'abort') return 'Cancelled.';
  if (e.kind === 'network') return `Could not reach ${name}. Check your internet connection.`;
  if (e.kind === 'blocked') return `${name} declined to write this one. Try Regenerate or write it yourself.`;
  return `${name} error: ${String(e.message || '').slice(0, 200)}`;
}

class AI {
  /** o: { getKey(provider) -> string, getConfig() -> { provider, models?, base? }, fetch?, now?, rpm? } */
  constructor(o) {
    this.o = Object.assign({ fetch: globalThis.fetch, now: Date.now, rpm: 9, hedgeMs: 2000 }, o);
    this.cool = new Map();   // model -> until
    this.gone = new Set();   // models this key cannot use
    this.calls = new Map();  // model -> [timestamps]
    this.cache = new Map();  // prompt hash -> result
    this.thinkingOff = new Set();
    this.stats = { requests: 0, hedges: 0, fallbacks: 0, quota: 0 };
  }
  config() {
    const c = this.o.getConfig() || {}; const p = c.provider || 'gemini'; const d = DEFAULTS[p] || DEFAULTS.gemini;
    const models = (c.models && c.models.length ? c.models : d.models).filter(Boolean);
    return { provider: p, models, base: (c.base || process.env.LETTERHEAD_AI_BASE || d.base).replace(/\/$/, '') };
  }
  ready() { const c = this.config(); return !!this.o.getKey(c.provider); }
  _window(model) { const now = this.o.now(); const l = (this.calls.get(model) || []).filter(t => now - t < 60000); this.calls.set(model, l); return l; }
  _usable(model) { return !this.gone.has(model) && (this.cool.get(model) || 0) <= this.o.now(); }
  _hasRoom(model) { return this._window(model).length < this.o.rpm; }
  _pick(models, skip = new Set()) { return models.find(m => !skip.has(m) && this._usable(m) && this._hasRoom(m)) || null; }
  _waitMs(models) {
    const now = this.o.now(); let best = Infinity;
    for (const m of models) { if (this.gone.has(m)) continue; const cu = Math.max(0, (this.cool.get(m) || 0) - now); const w = this._window(m); const room = w.length < this.o.rpm ? 0 : 60000 - (now - w[0]); best = Math.min(best, Math.max(cu, room)); }
    return best;
  }

  async generate(req) {
    const c = this.config(); const key = this.o.getKey(c.provider);
    if (!key) throw new AIError('Add an API key in Settings first.', 'auth');
    const ck = crypto.createHash('sha256').update(JSON.stringify([c.provider, req.system, req.prompt, req.maxTokens, req.temperature, req.nonce || ''])).digest('hex');
    if (!req.noCache && this.cache.has(ck)) return { ...this.cache.get(ck), cached: true };
    const deadline = this.o.now() + (req.interactive ? 60000 : 10 * 60000);
    let lastErr = null, attempts = 0, waited = 0;
    while (this.o.now() < deadline && attempts < 12) {
      attempts++;
      const usable = c.models.filter(m => !this.gone.has(m));
      if (!usable.length) break;
      const first = this._pick(usable);
      if (!first) {
        const w = this._waitMs(usable);
        if (!isFinite(w)) break;
        if (req.interactive && (w > 9000 || waited)) { lastErr = lastErr || new AIError('quota', 'quota'); break; }
        waited++; await sleep(Math.min(w + 50, 30000), req.signal); continue;
      }
      try {
        const out = req.interactive ? await this._hedged(c, key, req, first, usable) : await this._one(c, key, req, first, req.signal);
        this.cache.set(ck, out); if (this.cache.size > 300) this.cache.delete(this.cache.keys().next().value);
        return out;
      } catch (e) {
        lastErr = e;
        if (e.kind === 'auth' || e.kind === 'abort' || e.kind === 'blocked' || e.kind === 'bad') break;
        if (e.kind === 'server' || e.kind === 'network') await sleep(600 * attempts, req.signal).catch(() => {});
        this.stats.fallbacks++;
      }
    }
    const err = lastErr || new AIError('No model available right now.', 'quota');
    err.friendly = friendly(err, c.provider); throw err;
  }
  async _hedged(c, key, req, first, models) {
    const ctrls = []; let settled = false, started = false, timer = null;
    return new Promise((resolve, reject) => {
      const errors = [];
      const launch = (model) => {
        const ac = new AbortController(); ctrls.push(ac);
        if (req.signal) req.signal.addEventListener('abort', () => ac.abort(), { once: true });
        this._one(c, key, { ...req, onFirst: () => { started = true; } }, model, ac.signal).then(r => {
          if (settled) return; settled = true; clearTimeout(timer); ctrls.forEach(x => x !== ac && x.abort()); resolve(r);
        }, e => {
          errors.push(e);
          // every request so far has failed: give up here and let generate() pick the next model
          if (!settled && errors.length === ctrls.length) { settled = true; clearTimeout(timer); reject(errors.find(x => x.kind === 'auth') || e); }
        });
      };
      launch(first);
      timer = setTimeout(() => {
        if (settled || started) return;
        const backup = this._pick(models, new Set([first])) || (this._hasRoom(first) && this._usable(first) ? first : null);
        if (backup) { this.stats.hedges++; launch(backup); }
      }, this.o.hedgeMs);
    });
  }
  async _one(c, key, req, model, signal) {
    this._window(model).push(this.o.now()); this.stats.requests++;
    try {
      if (c.provider === 'gemini') return await this._gemini(c, key, req, model, signal);
      if (c.provider === 'openai') return await this._openai(c, key, req, model, signal);
      if (c.provider === 'anthropic') return await this._anthropic(c, key, req, model, signal);
      throw new AIError('Unknown provider ' + c.provider, 'bad');
    } catch (e) {
      if (!(e instanceof AIError)) e = new AIError(e.name === 'AbortError' ? 'Cancelled' : e.message, e.name === 'AbortError' ? 'abort' : 'network');
      if (e.kind === 'quota') { this.stats.quota++; this.cool.set(model, this.o.now() + (e.retryMs || 20000)); }
      if (e.kind === 'model') this.gone.add(model);
      throw e;
    }
  }
  async _http(url, init, signal) {
    let r; try { r = await this.o.fetch(url, { ...init, signal }); } catch (e) { if (e.name === 'AbortError') throw new AIError('Cancelled', 'abort'); throw new AIError(e.message, 'network'); }
    if (!r.ok) { const body = await r.text().catch(() => ''); const k = classify(r.status, body); let msg = body; try { msg = JSON.parse(body).error.message; } catch (e) {} throw new AIError(String(msg).slice(0, 400), k.kind, { status: r.status, retryMs: k.retryMs }); }
    return r;
  }
  _geminiBody(req, model) {
    const b = { contents: [{ role: 'user', parts: [{ text: req.prompt }] }], generationConfig: { maxOutputTokens: req.maxTokens || 1024, temperature: req.temperature == null ? 0.7 : req.temperature } };
    if (req.system) b.systemInstruction = { parts: [{ text: req.system }] };
    if (/gemini-3/.test(model) && !this.thinkingOff.has(model)) b.generationConfig.thinkingConfig = { thinkingLevel: 'minimal' };
    return b;
  }
  _geminiText(j) {
    const cand = (j.candidates || [])[0];
    if (!cand) { if (j.promptFeedback && j.promptFeedback.blockReason) throw new AIError(j.promptFeedback.blockReason, 'blocked'); return ''; }
    return (cand.content && cand.content.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
  }
  async _gemini(c, key, req, model, signal) {
    const headers = { 'content-type': 'application/json', 'x-goog-api-key': key };
    const body = JSON.stringify(this._geminiBody(req, model));
    try {
      if (req.stream !== false) {
        try {
          const r = await this._http(`${c.base}/v1beta/models/${model}:streamGenerateContent?alt=sse`, { method: 'POST', headers, body }, signal);
          let text = '', buf = '', got = false;
          const dec = new TextDecoder();
          for await (const chunk of r.body) {
            buf += dec.decode(chunk, { stream: true });
            let i; while ((i = buf.indexOf('\n')) >= 0) {
              const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
              if (!line.startsWith('data:')) continue;
              const data = line.slice(5).trim(); if (!data || data === '[DONE]') continue;
              let j; try { j = JSON.parse(data); } catch (e) { continue; }
              if (j.error) throw new AIError(j.error.message || 'stream error', classify(j.error.code || 500, JSON.stringify(j.error)).kind);
              const t = this._geminiText(j); if (t && !got) { got = true; req.onFirst && req.onFirst(); }
              text += t; if (req.onDelta && t) req.onDelta(t);
            }
          }
          if (text.trim()) return { text: text.trim(), model, provider: 'gemini' };
        } catch (e) {
          if (['quota', 'auth', 'model', 'abort', 'thinking', 'blocked'].includes(e.kind)) throw e;
          // stream trouble: fall through to the plain request
        }
      }
      const r = await this._http(`${c.base}/v1beta/models/${model}:generateContent`, { method: 'POST', headers, body }, signal);
      const j = await r.json(); req.onFirst && req.onFirst();
      const text = this._geminiText(j).trim();
      if (!text) throw new AIError('Empty answer', 'server');
      return { text, model, provider: 'gemini' };
    } catch (e) {
      if (e.kind === 'thinking' && !this.thinkingOff.has(model)) { this.thinkingOff.add(model); return this._gemini(c, key, req, model, signal); }
      throw e;
    }
  }
  async _openai(c, key, req, model, signal) {
    const messages = [...(req.system ? [{ role: 'system', content: req.system }] : []), { role: 'user', content: req.prompt }];
    const r = await this._http(`${c.base}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify({ model, messages, max_completion_tokens: req.maxTokens || 1024 }) }, signal);
    const j = await r.json(); req.onFirst && req.onFirst();
    const text = ((j.choices || [])[0] || {}).message?.content || '';
    if (!text.trim()) throw new AIError('Empty answer', 'server');
    return { text: text.trim(), model, provider: 'openai' };
  }
  async _anthropic(c, key, req, model, signal) {
    const r = await this._http(`${c.base}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model, system: req.system || undefined, max_tokens: req.maxTokens || 1024, messages: [{ role: 'user', content: req.prompt }] }) }, signal);
    const j = await r.json(); req.onFirst && req.onFirst();
    const text = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    if (!text.trim()) throw new AIError('Empty answer', 'server');
    return { text: text.trim(), model, provider: 'anthropic' };
  }
  async test() { return this.generate({ system: 'Reply with one short friendly sentence.', prompt: 'Say hello to Shabd in under ten words.', maxTokens: 40, interactive: true, noCache: true }); }
}

module.exports = { AI, AIError, classify, friendly, DEFAULTS, GEMINI_MODELS, PROVIDER_NAMES };
