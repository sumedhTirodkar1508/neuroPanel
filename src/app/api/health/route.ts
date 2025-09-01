import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// Optional: require a simple shared secret for this endpoint
const KEY = process.env.HEALTHCHECK_KEY ?? "";

async function dbPing(timeoutMs = 1500) {
  // race a tiny DB query against a timeout
  const ping = prisma.$queryRaw`SELECT 1`;
  const timeout = new Promise((_, rej) =>
    setTimeout(() => rej(new Error("db-timeout")), timeoutMs)
  );
  return Promise.race([ping, timeout]);
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Optional shared-key gate
  if (KEY) {
    const key =
      req.headers.get("x-healthcheck-key") ??
      new URL(req.url).searchParams.get("key");
    if (key !== KEY) {
      return NextResponse.json(
        { ok: false, error: "forbidden" },
        { status: 403 }
      );
    }
  }

  const started = Date.now();
  try {
    await dbPing();
    const ms = Date.now() - started;
    return NextResponse.json(
      {
        ok: true,
        status: "ready",
        deps: { db: "ok", dbLatencyMs: ms },
        timestamp: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    const ms = Date.now() - started;
    // Don’t leak internals; keep the error minimal
    return NextResponse.json(
      {
        ok: false,
        status: "degraded",
        deps: { db: "fail", dbLatencyMs: ms },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
