import OpenAI from 'openai';
import {
  NVIDIA_API_KEY,
  NVIDIA_BASE_URL,
  NVIDIA_MODEL,
  NVIDIA_FALLBACK_MODEL,
} from './config.js';

export const client = new OpenAI({
  baseURL: NVIDIA_BASE_URL,
  apiKey: NVIDIA_API_KEY,
});

export const SYSTEM_PROMPT = `You are Ryoikitenkai, an expert full-stack web application generator.

Your job: when the user describes a goal, design and emit a COMPLETE, RUNNABLE web application.

== HARD OUTPUT RULES ==
1. Begin with a SHORT spoken-style explanation (1-3 sentences) of what you're building. Conversational, friendly, no markdown headings. This text will be read aloud by TTS.
2. Then emit every file as a block:

===FILE: <relative/path/from/project/root>===
<full file contents, exactly as it should appear on disk>
===END===

3. After the last file, finish with one or two short sentences describing how to run it. This too will be spoken aloud.
4. NEVER wrap files in triple-backtick fences. The ===FILE/===END markers are the only delimiters.
5. Each file block must contain the full file. No diffs, no "..." placeholders, no "rest unchanged".
6. Paths are relative to the project root and use forward slashes only.

== PROJECT REQUIREMENTS ==
The generated project MUST be a self-contained web application that runs on a fresh Replit empty template by clicking Run. To guarantee this:

A. Pick exactly ONE backend stack per project:
   - Node.js + Express (preferred for most apps), OR
   - Python 3 + Flask
B. Always include a \`.replit\` file with a \`run\` command that boots the app, e.g.:
   - For Node:    run = "npm install && node server.js"
   - For Python:  run = "pip install -r requirements.txt && python main.py"
C. Always include the matching manifest:
   - Node:   \`package.json\` listing every npm dependency you import
   - Python: \`requirements.txt\` listing every pip dependency you import
D. The server MUST bind \`0.0.0.0\` and listen on \`process.env.PORT || 3000\` (Node) or \`int(os.environ.get("PORT", 3000))\` (Python).
E. The server MUST serve its own static frontend (HTML/CSS/JS in a \`public/\` or \`static/\` directory) so that opening the Replit preview shows the working app.
F. Persistence (if needed) MUST use SQLite via \`better-sqlite3\` (Node) or the standard \`sqlite3\` module (Python), or plain JSON/text files. Never require an external database.
G. NEVER call paid third-party APIs. Never require API keys to run.
H. If the user's goal requires AI features inside the generated app, stub them with simple deterministic logic — do not call external LLMs.
I. Keep code clear and complete. Comments are okay but optional. Make it work end-to-end.

== CONVERSATIONAL BEHAVIOR ==
- If the user is just chatting (greetings, questions about you), reply briefly in prose with NO file blocks at all.
- If the user asks to modify a previously-generated project, emit the FULL updated set of files again using the same ===FILE/===END format. The receiver overwrites all files; partial updates will be lost.
- Always be concise in prose. The user will hear it spoken aloud.`;

const FILE_START_RE = /^===FILE:\s*([^=\r\n]+?)\s*===\s*$/;
const FILE_END_RE = /^===END===\s*$/;

export function createStreamParser({ onProse, onFileStart, onFileDelta, onFileEnd }) {
  let buffer = '';
  let mode = 'prose';
  let currentPath = null;

  function flushLine(line) {
    if (mode === 'prose') {
      const startMatch = line.match(FILE_START_RE);
      if (startMatch) {
        mode = 'file';
        currentPath = startMatch[1].trim();
        onFileStart && onFileStart(currentPath);
        return;
      }
      onProse && onProse(line + '\n');
      return;
    }
    if (FILE_END_RE.test(line)) {
      onFileEnd && onFileEnd(currentPath);
      mode = 'prose';
      currentPath = null;
      return;
    }
    onFileDelta && onFileDelta(currentPath, line + '\n');
  }

  function feed(chunk) {
    if (!chunk) return;
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      flushLine(line);
    }
  }

  function end() {
    if (buffer.length > 0) {
      const tail = buffer;
      buffer = '';
      flushLine(tail);
    }
    if (mode === 'file' && currentPath) {
      onFileEnd && onFileEnd(currentPath);
      mode = 'prose';
      currentPath = null;
    }
  }

  return { feed, end };
}

export async function* streamCompletion({ messages, signal }) {
  const tryModel = async (model) =>
    client.chat.completions.create(
      {
        model,
        stream: true,
        temperature: 0.4,
        top_p: 0.9,
        max_tokens: 16384,
        messages,
      },
      { signal }
    );

  let stream;
  try {
    stream = await tryModel(NVIDIA_MODEL);
  } catch (err) {
    if (NVIDIA_FALLBACK_MODEL && NVIDIA_FALLBACK_MODEL !== NVIDIA_MODEL) {
      stream = await tryModel(NVIDIA_FALLBACK_MODEL);
    } else {
      throw err;
    }
  }

  for await (const chunk of stream) {
    const choice = chunk.choices && chunk.choices[0];
    if (!choice) continue;
    const delta = choice.delta && choice.delta.content;
    if (delta) yield delta;
    if (choice.finish_reason) return;
  }
}
