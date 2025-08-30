import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/options";
import { ai, MODEL_ID as MODEL_ID_RAW } from "@/lib/gemini";
import { transcribeWithDeepgramBytes } from "@/lib/deepgramHelper";
import prisma from "@/lib/prisma";
import jwt from "jsonwebtoken";

const NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET!;
const EXT_ALLOWED_ORIGIN = process.env.EXT_ALLOWED_ORIGIN || "*";

// ~20MB inline threshold for audio data
const INLINE_MAX_BYTES = 20 * 1024 * 1024;
const MODEL_ID = MODEL_ID_RAW || "gemini-2.5-flash";

// Request counter (helps correlate server logs with client requests)
let requestCounter = 0;

// ---- helpers ---------------------------------------------------------------

const MAX_PREV_TAIL_CHARS = 300;
function normalizePrevTail(s?: string | null) {
  if (!s) return null;
  const trimmed = s.replace(/\s+/g, " ").trim();
  return trimmed.slice(-MAX_PREV_TAIL_CHARS);
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": EXT_ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function bearerFrom(req: Request) {
  const h =
    req.headers.get("authorization") || req.headers.get("Authorization");
  if (!h) return null;
  const [scheme, token] = h.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

/** Retry helper with minimal logging */
async function withRetry<T>(
  fn: () => Promise<T>,
  isRetryable: (e: any) => boolean,
  attempts = 2,
  baseDelayMs = 2000
): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const retryable =
        isRetryable(e) ||
        e?.error?.status === "RESOURCE_EXHAUSTED" ||
        e?.status === 429;
      if (!retryable || i === attempts - 1) break;

      // Exponential backoff; respect RetryInfo if present
      let delay = baseDelayMs * Math.pow(2, i);
      const retryAfter = e?.error?.details?.find(
        (d: any) => d["@type"] === "type.googleapis.com/google.rpc.RetryInfo"
      )?.retryDelay;
      const secs = retryAfter
        ? parseInt(String(retryAfter).replace("s", ""))
        : NaN;
      if (!Number.isNaN(secs)) delay = secs * 1000;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/** Normalize Gemini response to plain text */
function extractText(resp: any): string {
  const direct = resp?.text ?? resp?.output_text ?? resp?.response?.text?.();
  if (typeof direct === "string") return direct;

  const parts =
    resp?.candidates?.[0]?.content?.parts ??
    resp?.response?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    const t = parts
      .map((p: any) => p?.text)
      .filter(Boolean)
      .join("\n");
    if (t) return t;
  }
  return "";
}

/** Remove textual overlap between previous and next chunk */
function stripTextOverlap(
  prev: string | undefined,
  next: string,
  { minMatch = 20, window = 300 } = {}
): string {
  if (!prev || !next) return next;
  const a = prev.slice(-window);
  const b = next;
  const max = Math.min(a.length, b.length);
  let best = 0;
  for (let k = minMatch; k <= max; k++) {
    if (a.slice(a.length - k) === b.slice(0, k)) best = k;
  }
  return best > 0 ? b.slice(best) : b;
}

/** Gemini (inline) */
async function transcribeInline(
  base64: string,
  mimeType: string,
  prevTail: string | null
): Promise<string> {
  const stitchPrompt = prevTail
    ? `You will receive the last part of the previous transcript in "prev_tail" and a new audio chunk with ~3s overlap.
Task:
- Transcribe the new audio.
- Use prev_tail only as context.
- Return ONLY the new words after prev_tail (no repetition).
- Keep punctuation/casing.
- If fully overlapping/silent, return empty.`
    : `Transcribe this audio. Return only the verbatim transcript with punctuation.`;

  const contents = [
    {
      role: "user",
      parts: [
        { text: stitchPrompt },
        ...(prevTail ? [{ text: `prev_tail:\n${prevTail}` }] : []),
        { inlineData: { mimeType, data: base64 } },
      ],
    },
  ];

  const resp = await withRetry(
    () =>
      ai.models.generateContent({
        model: MODEL_ID,
        contents: contents as any,
      }),
    (e) => e?.status >= 500 || e?.code === "ECONNRESET"
  );
  return extractText(resp);
}

/** Gemini (Files API) */
async function transcribeViaFile(
  file: File,
  mimeType: string,
  prevTail: string | null
) {
  const uploaded = await ai.files.upload({ file, config: { mimeType } });

  const stitchPrompt = prevTail
    ? `You will receive the last part of the previous transcript in "prev_tail" and a new audio chunk with ~3s overlap.
Task:
- Transcribe the new audio.
- Use prev_tail only as context.
- Return ONLY the new words after prev_tail (no repetition).
- Keep punctuation/casing.
- If fully overlapping/silent, return empty.`
    : `Transcribe this audio. Return only the verbatim transcript with punctuation.`;

  const contents = [
    {
      role: "user",
      parts: [
        { text: stitchPrompt },
        ...(prevTail ? [{ text: `prev_tail:\n${prevTail}` }] : []),
        { fileData: { mimeType: uploaded.mimeType, fileUri: uploaded.uri } },
      ],
    },
  ];

  const resp = await withRetry(
    () =>
      ai.models.generateContent({
        model: MODEL_ID,
        contents: contents as any,
      }),
    (e) => e?.status >= 500 || e?.code === "ECONNRESET"
  );
  return extractText(resp);
}

// ---- route ---------------------------------------------------------------

export async function POST(req: Request) {
  const reqId = ++requestCounter;
  console.info(`🟣 [transcribe:${reqId}] start`);

  try {
    // --- auth (bearer first, then cookie) ---
    let userId: string | null = null;
    const bearer = bearerFrom(req);
    if (bearer) {
      try {
        const decoded = jwt.verify(bearer, NEXTAUTH_SECRET) as { sub: string };
        userId = decoded.sub;
      } catch {
        return NextResponse.json(
          { error: "Invalid or expired access token" },
          { status: 401, headers: corsHeaders() }
        );
      }
    }
    if (!userId) {
      const session = await getServerSession(authOptions);
      if (!session?.user?.id) {
        return NextResponse.json(
          { error: "Unauthorized" },
          { status: 401, headers: corsHeaders() }
        );
      }
      userId = session.user.id;
    }

    // --- parse form ---
    const form = await req.formData();
    const file = form.get("audio") as File | null;
    const prevTail = normalizePrevTail(form.get("prevTail") as string | null);
    if (!file) {
      return NextResponse.json(
        { error: "Missing 'audio' file" },
        { status: 400, headers: corsHeaders() }
      );
    }

    const seq = Number(form.get("seq") ?? NaN);
    const tStartMs = Number(form.get("startMs") ?? NaN);
    const tEndMs = Number(form.get("endMs") ?? NaN);
    const sessionId = (form.get("sessionId") as string) || null;

    // Optional metadata
    const title = (form.get("title") as string) || null;
    const sourceUrl = (form.get("sourceUrl") as string) || null;
    const sourceTabTitle = (form.get("sourceTabTitle") as string) || null;

    // --- read audio once ---
    const arrayBuffer = await file.arrayBuffer();
    const rawBytes: Buffer = Buffer.from(arrayBuffer);
    let mimeType = file.type || "audio/webm";
    if (mimeType.includes("webm")) mimeType = "audio/webm";
    else if (mimeType.includes("ogg")) mimeType = "audio/ogg";
    const size = (file as any).size ?? 0;

    console.info(
      `🟣 [transcribe:${reqId}] audio size=${size}B mime=${mimeType} seq=${
        isFinite(seq) ? seq : "-"
      }`
    );

    // --- transcribe (Gemini → fallback Deepgram) ---
    let text = "";
    try {
      if (size <= INLINE_MAX_BYTES) {
        const base64 = rawBytes.toString("base64");
        text = await transcribeInline(base64, mimeType, prevTail);
        console.info(`🟣 [transcribe:${reqId}] Gemini text: ${text}`);
      } else {
        text = await transcribeViaFile(file, mimeType, prevTail);
        console.info(`🟣 [transcribe:${reqId}] Gemini(text via file): ${text}`);
      }
    } catch (modelErr: any) {
      // Bubble up 429 so the client can backoff
      if (
        modelErr?.error?.status === "RESOURCE_EXHAUSTED" ||
        modelErr?.status === 429
      ) {
        const retryAfter =
          modelErr?.error?.details?.find(
            (d: any) =>
              d["@type"] === "type.googleapis.com/google.rpc.RetryInfo"
          )?.retryDelay || "60s";
        return NextResponse.json(
          {
            error: "Gemini rate limit exceeded",
            retryAfter,
            rateLimited: true,
            provider: "gemini",
          },
          { status: 429, headers: corsHeaders() }
        );
      }

      // Fallback once to Deepgram
      try {
        text = await transcribeWithDeepgramBytes(rawBytes, mimeType);
        console.info(`🟣 [transcribe:${reqId}] Deepgram text: ${text}`);
      } catch (dgErr: any) {
        console.error(`🔴 [transcribe:${reqId}] both providers failed`, {
          gemini: { status: modelErr?.status, message: modelErr?.message },
          deepgram: { status: dgErr?.status, message: dgErr?.message },
        });
        return NextResponse.json(
          { error: "Transcription failed" },
          { status: 500, headers: corsHeaders() }
        );
      }
    }

    // --- if model returned nothing (silence/overlap) ---
    if (!text || !text.trim()) {
      console.info(`🟣 [transcribe:${reqId}] empty/overlap skipped`);
      return NextResponse.json(
        {
          ok: true,
          skipped: true,
          seq: isFinite(seq) ? seq : undefined,
          tStartMs: isFinite(tStartMs) ? tStartMs : undefined,
          tEndMs: isFinite(tEndMs) ? tEndMs : undefined,
          model: MODEL_ID,
        },
        { headers: corsHeaders() }
      );
    }

    // --- persist (strip overlap defensively) ---
    let transcriptId = sessionId ?? null;
    let adjustedText = text;

    if (transcriptId) {
      const transcript = await prisma.transcript.findFirst({
        where: { id: transcriptId, userId: userId! },
        select: {
          id: true,
          contentJson: true,
          chunkCount: true,
          durationMs: true,
        },
      });

      if (!transcript) {
        await prisma.transcript.create({
          data: {
            id: transcriptId,
            userId: userId!,
            title,
            sourceUrl,
            sourceTabTitle,
            contentJson: {
              version: 1,
              chunks: [
                {
                  startMs: isFinite(tStartMs) ? tStartMs : undefined,
                  endMs: isFinite(tEndMs) ? tEndMs : undefined,
                  seq: isFinite(seq) ? seq : undefined,
                  text: adjustedText,
                },
              ],
            },
            chunkCount: 1,
            durationMs: isFinite(tEndMs) ? tEndMs : null,
          },
        });
      } else {
        const cj =
          typeof transcript.contentJson === "string"
            ? JSON.parse(transcript.contentJson)
            : transcript.contentJson || { version: 1, chunks: [] };
        cj.chunks = Array.isArray(cj.chunks) ? cj.chunks : [];

        let prevChunk: any = cj.chunks.find(
          (c: any) =>
            typeof c?.seq === "number" &&
            c.seq === (isFinite(seq) ? seq - 1 : -1)
        );
        if (!prevChunk && cj.chunks.length > 0)
          prevChunk = cj.chunks[cj.chunks.length - 1];

        // De-dup against prevTail plus time-overlap heuristic
        if (prevTail) {
          text = stripTextOverlap(prevTail, text, {
            minMatch: 10,
            window: 400,
          });
        }
        const prevEnd =
          typeof prevChunk?.endMs === "number" ? prevChunk.endMs : undefined;
        const overlapMs =
          isFinite(tStartMs) && typeof prevEnd === "number"
            ? Math.max(0, prevEnd - tStartMs)
            : 0;
        if (overlapMs >= 2000) {
          adjustedText = stripTextOverlap(prevChunk?.text, text, {
            minMatch: 20,
            window: 400,
          });
        }

        cj.chunks.push({
          startMs: isFinite(tStartMs) ? tStartMs : undefined,
          endMs: isFinite(tEndMs) ? tEndMs : undefined,
          seq: isFinite(seq) ? seq : undefined,
          text: adjustedText,
        });

        await prisma.transcript.update({
          where: { id: transcriptId },
          data: {
            title: title ?? undefined,
            sourceUrl: sourceUrl ?? undefined,
            sourceTabTitle: sourceTabTitle ?? undefined,
            contentJson: cj,
            chunkCount: (transcript.chunkCount ?? 0) + 1,
            durationMs: isFinite(tEndMs)
              ? Math.max(transcript.durationMs ?? 0, tEndMs)
              : transcript.durationMs ?? null,
          },
        });
      }
    } else {
      const created = await prisma.transcript.create({
        data: {
          userId: userId!,
          title,
          sourceUrl,
          sourceTabTitle,
          contentJson: {
            version: 1,
            chunks: [
              {
                startMs: isFinite(tStartMs) ? tStartMs : undefined,
                endMs: isFinite(tEndMs) ? tEndMs : undefined,
                seq: isFinite(seq) ? seq : undefined,
                text: adjustedText,
              },
            ],
          },
          chunkCount: 1,
          durationMs: isFinite(tEndMs) ? tEndMs : null,
        },
        select: { id: true },
      });
      transcriptId = created.id;
    }

    // --- done ---
    console.info(`🟣 [transcribe:${reqId}] ok`);
    return NextResponse.json(
      {
        ok: true,
        text,
        seq: isFinite(seq) ? seq : undefined,
        tStartMs: isFinite(tStartMs) ? tStartMs : undefined,
        tEndMs: isFinite(tEndMs) ? tEndMs : undefined,
        transcriptId,
        model: MODEL_ID,
      },
      { headers: corsHeaders() }
    );
  } catch (err: any) {
    console.error(`🔴 [transcribe:${reqId}] error`, {
      status: err?.status,
      code: err?.error?.code,
      message: err?.error?.message || err?.message,
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders() }
    );
  }
}
