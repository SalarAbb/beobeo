import { count, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db, schema } from "@beobeo/db";
import { auth } from "@/lib/auth";
import { SignOutButton } from "@/components/sign-out-button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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
    <div className="mx-auto grid max-w-2xl gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Account</h1>

      <Card>
        <CardContent className="flex items-center gap-4 py-5">
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
            <p className="truncate text-lg font-semibold">{user.name}</p>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sign-in methods</CardTitle>
          <CardDescription>
            Ways you can sign in to this account. Signing in with Google or
            Apple using the same email links automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {providers.length === 0 ? (
            <p className="text-sm text-muted-foreground">None found</p>
          ) : (
            providers.map((p) => (
              <Badge key={p.providerId} variant="secondary">
                {PROVIDER_LABEL[p.providerId] ?? p.providerId}
              </Badge>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your data</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-2xl font-semibold tabular-nums">
              {portfolioCount?.n ?? 0}
            </p>
            <p className="text-muted-foreground">
              {(portfolioCount?.n ?? 0) === 1 ? "Portfolio" : "Portfolios"}
            </p>
          </div>
          <div>
            <p className="text-2xl font-semibold tabular-nums">{txnCount?.n ?? 0}</p>
            <p className="text-muted-foreground">Transactions</p>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Your transactions live in your own database and are never shared.
        Questions asked in Chat send the relevant portfolio numbers to the
        Claude API to generate answers.
      </p>
    </div>
  );
}
