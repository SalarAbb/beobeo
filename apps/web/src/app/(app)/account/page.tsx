import { count, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db, schema } from "@beobeo/db";
import { auth } from "@/lib/auth";
import { SignOutButton } from "@/components/sign-out-button";
import { PageHeader, Section, StatStrip, StatTile } from "@/components/page-section";

const PROVIDER_LABEL: Record<string, string> = {
  credential: "Email & password",
  google: "Google",
  apple: "Apple",
};

export default async function AccountPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/signin");
  const { user } = session;

  const [providers, [txnCount], [portfolioCount]] = await Promise.all([
    db
      .select({ providerId: schema.account.providerId })
      .from(schema.account)
      .where(eq(schema.account.userId, user.id)),
    db
      .select({ n: count() })
      .from(schema.transactions)
      .where(eq(schema.transactions.userId, user.id)),
    db
      .select({ n: count() })
      .from(schema.portfolios)
      .where(eq(schema.portfolios.userId, user.id)),
  ]);

  return (
    <div className="mx-auto grid w-full max-w-2xl grid-cols-1 gap-12">
      <PageHeader title="Account" />

      <div className="-mt-4 flex flex-wrap items-center gap-4 rounded-xl border bg-card px-5 py-5">
          {user.image ? (
            // eslint-disable-next-line @next/next/no-img-element -- avatar from OAuth provider
            <img
              src={user.image}
              alt=""
              className="size-14 rounded-full"
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className="flex size-14 items-center justify-center rounded-full bg-primary text-xl font-semibold text-primary-foreground">
              {(user.name || user.email).slice(0, 1).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate font-display text-xl font-bold">{user.name}</p>
            <p className="truncate text-sm text-muted-foreground">{user.email}</p>
            <p className="text-xs text-muted-foreground">
              Member since{" "}
              {new Date(user.createdAt).toLocaleDateString("en-US", {
                month: "long",
                year: "numeric",
              })}
            </p>
          </div>
          <div className="ml-auto">
            <SignOutButton variant="outline" />
          </div>
      </div>

      <Section title="Sign-in methods">
        <p className="-mt-2 text-sm text-muted-foreground">
          Ways you can sign in to this account. Signing in with Google or Apple
          using the same email links automatically.
        </p>
        <div className="flex flex-wrap gap-2">
          {providers.length === 0 ? (
            <p className="text-sm text-muted-foreground">None found</p>
          ) : (
            providers.map((p) => (
              <span
                key={p.providerId}
                className="rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-primary"
              >
                {PROVIDER_LABEL[p.providerId] ?? p.providerId}
              </span>
            ))
          )}
        </div>
      </Section>

      <Section title="Your data">
        <StatStrip cols="grid-cols-2">
          <StatTile
            label={(portfolioCount?.n ?? 0) === 1 ? "Portfolio" : "Portfolios"}
            value={String(portfolioCount?.n ?? 0)}
          />
          <StatTile label="Transactions" value={(txnCount?.n ?? 0).toLocaleString("en-US")} />
        </StatStrip>
      </Section>

      <p className="text-xs text-muted-foreground">
        Your transactions live in your own database and are never shared.
        Questions asked in Chat send the relevant portfolio numbers to the
        Claude API to generate answers.
      </p>
    </div>
  );
}
