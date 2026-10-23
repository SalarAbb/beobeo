import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { PortfolioProvider } from "@/components/portfolio-context";
import { PortfolioSwitcher } from "@/components/portfolio-switcher";
import { Toaster } from "@/components/ui/sonner";

const nav = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/transactions", label: "Transactions" },
  { href: "/tax-center", label: "Tax Center" },
  { href: "/compare", label: "Compare" },
  { href: "/chat", label: "Chat" },
  { href: "/accounts", label: "Accounts" },
];

function UserBadge({
  name,
  email,
  image,
}: {
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
      {image ? (
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
      )}
      <div className="min-w-0 flex-1 overflow-hidden">
        <p className="truncate text-sm font-medium capitalize">{name}</p>
        <p className="truncate text-xs text-muted-foreground">{email}</p>
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

  return (
    <PortfolioProvider>
    <div className="flex min-h-screen">
      <aside className="flex w-52 shrink-0 flex-col overflow-hidden border-r bg-sidebar">
        <div className="px-5 py-5">
          <Link href="/dashboard" className="text-lg font-semibold tracking-tight">
            beobeo
          </Link>
        </div>
        <div className="px-3 pb-3">
          <PortfolioSwitcher />
        </div>
        <nav className="flex flex-col gap-1 px-3">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-2 py-1.5 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto border-t p-2">
          <UserBadge
            name={session.user.name}
            email={session.user.email}
            image={session.user.image}
          />
        </div>
      </aside>
      <main className="flex-1 overflow-x-hidden p-6">{children}</main>
      <Toaster />
    </div>
    </PortfolioProvider>
  );
}
