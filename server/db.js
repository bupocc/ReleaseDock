import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openDatabase(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(dataDir, 'releasedock.sqlite'));
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version > 2) { db.close(); throw new Error('数据库版本高于当前程序，请使用更新版本的 ReleaseDock'); }
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      subtitle TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '其他', website TEXT NOT NULL DEFAULT '',
      platforms TEXT NOT NULL DEFAULT '[]', is_public INTEGER NOT NULL DEFAULT 1,
      icon TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS releases (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
      version TEXT NOT NULL, title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
      channel TEXT NOT NULL CHECK(channel IN ('stable','prerelease')),
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','withdrawn')),
      is_latest INTEGER NOT NULL DEFAULT 0, published_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(project_id,version)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_latest_release ON releases(project_id) WHERE is_latest = 1;
    CREATE INDEX IF NOT EXISTS releases_project_status ON releases(project_id,status,published_at DESC);
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY, release_id TEXT NOT NULL REFERENCES releases(id),
      filename TEXT NOT NULL, storage_name TEXT NOT NULL UNIQUE, content_type TEXT NOT NULL,
      size INTEGER NOT NULL CHECK(size >= 0), platform TEXT NOT NULL, arch TEXT NOT NULL,
      sha256 TEXT NOT NULL, download_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, UNIQUE(release_id,filename)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, csrf_token TEXT NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS daily_downloads (
      day TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, target_id TEXT,
      created_at TEXT NOT NULL
    );
  `);
  if (version < 2) transaction(db, () => {
    db.exec(`
      CREATE TABLE passkeys (
        id TEXT PRIMARY KEY, credential_id TEXT NOT NULL UNIQUE,
        public_key BLOB NOT NULL, counter INTEGER NOT NULL DEFAULT 0,
        rp_id TEXT NOT NULL, label TEXT NOT NULL, transports TEXT NOT NULL DEFAULT '[]',
        device_type TEXT NOT NULL, backed_up INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, last_used_at TEXT
      );
      CREATE TABLE passkey_enrollments (
        token_hash TEXT PRIMARY KEY, mode TEXT NOT NULL CHECK(mode IN ('setup','recovery')),
        origin TEXT NOT NULL, expires_at INTEGER NOT NULL
      );
      CREATE TABLE webauthn_challenges (
        token_hash TEXT PRIMARY KEY, challenge TEXT NOT NULL,
        purpose TEXT NOT NULL CHECK(purpose IN ('registration','login','reauthentication')),
        origin TEXT NOT NULL, rp_id TEXT NOT NULL, expires_at INTEGER NOT NULL,
        enrollment_hash TEXT, session_hash TEXT, label TEXT
      );
      CREATE INDEX webauthn_challenges_expiry ON webauthn_challenges(expires_at);
      ALTER TABLE sessions ADD COLUMN passkey_id TEXT REFERENCES passkeys(id);
      ALTER TABLE sessions ADD COLUMN verified_at INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE sessions ADD COLUMN auth_origin TEXT NOT NULL DEFAULT '';
      DELETE FROM sessions;
      DELETE FROM settings WHERE key = '_key_fingerprint';
      PRAGMA user_version = 2;
    `);
  });
  const insert = db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)');
  for (const [key,value] of Object.entries({name:'ReleaseDock',description:'发现我们的软件项目，获取最新稳定版本。',announcement:''})) insert.run(key,value);
  return db;
}

export function transaction(db,fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result=fn();db.exec('COMMIT');return result; }
  catch(error) {db.exec('ROLLBACK');throw error;}
}

export function audit(db,action,targetId = null) {
  db.prepare('INSERT INTO audit_log(action,target_id,created_at) VALUES(?,?,?)').run(action,targetId,new Date().toISOString());
}
