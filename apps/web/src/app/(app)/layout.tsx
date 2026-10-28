import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AppNav } from "@/components/app-nav";
import { PortfolioProvider } from "@/components/portfolio-context";
import { PortfolioSwitcher } from "@/components/portfolio-switcher";

function Avatar({
  name,
  email,
  image,
}: {
  name: string;
  email: string;
  image: string | null | undefined;
}) {
  return image ? (
    // eslint-disable-next-line @next/next/no-img-element -- avatar from OAuth provider
    <img
      src={image}
      alt=""
      width={32}
      height={32}
      className="size-8 shrink-0 rounded-full object-cover"
      referrerPolicy="no-referrer"
    />
  ) : (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
      {(name || email).slice(0, 1).toUpperCase()}
    </span>
  );
}

function UserBadge(props: {
  name: string;
  email: string;
  image: string | null | undefined;
}) {
  return (
    <Link
      href="/account"
      title="Account settings"
      className="flex w-full items-center gap-2.5 overflow-hidden rounded-md px-2 py-2 hover:bg-sidebar-accent"
    >
      <Avatar {...props} />
      <div className="min-w-0 flex-1 overflow-hidden">
        <p className="truncate text-sm font-medium capitalize">{props.name}</p>
        <p className="truncate text-xs text-muted-foreground">{props.email}</p>
      </div>
    </Link>
  );
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/signin");
  const user = {
    name: session.user.name,
    email: session.user.email,
    image: session.user.image,
  };

  return (
    <PortfolioProvider userId={session.user.id}>
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Desktop: a fixed-width sidebar. Phone: a slim top bar (logo, switcher,
          avatar) over a scrolling nav row, so content gets the full width. */}
      <aside className="flex shrink-0 flex-col border-b bg-sidebar md:w-52 md:overflow-hidden md:border-r md:border-b-0">
        <div className="flex items-center gap-3 px-4 py-3 md:px-5 md:py-5">
          <Link href="/dashboard" className="font-display text-xl font-bold">
            beobeo
          </Link>
          <div className="ml-auto min-w-0 md:hidden">
            <PortfolioSwitcher />
          </div>
          <Link
            href="/account"
            aria-label={`Account settings for ${user.email}`}
            title={user.email}
            className="md:hidden"
          >
            <Avatar {...user} />
          </Link>
        </div>
        <div className="hidden px-3 pb-3 md:block">
          <PortfolioSwitcher />
        </div>
        <AppNav />
        <div className="mt-auto hidden border-t p-2 md:block">
          <UserBadge {...user} />
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-x-hidden px-4 py-6 md:p-8">{children}</main>
    </div>
    </PortfolioProvider>
  );
}
