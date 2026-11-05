import { z } from "zod";
import { IdSchema, TimeZoneSchema, TimestampSchema } from "./common.js";
import { MeSchema } from "./households.js";

/**
 * Password rules follow NIST SP 800-63B (the US government's digital identity
 * guidelines, widely adopted by industry):
 *  - LENGTH matters most: at least 12 characters.
 *  - NO composition rules ("must contain a symbol") — they make passwords harder
 *    to remember without making them meaningfully harder to crack.
 *  - Allow long passphrases (up to 256), but cap it: hashing a 10 MB "password"
 *    would be a denial-of-service vector.
 *  - Reject known-common passwords (checked on the server).
 */
export const PasswordSchema = z
  .string()
  .min(12, "Use at least 12 characters — a few random words works great")
  .max(256, "Use at most 256 characters");

/** Normalise FIRST (trim + lowercase), then validate — "  Sam@Example.com " is fine. */
export const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email("Enter a valid email address"));

export const SignupSchema = z
  .object({
    email: EmailSchema,
    password: PasswordSchema,
    displayName: z.string().trim().min(1).max(100),
    /** The browser's time zone, for the new household (scheduled jobs need it). */
    timeZone: TimeZoneSchema.optional(),
  })
  .meta({ id: "Signup" });
export type SignupInput = z.infer<typeof SignupSchema>;

export const LoginSchema = z
  .object({
    email: EmailSchema,
    // Never apply strength rules at login: old passwords created under older
    // rules must keep working. Just bound the size.
    password: z.string().min(1).max(256),
  })
  .meta({ id: "Login" });
export type LoginInput = z.infer<typeof LoginSchema>;

export const MfaCodeSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(6)
      .max(20)
      .meta({ description: "6-digit authenticator code, or a recovery code like ABCD-EFGH-JKMN" }),
  })
  .meta({ id: "MfaCode" });

export const LoginResultSchema = z
  .discriminatedUnion("status", [
    z.object({ status: z.literal("authenticated"), user: MeSchema }),
    z.object({
      status: z.literal("mfa_required"),
      message: z.string(),
    }),
  ])
  .meta({ id: "LoginResult" });
export type LoginResult = z.infer<typeof LoginResultSchema>;

export const ChangePasswordSchema = z
  .object({ currentPassword: z.string().min(1).max(256), newPassword: PasswordSchema })
  .meta({ id: "ChangePassword" });

// ─── Account recovery and verification (Stage 15) ─────────────────────────────

/** A secret from an emailed link: 32 random bytes, base64url. */
const LinkTokenSchema = z.string().min(20).max(200);

export const PasswordResetRequestSchema = z
  .object({ email: EmailSchema })
  .meta({ id: "PasswordResetRequest" });

export const PasswordResetSchema = z
  .object({ token: LinkTokenSchema, password: PasswordSchema })
  .meta({ id: "PasswordReset" });

export const VerifyEmailSchema = z.object({ token: LinkTokenSchema }).meta({ id: "VerifyEmail" });

/** Deleting your account: re-enter your password (and a 2FA code if it's on). */
export const DeleteAccountSchema = z
  .object({
    password: z.string().min(1).max(256),
    code: z.string().trim().min(6).max(20).optional(),
  })
  .meta({ id: "DeleteAccount" });
export type DeleteAccountInput = z.infer<typeof DeleteAccountSchema>;

export const SessionSchema = z
  .object({
    id: IdSchema,
    current: z.boolean().meta({ description: "True for the session making this request" }),
    userAgent: z.string().nullable(),
    ipAddress: z.string().nullable(),
    createdAt: TimestampSchema,
    lastSeenAt: TimestampSchema,
    expiresAt: TimestampSchema,
  })
  .meta({ id: "Session" });
export type SessionDto = z.infer<typeof SessionSchema>;

export const TotpSetupSchema = z
  .object({
    secret: z.string().meta({ description: "Base32 secret, for manual entry" }),
    otpauthUri: z.string().meta({ description: "Render as a QR code for authenticator apps" }),
  })
  .meta({ id: "TotpSetup" });

export const RecoveryCodesSchema = z
  .object({
    recoveryCodes: z
      .array(z.string())
      .meta({ description: "Shown ONCE. Each code works one time if the authenticator is lost." }),
  })
  .meta({ id: "RecoveryCodes" });

export const DisableTotpSchema = z
  .object({ password: z.string().min(1).max(256), code: MfaCodeSchema.shape.code })
  .meta({ id: "DisableTotp" });
