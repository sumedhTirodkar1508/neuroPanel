// src/helpers/mailer.ts
import nodemailer from "nodemailer";

function createTransport() {
  const host = process.env.MAILTRAP_HOST;
  const port = Number(process.env.MAILTRAP_PORT || 2525);
  const user = process.env.MAILTRAP_USER;
  const pass = process.env.MAILTRAP_PASSWORD;

  if (!host || !user || !pass) {
    throw new Error("Mailtrap credentials are missing in env");
  }

  return nodemailer.createTransport({
    host,
    port,
    auth: { user, pass },
  });
}

const transporter = createTransport();

/**
 * Sends the verification email with a link to /verify-email
 */
export async function sendVerificationEmail(
  email: string,
  emailVerifyToken: string,
  qrCodeId?: string
) {
  const domain = process.env.DOMAIN;

  const verificationUrl = `${domain}/verify-email?token=${emailVerifyToken}${
    qrCodeId ? `&qrcodeID=${encodeURIComponent(qrCodeId)}` : ""
  }`;

  const from = process.env.ADMIN_EMAIL;

  const mailOptions = {
    from,
    to: email,
    subject: "Verify Your Email Address",
    html: `
      <h1>Welcome to SQRATCH!</h1>
      <p>Please click the link below to verify your email address:</p>
      <a href="${verificationUrl}" style="padding:10px 20px;color:#fff;background:#3b82f6;text-decoration:none;border-radius:6px;">
        Verify Email
      </a>
      <p>If you did not sign up, you can safely ignore this email.</p>
    `,
  };

  return transporter.sendMail(mailOptions);
}
