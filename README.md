# Ryoikitenkai — Voice-Driven Full-Stack Generator

A web AI that generates complete, runnable web applications from spoken or
typed goals. Powered by NVIDIA NIM, with full TTS/STT, clap-to-wake,
voice-interrupt, mute, email accounts, and one-click ZIP download of the
generated project.

## Quick start (Replit empty template)

1. Import this repo into a fresh Replit empty template (or drop the files in).
2. Click **Run**. Replit will execute `npm install && node server.js` (see
   `.replit`).
3. Open the preview, sign up with any email + password, and start generating.

That's it. The NVIDIA API key ships baked in as a fallback so the project runs
with zero configuration.

## Local quick start

```bash
npm install
node server.js
```

Then open <http://localhost:3000>.

## Voice features

- **STT / TTS** — uses the browser Web Speech API (`SpeechRecognition` and
  `speechSynthesis`). Works in Chrome and Edge. In other browsers the voice
  features fall back gracefully and the typed-text path keeps working.
- **Clap to wake** — clap twice within one second to start listening.
- **Interrupt** — while the AI is speaking, just speak; it stops mid-sentence
  and processes your new command.
- **Mute** — click the mute button to disable the microphone. The current
  generation keeps running.

## Generated app guarantees

Every generated project is a self-contained web app that:
- Includes a `.replit` config and the right manifest (`package.json` for Node
  apps, `requirements.txt` for Python).
- Binds `0.0.0.0` on `process.env.PORT` (or the Python equivalent), so it
  works in Replit's preview.
- Serves its own static frontend from its own backend, so a single Replit
  **Run** boots everything.
- Uses only SQLite or local file storage (no external paid APIs).

Click **Download** at any time to get the latest ZIP. Drop it into a fresh
Replit empty template and click **Run**.

## Configuration

| Env var                 | Default                                       | Purpose                                         |
| ----------------------- | --------------------------------------------- | ----------------------------------------------- |
| `NVIDIA_API_KEY`        | baked-in fallback                             | NVIDIA NIM API key                              |
| `NVIDIA_MODEL`          | `qwen/qwen3-coder-480b-a35b-instruct`         | Primary model                                   |
| `NVIDIA_FALLBACK_MODEL` | `meta/llama-4-maverick-17b-128e-instruct`     | Used if the primary model errors                |
| `SESSION_SECRET`        | random per-process                            | Signs session cookies                           |
| `PORT`                  | `3000`                                        | Bind port (Replit sets it for you)              |

## Security note

The user who set up this project explicitly asked for the NVIDIA API key to be
baked in so a fresh Replit import works with zero configuration. That key
travels with any push of this branch. **Rotate the key on
<https://build.nvidia.com> if you intend to publish this repo openly.**
