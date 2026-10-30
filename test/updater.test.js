// Updater end to end against a local HTTP feed, including the real swap script on this machine.
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'), cp = require('child_process'), assert = require('assert');
const { Updater, cmpVer } = require('../src/updater');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-upd-'));
const plist = v => `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>CFBundleIdentifier</key>\n<string>com.shabdwarar.letterhead</string><key>CFBundleShortVersionString</key>\n<string>${v}</string></dict></plist>`;
const exe = (v, hang) => `#!/bin/sh
for a in "$@"; do case "$a" in --health-check=*) f="\${a#--health-check=}"; ${hang ? 'sleep 600' : `printf '{"version":"${v}","ok":true}' > "$f"`}; exit 0;; esac; done
echo ${v}
`;
function fakeApp(dir, v, bundleId, hang) {
  const app = path.join(dir, 'Letterhead.app'); fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true });
  fs.writeFileSync(path.join(app, 'Contents', 'Info.plist'), bundleId ? plist(v).replace('com.shabdwarar.letterhead', bundleId) : plist(v));
  fs.writeFileSync(path.join(app, 'Contents', 'MacOS', 'Letterhead'), exe(v, hang), { mode: 0o755 });
  fs.symlinkSync('MacOS/Letterhead', path.join(app, 'Contents', 'link-test'));
  return app;
}
const zipOf = (name, v, id, hang) => { const d = path.join(root, 'src-' + name); fs.mkdirSync(d); fakeApp(d, v, id, hang); const z = path.join(root, name + '.zip'); cp.execFileSync('python3', [path.join(__dirname, '..', 'scripts', 'mkzip.py'), z, path.join(d, 'Letterhead.app') + '=Letterhead.app']); return z; };
const until = async (fn, ms) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timed out'); await new Promise(r => setTimeout(r, 100)); } };
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const good = zipOf('good', '1.1.1'), wrongVer = zipOf('wrongver', '1.0.5'), wrongId = zipOf('wrongid', '1.1.1', 'com.evil.app');
let manifest;
const srv = http.createServer((q, r) => {
  const u = q.url.split('?')[0];
  if (u === '/latest.json') { r.setHeader('content-type', 'application/json'); return r.end(JSON.stringify(manifest)); }
  if (u === '/redirect/good.zip') { r.writeHead(302, { location: '/good.zip' }); return r.end(); }
  const f = path.join(root, u.slice(1)); if (fs.existsSync(f)) { r.setHeader('content-length', fs.statSync(f).size); return fs.createReadStream(f).pipe(r); }
  r.statusCode = 404; r.end();
});
srv.listen(0, '127.0.0.1', async () => {
  const base = `http://127.0.0.1:${srv.address().port}`;
  const appsDir = path.join(root, 'Applications'); fs.mkdirSync(appsDir); const installed = fakeApp(appsDir, '1.1.0');
  const mk = () => new Updater({ currentVersion: '1.1.0', feedUrl: base + '/latest.json', arch: 'arm64', platform: 'linux', appPath: installed, workDir: path.join(root, 'work') });
  const asset = (f, extra) => ({ url: base + '/' + path.basename(f), sha256: sha(f), size: fs.statSync(f).size, ...extra });
  try {
    assert.strictEqual(cmpVer('1.10.0', '1.9.9'), 1); assert.strictEqual(cmpVer('v1.1.0', '1.1.0'), 0); assert.strictEqual(cmpVer('1.0.9', '1.1'), -1);
    console.log('version compare ok');
    manifest = { version: '1.1.0', assets: { arm64: asset(good) } }; let u = mk(); await u.check(); assert.strictEqual(u.state.status, 'uptodate'); console.log('same version: up to date');
    manifest = { version: '1.1.1', assets: { arm64: { ...asset(good), sha256: 'a'.repeat(64) } } }; u = mk(); await u.check();
    assert.strictEqual(u.state.status, 'error'); console.log('bad sha256 ->', u.state.error);
    manifest = { version: '1.1.1', assets: { arm64: asset(wrongVer) } }; u = mk(); await u.check(); assert.strictEqual(u.state.status, 'error'); console.log('version mismatch ->', u.state.error);
    manifest = { version: '1.1.1', assets: { arm64: asset(wrongId) } }; u = mk(); await u.check(); assert.strictEqual(u.state.status, 'error'); console.log('wrong bundle id ->', u.state.error);
    manifest = { version: '1.1.1', assets: { x64: asset(good) } }; u = mk(); await u.check(); assert.strictEqual(u.state.status, 'error'); console.log('no asset for this chip ->', u.state.error);
    manifest = { version: '1.1.1', notes: 'Scheduling', assets: { arm64: { ...asset(good), url: base + '/redirect/good.zip' } } }; u = mk();
    const progress = []; u.on('state', s => progress.push(s.status)); await u.check();
    assert.strictEqual(u.state.status, 'ready', u.state.error); console.log('good update (through a redirect, like GitHub) ->', [...new Set(progress)].join(' > '));
    assert(fs.lstatSync(path.join(u.staged, 'Contents', 'link-test')).isSymbolicLink(), 'symlink kept');
    // real swap: a dummy process stands in for the running app
    const dummy = cp.spawn('sleep', ['30']); u.o.pid = dummy.pid;
    const marker = path.join(root, 'relaunched.txt'); process.env.LETTERHEAD_RELAUNCH = `echo relaunched > ${marker}`;
    const { log } = u.install({ relaunch: true });
    await new Promise(r => setTimeout(r, 700));
    assert(/1\.1\.0/.test(fs.readFileSync(path.join(installed, 'Contents', 'Info.plist'), 'utf8')), 'swapped before the app quit');
    console.log('swap waits while the app is still running: ok');
    dummy.kill(); await new Promise(r => setTimeout(r, 1500));
    const pl = fs.readFileSync(path.join(installed, 'Contents', 'Info.plist'), 'utf8');
    assert(/1\.1\.1/.test(pl), 'not swapped'); assert(!fs.existsSync(installed + '.previous'), 'backup left behind');
    assert(fs.existsSync(marker), 'did not relaunch');
    assert(fs.statSync(path.join(installed, 'Contents', 'MacOS', 'Letterhead')).mode & 0o100, 'exec bit lost');
    console.log('after quit: app swapped to 1.1.1, exec bit kept, relaunch command ran. log:\n  ' + fs.readFileSync(log, 'utf8').trim().split('\n').join('\n  '));
    // installability refusals
    const t = new Updater({ currentVersion: '1', feedUrl: '', appPath: '/private/var/folders/x/AppTranslocation/ABC/d/Letterhead.app', workDir: root });
    assert(!t.installability().ok); console.log('translocated copy refused:', t.installability().note);
    const ro = path.join(root, 'ro'); fs.mkdirSync(ro); fakeApp(ro, '1.0.0'); fs.chmodSync(ro, 0o555);
    const t2 = new Updater({ currentVersion: '1', feedUrl: '', appPath: path.join(ro, 'Letterhead.app'), workDir: root });
    if (process.getuid && process.getuid() !== 0) { assert(!t2.installability().ok); console.log('read only folder refused:', t2.installability().note); } else console.log('(running as root, read only check skipped)');
    fs.chmodSync(ro, 0o755);
    // failed swap keeps the old app
    manifest = { version: '1.1.2', assets: { arm64: asset(zipOf('good2', '1.1.2')) } };
    u = new Updater({ currentVersion: '1.1.1', feedUrl: base + '/latest.json', arch: 'arm64', platform: 'linux', appPath: installed, workDir: path.join(root, 'work2') });
    await u.check(); assert.strictEqual(u.state.status, 'ready'); fs.rmSync(u.staged, { recursive: true }); // staged copy vanished
    delete process.env.LETTERHEAD_RELAUNCH; u.o.pid = 999999; u.install({ relaunch: false }); await new Promise(r => setTimeout(r, 1200));
    assert(/1\.1\.1/.test(fs.readFileSync(path.join(installed, 'Contents', 'Info.plist'), 'utf8')), 'old app not restored');
    console.log('swap failure: old app put back, still 1.1.1');
    // new version that hangs at launch (like a Gatekeeper hold): health check fails, old app restored
    const hangZip = zipOf('hang', '1.1.3', null, true);
    manifest = { version: '1.1.3', assets: { arm64: asset(hangZip) } };
    const w3 = path.join(root, 'work3');
    u = new Updater({ currentVersion: '1.1.1', feedUrl: base + '/latest.json', arch: 'arm64', platform: 'linux', appPath: installed, workDir: w3, healthWait: 3 });
    await u.check(); assert.strictEqual(u.state.status, 'ready', u.state.error);
    u.o.pid = 999999; const t0 = Date.now(); u.install({ relaunch: false });
    await until(() => fs.existsSync(path.join(w3, 'rollback.json')), 15000);
    await new Promise(r => setTimeout(r, 500));
    assert(/1\.1\.1/.test(fs.readFileSync(path.join(installed, 'Contents', 'Info.plist'), 'utf8')), 'old app not restored after failed health check');
    assert(!fs.existsSync(installed + '.previous') && !fs.existsSync(installed + '.failed'), 'leftovers');
    const rb = JSON.parse(fs.readFileSync(path.join(w3, 'rollback.json'), 'utf8')); assert.strictEqual(rb.version, '1.1.3');
    console.log(`hanging new version: rolled back to 1.1.1 in ${((Date.now() - t0) / 1000).toFixed(1)} s, reason: ${rb.reason}`);
    u = new Updater({ currentVersion: '1.1.1', feedUrl: base + '/latest.json', arch: 'arm64', platform: 'linux', appPath: installed, workDir: w3 });
    let told = null; u.on('rollback', r => { told = r; }); u.confirmLaunch(); assert(told && told.version === '1.1.3', 'rollback reported');
    await u.check(); assert.strictEqual(u.state.status, 'uptodate'); console.log('after rollback: automatic checks skip 1.1.3');
    await u.check({ manual: true }); assert.strictEqual(u.state.status, 'ready'); console.log('a manual check can still fetch it');
    // healthy update deletes the backup only after the health check
    manifest = { version: '1.1.4', assets: { arm64: asset(zipOf('good4', '1.1.4')) } };
    u = new Updater({ currentVersion: '1.1.1', feedUrl: base + '/latest.json', arch: 'arm64', platform: 'linux', appPath: installed, workDir: path.join(root, 'work4') });
    await u.check(); u.o.pid = 999999; const lg = u.install({ relaunch: false }).log;
    await until(() => /updated .* to 1\.1\.4/.test(fs.existsSync(lg) ? fs.readFileSync(lg, 'utf8') : ''), 15000);
    assert(/1\.1\.4/.test(fs.readFileSync(path.join(installed, 'Contents', 'Info.plist'), 'utf8')) && !fs.existsSync(installed + '.previous'));
    console.log('healthy update: health check passed, then the old copy was removed');
    console.log('\nALL UPDATER TESTS PASSED'); process.exit(0);
  } catch (e) { console.error('FAIL', e); process.exit(1); }
});
