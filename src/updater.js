'use strict';
// Self updater for an ad-hoc signed app. Squirrel.Mac (used by Electron's autoUpdater and electron-updater)
// only accepts updates for apps signed with a real identity, so Letterhead updates itself:
// read latest.json from GitHub Releases, download the zip for this Mac's chip, check its sha256,
// unpack with ditto, check the bundle id and version, then a small shell script swaps the app
// once Letterhead has quit, clears quarantine, and opens the new copy.
// Inside Electron, the normal fs module treats any *.asar file as a folder (asar support). A downloaded
// Letterhead.app contains Contents/Resources/app.asar, so fs.rmSync on a staged update fails with
// ENOTDIR (rmdir on app.asar). original-fs is plain Node fs with no asar magic, so the updater uses it.
let fs; try { fs = require('original-fs'); } catch (e) { fs = require('fs'); }
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const { EventEmitter } = require('events');

/** Delete a path without following symlinks or opening asar files: /bin/rm -rf first, plain fs as backup. */
function rmrf(p) {
  if (!p || p === '/' || p.length < 8) throw new Error('Refusing to delete ' + p);
  try { cp.execFileSync('/bin/rm', ['-rf', '--', p], { stdio: 'ignore' }); } catch (e) { /* fall through */ }
  let exists = true; try { fs.lstatSync(p); } catch (e) { exists = false; }
  if (exists) fs.rmSync(p, { recursive: true, force: true, maxRetries: 2 });
  try { fs.lstatSync(p); } catch (e) { return; }
  throw new Error('Could not clear ' + p);
}
const KEEP = new Set(['swap.sh', 'update.log']);

const BUNDLE_ID = 'com.shabdwarar.letterhead';
function cmpVer(a, b) {
  const pa = String(a).replace(/^v/, '').split(/[.-]/).map(x => parseInt(x, 10) || 0), pb = String(b).replace(/^v/, '').split(/[.-]/).map(x => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}
function plistValue(xml, key) { const m = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(xml); return m ? m[1] : null; }
function findApp(dir, depth = 0) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (n.endsWith('.app') && fs.lstatSync(p).isDirectory()) return p;
  }
  if (depth < 2) for (const n of fs.readdirSync(dir)) { const p = path.join(dir, n); if (fs.lstatSync(p).isDirectory() && !n.startsWith('__MACOSX')) { const f = findApp(p, depth + 1); if (f) return f; } }
  return null;
}
const SWAP_SCRIPT = `#!/bin/sh
# Letterhead update: wait for the app to quit, swap bundles, keep the old one if anything fails.
PID="$1"; APP="$2"; NEW="$3"; RELAUNCH="$4"; LOG="$5"
exec >>"$LOG" 2>&1
echo "[$(date)] waiting for $PID"
i=0
while kill -0 "$PID" 2>/dev/null; do i=$((i+1)); if [ $i -gt 600 ]; then echo "app did not quit, giving up"; exit 1; fi; sleep 0.2; done
BAK="$APP.previous"
rm -rf "$BAK"
if ! mv "$APP" "$BAK"; then echo "could not move the current app"; exit 1; fi
if mv "$NEW" "$APP"; then
  if command -v xattr >/dev/null 2>&1; then xattr -dr com.apple.quarantine "$APP" 2>/dev/null; fi
  rm -rf "$BAK"
  echo "updated $APP"
else
  echo "swap failed, putting the old app back"
  rm -rf "$APP"; mv "$BAK" "$APP"
fi
if [ "$RELAUNCH" = "1" ]; then
  if [ "$(uname)" = "Darwin" ]; then /usr/bin/open "$APP"; elif [ -n "$LETTERHEAD_RELAUNCH" ]; then sh -c "$LETTERHEAD_RELAUNCH" & fi
fi
echo "done"
`;

class Updater extends EventEmitter {
  constructor(o) {
    super();
    this.o = Object.assign({ platform: process.platform, arch: process.arch, fetch: globalThis.fetch, now: Date.now, intervalMs: 4 * 3600 * 1000 }, o);
    this.state = { status: 'idle', current: o.currentVersion, version: null, notes: null, progress: 0, error: null, lastChecked: null, canInstall: true, installNote: null };
    this.staged = null; this._busy = false;
  }
  set(p) { Object.assign(this.state, p); this.emit('state', { ...this.state }); }
  appBundle() { return this.o.appPath; }
  installability() {
    const app = this.appBundle();
    if (!app) return { ok: false, note: 'Updates install from the packaged app only.' };
    if (/AppTranslocation/.test(app)) return { ok: false, note: 'macOS is running Letterhead from a temporary copy. Move Letterhead to your Applications folder, open it from there, and updates will install.' };
    try { fs.accessSync(path.dirname(app), fs.constants.W_OK); } catch (e) { return { ok: false, note: `Letterhead cannot write to ${path.dirname(app)}. Move it to your Applications folder.` }; }
    if (/\/Volumes\//.test(app)) return { ok: false, note: 'Letterhead is running from a disk image. Copy it to Applications first.' };
    return { ok: true };
  }
  start() { setTimeout(() => { if (!this.staged) this.wipe(); this.check(); }, 15000); this._t = setInterval(() => this.check(), this.o.intervalMs); }
  stop() { clearInterval(this._t); }

  async check({ manual } = {}) {
    if (this._busy) return this.state;
    if (this.state.status === 'ready') return this.state;
    this._busy = true;
    try {
      this.set({ status: 'checking', error: null });
      const url = this.o.feedUrl + (this.o.feedUrl.includes('?') ? '&' : '?') + 't=' + this.o.now();
      const r = await this.o.fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Letterhead/' + this.o.currentVersion, Accept: 'application/json' } });
      if (r.status === 404) { this.set({ status: 'uptodate', lastChecked: this.o.now() }); return this.state; }
      if (!r.ok) throw new Error('Update feed answered ' + r.status);
      const m = await r.json();
      this.set({ lastChecked: this.o.now() });
      if (!m || !m.version || cmpVer(m.version, this.o.currentVersion) <= 0) { this.set({ status: 'uptodate', version: m && m.version }); return this.state; }
      const asset = m.assets && (m.assets[this.o.arch] || m.assets.universal);
      if (!asset || !asset.url || !/^[a-f0-9]{64}$/i.test(asset.sha256 || '')) throw new Error('The update feed has no download for this Mac.');
      const inst = this.installability();
      this.set({ status: 'downloading', version: m.version, notes: m.notes || '', progress: 0, canInstall: inst.ok, installNote: inst.note || null });
      let app;
      try { app = await this.stage(asset, m.version); }
      catch (e) {
        if (e.final) throw e;
        // self heal: wipe the whole updates folder (stale copies from older attempts) and try once more
        this.log('staging failed, wiping and retrying: ' + e.message);
        this.wipe({ all: true });
        this.set({ progress: 0 });
        app = await this.stage(asset, m.version);
      }
      this.staged = app;
      this.set({ status: 'ready', progress: 1 });
      this.emit('ready', { version: m.version, manual });
    } catch (e) {
      this.log('update failed: ' + e.message);
      this.set({ status: 'error', error: e.message });
    } finally { this._busy = false; }
    return this.state;
  }

  log(line) { try { fs.mkdirSync(this.o.workDir, { recursive: true }); fs.appendFileSync(path.join(this.o.workDir, 'update.log'), `[${new Date().toISOString()}] ${line}\n`); } catch (e) { /* ignore */ } }

  /** Remove old attempts. all=false keeps the folder of the update that is currently staged. */
  wipe({ all = false } = {}) {
    let names = []; try { names = fs.readdirSync(this.o.workDir); } catch (e) { return; }
    const keepDir = !all && this.staged ? path.relative(this.o.workDir, this.staged).split(path.sep)[0] : null;
    for (const n of names) { if (KEEP.has(n) || n === keepDir) continue; try { rmrf(path.join(this.o.workDir, n)); } catch (e) { this.log('cleanup: ' + e.message); } }
  }

  /** Download, verify and unpack into a fresh folder of its own. Errors marked final are not retried. */
  async stage(asset, version) {
    this.wipe();
    fs.mkdirSync(this.o.workDir, { recursive: true });
    const dir = fs.mkdtempSync(path.join(this.o.workDir, 'v' + String(version).replace(/[^0-9A-Za-z.-]/g, '') + '-'));
    const zip = path.join(dir, 'update.zip');
    await this.download(asset, zip);
    const out = path.join(dir, 'unpacked');
    await this.extract(zip, out);
    const app = findApp(out);
    const fin = msg => Object.assign(new Error(msg), { final: true });
    if (!app) throw new Error('The download did not contain Letterhead.app.');
    const plist = fs.readFileSync(path.join(app, 'Contents', 'Info.plist'), 'utf8');
    if (plistValue(plist, 'CFBundleIdentifier') !== BUNDLE_ID) { rmrf(dir); throw fin('The downloaded app is not Letterhead. Update skipped.'); }
    if (plistValue(plist, 'CFBundleShortVersionString') !== String(version).replace(/^v/, '')) { rmrf(dir); throw fin('The downloaded app version does not match the feed. Update skipped.'); }
    try { fs.rmSync(zip, { force: true }); } catch (e) { /* harmless */ }
    return app;
  }

  async download(asset, file) {
    const r = await this.o.fetch(asset.url, { redirect: 'follow', headers: { 'User-Agent': 'Letterhead/' + this.o.currentVersion } });
    if (!r.ok || !r.body) throw Object.assign(new Error('Download failed with ' + r.status), { final: r.status === 404 });
    const total = Number(asset.size) || Number(r.headers.get('content-length')) || 0;
    const hash = crypto.createHash('sha256'); const ws = fs.createWriteStream(file);
    let got = 0, lastEmit = 0;
    for await (const chunk of r.body) {
      const b = Buffer.from(chunk); hash.update(b); got += b.length;
      if (!ws.write(b)) await new Promise(res => ws.once('drain', res));
      if (total && Date.now() - lastEmit > 300) { lastEmit = Date.now(); this.set({ progress: Math.min(0.99, got / total) }); }
    }
    await new Promise((res, rej) => ws.end(err => err ? rej(err) : res()));
    const hex = hash.digest('hex');
    if (hex.toLowerCase() !== asset.sha256.toLowerCase()) { fs.rmSync(file, { force: true }); throw Object.assign(new Error('The download did not match its checksum, so it was thrown away.'), { final: true }); }
  }

  extract(zip, out) {
    fs.mkdirSync(out, { recursive: true });
    const [cmd, args] = this.o.platform === 'darwin'
      ? ['/usr/bin/ditto', ['-x', '-k', zip, out]]
      : ['python3', ['-c', 'import sys,zipfile,os,stat\nz=zipfile.ZipFile(sys.argv[1])\nfor i in z.infolist():\n p=os.path.join(sys.argv[2],i.filename); m=i.external_attr>>16\n if stat.S_ISLNK(m): os.makedirs(os.path.dirname(p),exist_ok=True); os.symlink(z.read(i).decode(),p)\n elif i.is_dir(): os.makedirs(p,exist_ok=True)\n else:\n  os.makedirs(os.path.dirname(p),exist_ok=True); open(p,"wb").write(z.read(i)); os.chmod(p,m&0o777 or 0o644)', zip, out]];
    return new Promise((res, rej) => cp.execFile(cmd, args, { maxBuffer: 1 << 20 }, err => err ? rej(new Error('Could not unpack the update: ' + err.message)) : res()));
  }

  /** Spawns the swap script, the caller must quit right after. */
  install({ relaunch = true } = {}) {
    if (!this.staged) throw new Error('No update is ready.');
    const inst = this.installability(); if (!inst.ok) throw new Error(inst.note);
    const script = path.join(this.o.workDir, 'swap.sh'); fs.writeFileSync(script, SWAP_SCRIPT, { mode: 0o755 });
    const log = path.join(this.o.workDir, 'update.log');
    const child = cp.spawn('/bin/sh', [script, String(this.o.pid || process.pid), this.appBundle(), this.staged, relaunch ? '1' : '0', log], { detached: true, stdio: 'ignore', env: process.env });
    child.unref();
    this.staged = null;
    return { script, log };
  }
}

module.exports = { Updater, cmpVer, findApp, rmrf, plistValue, SWAP_SCRIPT, BUNDLE_ID };
