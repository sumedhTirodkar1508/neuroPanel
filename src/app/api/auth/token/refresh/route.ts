// src/app/api/auth/token/refresh/route.ts
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { mintAccessToken, rotateRefreshToken } from "@/lib/auth-token-helper";

const EXT_ALLOWED_ORIGIN = process.env.EXT_ALLOWED_ORIGIN || "*";
const cors = {
  "Access-Control-Allow-Origin": EXT_ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors });
}

export async function POST(req: Request) {
  try {
    const { userId, refreshToken } = await req.json();
    if (!userId || !refreshToken) {
      return NextResponse.json({ error: "userId and refreshToken required" }, { status: 400, headers: cors });
    }

    // Load user to copy latest role/flags into the new access token
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true, isEmailVerified: true },
    });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404, headers: cors });
    }

    // Rotate the refresh token (revokes old one, issues new one)
    const { refreshToken: newRefresh, refreshExpiresAt } = await rotateRefreshToken(refreshToken, user.id);

    // Mint a fresh access token
    const { token: accessToken, expiresAt: accessTokenExpires } = mintAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role as "USER" | "ADMIN",
      isEmailVerified: user.isEmailVerified,
    });

    return NextResponse.json(
      { accessToken, accessTokenExpires, refreshToken: newRefresh, refreshTokenExpires: refreshExpiresAt },
      { headers: cors }
    );
  } catch (e: any) {
    const msg = e?.message?.toString?.() ?? "Internal error";
    const status = /invalid refresh/i.test(msg) ? 401 : 500;
    return NextResponse.json({ error: msg }, { status, headers: cors });
  }
}
