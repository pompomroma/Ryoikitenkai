import {
  bus,
  startSTT,
  stopSTT,
  setMuted,
  getMuted,
  cancelTTS,
  feedTTSDelta,
  flushTTS,
  resetTTSBuffer,
  setTTSEnabled,
  getTTSEnabled,
  sttSupported,
  ttsSupported,
  isListening,
} from './voice.js';
import { enableClap, disableClap, isClapEnabled } from './clap.js';

const $ = (sel) => document.querySelector(sel);

const ui = {
  authScreen: $('#auth'),
  authForm: $('#auth-form'),
  authSubmit: $('#auth-submit'),
  authError: $('#auth-error'),
  authTabs: document.querySelectorAll('.tab'),

  app: $('#app'),
  projectList: $('#project-list'),
  newProjectBtn: $('#new-project'),
  userEmail: $('#user-email'),
  logoutBtn: $('#logout'),

  projectName: $('#project-name'),
  statusBadge: $('#status-badge'),
  downloadBtn: $('#download-btn'),

  messages: $('#messages'),
  chatForm: $('#chat-form'),
  chatInput: $('#chat-input'),
  sendBtn: $('#send-btn'),
  voiceHint: $('#voice-hint'),

  micBtn: $('#mic-btn'),
  muteBtn: $('#mute-btn'),
  clapBtn: $('#clap-btn'),
  ttsBtn: $('#tts-btn'),

  fileList: $('#file-list'),
  filePreview: $('#file-preview'),
};

const state = {
  user: null,
  authMode: 'login',
  projects: [],
  currentProjectId: null,
  currentProject: null,
  files: [],
  fileContents: new Map(), // path -> content (live)
  selectedFile: null,
  generating: false,
  pendingAssistantBubble: null,
  generationComplete: false,
};

function setStatus(label, kind) {
  ui.statusBadge.textContent = label;
  ui.statusBadge.className = `badge ${kind || 'idle'}`;
}

function setVoiceHint(text) {
  ui.voiceHint.textContent = text || '';
}

async function api(path, options) {
  const opts = Object.assign(
    { credentials: 'same-origin', headers: {} },
    options || {}
  );
  if (opts.body && typeof opts.body !== 'string') {
    opts.body = JSON.stringify(opts.body);
    opts.headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, opts);
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : null;
  if (!res.ok) {
    const msg = (data && data.error) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

// ===== Auth =====

ui.authTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    ui.authTabs.forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    state.authMode = tab.dataset.tab;
    ui.authSubmit.textContent =
      state.authMode === 'signup' ? 'Create account' : 'Log in';
    ui.authError.hidden = true;
  });
});

ui.authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  ui.authError.hidden = true;
  const fd = new FormData(ui.authForm);
  const email = fd.get('email');
  const password = fd.get('password');
  ui.authSubmit.disabled = true;
  try {
    const path = state.authMode === 'signup' ? '/api/signup' : '/api/login';
    const data = await api(path, { method: 'POST', body: { email, password } });
    state.user = data.user;
    await enterApp();
  } catch (err) {
    ui.authError.textContent = err.message;
    ui.authError.hidden = false;
  } finally {
    ui.authSubmit.disabled = false;
  }
});

ui.logoutBtn.addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  state.user = null;
  state.projects = [];
  state.currentProjectId = null;
  ui.app.hidden = true;
  ui.authScreen.hidden = false;
  cancelTTS();
  stopSTT();
});

// ===== Project list =====

async function loadProjects() {
  const data = await api('/api/projects');
  state.projects = data.projects || [];
  renderProjectList();
}

function renderProjectList() {
  ui.projectList.innerHTML = '';
  for (const p of state.projects) {
    const li = document.createElement('li');
    if (p.id === state.currentProjectId) li.classList.add('active');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = p.name || `Project ${p.id}`;
    name.addEventListener('click', () => selectProject(p.id));
    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '×';
    del.title = 'Delete project';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete "${p.name}"?`)) return;
      await api(`/api/projects/${p.id}`, { method: 'DELETE' });
      if (state.currentProjectId === p.id) {
        state.currentProjectId = null;
        state.currentProject = null;
        clearWorkspace();
      }
      await loadProjects();
    });
    li.appendChild(name);
    li.appendChild(del);
    ui.projectList.appendChild(li);
  }
}

ui.newProjectBtn.addEventListener('click', async () => {
  const data = await api('/api/projects', {
    method: 'POST',
    body: { name: 'New project' },
  });
  await loadProjects();
  selectProject(data.project.id);
});

async function selectProject(id) {
  state.currentProjectId = id;
  const data = await api(`/api/projects/${id}`);
  state.currentProject = data.project;
  state.files = data.files || [];
  state.fileContents = new Map();
  state.selectedFile = null;
  state.generationComplete = !!data.project.generation_complete;
  renderProjectList();
  renderProjectHeader();
  renderMessages(data.messages || []);
  renderFileList();
  ui.filePreview.textContent = '';
  updateDownloadButton();
}

function clearWorkspace() {
  ui.messages.innerHTML = '';
  ui.fileList.innerHTML = '';
  ui.filePreview.textContent = '';
  ui.projectName.value = '';
  setStatus('Idle', 'idle');
  updateDownloadButton();
}

function renderProjectHeader() {
  ui.projectName.value = state.currentProject
    ? state.currentProject.name
    : '';
}

ui.projectName.addEventListener('change', async () => {
  if (!state.currentProjectId) return;
  const newName = ui.projectName.value.trim() || 'Untitled project';
  try {
    const data = await api(`/api/projects/${state.currentProjectId}`, {
      method: 'PATCH',
      body: { name: newName },
    });
    state.currentProject = data.project;
    await loadProjects();
  } catch (err) {
    setStatus('Rename failed', 'error');
  }
});

// ===== Messages =====

function renderMessages(messages) {
  ui.messages.innerHTML = '';
  for (const m of messages) {
    appendMessage(m.role, m.content, { historic: true });
  }
  scrollToBottom();
}

function appendMessage(role, content, opts) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = role === 'user' ? 'You' : 'AI';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = role === 'assistant' && opts && opts.historic
    ? extractProseFromAssistant(content)
    : content;
  div.appendChild(avatar);
  div.appendChild(bubble);
  ui.messages.appendChild(div);
  scrollToBottom();
  return bubble;
}

function extractProseFromAssistant(content) {
  // Strip ===FILE:...===END=== blocks for display, keeping the prose.
  let out = '';
  const lines = String(content || '').split('\n');
  let inFile = false;
  for (const line of lines) {
    if (/^===FILE:\s*[^=]+===\s*$/.test(line)) {
      inFile = true;
      const m = line.match(/^===FILE:\s*([^=]+?)\s*===\s*$/);
      out += `[file: ${m ? m[1] : ''}]\n`;
      continue;
    }
    if (/^===END===\s*$/.test(line)) {
      inFile = false;
      continue;
    }
    if (!inFile) out += line + '\n';
  }
  return out.trim();
}

function scrollToBottom() {
  ui.messages.scrollTop = ui.messages.scrollHeight;
}

// ===== File pane =====

function renderFileList() {
  ui.fileList.innerHTML = '';
  const merged = new Map();
  for (const f of state.files) merged.set(f.path, { ...f, streaming: false });
  for (const [p] of state.fileContents) {
    if (!merged.has(p))
      merged.set(p, {
        path: p,
        size: state.fileContents.get(p).length,
        streaming: true,
      });
  }
  const ordered = Array.from(merged.values()).sort((a, b) =>
    a.path.localeCompare(b.path)
  );
  for (const f of ordered) {
    const li = document.createElement('li');
    if (f.streaming) li.classList.add('streaming');
    if (state.selectedFile === f.path) li.classList.add('active');
    const name = document.createElement('span');
    name.textContent = f.path;
    const size = document.createElement('span');
    size.className = 'size';
    size.textContent = f.streaming ? '…' : `${f.size}b`;
    li.appendChild(name);
    li.appendChild(size);
    li.addEventListener('click', () => previewFile(f.path));
    ui.fileList.appendChild(li);
  }
}

async function previewFile(p) {
  state.selectedFile = p;
  renderFileList();
  if (state.fileContents.has(p)) {
    ui.filePreview.textContent = state.fileContents.get(p);
    return;
  }
  try {
    const res = await fetch(
      `/api/projects/${state.currentProjectId}/files/${encodeURI(p)}`,
      { credentials: 'same-origin' }
    );
    if (res.ok) {
      ui.filePreview.textContent = await res.text();
    } else {
      ui.filePreview.textContent = '(unable to load file)';
    }
  } catch {
    ui.filePreview.textContent = '(unable to load file)';
  }
}

function updateDownloadButton() {
  ui.downloadBtn.disabled =
    !state.currentProjectId || !state.generationComplete;
}

ui.downloadBtn.addEventListener('click', () => {
  if (!state.currentProjectId || !state.generationComplete) return;
  const url = `/api/projects/${state.currentProjectId}/download`;
  window.location.href = url;
});

// ===== Generation (SSE consumer) =====

async function sendMessage(text) {
  const trimmed = (text || '').trim();
  if (!trimmed || state.generating) return;
  state.generating = true;
  setStatus('Thinking…', 'thinking');
  ui.sendBtn.disabled = true;
  ui.chatInput.value = '';
  cancelTTS();
  resetTTSBuffer();

  appendMessage('user', trimmed);
  state.pendingAssistantBubble = appendMessage('assistant', '', {});

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({
        message: trimmed,
        projectId: state.currentProjectId,
      }),
    });
    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    await consumeSSE(res.body);
    flushTTS();
    setStatus('Idle', 'idle');
  } catch (err) {
    setStatus('Error', 'error');
    if (state.pendingAssistantBubble) {
      state.pendingAssistantBubble.textContent +=
        (state.pendingAssistantBubble.textContent ? '\n\n' : '') +
        `[error: ${err.message}]`;
    }
  } finally {
    state.generating = false;
    state.pendingAssistantBubble = null;
    ui.sendBtn.disabled = false;
    await loadProjects();
  }
}

async function consumeSSE(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      handleSSEEvent(raw);
    }
  }
  if (buffer.trim()) handleSSEEvent(buffer);
}

function handleSSEEvent(raw) {
  let event = 'message';
  let data = '';
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (!data) return;
  let payload;
  try {
    payload = JSON.parse(data);
  } catch {
    return;
  }
  switch (event) {
    case 'project':
      if (payload.project) {
        state.currentProjectId = payload.project.id;
        state.currentProject = payload.project;
        renderProjectHeader();
      }
      break;
    case 'prose':
      if (state.pendingAssistantBubble) {
        state.pendingAssistantBubble.textContent += payload.delta;
        scrollToBottom();
      }
      feedTTSDelta(payload.delta);
      break;
    case 'file_start':
      if (state.pendingAssistantBubble) {
        const span = document.createElement('div');
        span.className = 'file-mark';
        span.textContent = `→ ${payload.path}`;
        state.pendingAssistantBubble.appendChild(span);
      }
      state.fileContents.set(payload.path, '');
      state.selectedFile = payload.path;
      renderFileList();
      previewFile(payload.path);
      break;
    case 'file_delta': {
      const cur = state.fileContents.get(payload.path) || '';
      state.fileContents.set(payload.path, cur + payload.delta);
      if (state.selectedFile === payload.path) {
        ui.filePreview.textContent = state.fileContents.get(payload.path);
      }
      break;
    }
    case 'file_end':
      // Persisted on server. Keep local copy.
      break;
    case 'done':
      state.files = payload.files || [];
      state.generationComplete = !!payload.generationComplete;
      updateDownloadButton();
      renderFileList();
      break;
    case 'error':
      setStatus('Error', 'error');
      if (state.pendingAssistantBubble) {
        const e = document.createElement('div');
        e.className = 'file-mark';
        e.textContent = `[error: ${payload.message || ''}]`;
        state.pendingAssistantBubble.appendChild(e);
      }
      break;
  }
}

// ===== Chat form =====

ui.chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  sendMessage(ui.chatInput.value);
});

ui.chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage(ui.chatInput.value);
  }
});

// ===== Voice wiring =====

ui.micBtn.addEventListener('click', () => {
  if (!sttSupported) {
    setVoiceHint('Speech recognition is not supported in this browser.');
    return;
  }
  if (isListening()) {
    stopSTT();
  } else {
    if (getMuted()) setMuted(false);
    startSTT();
  }
});

ui.muteBtn.addEventListener('click', () => {
  setMuted(!getMuted());
});

ui.clapBtn.addEventListener('click', async () => {
  if (isClapEnabled()) {
    disableClap();
  } else {
    await enableClap();
  }
});

ui.ttsBtn.addEventListener('click', () => {
  setTTSEnabled(!getTTSEnabled());
  ui.ttsBtn.textContent = getTTSEnabled() ? 'TTS: on' : 'TTS: off';
  ui.ttsBtn.classList.toggle('active', getTTSEnabled());
});

bus.addEventListener('voice:listening', (e) => {
  const on = e.detail && e.detail.listening;
  ui.micBtn.classList.toggle('listening', on);
  if (state.generating) return;
  setStatus(on ? 'Listening…' : 'Idle', on ? 'listening' : 'idle');
});

bus.addEventListener('voice:speaking', (e) => {
  const on = e.detail && e.detail.speaking;
  if (state.generating) return;
  setStatus(on ? 'Speaking…' : 'Idle', on ? 'speaking' : 'idle');
});

bus.addEventListener('voice:muted', (e) => {
  const m = e.detail && e.detail.muted;
  ui.muteBtn.classList.toggle('muted', m);
  ui.muteBtn.textContent = m ? 'Muted' : 'Mute';
  setVoiceHint(
    m ? 'Mic muted. Generation continues. Click Mute to unmute.' : ''
  );
});

bus.addEventListener('voice:transcript', (e) => {
  const detail = e.detail || {};
  if (!detail.final) {
    setVoiceHint(`Hearing: ${detail.text}`);
    return;
  }
  setVoiceHint('');
  // If interrupt fired, that handler already cancelled TTS; we still send.
  sendMessage(detail.text);
});

bus.addEventListener('voice:interrupt', () => {
  setStatus('Interrupted', 'thinking');
});

bus.addEventListener('voice:error', (e) => {
  setVoiceHint(e.detail && e.detail.message ? e.detail.message : 'Voice error');
});

bus.addEventListener('clap:state', (e) => {
  const on = e.detail && e.detail.enabled;
  ui.clapBtn.classList.toggle('active', on);
  ui.clapBtn.textContent = on ? 'Clap-wake: on' : 'Clap-wake: off';
});

bus.addEventListener('clap:wake', () => {
  if (getMuted()) setMuted(false);
  startSTT();
  setVoiceHint('Clap detected — listening.');
});

// ===== Boot =====

async function enterApp() {
  ui.authScreen.hidden = true;
  ui.app.hidden = false;
  ui.userEmail.textContent = state.user.email;

  if (!sttSupported) {
    ui.micBtn.disabled = true;
    ui.clapBtn.disabled = false; // clap can still work via Web Audio
    setVoiceHint(
      'Speech-to-text not available in this browser. Use Chrome/Edge for voice input. Typing still works.'
    );
  }
  if (!ttsSupported) {
    ui.ttsBtn.disabled = true;
    ui.ttsBtn.textContent = 'TTS: n/a';
  }

  await loadProjects();
  if (state.projects.length > 0) {
    await selectProject(state.projects[0].id);
  } else {
    clearWorkspace();
  }
  setStatus('Idle', 'idle');
}

async function boot() {
  try {
    const data = await api('/api/me');
    if (data.user) {
      state.user = data.user;
      await enterApp();
      return;
    }
  } catch {}
  ui.authScreen.hidden = false;
  ui.app.hidden = true;
}

boot();
