// Mock Google Gemini API (generateContent + streamGenerateContent?alt=sse) for tests and screenshots.
// Usage as CLI: node test/mock_ai.js PORT   (key "test-key-123" is accepted; it is a fake test value)
const http = require('http');
const KEY = 'test-key-123';
function replyFor(system, prompt) {
  if (/writing coach/i.test(system)) {
    if (/^Combine these notes/.test(prompt)) return '- Warm, upbeat and polite, never stiff\n- Opens with "Hi Dr. Lastname," for professors and "Hey Name!" for friends\n- Signs off with "Best,\\nShabd" to adults, "thanks!!" to friends\n- Short paragraphs, two to four sentences each\n- Thanks people early and specifically ("Thank you so much for getting back to me")\n- Likes "I would love to", "that sounds great", "no worries at all"\n- Uses exclamation points with friends, sparingly with professors\n- Gives concrete times and next steps';
    return '- Warm and polite\n- Opens with "Hi Dr. Lastname,"\n- Signs off "Best, Shabd"\n- Short paragraphs\n- Says "Thank you so much" a lot';
  }
  const m = /Write (.+?)'s reply to the last message, from (.+?)\./.exec(prompt) || [];
  const from = (m[2] || 'there').trim();
  const convoAll = prompt.slice(prompt.lastIndexOf('THE CONVERSATION'), prompt.lastIndexOf('\n\nWrite ') > 0 ? prompt.lastIndexOf('\n\nWrite ') : undefined);
  const sigs = [...convoAll.replace(/\r/g, '').matchAll(/\n(?:Thanks|Best|Cheers|Thank you),?[ \t]*\n\s*([A-Z][a-z]+)\s*(?=\n|$)/g)]; const lastFrom = convoAll.lastIndexOf('From: '); const signed = sigs.filter(m => m.index > lastFrom).pop();
  let first = from.split(/\s+/)[0], last = from.split(/\s+/).slice(-1)[0];
  if (signed && !/Dr\.|Professor/.test(convoAll.slice(-400))) { first = signed[1]; }
  const prof = /stanford|mit|ucsd|cmu|\.edu|Dr\.|Professor/i.test(prompt.slice(prompt.lastIndexOf('THE CONVERSATION')));
  const hi = /^(Ms\.|Mr\.|Mrs\.|Dr\.)$/.test(first) ? `Hi ${from},` : prompt.includes(`Dr. ${last}`) ? `Hi Dr. ${last},` : signed ? `Hi ${signed[1]},` : prof ? `Hi Dr. ${last},` : `Hey ${first}!`;
  const convo = prompt.slice(prompt.lastIndexOf('THE CONVERSATION'));
  let body;
  if (/confirm that still works/i.test(convo.slice(-600))) body = 'Yes, Thursday at 4 PM still works great for me. Thank you for setting it up! Could you send the Zoom link when you have it?\n\nLooking forward to meeting everyone.';
  else if (/Thursday at 4 PM|30 minute call|Zoom/i.test(convo)) body = 'Thank you so much for getting back to me, and for sending the overview! Thursday at 4 PM works great for me. I will read through the SIMR document before then and come with a few questions about the inner speech decoding work.\n\nI have also attached my updated resume in case it is helpful. Looking forward to talking!';
  else if (/Kalman filter notebook/i.test(convo.slice(-600))) body = 'That would be amazing, thank you! A quick walkthrough on a call would help a lot since I am still new to Kalman filters. I am free most afternoons after 3:30 PM Central, so [Tuesday or Wednesday?] could work.';
  else if (/Kalman/i.test(convo)) body = 'That makes a lot of sense, thank you for explaining it! I had not thought about the latency tradeoff that way. I would love to look at the code if you are okay sharing it, and I can send you my notes on the preprocessing in return.';
  else if (/recommendation|letter/i.test(convo)) body = 'Thank you so much for being willing to write this! I will send you my resume and the program details by [Friday?] so you have everything in one place. Please let me know if there is anything else that would help.';
  else body = 'Thank you so much for reaching out! That sounds great to me. Let me know what works best on your end and I will make it happen.';
  if (/noticeably shorter/.test(prompt)) body = body.split(/(?<=[.!])\s+/).slice(0, 2).join(' ');
  if (/more formal/.test(prompt)) { body = body.replace(/Thank you so much/g, 'Thank you very much').replace(/!/g, '.').replace(/works great/g, 'works well'); }
  if (/fresh version/.test(prompt)) body = body.replace('Thank you so much', 'I really appreciate you');
  const close = prof || /^Hi /.test(hi) ? 'Best,\nShabd' : 'thanks!!\nShabd';
  return `${hi}\n\n${body}\n\n${close}`;
}
function start(port = 0, opts = {}) {
  const st = Object.assign({ quota: new Set(), gone: new Set(['gemini-2.5-flash', 'gemini-2.5-flash-lite']), slow: {}, thinking400: new Set(), streamBroken: false, log: [], chunkMs: 25 }, opts);
  const srv = http.createServer((q, s) => {
    let b = ''; q.on('data', d => b += d); q.on('end', async () => {
      const m = /^\/v1beta\/models\/([^:]+):(generateContent|streamGenerateContent)/.exec(q.url);
      if (!m && (q.url === '/v1/chat/completions' || q.url === '/v1/messages')) {
        let j = {}; try { j = JSON.parse(b); } catch (e) {}
        const oa = q.url === '/v1/chat/completions';
        const key = oa ? String(q.headers.authorization || '').replace(/^Bearer /, '') : q.headers['x-api-key'];
        st.log.push({ t: Date.now(), model: j.model, kind: oa ? 'openai' : 'anthropic', key });
        if (key !== KEY) { s.writeHead(401, { 'content-type': 'application/json' }); return s.end(JSON.stringify(oa ? { error: { message: 'Incorrect API key provided' } } : { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } })); }
        const sys = oa ? ((j.messages || []).find(x => x.role === 'system') || {}).content : j.system;
        const text = replyFor(sys || '', (j.messages || []).find(x => x.role === 'user').content);
        s.writeHead(200, { 'content-type': 'application/json' });
        return s.end(JSON.stringify(oa ? { choices: [{ message: { role: 'assistant', content: text } }] } : { content: [{ type: 'text', text }] }));
      }
      if (!m) { s.writeHead(404); return s.end('{}'); }
      const [, model, kind] = m; let j = {}; try { j = JSON.parse(b); } catch (e) {}
      const entry = { t: Date.now(), model, kind, key: q.headers['x-goog-api-key'], thinking: j.generationConfig && j.generationConfig.thinkingConfig, system: j.systemInstruction && j.systemInstruction.parts[0].text, prompt: j.contents && j.contents[0].parts[0].text };
      st.log.push(entry);
      const err = (code, status, message, extra) => { s.writeHead(code, { 'content-type': 'application/json' }); s.end(JSON.stringify({ error: { code, message, status, ...extra } })); };
      if (entry.key !== KEY) return err(400, 'INVALID_ARGUMENT', 'API key not valid. Please pass a valid API key.', { details: [{ reason: 'API_KEY_INVALID' }] });
      if (st.gone.has(model)) return err(404, 'NOT_FOUND', `models/${model} is not found for API version v1beta, or is not supported for generateContent.`);
      if (st.quota.has(model)) return err(429, 'RESOURCE_EXHAUSTED', 'You exceeded your current quota, please check your plan and billing details.', { details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '7s' }] });
      if (st.thinking400.has(model) && entry.thinking) return err(400, 'INVALID_ARGUMENT', 'Unknown name "thinkingLevel" at generation_config.thinking_config');
      const delay = st.slow[model] || 0; if (delay) await new Promise(r => setTimeout(r, delay));
      if (s.destroyed) return;
      const text = replyFor(entry.system || '', entry.prompt || '');
      if (kind === 'generateContent') { s.writeHead(200, { 'content-type': 'application/json' }); return s.end(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }], modelVersion: model })); }
      if (st.streamBroken) { s.writeHead(500); return s.end('{"error":{"code":500,"message":"Internal"}}'); }
      s.writeHead(200, { 'content-type': 'text/event-stream' });
      const parts = text.match(/[\s\S]{1,40}/g) || [];
      for (const p of parts) { if (s.destroyed) return; s.write(`data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: p }] } }] })}\r\n\r\n`); await new Promise(r => setTimeout(r, st.chunkMs)); }
      s.end();
    });
  });
  return new Promise(res => srv.listen(port, '127.0.0.1', () => res({ srv, st, port: srv.address().port, base: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise(r => { srv.closeAllConnections && srv.closeAllConnections(); srv.close(r); }) })));
}
module.exports = { start, KEY, replyFor };
if (require.main === module) start(Number(process.argv[2] || 8799)).then(m => console.log('mock gemini on', m.base));
