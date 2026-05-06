import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import archiver from 'archiver';
import { PROJECTS_DIR } from './config.js';

export function projectDir(userId, projectId) {
  return path.join(PROJECTS_DIR, String(userId), String(projectId));
}

function safeJoin(rootDir, relativePath) {
  const normalized = path
    .normalize(relativePath)
    .replace(/^([/\\])+/, '');
  const target = path.resolve(rootDir, normalized);
  const rootResolved = path.resolve(rootDir);
  if (
    target !== rootResolved &&
    !target.startsWith(rootResolved + path.sep)
  ) {
    throw new Error(`Refusing to write outside project: ${relativePath}`);
  }
  return target;
}

export async function clearProjectDir(userId, projectId) {
  const dir = projectDir(userId, projectId);
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(dir, { recursive: true });
}

export async function writeProjectFile(userId, projectId, relPath, contents) {
  const root = projectDir(userId, projectId);
  await fsp.mkdir(root, { recursive: true });
  const target = safeJoin(root, relPath);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, contents, 'utf8');
  return target;
}

export async function listProjectFiles(userId, projectId) {
  const root = projectDir(userId, projectId);
  if (!fs.existsSync(root)) return [];
  const out = [];
  async function walk(dir, prefix) {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await walk(full, rel);
      } else if (e.isFile()) {
        const stat = await fsp.stat(full);
        out.push({ path: rel, size: stat.size });
      }
    }
  }
  await walk(root, '');
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

export async function readProjectFile(userId, projectId, relPath) {
  const root = projectDir(userId, projectId);
  const target = safeJoin(root, relPath);
  return fsp.readFile(target, 'utf8');
}

export function streamProjectZip(userId, projectId, projectName, res) {
  const root = projectDir(userId, projectId);
  if (!fs.existsSync(root)) {
    res.status(404).json({ error: 'No files generated yet' });
    return;
  }
  const safeName =
    (projectName || `project-${projectId}`)
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || `project-${projectId}`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${safeName}.zip"`
  );
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => {
    res.destroy(err);
  });
  archive.pipe(res);
  archive.directory(root, safeName);
  archive.finalize();
}
