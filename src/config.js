import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const PROJECTS_DIR = path.join(DATA_DIR, 'projects');
export const DB_PATH = path.join(DATA_DIR, 'app.db');

const FALLBACK_NVIDIA_KEY =
  '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';

export const NVIDIA_API_KEY =
  (process.env.NVIDIA_API_KEY && process.env.NVIDIA_API_KEY.trim()) ||
  FALLBACK_NVIDIA_KEY;

export const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';

export const NVIDIA_MODEL =
  process.env.NVIDIA_MODEL || 'qwen/qwen3-coder-480b-a35b-instruct';

export const NVIDIA_FALLBACK_MODEL =
  process.env.NVIDIA_FALLBACK_MODEL ||
  'meta/llama-4-maverick-17b-128e-instruct';

export const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

export const PORT = Number(process.env.PORT || 3000);
export const HOST = '0.0.0.0';
