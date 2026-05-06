import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { projectDir } from './packager.js';

const NODE_ENTRY_CANDIDATES = [
  'server.js',
  'index.js',
  'app.js',
  'src/server.js',
  'src/index.js',
];
const PYTHON_ENTRY_CANDIDATES = [
  'main.py',
  'app.py',
  'server.py',
  'src/main.py',
  'src/app.py',
];

function exists(root, rel) {
  try {
    return fs.statSync(path.join(root, rel)).isFile();
  } catch {
    return false;
  }
}

function detectEntry(root) {
  if (exists(root, 'package.json')) {
    for (const c of NODE_ENTRY_CANDIDATES) {
      if (exists(root, c)) {
        return {
          stack: 'node',
          run: `npm install && node ${c}`,
          entry: c,
        };
      }
    }
    return {
      stack: 'node',
      run: 'npm install && npm start',
      entry: 'package.json',
    };
  }
  if (exists(root, 'requirements.txt')) {
    for (const c of PYTHON_ENTRY_CANDIDATES) {
      if (exists(root, c)) {
        return {
          stack: 'python',
          run: `pip install -r requirements.txt && python ${c}`,
          entry: c,
        };
      }
    }
  }
  for (const c of PYTHON_ENTRY_CANDIDATES) {
    if (exists(root, c)) {
      return {
        stack: 'python',
        run: `python ${c}`,
        entry: c,
      };
    }
  }
  for (const c of NODE_ENTRY_CANDIDATES) {
    if (exists(root, c)) {
      return {
        stack: 'node',
        run: `node ${c}`,
        entry: c,
      };
    }
  }
  return null;
}

const NIX_NODE = `{ pkgs }: {
  deps = [
    pkgs.nodejs_20
    pkgs.sqlite
  ];
}
`;

const NIX_PYTHON = `{ pkgs }: {
  deps = [
    pkgs.python311
    pkgs.python311Packages.pip
    pkgs.sqlite
  ];
}
`;

function buildReplit(run) {
  return [
    `run = "${run.replace(/"/g, '\\"')}"`,
    'modules = ["nodejs-20", "python-3.11"]',
    '',
    '[nix]',
    'channel = "stable-24_05"',
    '',
    '[[ports]]',
    'localPort = 3000',
    'externalPort = 80',
    '',
  ].join('\n');
}

export async function ensureReplitFiles(userId, projectId) {
  const root = projectDir(userId, projectId);
  if (!fs.existsSync(root)) return;

  const detected = detectEntry(root);
  if (!detected) return;

  const replitPath = path.join(root, '.replit');
  if (!fs.existsSync(replitPath)) {
    await fsp.writeFile(replitPath, buildReplit(detected.run), 'utf8');
  }

  const nixPath = path.join(root, 'replit.nix');
  if (!fs.existsSync(nixPath)) {
    await fsp.writeFile(
      nixPath,
      detected.stack === 'python' ? NIX_PYTHON : NIX_NODE,
      'utf8'
    );
  }
}
