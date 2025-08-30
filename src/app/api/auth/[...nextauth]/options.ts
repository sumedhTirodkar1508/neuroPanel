// /Users/sumedh/Documents/PersonalProjects/neuropanel/src/app/api/auth/[...nextauth]/options.ts
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";

import {
  mintAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
} from "@/lib/auth-token-helper";

const { NEXTAUTH_SECRET = "" } = process.env;

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },

  providers: [
    CredentialsProvider({
      id: "credentials",
      name: "Credentials",
      credentials: {
        email: { label: "Email:", type: "text", placeholder: "name@gmail.com" },
        password: {
          label: "Password:",
          type: "password",
          placeholder: "••••••••",
        },
      },
      async authorize(credentials: any) {
        const { email, password } = credentials ?? {};
        if (!email || !password)
          throw new Error("Email and password are required.");

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.password)
          throw new Error("Invalid email or password.");

        // Require email verification
        if (!user.isEmailVerified && !user.emailVerified) {
          throw new Error("Please verify your email address first.");
        }

        const ok = await bcrypt.compare(password, user.password);
        if (!ok) throw new Error("Invalid email or password.");

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          isEmailVerified: user.isEmailVerified || !!user.emailVerified,
        };
      },
    }),
  ],

  pages: {
    signIn: "/login",
    newUser: "/",
  },

  callbacks: {
    /**
     * Initial sign-in: set id/role/etc, then mint access + issue refresh.
     * Thereafter: if access is still valid, return; if expired, rotate using refresh.
     */
    async jwt({ token, user, trigger, session }) {
      // Initial login
      if (user) {
        token.id = user.id as string;
        token.email = user.email ?? null;
        token.name = user.name ?? null;
        token.role = (user as any).role ?? "USER";
        token.isEmailVerified = !!(user as any).isEmailVerified;

        const { token: accessToken, expiresAt } = mintAccessToken({
          sub: token.id as string,
          email: token.email,
          role: token.role as "USER" | "ADMIN",
          isEmailVerified: token.isEmailVerified,
        });

        const { refreshToken, refreshExpiresAt } = await issueRefreshToken(
          token.id as string
        );

        token.accessToken = accessToken;
        token.accessTokenExpires = expiresAt;
        token.refreshToken = refreshToken;
        token.refreshTokenExpires = refreshExpiresAt;

        return token;
      }

      // Manual refresh trigger via session.update({ refresh: true }) if you ever use it
      if (trigger === "update" && session?.refresh === true) {
        if (!token.id) return token;
        const { token: accessToken, expiresAt } = mintAccessToken({
          sub: token.id as string,
          email: token.email ?? null,
          role: (token.role as any) ?? "USER",
          isEmailVerified: !!token.isEmailVerified,
        });
        token.accessToken = accessToken;
        token.accessTokenExpires = expiresAt;
        return token;
      }

      // If access token is still valid, keep it
      const now = Date.now();
      if (
        token.accessToken &&
        token.accessTokenExpires &&
        now < (token.accessTokenExpires as number)
      ) {
        return token;
      }

      // Access expired -> try refresh rotation (for cookie-based flows)
      if (token.refreshToken && token.id) {
        try {
          const rotated = await rotateRefreshToken(
            token.refreshToken as string,
            token.id as string
          );
          token.refreshToken = rotated.refreshToken;
          token.refreshTokenExpires = rotated.refreshExpiresAt;

          const { token: accessToken, expiresAt } = mintAccessToken({
            sub: token.id as string,
            email: token.email ?? null,
            role: (token.role as any) ?? "USER",
            isEmailVerified: !!token.isEmailVerified,
          });
          token.accessToken = accessToken;
          token.accessTokenExpires = expiresAt;
        } catch {
          // Refresh failed: force re-login
          delete token.accessToken;
          delete token.accessTokenExpires;
          delete token.refreshToken;
          delete token.refreshTokenExpires;
        }
      }

      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.email = token.email ?? null;
        session.user.name = token.name ?? null;
        session.user.role = (token.role as any) ?? "USER";
        session.user.isEmailVerified = !!token.isEmailVerified;
      }

      // Expose tokens (handy for debugging or if the web UI wants to call APIs with Bearer)
      session.accessToken = token.accessToken as string | undefined;
      session.accessTokenExpires = token.accessTokenExpires as
        | number
        | undefined;
      session.refreshToken = token.refreshToken as string | undefined;
      session.refreshTokenExpires = token.refreshTokenExpires as
        | number
        | undefined;

      return session;
    },
  },

  secret: NEXTAUTH_SECRET,
};
