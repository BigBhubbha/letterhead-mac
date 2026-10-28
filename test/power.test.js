// Keep-awake logic with a mocked macOS (execFile/spawn), plus running the real watcher loop under sh.
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process'), assert = require('assert');
const { Power, lidOnCommand, lidOffCommand, osascriptArgs, parseSleepDisabled } = require('../src/power');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh pow'er ")); // space and quote on purpose
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  // 1. command construction and quoting
  const flag = path.join(dir, 'lid-awake.flag');
  const on = lidOnCommand(4242, flag);
  console.log('lid on command:\n  ' + on);
  assert(on.startsWith('/usr/bin/pmset -a disablesleep 1 && '));
  assert(on.includes('kill -0 4242') && on.includes('/usr/bin/pmset -a disablesleep 0'));
  const args = osascriptArgs(on); console.log('osascript args:\n  ' + JSON.stringify(args));
  assert(args[1].startsWith('do shell script "') && args[1].endsWith('" with administrator privileges'));
  assert.strictEqual(lidOffCommand(), '/usr/bin/pmset -a disablesleep 0');
  // The AppleScript string must decode back to exactly the shell command
  const decoded = JSON.parse(args[1].slice('do shell script '.length, -' with administrator privileges'.length).replace(/\\\\/g, '\u0000').replace(/\u0000/g, '\\\\'));
  assert.strictEqual(decoded, on); console.log('AppleScript quoting round trips: ok');
  assert.strictEqual(parseSleepDisabled('System-wide power settings:\n SleepDisabled\t\t1\nCurrently in use:\n'), true);
  assert.strictEqual(parseSleepDisabled(' SleepDisabled\t\t0'), false);
  assert.strictEqual(parseSleepDisabled('nothing'), null); console.log('pmset -g parsing ok');

  // 2. the generated shell really runs: swap pmset for a fake that logs, then check both restore paths
  const fakeBin = path.join(dir, 'pmset-log.txt');
  const fakePm = fs.mkdtempSync(path.join(os.tmpdir(), 'pm')) + '/pmset';
  fs.writeFileSync(fakePm, `#!/bin/sh\necho "pmset $*" >> "${fakeBin}"\n`, { mode: 0o755 });
  const runnable = c => c.split('/usr/bin/pmset').join(fakePm);
  const victim = cp.spawn('sleep', ['30']);
  fs.writeFileSync(flag, 'x');
  cp.execFileSync('/bin/sh', ['-c', runnable(lidOnCommand(victim.pid, flag))], { stdio: 'ignore', timeout: 5000 });
  await sleep(300); let log = fs.readFileSync(fakeBin, 'utf8');
  assert.strictEqual(log.trim().split('\n').length, 1); console.log('watcher running, sleep disabled once:', JSON.stringify(log.trim()));
  victim.kill(); await sleep(6000); log = fs.readFileSync(fakeBin, 'utf8').trim().split('\n');
  assert.strictEqual(log.length, 2); assert(!fs.existsSync(flag)); console.log('app died (crash or quit) -> watcher restored sleep and removed the flag');
  fs.unlinkSync(fakeBin);
  const victim2 = cp.spawn('sleep', ['30']); fs.writeFileSync(flag, 'x');
  cp.execFileSync('/bin/sh', ['-c', runnable(lidOnCommand(victim2.pid, flag))], { stdio: 'ignore', timeout: 5000 });
  fs.unlinkSync(flag); await sleep(6000); log = fs.readFileSync(fakeBin, 'utf8').trim().split('\n');
  assert.strictEqual(log.length, 2); console.log('flag removed (queue finished / toggle off) -> watcher restored sleep while app keeps running'); victim2.kill();

  // 3. Power class with a mocked Mac
  const calls = []; let sleepDisabled = 0, cancel = false;
  const execFile = (cmd, a, o, cb) => {
    calls.push([cmd, ...a].join(' '));
    if (cmd === '/usr/bin/pmset') return cb(null, ` SleepDisabled\t\t${sleepDisabled}\n`, '');
    if (cmd === '/usr/bin/osascript') { if (cancel) { const e = new Error('x'); return cb(e, '', 'execution error: User canceled. (-128)'); } sleepDisabled = /disablesleep 1/.test(a[1]) ? 1 : 0; return cb(null, '', ''); }
    cb(null, '', '');
  };
  const spawned = []; const spawn = (cmd, a) => { const ee = new (require('events'))(); ee.kill = () => { ee.killed = true; }; spawned.push({ cmd, a, ee }); return ee; };
  const blocks = []; const blockerApi = { start: t => { blocks.push('start ' + t); return 7; }, stop: id => blocks.push('stop ' + id) };
  const p = new Power({ dir, platform: 'darwin', pid: 555, execFile, spawn });
  sleepDisabled = 1; fs.writeFileSync(p.flag, 'old');
  assert.strictEqual(await p.startupCheck(), true); assert(!fs.existsSync(p.flag)); console.log('launch after a crash with sleep still disabled -> stale warning shown, flag cleared');
  let r = await p.restoreNow(); assert(r.ok && !p.status().stale && sleepDisabled === 0); console.log('Restore normal sleep button ->', calls[calls.length - 2]);
  await p.update({ wantAwake: true, wantLid: false, blockerApi });
  assert.deepStrictEqual(blocks, ['start prevent-app-suspension']); assert.strictEqual(spawned[0].cmd + ' ' + spawned[0].a.join(' '), '/usr/bin/caffeinate -dimsu -w 555');
  console.log('awake: powerSaveBlocker(prevent-app-suspension) + caffeinate -dimsu -w 555');
  await p.update({ wantAwake: true, wantLid: true, blockerApi });
  assert.strictEqual(p.lid, 'on'); assert(fs.existsSync(p.flag)); assert.strictEqual(sleepDisabled, 1); console.log('lid mode on: one admin prompt, flag written, SleepDisabled=1');
  await p.update({ wantAwake: true, wantLid: true, blockerApi }); assert.strictEqual(calls.filter(c => c.includes('disablesleep 1')).length, 1); console.log('no second prompt while it stays on');
  await p.update({ wantAwake: false, wantLid: false, blockerApi });
  assert.strictEqual(p.lid, 'off'); assert(!fs.existsSync(p.flag)); assert(spawned[0].ee.killed); assert(blocks.includes('stop 7'));
  console.log('queue finished: flag removed (root watcher restores sleep), caffeinate stopped, blocker released');
  cancel = true; await p.update({ wantAwake: true, wantLid: true, blockerApi }); assert.strictEqual(p.lid, 'declined'); assert(!fs.existsSync(p.flag));
  console.log('password prompt cancelled ->', p.lidError);
  await p.update({ wantAwake: true, wantLid: true, blockerApi }); assert.strictEqual(calls.filter(c => c.includes('osascript')).length, 3, 'asked again after decline');
  console.log('declined is remembered: no nagging until the toggle changes');
  cancel = false; await p.update({ wantAwake: true, wantLid: true, blockerApi }); // still declined
  await p.update({ wantAwake: true, wantLid: false, blockerApi }); await p.update({ wantAwake: true, wantLid: true, blockerApi }); assert.strictEqual(p.lid, 'on');
  p.shutdown(); assert(!fs.existsSync(p.flag)); console.log('quit: flag removed so the watcher restores sleep');
  const lin = new Power({ dir, platform: 'linux' }); await lin.update({ wantAwake: true, wantLid: true, blockerApi }); assert.strictEqual(lin.lid, 'unsupported'); console.log('non-Mac: lid mode reports unsupported, no commands run');
  console.log('\nALL POWER TESTS PASSED'); process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
