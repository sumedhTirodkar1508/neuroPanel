// src/lib/auth-token-helper.ts
import jwt from "jsonwebtoken";
import { randomBytes, createHash } from "crypto";
import prisma from "@/lib/prisma";

const NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET!;
const ACCESS_TOKEN_TTL_MIN = parseInt(
  process.env.ACCESS_TOKEN_TTL_MIN ?? "15",
  10
);
const REFRESH_TOKEN_TTL_DAYS = parseInt(
  process.env.REFRESH_TOKEN_TTL_DAYS ?? "30",
  10
);

const ACCESS_TTL_MS = ACCESS_TOKEN_TTL_MIN * 60 * 1000;
const REFRESH_TTL_MS = REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

export function sha256(s: string) {
  return createHash("sha256").update(s).digest("hex");
}

export function mintAccessToken(payload: {
  sub: string;
  email?: string | null;
  role?: "USER" | "ADMIN";
  isEmailVerified?: boolean;
}) {
  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + Math.floor(ACCESS_TTL_MS / 1000);
  const token = jwt.sign(
    {
      sub: payload.sub,
      email: payload.email,
      role: payload.role,
      isEmailVerified: payload.isEmailVerified,
      iat: nowSec,
      exp: expSec,
      iss: "app",
      aud: "extension",
    },
    NEXTAUTH_SECRET
  );
  return { token, expiresAt: expSec * 1000 };
}

export async function issueRefreshToken(
  userId: string,
  meta?: { ua?: string; ip?: string }
) {
  const refreshPlain = randomBytes(48).toString("base64url");
  const tokenHash = sha256(refreshPlain);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);

  await prisma.refreshToken.create({
    data: { userId, tokenHash, expiresAt, userAgent: meta?.ua, ip: meta?.ip },
  });

  return { refreshToken: refreshPlain, refreshExpiresAt: expiresAt.getTime() };
}

export async function rotateRefreshToken(
  oldPlain: string,
  userId: string,
  meta?: { ua?: string; ip?: string }
) {
  const oldHash = sha256(oldPlain);
  const current = await prisma.refreshToken.findUnique({
    where: { tokenHash: oldHash },
  });
  if (
    !current ||
    current.userId !== userId ||
    current.revokedAt ||
    current.expiresAt < new Date()
  ) {
    throw new Error("Invalid refresh token");
  }

  const { refreshToken, refreshExpiresAt } = await issueRefreshToken(
    userId,
    meta
  );
  await prisma.refreshToken.update({
    where: { tokenHash: oldHash },
    data: { revokedAt: new Date(), replacedByTokenHash: sha256(refreshToken) },
  });

  return { refreshToken, refreshExpiresAt };
}
