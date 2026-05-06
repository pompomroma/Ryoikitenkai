import express from 'express';
import { stmts } from './db.js';
import { requireAuth } from './auth.js';
import {
  createStreamParser,
  streamCompletion,
  SYSTEM_PROMPT,
} from './generator.js';
import {
  clearProjectDir,
  listProjectFiles,
  projectDir,
  readProjectFile,
  streamProjectZip,
  writeProjectFile,
} from './packager.js';
import { ensureReplitFiles } from './replitTemplate.js';
import fs from 'node:fs';
import fsp from 'node:fs/promises';

export const apiRouter = express.Router();

function defaultProjectName(text) {
  const t = String(text || '').trim().replace(/\s+/g, ' ');
  if (!t) return 'New project';
  return t.length > 60 ? t.slice(0, 57) + '...' : t;
}

function buildMessageHistory(projectId, newUserMessage) {
  const history = stmts.listMessagesForProject.all(projectId);
  const msgs = [{ role: 'system', content: SYSTEM_PROMPT }];
  for (const m of history) {
    msgs.push({ role: m.role, content: m.content });
  }
  msgs.push({ role: 'user', content: newUserMessage });
  return msgs;
}

apiRouter.get('/projects', requireAuth, (req, res) => {
  const rows = stmts.listProjectsForUser.all(req.user.id);
  res.json({ projects: rows });
});

apiRouter.post('/projects', requireAuth, (req, res) => {
  const name = defaultProjectName((req.body && req.body.name) || 'New project');
  const project = stmts.insertProject.get(req.user.id, name);
  res.json({ project });
});

apiRouter.get('/projects/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const project = stmts.getProject.get(id, req.user.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const messages = stmts.listMessagesForProject.all(id);
  const files = await listProjectFiles(req.user.id, id);
  res.json({ project, messages, files });
});

apiRouter.patch('/projects/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const project = stmts.getProject.get(id, req.user.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const name = defaultProjectName((req.body && req.body.name) || project.name);
  stmts.renameProject.run(name, id, req.user.id);
  res.json({ project: stmts.getProject.get(id, req.user.id) });
});

apiRouter.delete('/projects/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const project = stmts.getProject.get(id, req.user.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  stmts.deleteProject.run(id, req.user.id);
  await fsp
    .rm(projectDir(req.user.id, id), { recursive: true, force: true })
    .catch(() => {});
  res.json({ ok: true });
});

apiRouter.get('/projects/:id/files/*', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const project = stmts.getProject.get(id, req.user.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const rel = req.params[0];
  try {
    const content = await readProjectFile(req.user.id, id, rel);
    res.type('text/plain').send(content);
  } catch (e) {
    res.status(404).json({ error: 'File not found' });
  }
});

apiRouter.get('/projects/:id/download', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const project = stmts.getProject.get(id, req.user.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  streamProjectZip(req.user.id, id, project.name, res);
});

apiRouter.post('/generate', requireAuth, async (req, res) => {
  const userMessage = String((req.body && req.body.message) || '').trim();
  if (!userMessage) {
    return res.status(400).json({ error: 'message is required' });
  }

  let projectId = Number(req.body && req.body.projectId);
  let project = projectId
    ? stmts.getProject.get(projectId, req.user.id)
    : null;
  if (!project) {
    project = stmts.insertProject.get(
      req.user.id,
      defaultProjectName(userMessage)
    );
    projectId = project.id;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders && res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  send('project', { project });

  stmts.insertMessage.run(projectId, 'user', userMessage);
  const messages = buildMessageHistory(projectId, userMessage);

  const ac = new AbortController();
  let clientClosed = false;
  const onClose = () => {
    if (res.writableEnded) return;
    clientClosed = true;
    ac.abort();
    console.log('[generate] client closed connection — aborting');
  };
  res.on('close', onClose);

  let assistantBuffer = '';
  let proseBuffer = '';
  let sawAnyFile = false;
  const fileBuffers = new Map();

  const parser = createStreamParser({
    onProse(text) {
      proseBuffer += text;
      assistantBuffer += text;
      send('prose', { delta: text });
    },
    async onFileStart(filePath) {
      if (!sawAnyFile) {
        sawAnyFile = true;
        await clearProjectDir(req.user.id, projectId);
      }
      assistantBuffer += `\n===FILE: ${filePath}===\n`;
      fileBuffers.set(filePath, '');
      send('file_start', { path: filePath });
    },
    onFileDelta(filePath, delta) {
      const cur = fileBuffers.get(filePath) || '';
      fileBuffers.set(filePath, cur + delta);
      assistantBuffer += delta;
      send('file_delta', { path: filePath, delta });
    },
    async onFileEnd(filePath) {
      assistantBuffer += '===END===\n';
      const contents = fileBuffers.get(filePath) || '';
      fileBuffers.delete(filePath);
      try {
        await writeProjectFile(req.user.id, projectId, filePath, contents);
        send('file_end', { path: filePath, bytes: contents.length });
      } catch (e) {
        send('error', {
          where: 'write',
          path: filePath,
          message: String(e && e.message ? e.message : e),
        });
      }
    },
  });

  try {
    for await (const delta of streamCompletion({ messages, signal: ac.signal })) {
      parser.feed(delta);
    }
    parser.end();

    if (sawAnyFile) {
      await ensureReplitFiles(req.user.id, projectId);
      stmts.markProjectComplete.run(1, projectId);
    } else {
      stmts.touchProject.run(projectId);
    }

    stmts.insertMessage.run(projectId, 'assistant', assistantBuffer);

    const files = await listProjectFiles(req.user.id, projectId);
    send('done', {
      projectId,
      hasFiles: sawAnyFile,
      files,
      generationComplete: sawAnyFile,
    });
  } catch (err) {
    if (assistantBuffer.length > 0) {
      stmts.insertMessage.run(projectId, 'assistant', assistantBuffer);
    }
    console.error('[generate] upstream error:', err);
    const causeMsg =
      err && err.cause && err.cause.message ? ` (${err.cause.message})` : '';
    const aborted =
      err && (err.name === 'AbortError' || /aborted/i.test(err.message || ''));
    let message;
    if (clientClosed) {
      message = 'Generation cancelled.';
    } else if (aborted) {
      message =
        'Could not reach NVIDIA NIM. Check that the host has internet access and the API key is valid.' +
        causeMsg;
    } else {
      message = String(err && err.message ? err.message : err) + causeMsg;
    }
    send('error', { where: 'stream', message });
  } finally {
    res.off('close', onClose);
    res.end();
  }
});
