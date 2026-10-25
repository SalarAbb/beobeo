import type { ReactNode } from "react";

/** Sign-in / sign-up frame in the evolution look: serif wordmark, serif title,
 *  the form on a hairline surface (no shadow), the switch link below it. */
export function AuthShell({
  title,
  subtitle,
  footer,
  children,
}: {
  title: string;
  subtitle: string;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="grid w-full max-w-sm gap-6">
        <div className="grid gap-1">
          <p className="font-display text-xl font-bold">beobeo</p>
          <p className="eyebrow">Your investing companion</p>
        </div>
        <div className="grid gap-1.5">
          <h1 className="text-3xl">{title}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="grid gap-4 rounded-xl border bg-card p-5 sm:p-6">{children}</div>
        <p className="text-sm text-muted-foreground">{footer}</p>
      </div>
    </main>
  );
}
