'use strict';
// Keeps the Mac awake while batches are waiting or sending.
// Normal: Electron powerSaveBlocker + `caffeinate -dimsu -w <pid>`.
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
    this.blocker = null; this.caf = null;
    this.lid = 'off'; // off | asking | on | declined | error | unsupported
    this.lidError = null; this.sleepDisabled = null; this.staleSleepOff = false;
  }
  isMac() { return this.o.platform === 'darwin'; }
  run(cmd, args) { return new Promise(res => this.o.execFile(cmd, args, { timeout: 120000 }, (err, stdout, stderr) => res({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }))); }
  status() { return { awake: !!(this.blocker != null || this.caf), lid: this.lid, lidError: this.lidError, sleepDisabled: this.sleepDisabled, stale: this.staleSleepOff, supported: this.isMac() }; }
  changed() { this.emit('status', this.status()); }

  async readPmset() { if (!this.isMac()) return null; const r = await this.run('/usr/bin/pmset', ['-g']); this.sleepDisabled = parseSleepDisabled(r.stdout); return this.sleepDisabled; }

  /** On launch: a flag left behind means the old watcher already restored sleep (it exits with the app). */
  async startupCheck() {
    try { fs.unlinkSync(this.flag); } catch (e) {}
    const off = await this.readPmset();
    this.staleSleepOff = off === true;
    this.changed();
    return this.staleSleepOff;
  }

  /** wantAwake: keep awake now. wantLid: also keep awake with the lid closed. */
  async update({ wantAwake, wantLid, blockerApi }) {
    // normal awake
    if (wantAwake && this.blocker == null && blockerApi) this.blocker = blockerApi.start('prevent-app-suspension');
    if (!wantAwake && this.blocker != null && blockerApi) { blockerApi.stop(this.blocker); this.blocker = null; }
    if (wantAwake && !this.caf && this.isMac()) {
      try { this.caf = this.o.spawn('/usr/bin/caffeinate', ['-dimsu', '-w', String(this.o.pid)], { stdio: 'ignore' }); this.caf.on('exit', () => { this.caf = null; }); } catch (e) { this.caf = null; }
    }
    if (!wantAwake && this.caf) { try { this.caf.kill(); } catch (e) {} this.caf = null; }
    // lid closed
    if (wantLid && wantAwake && this.lid === 'off') await this.lidOn();
    if ((!wantLid || !wantAwake) && (this.lid === 'on')) await this.lidOff();
    if (!wantLid && this.lid === 'declined') this.lid = 'off';
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
    } else { this.lid = 'on'; this.lidError = null; await this.readPmset(); }
    this.changed();
  }
  async lidOff() {
    try { fs.unlinkSync(this.flag); } catch (e) {}
    this.lid = 'off'; this.changed();
    // the root watcher notices within about 5 seconds
    setTimeout(() => this.readPmset().then(() => this.changed()), 8000);
  }
  /** Manual "Restore normal sleep": always works, asks for the password. */
  async restoreNow() {
    try { fs.unlinkSync(this.flag); } catch (e) {}
    if (!this.isMac()) return { ok: true };
    const r = await this.run('/usr/bin/osascript', osascriptArgs(lidOffCommand()));
    await this.readPmset();
    if (!r.err) { this.staleSleepOff = false; this.lid = 'off'; }
    this.changed();
    return r.err ? { ok: false, error: /-128/.test(r.stderr) ? 'Cancelled.' : r.stderr.trim() } : { ok: true };
  }
  /** On quit: drop the flag so the watcher restores sleep, stop caffeinate. */
  shutdown() { try { fs.unlinkSync(this.flag); } catch (e) {} if (this.caf) try { this.caf.kill(); } catch (e) {} }
}

module.exports = { Power, lidOnCommand, lidOffCommand, osascriptArgs, parseSleepDisabled, shq, asq };
