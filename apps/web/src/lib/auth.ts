import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db, schema } from "@beobeo/db";

export type SocialProvider = "google" | "apple";

const googleEnabled = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
);
// Apple stays dormant until credentials exist — requires a paid Apple
// Developer account and HTTPS return URLs (no localhost), so this only
// activates after deployment.
const appleEnabled = Boolean(
  process.env.APPLE_CLIENT_ID && process.env.APPLE_CLIENT_SECRET,
);

/** Single source of truth for which social buttons the auth pages render. */
export const enabledSocialProviders: SocialProvider[] = [
  ...(googleEnabled ? (["google"] as const) : []),
  ...(appleEnabled ? (["apple"] as const) : []),
];

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  emailAndPassword: {
    enabled: true,
  },
  // Every page render and tRPC request checks the session. Without the
  // signed cookie cache that's a ~150ms DB round trip each time, more than the
  // query it guards. A session revoked elsewhere stays usable here for at
  // most maxAge; signing out on this device clears the cookie at once.
  session: {
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  socialProviders: {
    ...(googleEnabled
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
          },
        }
      : {}),
    ...(appleEnabled
      ? {
          apple: {
            clientId: process.env.APPLE_CLIENT_ID!,
            clientSecret: process.env.APPLE_CLIENT_SECRET!,
          },
        }
      : {}),
  },
  account: {
    // Let an email/password user later sign in with Google/Apple on the same
    // (provider-verified) email instead of erroring with a duplicate account.
    accountLinking: {
      enabled: true,
      trustedProviders: ["google", "apple"],
    },
  },
  // Apple's OAuth flow posts back from appleid.apple.com (form_post).
  ...(appleEnabled ? { trustedOrigins: ["https://appleid.apple.com"] } : {}),
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
