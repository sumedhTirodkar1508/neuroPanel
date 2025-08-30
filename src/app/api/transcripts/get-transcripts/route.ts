// src/app/api/transcripts/get-transcripts/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/options";
import prisma from "@/lib/prisma";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const transcripts = await prisma.transcript.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        sourceUrl: true,
        sourceTabTitle: true,
        durationMs: true,
        chunkCount: true,
        contentJson: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ data: transcripts });
  } catch (e) {
    console.error("[/api/transcripts/get-transcripts] error:", e);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
