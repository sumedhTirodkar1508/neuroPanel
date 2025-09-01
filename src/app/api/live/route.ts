import { NextResponse } from "next/server";

export const runtime = "nodejs"; // or "edge" if you prefer
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      status: "live",
      uptimeSec: Math.round(process.uptime?.() ?? 0),
      timestamp: new Date().toISOString(),
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || null,
    },
    { headers: { "Cache-Control": "no-store" } } // always fresh
  );
}
