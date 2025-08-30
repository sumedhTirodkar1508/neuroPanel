// src/types/next-auth.d.ts
import "next-auth";
import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    id: string;
    email?: string | null;
    name?: string | null;
    role?: "USER" | "ADMIN";
    isEmailVerified?: boolean;
  }

  interface Session {
    user: {
      id: string;
      role?: "USER" | "ADMIN";
      isEmailVerified?: boolean;
      email?: string | null;
      name?: string | null;
    } & DefaultSession["user"];

    // expose for extension usage
    accessToken?: string;
    accessTokenExpires?: number; // epoch ms
    refreshToken?: string;
    refreshTokenExpires?: number; // epoch ms
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    email?: string | null;
    name?: string | null;
    role?: "USER" | "ADMIN";
    isEmailVerified?: boolean;

    // custom pair for extension
    accessToken?: string;
    accessTokenExpires?: number; // epoch ms
    refreshToken?: string;
    refreshTokenExpires?: number; // epoch ms
  }
}
