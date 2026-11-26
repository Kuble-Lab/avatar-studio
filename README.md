# Avatar Studio

An open-source web app for a configurable AI avatar. Give it a name, a portrait, a voice, a personality and its own knowledge. Talk in your browser or use text chat.

## Features

- Neutral, responsive interface with an animated avatar, or your own PNG/JPEG/WebP portrait.
- Realtime voice over WebRTC and text chat using OpenAI.
- Password-protected admin at `/admin`: name, description, greeting, accent colour, voice, speaking style and system prompt.
- Knowledge management: upload and edit Markdown/text files, publish a searchable index and restore previous versions.
- Two answer modes: use only your knowledge, or allow general knowledge too.
- Optional authenticated remote knowledge service for multiple web instances.
- No hardware services, kiosk setup or automatic conversation recording.

This version uses a portrait/orb with speaking and listening states. It does not generate a lip-synced video character. Configuration is for one avatar per installation; browser conversations are independent.

## Quick start

Requires Node.js 22 or newer (minimum 20.19).

```sh
git clone https://github.com/Kuble-Lab/avatar-studio.git
cd avatar-studio
npm ci
cp .env.example .env
# Edit .env: set OPENAI_API_KEY and a strong ADMIN_PASSWORD.
npm start
```

Open `http://localhost:3000`. Visit `/admin`, sign in, and save your avatar configuration. Reload an existing conversation to load new settings. A running voice session uses the configuration from its start; end and restart it after changes.

The default UI works without an API key, but chat and voice are disabled until one is configured. Choose models available to your OpenAI account through `OPENAI_TEXT_MODEL` and `OPENAI_REALTIME_MODEL`. API usage is billed by OpenAI and is not included with this app.

### Add knowledge

In `/admin`, upload `.md` or `.txt` files, then select **Änderungen veröffentlichen**. Edits remain drafts until publication. Publishing creates embeddings when an OpenAI API key is set; without a key, the index uses lexical search. The 12 latest archived versions can be restored.

Alternatively, place files in `knowledge/` and run `npm run build:index` before starting the server. An empty knowledge folder is fine for general conversation. A knowledge-only avatar explains when it lacks relevant sources.

### Voice

Click **Gespräch starten** and allow microphone access. Speak naturally; responses play through your browser's selected audio output. Click **Gespräch beenden** to release the microphone. Voice requires HTTPS, except on localhost. If a connection drops, the UI releases the microphone and lets you restart. No always-on or background voice session is created.

### Hosting and data

Run the Node process behind an HTTPS reverse proxy. `HOST` defaults to `127.0.0.1`; set `HOST=0.0.0.0` inside a container when needed. Set `ACCESS_CODE` to restrict chat and paid API usage. Without it, anyone who can reach the app can use your API quota. Add edge rate limits and spending limits for internet-facing deployments.

Persist `knowledge/` and `.cache/` across deployments. `.cache/` holds avatar/admin settings, the knowledge index and knowledge snapshots. Both directories and `.env` are excluded from Git and static file serving. Back them up separately and limit server filesystem access. Do not put secrets in prompts or knowledge intended for visitors: the avatar can disclose that content.

Chat history remains in the browser tab and is sent as conversation context. Text, voice and knowledge used for embeddings are transmitted to OpenAI for processing. This app does not save conversation transcripts. The backend keeps API keys server-side. Avatar portraits are embedded locally in the configuration; external image URLs are not accepted.

### Optional shared knowledge

On the knowledge server, set `AVATAR_RAG_SERVICE_TOKENS` to one or more comma-separated tokens. On a web client instance, set `AVATAR_RAG_URL` and `AVATAR_RAG_TOKEN`. Use HTTPS. Knowledge and the effective system prompt come from the central instance; appearance and voice are configured per instance. A remote outage returns an error without silently using a stale local index.

## Interactive demo

The `demo/` directory is a buildless, browser-only demo. It includes three avatar presets, custom portraits, colours, sample knowledge and browser text-to-speech. Responses are clearly marked as simulated; it does not connect to OpenAI or request microphone access. Serve the directory with any static web server. Avatar settings are saved only in browser local storage.

### ChatGPT Sites edition

The `sites/` directory contains the hosted edition. Its `/admin` page accepts a per-user OpenRouter key for text chat and an OpenAI API key for microphone conversations. Voice uses WebRTC, server-side turn detection and interruption with `gpt-realtime-2`. The avatar profile and knowledge are included in each voice session. Microphone audio goes directly to OpenAI. The browser voice sample is also available without a provider key.

To deploy your own copy, register a private ChatGPT Site, set its project ID in `sites/.openai/hosting.json`, and configure the R2 binding `BUCKET`. Set `AVATAR_KEY_ENCRYPTION` as a runtime secret containing a base64-encoded, randomly generated 32-byte AES key. Keep that value stable across deployments to retain access to saved credentials. Run `node build.mjs` from `sites/` and publish the Worker output through Sites. The Worker trusts the identity header supplied by the Sites gateway. Deployments outside Sites must authenticate users and supply a trusted identity server-side.

## Development

```sh
npm run check
npm test
```

The integration suite starts temporary local servers and needs permission to bind loopback ports. Tests use isolated temporary storage and no paid OpenAI calls. CI runs checks and tests on pushes and pull requests.

- `server.js`: Express API, authentication, text/realtime sessions and retrieval.
- `app.js`, `index.html`, `styles.css`: browser conversation UI.
- `admin.*`: avatar configuration and knowledge editor.
- `lib/avatar-config.js`: validated avatar settings.
- `lib/rag-store.js`: knowledge files, archives and restore.
- `scripts/build-index.js`: chunking and optional embeddings.

## Contributing

Open an issue or pull request. Include checks for changed behaviour. Never include real API keys, user conversations, portraits or private knowledge in a contribution.

## Licence

MIT. This standalone web application reuses the original project's voice, retrieval and knowledge-management code. No original private knowledge, artwork, credentials or repository history is included.
