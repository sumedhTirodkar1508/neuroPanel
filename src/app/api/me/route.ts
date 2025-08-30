// src/app/api/me/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import jwt from "jsonwebtoken";
import prisma from "@/lib/prisma";
import { authOptions } from "@/app/api/auth/[...nextauth]/options";

const NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET!;
const EXT_ALLOWED_ORIGIN = process.env.EXT_ALLOWED_ORIGIN || "*"; // set to your site or extension origin in prod

// --- Small helpers ---
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": EXT_ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function bearerFrom(req: Request) {
  const auth =
    req.headers.get("authorization") || req.headers.get("Authorization");
  if (!auth) return null;
  const [scheme, token] = auth.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

type AccessPayload = {
  sub: string; // userId
  email?: string | null;
  role?: "USER" | "ADMIN";
  isEmailVerified?: boolean;
  exp?: number; // seconds
};

// --- OPTIONS (CORS preflight) ---
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

// --- GET /api/me ---
export async function GET(req: Request) {
  try {
    // 1) Try Bearer token (extension)
    const bearer = bearerFrom(req);
    if (bearer) {
      try {
        const decoded = jwt.verify(bearer, NEXTAUTH_SECRET) as AccessPayload;

        // Optional: fetch fresh user data to ensure current role/status
        const user = await prisma.user.findUnique({
          where: { id: decoded.sub },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            isEmailVerified: true,
          },
        });

        if (!user) {
          return NextResponse.json(
            { error: "User not found" },
            { status: 401, headers: corsHeaders() }
          );
        }

        return NextResponse.json(
          {
            auth: "bearer",
            user: {
              id: user.id,
              email: user.email,
              name: user.name,
              role: user.role,
              isEmailVerified: user.isEmailVerified,
            },
            accessTokenExpires: decoded.exp ? decoded.exp * 1000 : undefined,
          },
          { headers: corsHeaders() }
        );
      } catch (e: any) {
        // Differentiate expired tokens for the extension to trigger refresh
        const msg =
          e?.name === "TokenExpiredError"
            ? "Access token expired"
            : "Invalid access token";
        return NextResponse.json(
          { error: msg },
          { status: 401, headers: corsHeaders() }
        );
      }
    }

    // 2) Fall back to cookie session (web app)
    const session = await getServerSession(authOptions);
    if (session?.user?.id) {
      return NextResponse.json(
        {
          auth: "cookie",
          user: {
            id: session.user.id,
            email: session.user.email ?? null,
            name: session.user.name ?? null,
            role: session.user.role ?? "USER",
            isEmailVerified: !!session.user.isEmailVerified,
          },
          accessTokenExpires: session.accessTokenExpires ?? undefined,
        },
        { headers: corsHeaders() }
      );
    }

    // 3) Unauthenticated
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: corsHeaders() }
    );
  } catch (err) {
    console.error("[/api/me] error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders() }
    );
  }
}
