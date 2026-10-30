// Run inside Electron (asar aware fs), like the real app:
//   xvfb-run -a node_modules/.bin/electron test/updater-electron.test.js --no-sandbox [path/to/old/updater.js]
// Builds a Letterhead.app with a real app.asar and Electron style framework symlinks, leaves a stale
// copy from an earlier attempt in the updates folder, then checks the updater still stages the update.
const fs = require('original-fs'), path = require('path'), os = require('os'), http = require('http'), crypto = require('crypto'), cp = require('child_process'), assert = require('assert');
const { app } = require('electron');
const oldImpl = process.argv.find(a => /updater.*\.js$/.test(a) && !a.includes('updater-electron'));
const { Updater } = require(oldImpl ? path.resolve(oldImpl) : '../src/updater');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-upde-'));
const plist = v => `<plist><dict><key>CFBundleIdentifier</key><string>com.shabdwarar.letterhead</string><key>CFBundleShortVersionString</key><string>${v}</string></dict></plist>`;
function fakeApp(dir, v) {
  const C = path.join(dir, 'Letterhead.app', 'Contents'); fs.mkdirSync(path.join(C, 'MacOS'), { recursive: true }); fs.mkdirSync(path.join(C, 'Resources'), { recursive: true });
  fs.writeFileSync(path.join(C, 'Info.plist'), plist(v)); fs.writeFileSync(path.join(C, 'MacOS', 'Letterhead'), '#!/bin/sh\n', { mode: 0o755 });
  // a real asar archive, so Electron's fs sees it as a folder
  const src = path.join(root, 'asar-src-' + v); fs.mkdirSync(src, { recursive: true }); fs.writeFileSync(path.join(src, 'package.json'), '{"name":"x","main":"main.js"}'); fs.writeFileSync(path.join(src, 'main.js'), '');
  cp.execFileSync(process.execPath.includes('electron') ? 'node' : process.execPath, [require.resolve('@electron/asar/bin/asar.js'), 'pack', src, path.join(C, 'Resources', 'app.asar')]);
  for (const fw of ['Electron Framework', 'Mantle', 'ReactiveObjC', 'Squirrel']) {
    const F = path.join(C, 'Frameworks', fw + '.framework'); fs.mkdirSync(path.join(F, 'Versions', 'A', 'Resources'), { recursive: true });
    fs.writeFileSync(path.join(F, 'Versions', 'A', fw), 'bin'); fs.writeFileSync(path.join(F, 'Versions', 'A', 'Resources', 'Info.plist'), '<plist/>');
    fs.symlinkSync('A', path.join(F, 'Versions', 'Current')); fs.symlinkSync('Versions/Current/Resources', path.join(F, 'Resources')); fs.symlinkSync('Versions/Current/' + fw, path.join(F, fw));
  }
  fs.symlinkSync('/nonexistent/target', path.join(C, 'dangling-link'));
  return path.join(dir, 'Letterhead.app');
}
const zipOf = v => { const d = path.join(root, 'src-' + v); fs.mkdirSync(d); fakeApp(d, v); const z = path.join(root, v + '.zip'); cp.execFileSync('python3', [path.join(__dirname, '..', 'scripts', 'mkzip.py'), z, path.join(d, 'Letterhead.app') + '=Letterhead.app']); return z; };
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
let manifest;
const srv = http.createServer((q, r) => { const u = q.url.split('?')[0]; if (u === '/latest.json') return r.end(JSON.stringify(manifest)); const f = path.join(root, u.slice(1)); if (fs.existsSync(f)) return fs.createReadStream(f).pipe(r); r.statusCode = 404; r.end(); });
app.whenReady().then(() => srv.listen(0, '127.0.0.1', async () => {
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const z = zipOf('2.0.1'); manifest = { version: '2.0.1', assets: { arm64: { url: base + '/2.0.1.zip', sha256: sha(z), size: fs.statSync(z).size } } };
    const work = path.join(root, 'updates'); const apps = path.join(root, 'Applications'); fs.mkdirSync(apps); const installed = fakeApp(apps, '2.0.0');
    // stale copies from earlier attempts: the 1.1 style folder name and an older version
    if (process.env.NO_STALE) fs.mkdirSync(work, { recursive: true }); else { fakeApp(path.join(work, 'v2.0.1', 'unpacked'), '2.0.1'); fakeApp(path.join(work, 'v2.0.0', 'unpacked'), '2.0.0'); }
    const mk = () => new Updater({ currentVersion: '2.0.0', feedUrl: base + '/latest.json', arch: 'arm64', platform: 'linux', appPath: installed, workDir: work });
    let u = mk(); await u.check();
    console.log('with stale copies in updates/:', u.state.status, u.state.error || '');
    assert.strictEqual(u.state.status, 'ready', u.state.error);
    assert(!fs.existsSync(path.join(work, 'v2.0.0')) && !fs.existsSync(path.join(work, 'v2.0.1')), 'stale copies removed');
    assert(fs.lstatSync(path.join(u.staged, 'Contents', 'Frameworks', 'Mantle.framework', 'Versions', 'Current')).isSymbolicLink(), 'symlinks kept');
    assert(fs.statSync(path.join(u.staged, 'Contents', 'Resources', 'app.asar')).isFile(), 'asar kept as a file');
    const first = u.staged;
    // a second attempt (app relaunched before installing) must also work, and gets its own folder
    u = mk(); await u.check(); assert.strictEqual(u.state.status, 'ready', u.state.error); assert.notStrictEqual(u.staged, first); assert(!fs.existsSync(first), 'previous attempt cleaned');
    console.log('second attempt in a fresh folder: ok', path.basename(path.dirname(path.dirname(u.staged))));
    // self heal: first staging fails (unpack error), updater wipes updates/ and retries once
    u = mk(); let calls = 0; const realExtract = u.extract.bind(u); u.extract = (zip, out) => (++calls === 1 ? Promise.reject(new Error('Could not unpack the update: simulated')) : realExtract(zip, out));
    await u.check(); assert.strictEqual(u.state.status, 'ready', u.state.error); assert.strictEqual(calls, 2); console.log('self heal after a failed unpack: wiped and retried once, ready');
    // persistent failure: retried once only, then a clear error
    u = mk(); calls = 0; u.extract = () => { calls++; return Promise.reject(new Error('Could not unpack the update: simulated')); };
    await u.check(); assert.strictEqual(u.state.status, 'error'); assert.strictEqual(calls, 2); console.log('persistent failure: tried twice, then error:', u.state.error);
    // real swap with the asar/symlink bundle
    u = mk(); await u.check(); const dummy = cp.spawn('sleep', ['30']); u.o.pid = dummy.pid; const { log } = u.install({ relaunch: false }); dummy.kill();
    await new Promise(r => setTimeout(r, 1500));
    assert(/2\.0\.1/.test(fs.readFileSync(path.join(installed, 'Contents', 'Info.plist'), 'utf8')), 'not swapped: ' + fs.readFileSync(log, 'utf8'));
    assert(!fs.existsSync(installed + '.previous'));
    console.log('swap to 2.0.1 with asar + framework symlinks: ok');
    console.log('\nALL ELECTRON UPDATER TESTS PASSED'); process.exit(0);
  } catch (e) { console.error('FAIL', e.message); process.exit(1); }
}));
