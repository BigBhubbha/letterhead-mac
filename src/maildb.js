'use strict';
// Local mail cache: SQLite (sql.js, compiled to WebAssembly so it runs on both Mac chips without native builds).
// Holds message headers, flags, snippets, the Sent-mail style index and assistant state. Bodies live as JSON
// files next to it so the database stays small. Written to disk a moment after each change.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, folder TEXT NOT NULL, uid INTEGER NOT NULL, msgid TEXT, gmid TEXT, thread TEXT,
  subject TEXT, fromName TEXT, fromAddr TEXT, toJson TEXT, ccJson TEXT, replyTo TEXT, date INTEGER, seen INTEGER, flagged INTEGER, answered INTEGER,
  draft INTEGER, labels TEXT, hasAtt INTEGER, snippet TEXT, size INTEGER, inReplyTo TEXT, refs TEXT, bulk TEXT, body INTEGER DEFAULT 0, UNIQUE(folder, uid));
CREATE INDEX IF NOT EXISTS m_folder_date ON messages(folder, date);
CREATE INDEX IF NOT EXISTS m_thread ON messages(thread);
CREATE INDEX IF NOT EXISTS m_msgid ON messages(msgid);
CREATE TABLE IF NOT EXISTS folders(path TEXT PRIMARY KEY, name TEXT, delim TEXT, special TEXT, isLabel INTEGER, uidvalidity INTEGER, uidnext INTEGER,
  total INTEGER, unread INTEGER, synced INTEGER, complete INTEGER, sort INTEGER);
CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS sent_index(id INTEGER PRIMARY KEY, msgid TEXT UNIQUE, uid INTEGER, date INTEGER, toAddr TEXT, toName TEXT, subject TEXT, reply TEXT, context TEXT, hash TEXT);
CREATE TABLE IF NOT EXISTS suggestions(k TEXT PRIMARY KEY, thread TEXT, msgid TEXT, folder TEXT, uid INTEGER, fromAddr TEXT, fromName TEXT, subject TEXT,
  snippet TEXT, date INTEGER, status TEXT, draft TEXT, variant TEXT, model TEXT, error TEXT, createdAt INTEGER, updatedAt INTEGER, sendAt INTEGER, rule TEXT, auto INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS autolog(id INTEGER PRIMARY KEY, t INTEGER, toAddr TEXT, subject TEXT, status TEXT, reason TEXT, rule TEXT);
`;

class MailDB {
  static async open(file, { wasmPath } = {}) {
    const initSqlJs = require('sql.js/dist/sql-wasm.js');
    const wp = wasmPath || [path.join(__dirname, 'sql-wasm.wasm'), path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')].find(p => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } });
    const SQL = await initSqlJs({ wasmBinary: fs.readFileSync(wp) });
    let data = null;
    try { data = fs.readFileSync(file); } catch (e) {}
    let db;
    try { db = data ? new SQL.Database(data) : new SQL.Database(); db.exec('SELECT 1'); }
    catch (e) { try { fs.renameSync(file, file + '.broken'); } catch (e2) {} db = new SQL.Database(); }
    db.exec(SCHEMA);
    return new MailDB(db, file);
  }
  constructor(db, file) { this.db = db; this.file = file; this.bodyDir = file ? path.join(path.dirname(file), 'mailcache') : null; this._t = null; }
  all(sql, params = []) { const st = this.db.prepare(sql); try { st.bind(params); const out = []; while (st.step()) out.push(st.getAsObject()); return out; } finally { st.free(); } }
  get(sql, params = []) { return this.all(sql, params)[0] || null; }
  run(sql, params = []) { this.db.run(sql, params); this.dirty(); }
  tx(fn) { this.db.exec('BEGIN'); try { const r = fn(); this.db.exec('COMMIT'); this.dirty(); return r; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
  dirty() { if (!this.file || this._t) return; this._t = setTimeout(() => this.flush(), 1500); }
  flush() {
    clearTimeout(this._t); this._t = null; if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp'; fs.writeFileSync(tmp, Buffer.from(this.db.export())); fs.renameSync(tmp, this.file);
  }
  kvGet(k, d) { const r = this.get('SELECT v FROM kv WHERE k=?', [k]); if (!r) return d; try { return JSON.parse(r.v); } catch (e) { return d; } }
  kvSet(k, v) { this.run('INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v', [k, JSON.stringify(v)]); }
  // bodies
  bodyPath(folder, uid) { return path.join(this.bodyDir, crypto.createHash('sha1').update(folder + '\0' + uid).digest('hex') + '.json'); }
  readBody(folder, uid) { if (!this.bodyDir) return this._mem && this._mem[folder + '\0' + uid] || null; try { return JSON.parse(fs.readFileSync(this.bodyPath(folder, uid), 'utf8')); } catch (e) { return null; } }
  writeBody(folder, uid, body) {
    if (!this.bodyDir) { (this._mem = this._mem || {})[folder + '\0' + uid] = body; return; }
    fs.mkdirSync(this.bodyDir, { recursive: true }); fs.writeFileSync(this.bodyPath(folder, uid), JSON.stringify(body));
  }
  dropBody(folder, uid) { if (this.bodyDir) try { fs.unlinkSync(this.bodyPath(folder, uid)); } catch (e) {} else if (this._mem) delete this._mem[folder + '\0' + uid]; }
  close() { this.flush(); this.db.close(); }
}
module.exports = { MailDB };
