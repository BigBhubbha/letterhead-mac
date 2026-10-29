// Realistic mailbox for the mail client tests and screenshots.
const DAY = 86400000;
const NOW = Date.parse(process.env.FIXTURE_NOW || '2026-10-29T13:30:00-05:00');
const ME = 'Shabd Warar <tester@example.com>';
const fmt = t => new Date(t).toUTCString().replace('GMT', '+0000');
let gm = 1500000000000000000n;
function msg({ from, to = ME, cc, subject, date, id, irt, refs, text, html, headers = [], flags = [], thr, att, inlineImg }) {
  const H = [`From: ${from}`, `To: ${to}`, cc ? `Cc: ${cc}` : null, `Subject: ${subject}`, `Date: ${fmt(date)}`, `Message-ID: <${id}>`, irt ? `In-Reply-To: <${irt}>` : null, refs ? `References: ${refs.map(r => `<${r}>`).join(' ')}` : null, 'MIME-Version: 1.0', ...headers].filter(Boolean);
  let body;
  if (att || inlineImg || html) {
    const alt = ['--ALT', 'Content-Type: text/plain; charset=utf-8', '', text || '', '--ALT', 'Content-Type: text/html; charset=utf-8', '', html || `<p>${(text || '').replace(/\n/g, '<br>')}</p>`, '--ALT--'].join('\r\n');
    const parts = ['--MIX', 'Content-Type: multipart/alternative; boundary="ALT"', '', alt];
    if (inlineImg) parts.push('--MIX', 'Content-Type: image/png; name="logo.png"', 'Content-ID: <logo@lab>', 'Content-Disposition: inline; filename="logo.png"', 'Content-Transfer-Encoding: base64', '', 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkqPv/HwAFdgK/9VZmAgAAAABJRU5ErkJggg==');
    if (att) parts.push('--MIX', `Content-Type: application/pdf; name="${att}"`, `Content-Disposition: attachment; filename="${att}"`, 'Content-Transfer-Encoding: base64', '', Buffer.from('%PDF-1.4\n% ' + att + '\n').toString('base64'));
    parts.push('--MIX--', '');
    H.push(`Content-Type: multipart/${inlineImg ? 'related' : 'mixed'}; boundary="MIX"`);
    body = parts.join('\r\n');
  } else { H.push('Content-Type: text/plain; charset=utf-8'); body = (text || '').replace(/\n/g, '\r\n'); }
  gm += 1n;
  return { raw: H.join('\r\n') + '\r\n\r\n' + body, flags, internaldate: new Date(date), 'X-GM-MSGID': gm.toString(), 'X-GM-THRID': thr || gm.toString(), _id: id };
}
function build() {
  gm = 1500000000000000000n;
  const inbox = [], sent = [], drafts = [], spam = [], trash = [], research = [];
  // 1. a real conversation thread: he wrote, she replied, he replied, she replied again (unread, needs reply)
  const T1 = '1600000000000000001';
  sent.push(msg({ from: ME, to: 'Maya Okafor <maya.okafor@stanford.example>', subject: 'Summer research assistant, inner speech decoding', date: NOW - 3 * DAY, id: 't1a@example.com', thr: T1, flags: ['\\Seen'],
    text: 'Hi Dr. Okafor,\n\nI read "Decoding inner speech from motor cortex" twice and I would love to help in your lab this summer, even in a small way. My resume is attached.\n\nBest,\nShabd' }));
  inbox.push(msg({ from: 'Maya Okafor <maya.okafor@stanford.example>', subject: 'Re: Summer research assistant, inner speech decoding', date: NOW - 2 * DAY, id: 't1b@stanford.example', irt: 't1a@example.com', refs: ['t1a@example.com'], thr: T1, flags: ['\\Seen'],
    html: '<div style="font-family:Georgia,serif"><p>Hi Shabd,</p><p>Thanks for reaching out, and for actually reading the paper. We do take a few high school students each summer through the <b>SIMR</b> program.</p><p>Could you tell me a bit more about the EEG project you mentioned?</p><p>Best,<br>Maya</p><img src="https://tracker.example/pixel.gif" width="1" height="1"><p><img src="https://stanford.example/lab-logo.png" alt="Okafor Lab"></p></div>',
    text: 'Hi Shabd,\n\nThanks for reaching out, and for actually reading the paper. We do take a few high school students each summer through the SIMR program.\n\nCould you tell me a bit more about the EEG project you mentioned?\n\nBest,\nMaya' }));
  sent.push(msg({ from: ME, to: 'Maya Okafor <maya.okafor@stanford.example>', subject: 'Re: Summer research assistant, inner speech decoding', date: NOW - 2 * DAY + 3 * 3600e3, id: 't1c@example.com', irt: 't1b@stanford.example', refs: ['t1a@example.com', 't1b@stanford.example'], thr: T1, flags: ['\\Seen'],
    text: 'Hi Dr. Okafor,\n\nOf course! I built a 4 channel EEG headset from an OpenBCI kit and I have been training a small classifier to tell apart imagined left and right hand movements. It gets about 71% right now, which I know is not amazing, but I learned a ton.\n\nThank you so much for getting back to me.\n\nBest,\nShabd\n\nOn ' + new Date(NOW - 2 * DAY).toDateString() + ' Maya Okafor <maya.okafor@stanford.example> wrote:\n> Could you tell me a bit more about the EEG project you mentioned?' }));
  inbox.push(msg({ from: 'Maya Okafor <maya.okafor@stanford.example>', cc: 'Lab Manager <labmgr@stanford.example>', subject: 'Re: Summer research assistant, inner speech decoding', date: NOW - 2.5 * 3600e3, id: 't1d@stanford.example', irt: 't1c@example.com', refs: ['t1a@example.com', 't1b@stanford.example', 't1c@example.com'], thr: T1, att: 'SIMR_2027_overview.pdf', inlineImg: true,
    html: '<p>Hi Shabd,</p><p>71% with four channels is honestly a great start. I am cc\'ing our lab manager. Could you do a 20 minute Zoom call next week? Tuesday or Thursday afternoon works for me.</p><p>I attached the program overview.</p><p>Best,<br>Maya</p><p><img src="cid:logo@lab" alt="logo" width="24"></p>',
    text: 'Hi Shabd,\n\n71% with four channels is honestly a great start. I am cc\'ing our lab manager. Could you do a 20 minute Zoom call next week? Tuesday or Thursday afternoon works for me.\n\nI attached the program overview.\n\nBest,\nMaya' }));
  // 2. other people
  inbox.push(msg({ from: 'Daniel Reyes <dreyes@mit.example>', subject: 'Re: Question about low latency neural decoders', date: NOW - 5 * 3600e3, id: 'r1@mit.example', irt: 'q-reyes@example.com', refs: ['q-reyes@example.com'],
    text: 'Hi Shabd,\n\nGood question. We mostly use a causal Kalman filter for the low latency path. Happy to send the code if useful.\n\nDaniel' }));
  inbox.push(msg({ from: 'Priya Raman <praman@ucsd.example>', subject: 'Speech prosthetics reading list', date: NOW - 26 * 3600e3, id: 'p1@ucsd.example', flags: ['\\Seen', '\\Flagged'],
    text: 'Hello Shabd,\n\nHere are three papers to start with. Let me know which one you find most interesting and we can talk about it.\n\nPriya' }));
  inbox.push(msg({ from: 'Ms. Alvarez <alvarez@school.example>', subject: 'AP Bio lab report due Friday', date: NOW - 7 * 3600e3, id: 's1@school.example',
    text: 'Hi Shabd,\n\nJust a reminder that the enzyme kinetics lab report is due Friday. Let me know if you need an extension.\n\nMs. Alvarez' }));
  // 3. bulk and automated mail: never auto-reply
  inbox.push(msg({ from: 'Neuro Weekly <newsletter@neuroweekly.example>', subject: 'This week in BCI: 5 papers you missed', date: NOW - 4 * 3600e3, id: 'n1@neuroweekly.example', headers: ['List-Id: <weekly.neuroweekly.example>', 'List-Unsubscribe: <mailto:unsub@neuroweekly.example>'],
    html: '<table width="100%" style="background:#f3f3f3"><tr><td><h2>This week in BCI</h2><p>Five papers you missed.</p><img src="https://neuroweekly.example/banner.png"></td></tr></table>', text: 'This week in BCI. Five papers you missed.' }));
  inbox.push(msg({ from: 'GitHub <noreply@github.example>', subject: '[eeg-classifier] CI passed on main', date: NOW - 9 * 3600e3, id: 'gh1@github.example', flags: ['\\Seen'], headers: ['Auto-Submitted: auto-generated'], text: 'All checks have passed.' }));
  inbox.push(msg({ from: 'Coursera <no-reply@coursera.example>', subject: 'Your weekly learning summary', date: NOW - 30 * 3600e3, id: 'c1@coursera.example', flags: ['\\Seen'], headers: ['Precedence: bulk'], text: 'You completed 3 lessons this week.' }));
  for (let i = 0; i < 6; i++) inbox.push(msg({ from: `Club ${i} <club${i}@school.example>`, subject: `Robotics club update #${i + 1}`, date: NOW - (40 + i * 20) * 3600e3, id: `club${i}@school.example`, flags: ['\\Seen'], text: `Meeting notes number ${i + 1}. Bring your laptop.` }));
  // 4. writing samples: his past replies, with the quoted message he answered
  const people = [['Dr. Lee', 'lee@ucla.example'], ['Professor Kim', 'kim@uw.example'], ['Dr. Patel', 'patel@cmu.example'], ['Coach Brown', 'brown@school.example'], ['Mr. Chen', 'chen@school.example'], ['Dr. Novak', 'novak@jhu.example']];
  const asks = ['Could you send me your availability for a short call?', 'Would you be able to share the dataset you mentioned?', 'Are you still interested in the summer position?', 'Can you make it to practice on Saturday?', 'Did you finish the problem set?', 'Do you have time to present your project next month?'];
  const replies = [
    'Hi {n},\n\nThank you so much for getting back to me! I am free most afternoons after 3:30 PM Central, so Tuesday or Thursday would work great.\n\nBest,\nShabd',
    'Hi {n},\n\nYes, I would really appreciate that. I am happy to sign anything needed for the data use agreement.\n\nThanks so much,\nShabd',
    'Hi {n},\n\nAbsolutely, I am still very interested. I can start any time after June 5th once school is out.\n\nBest,\nShabd',
    'Hey {n},\n\nYes I can make it Saturday! I might be about 10 minutes late because of a robotics meeting.\n\nThanks,\nShabd',
    'Hi {n},\n\nYes, I finished it last night. Question 4 took me a while but I think I got it.\n\nThanks,\nShabd',
    'Hi {n},\n\nI would love to! Would the second week of the month work? I can have slides ready by then.\n\nBest,\nShabd',
  ];
  for (let i = 0; i < 36; i++) {
    const [n, a] = people[i % people.length], d = NOW - (6 + i) * DAY;
    const orig = `o${i}@${a.split('@')[1]}`;
    sent.push(msg({ from: ME, to: `${n} <${a}>`, subject: `Re: ${['Quick call', 'Dataset', 'Summer position', 'Saturday practice', 'Problem set', 'Project talk'][i % 6]}`, date: d, id: `s${i}@example.com`, irt: orig, refs: [orig], flags: ['\\Seen'],
      text: replies[i % replies.length].replace('{n}', n) + `\n\nOn ${new Date(d - 3600e3).toDateString()} ${n} <${a}> wrote:\n> ${asks[i % asks.length]}` }));
  }
  // 5. drafts, spam, trash, label
  drafts.push(msg({ from: ME, to: 'Hana Sato <hsato@cmu.example>', subject: 'Self supervised EEG, a quick question', date: NOW - DAY, id: 'd1@example.com', flags: ['\\Draft', '\\Seen'], text: 'Hi Dr. Sato,\n\nI am writing because' }));
  spam.push(msg({ from: 'Prize Desk <winner@lottery.example>', subject: 'You won a free iPad!!!', date: NOW - 12 * 3600e3, id: 'spam1@lottery.example', text: 'Click here to claim.' }));
  trash.push(msg({ from: 'Old Promo <promo@shop.example>', subject: 'Last chance: 20% off', date: NOW - 4 * DAY, id: 'tr1@shop.example', flags: ['\\Seen'], text: 'Sale ends today.' }));
  research.push({ ...inbox.find(m => m._id === 'p1@ucsd.example') });
  const all = [...inbox, ...sent, ...research.filter(() => false)].map(m => ({ ...m, flags: [...m.flags] }));
  return { inbox, sent, drafts, spam, trash, research, all };
}
function storage(flavor = 'gmail') {
  const f = build();
  if (flavor === 'gmail') return { INBOX: { messages: f.inbox }, '': { separator: '/', folders: {
    '[Gmail]': { flags: ['\\Noselect'], folders: {
      'All Mail': { 'special-use': '\\All', messages: f.all }, 'Sent Mail': { 'special-use': '\\Sent', messages: f.sent }, Drafts: { 'special-use': '\\Drafts', messages: f.drafts },
      Spam: { 'special-use': '\\Junk', messages: f.spam }, Trash: { 'special-use': '\\Trash', messages: f.trash }, Starred: { 'special-use': '\\Flagged', messages: f.inbox.filter(m => m.flags.includes('\\Flagged')).map(m => ({ ...m })) } } },
    Research: { messages: f.research }, School: { messages: [] } } } };
  return { INBOX: { messages: f.inbox }, '': { separator: '.', folders: { Sent: { 'special-use': '\\Sent', messages: f.sent }, Drafts: { 'special-use': '\\Drafts', messages: f.drafts }, Junk: { 'special-use': '\\Junk', messages: f.spam }, Trash: { 'special-use': '\\Trash', messages: f.trash }, Research: { messages: f.research } } } };
}
module.exports = { build, storage, NOW, DAY, msg };
