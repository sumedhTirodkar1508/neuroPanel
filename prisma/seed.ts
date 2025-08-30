/* prisma/seed.ts */
import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes, createHash } from "crypto";

const prisma = new PrismaClient();

function sha256(s: string) {
  return createHash("sha256").update(s).digest("hex");
}

async function createAdmin() {
  const email = "admin@gmail.com";
  const plainPass = "Admin@123"; // change in prod!
  const password = bcrypt.hashSync(plainPass, 10);

  const admin = await prisma.user.upsert({
    where: { email },
    update: {
      name: "Platform Admin",
      role: Role.ADMIN,
      isEmailVerified: true,
      emailVerified: new Date(),
      password,
    },
    create: {
      name: "Platform Admin",
      email,
      password,
      role: Role.ADMIN,
      isEmailVerified: true,
      emailVerified: new Date(),
    },
  });

  // OPTIONAL: seed a refresh token so you can test your refresh flow immediately
  const refreshPlain = randomBytes(48).toString("base64url");
  const tokenHash = sha256(refreshPlain);
  const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // +30 days

  // Upsert-like behavior for refresh: allow multiple per user, but avoid dup by hash
  await prisma.refreshToken.upsert({
    where: { tokenHash },
    update: {},
    create: {
      userId: admin.id,
      tokenHash,
      expiresAt: refreshExpiresAt,
      userAgent: "seed-script",
      ip: "127.0.0.1",
    },
  });

  console.log("✅ Admin:", admin.email);
  console.log("   Admin password:", plainPass);
  console.log("   Admin refresh (plain):", refreshPlain);
  return admin;
}

async function createUserWithVerification() {
  const email = "user@gmail.com";
  const plainPass = "User@123"; // change in prod!
  const password = bcrypt.hashSync(plainPass, 10);

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      name: "Sample User",
      isEmailVerified: false,
      emailVerified: null,
      password,
      role: Role.USER,
    },
    create: {
      name: "Sample User",
      email,
      password,
      role: Role.USER,
      isEmailVerified: false,
    },
  });

  // Seed an email verification token (1 hour)
  const verifyToken = "verify-token-seed-" + randomBytes(6).toString("hex");
  await prisma.emailVerificationToken.create({
    data: {
      userId: user.id,
      emailVerifyToken: verifyToken,
      expires: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  console.log("✅ User:", user.email);
  console.log("   User password:", plainPass);
  console.log("   Verification token:", verifyToken);
  return user;
}

async function createTranscripts(userId: string) {
  // Seed two transcripts with contentJson only
  const t1 = await prisma.transcript.create({
    data: {
      userId,
      title: "YouTube: Intro to Web Audio",
      sourceUrl: "https://www.youtube.com/watch?v=example1",
      sourceTabTitle: "Intro to Web Audio - YouTube",
      durationMs: 180_000,
      chunkCount: 6,
      contentJson: {
        version: 1,
        chunks: [
          {
            startMs: 0,
            endMs: 30000,
            text: "Welcome to the Web Audio introduction...",
          },
          {
            startMs: 30000,
            endMs: 60000,
            text: "We'll discuss MediaRecorder APIs...",
          },
        ],
        summary: "Basics of MediaRecorder and browser audio capture.",
      },
    },
  });

  const t2 = await prisma.transcript.create({
    data: {
      userId,
      title: "Podcast: Browser Internals",
      sourceUrl: "https://podcasts.example/episode-42",
      sourceTabTitle: "Episode 42 - Browser Internals",
      durationMs: 240_000,
      chunkCount: 8,
      contentJson: {
        version: 1,
        chunks: [
          {
            startMs: 0,
            endMs: 30000,
            text: "In this episode, we explore MV3 service workers...",
          },
          {
            startMs: 30000,
            endMs: 60000,
            text: "We'll also cover performance tips for long sessions...",
          },
        ],
        summary: "MV3 service workers and performance considerations.",
      },
    },
  });

  console.log("✅ Transcripts created:", t1.id, t2.id);
}

async function main() {
  console.log("🌱 Seeding database…");

  const admin = await createAdmin();
  const user = await createUserWithVerification();

  // Give admin a couple of transcripts, and the user one
  await createTranscripts(admin.id);
  await createTranscripts(user.id);

  console.log("🌱 Seed complete.");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
