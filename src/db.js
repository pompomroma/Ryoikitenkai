import fs from 'node:fs';
import Database from 'better-sqlite3';
import { DATA_DIR, DB_PATH, PROJECTS_DIR } from './config.js';

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(PROJECTS_DIR, { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    pw_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    generation_complete INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_messages_project ON messages(project_id);
`);

export const stmts = {
  insertUser: db.prepare(
    'INSERT INTO users (email, pw_hash) VALUES (?, ?) RETURNING *'
  ),
  findUserByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  findUserById: db.prepare('SELECT * FROM users WHERE id = ?'),

  insertProject: db.prepare(
    'INSERT INTO projects (user_id, name) VALUES (?, ?) RETURNING *'
  ),
  listProjectsForUser: db.prepare(
    'SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC'
  ),
  getProject: db.prepare(
    'SELECT * FROM projects WHERE id = ? AND user_id = ?'
  ),
  renameProject: db.prepare(
    "UPDATE projects SET name = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?"
  ),
  touchProject: db.prepare(
    "UPDATE projects SET updated_at = datetime('now') WHERE id = ?"
  ),
  markProjectComplete: db.prepare(
    "UPDATE projects SET generation_complete = ?, updated_at = datetime('now') WHERE id = ?"
  ),
  deleteProject: db.prepare(
    'DELETE FROM projects WHERE id = ? AND user_id = ?'
  ),

  insertMessage: db.prepare(
    'INSERT INTO messages (project_id, role, content) VALUES (?, ?, ?) RETURNING *'
  ),
  listMessagesForProject: db.prepare(
    'SELECT id, role, content, created_at FROM messages WHERE project_id = ? ORDER BY id ASC'
  ),
};
