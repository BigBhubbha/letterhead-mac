'use strict';
// Keeps the Mac awake while a batch is sending.
// Normal: Electron powerSaveBlocker('prevent-app-suspension') only. The display is never held on
// (no caffeinate -d), so the screen sleeps as usual and the GPU rests.
// Lid closed: `pmset -a disablesleep 1`, run once through an administrator prompt together with a
// root watcher that sets it back to 0 as soon as Letterhead removes its flag file or stops running
// (quit, crash, force quit). So no second password prompt is needed to restore sleep.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { EventEmitter } = require('events');

const shq = s => "'" + String(s).replace(/'/g, "'\\''") + "'";          // POSIX single-quote
const asq = s => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; // AppleScript string

function lidOnCommand(pid, flag) {
  const loop = `while [ -e ${shq(flag)} ] && kill -0 ${Number(pid)} 2>/dev/null; do sleep 5; done; /usr/bin/pmset -a disablesleep 0; rm -f ${shq(flag)}`;
  return `/usr/bin/pmset -a disablesleep 1 && (/usr/bin/nohup /bin/sh -c ${shq(loop)} >/dev/null 2>&1 &)`;
}
const lidOffCommand = () => '/usr/bin/pmset -a disablesleep 0';
const osascriptArgs = shellCmd => ['-e', `do shell script ${asq(shellCmd)} with administrator privileges`];
const parseSleepDisabled = out => { const m = /SleepDisabled\s+(\d)/.exec(String(out || '')); return m ? m[1] === '1' : null; };

class Power extends EventEmitter {
  constructor(o) {
    super();
    this.o = Object.assign({ platform: process.platform, pid: process.pid, execFile: cp.execFile, spawn: cp.spawn }, o);
    this.flag = path.join(this.o.dir, 'lid-awake.flag');
    this.owned = path.join(this.o.dir, 'lid-owned.json'); // we turned disablesleep on and have not seen it off yet
    this.blocker = null;
    this.lid = 'off'; // off | asking | on | declined | error | unsupported
    this.lidError = null; this.sleepDisabled = null; this.staleSleepOff = false;
  }
  isMac() { return this.o.platform === 'darwin'; }
  run(cmd, args) { return new Promise(res => this.o.execFile(cmd, args, { timeout: 120000 }, (err, stdout, stderr) => res({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }))); }
  status() { return { awake: this.blocker != null, lid: this.lid, lidError: this.lidError, sleepDisabled: this.sleepDisabled, stale: this.staleSleepOff, supported: this.isMac() }; }
  changed() { const st = this.status(), k = JSON.stringify(st); if (k === this._last) return; this._last = k; this.emit('status', st); }

  async readPmset() { if (!this.isMac()) return null; const r = await this.run('/usr/bin/pmset', ['-g']); this.sleepDisabled = parseSleepDisabled(r.stdout); return this.sleepDisabled; }

  /** On launch: a flag left behind means the old watcher already restored sleep (it exits with the app).
   *  If sleep is still disabled and Letterhead was the one that disabled it (a reboot stops the
   *  watcher before it can restore), set it back right away. That asks for the password once. */
  async startupCheck() {
    try { fs.unlinkSync(this.flag); } catch (e) {}
    const off = await this.readPmset();
    const ours = fs.existsSync(this.owned);
    this.staleSleepOff = off === true;
    if (off === false && ours) { try { fs.unlinkSync(this.owned); } catch (e) {} }
    this.changed();
    if (off === true && ours) { this.autoRestored = await this.restoreNow(); }
    return this.staleSleepOff;
  }

  /** wantAwake: keep the system awake now (display may sleep). wantLid: also with the lid closed. */
  async update({ wantAwake, wantLid, blockerApi }) {
    if (wantAwake && this.blocker == null && blockerApi) this.blocker = blockerApi.start('prevent-app-suspension');
    if (!wantAwake && this.blocker != null && blockerApi) { blockerApi.stop(this.blocker); this.blocker = null; }
    // lid closed
    if (wantLid && wantAwake && this.lid === 'off') await this.lidOn();
    if ((!wantLid || !wantAwake) && this.lid === 'on') await this.lidOff();
    if (!wantLid && (this.lid === 'declined' || this.lid === 'error')) this.lid = 'off';
    this.changed();
  }

  async lidOn() {
    if (!this.isMac()) { this.lid = 'unsupported'; return; }
    this.lid = 'asking'; this.changed();
    fs.mkdirSync(this.o.dir, { recursive: true });
    fs.writeFileSync(this.flag, String(Date.now()));
    const r = await this.run('/usr/bin/osascript', osascriptArgs(lidOnCommand(this.o.pid, this.flag)));
    if (r.err) {
      try { fs.unlinkSync(this.flag); } catch (e) {}
      const cancelled = /-128|User canceled/i.test(r.stderr);
      this.lid = cancelled ? 'declined' : 'error';
      this.lidError = cancelled ? 'The password prompt was cancelled, so the Mac will still sleep when the lid closes.' : (r.stderr.trim() || r.err.message);
    } else { this.lid = 'on'; this.lidError = null; try { fs.writeFileSync(this.owned, JSON.stringify({ at: Date.now(), pid: this.o.pid })); } catch (e) {} await this.readPmset(); }
    this.changed();
  }
  async lidOff() {
    try { fs.unlinkSync(this.flag); } catch (e) {}
    this.lid = 'off'; this.changed();
    // the root watcher notices within about 5 seconds
    const t = setTimeout(() => this.readPmset().then(off => { if (off === false) { try { fs.unlinkSync(this.owned); } catch (e) {} } this.changed(); }), 8000); if (t.unref) t.unref();
  }
  /** Manual "Restore normal sleep": always works, asks for the password. */
  async restoreNow() {
    try { fs.unlinkSync(this.flag); } catch (e) {}
    if (!this.isMac()) return { ok: true };
    const r = await this.run('/usr/bin/osascript', osascriptArgs(lidOffCommand()));
    await this.readPmset();
    if (!r.err) { this.staleSleepOff = false; this.lid = 'off'; try { fs.unlinkSync(this.owned); } catch (e) {} }
    this.changed();
    return r.err ? { ok: false, error: /-128/.test(r.stderr) ? 'Cancelled.' : r.stderr.trim() } : { ok: true };
  }
  /** On quit: drop the flag so the watcher restores sleep, release the blocker. */
  shutdown(blockerApi) { try { fs.unlinkSync(this.flag); } catch (e) {} if (this.blocker != null && blockerApi) { try { blockerApi.stop(this.blocker); } catch (e) {} this.blocker = null; } }
}

// `pmset -g batt` -> { pct, ac } or null when there is no battery
function parseBattery(out) {
  const s = String(out || ''); const m = /(\d+)%;\s*([a-z ]+);/i.exec(s);
  if (!m) return null;
  return { pct: Number(m[1]), ac: /AC Power/.test(s) || /^(charging|charged|finishing charge|AC attached)$/i.test(m[2].trim()) };
}
Power.prototype.readBattery = async function () { if (!this.isMac()) return null; const r = await this.run('/usr/bin/pmset', ['-g', 'batt']); return parseBattery(r.stdout); };

module.exports = { parseBattery, Power, lidOnCommand, lidOffCommand, osascriptArgs, parseSleepDisabled, shq, asq };
