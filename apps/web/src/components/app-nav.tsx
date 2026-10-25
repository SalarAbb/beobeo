"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const nav = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/transactions", label: "Transactions" },
  { href: "/tax-center", label: "Tax Center" },
  { href: "/compare", label: "Compare" },
  { href: "/chat", label: "Chat" },
  { href: "/accounts", label: "Accounts" },
];

/** Primary navigation: a vertical list in the desktop sidebar, a horizontally
 *  scrolling row under the top bar on phones. The current page is tinted
 *  with the accent. */
export function AppNav() {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  // On phones the row scrolls; keep the current page's tab visible.
  useEffect(() => {
    navRef.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pathname]);
  return (
    <nav
      ref={navRef}
      aria-label="Main"
      className="flex gap-1 overflow-x-auto px-3 pb-2 md:flex-col md:overflow-visible md:pb-0"
    >
      {nav.map((item) => {
        const active =
          pathname === item.href ||
          pathname.startsWith(`${item.href}/`) ||
          (item.href === "/dashboard" && pathname.startsWith("/positions/"));
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm transition-colors ${
              active
                ? "bg-sidebar-accent font-medium text-primary"
                : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
