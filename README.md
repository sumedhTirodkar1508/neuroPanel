# Twin Mind — Next.js App + Chrome Extension (Audio Transcription)

A full-stack project that captures **tab audio in Chrome**, streams it to a **Next.js** backend, transcribes audio with **Google Gemini**, and persists incremental text chunks with **Prisma**. It includes secure auth for both the web app and the extension, plus clean health endpoints for monitoring.

---

## ✨ Features

- **Chrome Extension (side panel)**
  - Captures current tab audio via `chrome.tabCapture`.
  - Encodes with `MediaRecorder` and uploads **30-second chunks**.
  - Robust token handling (access/refresh) stored in `chrome.storage.local`.
- **Next.js App Router backend**
  - `/api/transcribe` accepts multipart audio, calls **Gemini** to transcribe.
  - Appends chunks to a `Transcript` row (`contentJson.chunks[]`) with timing.
  - Handles **inline base64** for ≤ 20 MB and **Files API** for larger blobs.
  - Smart error handling: **skip empty**, **retry 5xx**, return **429** with `retryAfterMs` when rate-limited.
- **Auth**
  - Web requests use **NextAuth** session cookies.
  - Extension requests use a **Bearer JWT** (validated with `NEXTAUTH_SECRET`).
- **Database (Supabase and Prisma)**
  - `transcript` table to store the recorded transcripts for individual users.
- **Ops / Observability**
  - Health endpoints: `/api/live`, `/api/health` (readiness).
- **UI**
  - Uses shadcn components to make it beautiful and responsive.

---

## 🧱 Tech Stack

- **Frontend (extension + app):** Vite, React 19, TypeScript, SmoothUI/shadcn
- **Backend:** Next.js (API routes), Next.js Admin Dashboard
- **Auth:** NextAuth (sessions) + JWT (Bearer for extension)
- **DB:** Prisma (PostgreSQL (Supabase))
- **AI:** Google Gemini (`@google/generative-ai`) — defaults to `gemini-2.5-flash`, Deepgram Nova.
- **Build tooling:** Vite (extension), Next.js build (app)

---

## 📦 Project Structure (key parts)

```
BACKEND NEXTJS APP
app/
  api/
    transcribe/route.ts        # main transcription endpoint
    live/route.ts              # liveness
    health/route.ts            # readiness (DB etc.)
lib/
  prisma.ts                    # Prisma client
  gemini.ts                    # Gemini client + MODEL_ID export
  deepgramHelper.ts            # Deepgram client + MODEL_ID export

EXTENSION
src/
  lib/
    api.ts                     # extension: POST /api/transcribe with token
    recorder.ts                # extension: tab audio capture + 30s chunk upload
    auth.ts
    storage.ts
    utils.ts
  sidepanel/
    sidepanel.html             # extension UI entry (built/served by Vite)
    App.tsx                    # Extension sidepanel UI render
    sidepanel.tsx
```

---

## 🚀 Getting Started (Local)

### 1) Prerequisites

- Node 18+
- PostgreSQL (or your DB of choice)
- A **Gemini API key**

### 2) Environment

Create `.env` for the **Next.js app**:

```bash
# NextAuth
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-long-random-string
ACCESS_TOKEN_TTL_MIN=15
REFRESH_TOKEN_TTL_DAYS=30

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/yourdb

# Gemini
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash

DOMAIN=http://localhost:3000
# DOMAIN=https://neuro-panel.vercel.app

DEEPGRAM_API_KEY=our_deepgram_api_key

# ---MAILTRAP SANDBOX---
MAILTRAP_USER=user_id
MAILTRAP_PASSWORD=user_password
ADMIN_EMAIL=test@gmail.com
MAILTRAP_HOST=sandbox.smtp.mailtrap.io
MAILTRAP_PORT=2525

```

Run Prisma migrations:

```bash
npx prisma migrate dev
```

### 3) App (web)

```bash
npm install
npm run dev
# open http://localhost:3000
```

### 4) Extension (Chrome)

- Ensure `API_BASE` in the extension config points to the app URL (e.g., `http://localhost:3000`).
- Build/serve the extension with Vite (see repo scripts) or load your dev build.
- Load it via **chrome://extensions → Load unpacked** and pick the extension’s `dist/`.

> **TypeScript + Vite Tip:** In `tsconfig.json` set `"noEmit": true` so the compiler doesn’t drop loose `.js` files next to sources. Let Vite handle bundling to `dist/`.

---

## 🔐 Authentication Model

- **Web app:** standard NextAuth session cookies.
- **Extension:** sends `Authorization: Bearer <accessToken>` to `/api/transcribe`.  
  On 401 with “expired”, it uses the **refresh token** to get a new access token and retries.

---

## 🧠 Transcription Flow

1. **Extension** records **30 s** of tab audio (`MediaRecorder`), creates `FormData`:
   - `audio` (Blob), `seq`, `startMs`, `endMs`
   - `sessionId` (optional — reuse to append to the same transcript)
   - Optional: `title`, `sourceUrl`, `sourceTabTitle`
2. **POST /api/transcribe** (multipart):
   - Validates bearer (extension) or session cookie (web).
   - If `size ≤ 20 MB`: encode to base64 and call Gemini with `inlineData`.
   - Else: upload via Gemini **Files API** and call `fileData`.
   - Extracts text and **skips empty** (returns `{ ok: true, skipped: true }`).
   - Appends a chunk to `Transcript.contentJson.chunks[]`.
   - Returns `{ ok, text, transcriptId, seq, tStartMs, tEndMs, model }`.

### Gemini Payload Shapes (SDK-friendly)

```ts
// Inline (≤ 20 MB)
contents: [
  {
    role: "user",
    parts: [
      {
        text: "Transcribe this audio. Return only the verbatim transcript with punctuation. No extra commentary.",
      },
      { inlineData: { mimeType, data: base64 } },
    ],
  },
];

// Files API (> 20 MB)
contents: [
  {
    role: "user",
    parts: [
      {
        text: "Transcribe this audio. Return only the verbatim transcript with punctuation. No extra commentary.",
      },
      { fileData: { mimeType: uploaded.mimeType, fileUri: uploaded.uri } },
    ],
  },
];
```

---

## 🩺 Health & Monitoring

- `GET /api/live` → 200 if the process is up.
- `GET /api/health` → 200 if DB (and other deps) are OK; otherwise **503**.
- Optional `GET /api/metrics` → simple Prometheus metrics (uptime, build info).

Use these in UptimeRobot, Datadog, Vercel Monitoring, etc.

---

## 🛡️ CORS & Security

- Set `EXT_ALLOWED_ORIGIN` to your **extension ID** in production.
- `/api/transcribe` accepts either:
  - **Bearer** token (extension), or
  - **Session** (web app).
- Prisma queries are scoped to the authenticated `userId`.

---

## 🧰 Troubleshooting

- **Stray `.js` files in `src/` after build**  
  Set `"noEmit": true` in `tsconfig.json` and let Vite write to `dist/`.

- **Gemini 400 INVALID_ARGUMENT**  
  Ensure **camelCase** payload keys: `inlineData` / `fileData`, `mimeType`, `fileUri`.

- **Gemini 500 / 429 (rate limit)**  
  Server retries **5xx**; on **429** it responds with `retryAfterMs` and `Retry-After` so the client can back off. Use **30s** chunks to reduce RPM.

- **No audio from speakers**  
  Unmute the site/tab. Optionally monitor the captured stream by assigning it to a hidden `<audio>` element in the side panel and calling `play()`.

---

## 🗺️ Roadmap Ideas

- Better timestamps
- Speaker diarization
- Streaming UI updates with SSE/WebSocket
- Admin dashboard (rate limits, errors, quotas)

---

### Credits

Built as an assessment for the **TWIN MIND** project.
