import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeMessage } from './history.mjs';

export class Store {
  constructor(dir) {
    if (dir !== ':memory:') mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(dir === ':memory:' ? dir : join(dir, 'app.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS connections (id TEXT PRIMARY KEY, owner INTEGER NOT NULL, enabled INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS recipients (owner INTEGER NOT NULL, connection TEXT NOT NULL, chat INTEGER NOT NULL, name TEXT NOT NULL, username TEXT, incoming INTEGER NOT NULL DEFAULT 0, seen INTEGER NOT NULL, PRIMARY KEY(owner, connection, chat));
      CREATE TABLE IF NOT EXISTS destinations (owner INTEGER NOT NULL, chat INTEGER NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, username TEXT, PRIMARY KEY(owner,chat));
      CREATE TABLE IF NOT EXISTS destination_requests (id INTEGER PRIMARY KEY, owner INTEGER NOT NULL, expires INTEGER NOT NULL, kind TEXT NOT NULL, result INTEGER, error TEXT, claimed INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS selections (id INTEGER PRIMARY KEY, owner INTEGER NOT NULL, expires INTEGER NOT NULL, result INTEGER);
      CREATE TABLE IF NOT EXISTS packs (name TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS user_packs (owner INTEGER NOT NULL, pack TEXT NOT NULL, PRIMARY KEY(owner, pack));
      CREATE TABLE IF NOT EXISTS deliveries (owner INTEGER NOT NULL, id TEXT NOT NULL, digest TEXT NOT NULL, status TEXT NOT NULL, message INTEGER, created INTEGER NOT NULL, PRIMARY KEY(owner, id));
      CREATE TABLE IF NOT EXISTS chat_messages (owner INTEGER NOT NULL, connection TEXT NOT NULL, chat INTEGER NOT NULL, id INTEGER NOT NULL, date INTEGER NOT NULL, edited INTEGER NOT NULL, outgoing INTEGER NOT NULL, text TEXT NOT NULL, entities TEXT NOT NULL, media TEXT NOT NULL, reply_to INTEGER, deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(owner,connection,chat,id));
      CREATE INDEX IF NOT EXISTS chat_messages_recent ON chat_messages(owner,connection,chat,date DESC,id DESC);
      CREATE TABLE IF NOT EXISTS chat_deleted_messages (owner INTEGER NOT NULL, connection TEXT NOT NULL, chat INTEGER NOT NULL, id INTEGER NOT NULL, removed INTEGER NOT NULL, PRIMARY KEY(owner,connection,chat,id));
      CREATE TABLE IF NOT EXISTS delivery_reports (owner INTEGER NOT NULL, id TEXT NOT NULL, emoji_report TEXT NOT NULL, PRIMARY KEY(owner,id), FOREIGN KEY(owner,id) REFERENCES deliveries(owner,id));`);
    if (!this.db.prepare('PRAGMA table_info(selections)').all().some(c => c.name === 'result')) this.db.exec('ALTER TABLE selections ADD COLUMN result INTEGER');
    this.db.prepare("UPDATE deliveries SET status='unknown' WHERE status='pending'").run();
    this.db.prepare('INSERT OR IGNORE INTO meta VALUES (?,?)').run('history_started', String(Date.now()));
  }
  getMeta(key) { return this.db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value; }
  setMeta(key, value) { this.db.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)').run(key, String(value)); }
  connection(data) {
    this.db.prepare('INSERT OR REPLACE INTO connections VALUES (?,?,?,?)').run(data.id, data.user.id, data.is_enabled ? 1 : 0, JSON.stringify(data));
  }
  connections(owner) { return this.db.prepare('SELECT data FROM connections WHERE owner=? AND enabled=1').all(owner).map(r => JSON.parse(r.data)); }
  getConnection(id) { const r = this.db.prepare('SELECT data FROM connections WHERE id=?').get(id); return r ? JSON.parse(r.data) : null; }
  recipient(owner, connection, chat, incoming = 0) {
    if (chat.type && chat.type !== 'private') return;
    const name = [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || 'Пользователь';
    this.db.prepare(`INSERT INTO recipients VALUES (?,?,?,?,?,?,?) ON CONFLICT(owner,connection,chat) DO UPDATE SET name=excluded.name,username=excluded.username,incoming=MAX(recipients.incoming,excluded.incoming),seen=excluded.seen`).run(owner, connection, chat.id, name, chat.username || null, incoming, Date.now());
  }
  recipients(owner) {
    return this.db.prepare('SELECT r.* FROM recipients r JOIN connections c ON c.id=r.connection WHERE r.owner=? AND c.owner=? AND c.enabled=1 ORDER BY r.seen DESC LIMIT 200').all(owner, owner);
  }
  destinations(owner) { return this.db.prepare('SELECT * FROM destinations WHERE owner=? ORDER BY name').all(owner); }
  destination(owner, chat) { this.db.prepare('INSERT OR REPLACE INTO destinations VALUES (?,?,?,?,?)').run(owner, chat.id, chat.type, chat.title, chat.username); }
  destinationRequest(id, owner, kind) { this.db.prepare('DELETE FROM destination_requests WHERE expires<?').run(Date.now()); this.db.prepare('INSERT INTO destination_requests(id,owner,expires,kind) VALUES (?,?,?,?)').run(id, owner, Date.now()+300000, kind); }
  claimDestination(id, owner) { return this.db.prepare('UPDATE destination_requests SET claimed=1 WHERE id=? AND owner=? AND expires>? AND claimed=0 RETURNING kind').get(id, owner, Date.now()); }
  finishDestination(id, owner, result, error = null) { this.db.prepare('UPDATE destination_requests SET result=?,error=? WHERE id=? AND owner=? AND claimed=1').run(result, error, id, owner); }
  selectedDestination(id, owner) { return this.db.prepare('SELECT result,error FROM destination_requests WHERE id=? AND owner=? AND expires>?').get(id, owner, Date.now()); }
  pack(owner, pack) {
    this.db.prepare('INSERT OR REPLACE INTO packs VALUES (?,?)').run(pack.name, JSON.stringify(pack));
    this.db.prepare('INSERT OR IGNORE INTO user_packs VALUES (?,?)').run(owner, pack.name);
  }
  packs(owner = 0) { return this.db.prepare('SELECT p.data FROM packs p JOIN user_packs u ON u.pack=p.name WHERE u.owner=0 OR u.owner=? GROUP BY p.name ORDER BY MIN(u.rowid)').all(owner).map(r => JSON.parse(r.data)); }
  personalPackCount(owner) { return this.db.prepare('SELECT COUNT(*) AS count FROM user_packs u WHERE u.owner=? AND NOT EXISTS (SELECT 1 FROM user_packs shared WHERE shared.owner=0 AND shared.pack=u.pack)').get(owner).count; }
  allPacks() { return this.db.prepare('SELECT data FROM packs').all().map(r => JSON.parse(r.data)); }
  selection(id, owner) { this.db.prepare('DELETE FROM selections WHERE expires<?').run(Date.now()); this.db.prepare('INSERT INTO selections VALUES (?,?,?,NULL)').run(id, owner, Date.now() + 300000); }
  completeSelection(id, owner, chat) {
    return !!this.db.prepare('UPDATE selections SET result=? WHERE id=? AND owner=? AND expires>? AND result IS NULL RETURNING id').get(chat, id, owner, Date.now());
  }
  selected(id, owner) { return this.db.prepare('SELECT result FROM selections WHERE id=? AND owner=? AND expires>?').get(id, owner, Date.now())?.result; }
  recordMessage(owner, connection, message) {
    const m = normalizeMessage(owner, message); if (!m) return;
    // A delete update can arrive before the send response is saved.
    if (this.db.prepare('SELECT 1 FROM chat_deleted_messages WHERE owner=? AND connection=? AND chat=? AND id=?').get(owner, connection, message.chat.id, m.id)) return;
    this.db.exec('BEGIN');
    try {
      this.db.prepare(`INSERT INTO chat_messages(owner,connection,chat,id,date,edited,outgoing,text,entities,media,reply_to) VALUES (?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(owner,connection,chat,id) DO UPDATE SET date=excluded.date,edited=excluded.edited,outgoing=excluded.outgoing,text=excluded.text,entities=excluded.entities,media=excluded.media,reply_to=excluded.reply_to
        WHERE chat_messages.deleted=0 AND excluded.edited>=chat_messages.edited`).run(owner, connection, message.chat.id, m.id, m.date, m.edited, m.outgoing ? 1 : 0, m.text, JSON.stringify(m.entities), JSON.stringify(m.media), m.replyTo);
      this.db.prepare(`DELETE FROM chat_messages WHERE owner=? AND connection=? AND chat=? AND id NOT IN (SELECT id FROM chat_messages WHERE owner=? AND connection=? AND chat=? ORDER BY date DESC,id DESC LIMIT 100)`).run(owner, connection, message.chat.id, owner, connection, message.chat.id);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  deleteMessages(owner, connection, chat, ids) {
    const query = this.db.prepare("UPDATE chat_messages SET deleted=1,text='',entities='[]',media='null',reply_to=NULL WHERE owner=? AND connection=? AND chat=? AND id=?");
    this.db.exec('BEGIN');
    try {
      const tombstone = this.db.prepare('INSERT OR REPLACE INTO chat_deleted_messages VALUES (?,?,?,?,?)');
      for (const id of ids) { query.run(owner, connection, chat, id); tombstone.run(owner, connection, chat, id, Date.now()); }
      this.db.prepare('DELETE FROM chat_deleted_messages WHERE owner=? AND connection=? AND chat=? AND id NOT IN (SELECT id FROM chat_deleted_messages WHERE owner=? AND connection=? AND chat=? ORDER BY removed DESC,id DESC LIMIT 100)').run(owner, connection, chat, owner, connection, chat);
      this.db.exec('COMMIT');
    }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  history(owner, connection, chat) {
    return this.db.prepare('SELECT * FROM chat_messages WHERE owner=? AND connection=? AND chat=? ORDER BY date,id LIMIT 100').all(owner, connection, chat).map(historyRow);
  }
  historyMessage(owner, connection, chat, id) {
    const row = this.db.prepare('SELECT * FROM chat_messages WHERE owner=? AND connection=? AND chat=? AND id=?').get(owner, connection, chat, id);
    return row ? historyRow(row) : null;
  }
  delivery(owner, id) { return this.db.prepare('SELECT d.*,r.emoji_report FROM deliveries d LEFT JOIN delivery_reports r ON r.owner=d.owner AND r.id=d.id WHERE d.owner=? AND d.id=?').get(owner, id); }
  reserveDelivery(owner, id, digest) { this.db.prepare("INSERT INTO deliveries (owner,id,digest,status,message,created) VALUES (?,?,?,'pending',NULL,?)").run(owner, id, digest, Date.now()); }
  finishDelivery(owner, id, status, message = null, emojiReport = null) {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('UPDATE deliveries SET status=?,message=? WHERE owner=? AND id=?').run(status, message, owner, id);
      if (emojiReport) this.db.prepare('INSERT OR REPLACE INTO delivery_reports VALUES (?,?,?)').run(owner, id, JSON.stringify(emojiReport));
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}

function historyRow(row) { return { id: row.id, date: row.date, edited: row.edited, outgoing: !!row.outgoing, text: row.text, entities: JSON.parse(row.entities), media: JSON.parse(row.media), replyTo: row.reply_to, deleted: !!row.deleted }; }
