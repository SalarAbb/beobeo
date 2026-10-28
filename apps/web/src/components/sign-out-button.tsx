"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth-client";
import { setPortfolioCookie } from "@/lib/portfolio-cookie";

export function SignOutButton({
  variant = "ghost",
}: {
  variant?: "ghost" | "outline";
}) {
  const router = useRouter();
  return (
    <Button
      variant={variant}
      size="sm"
      onClick={async () => {
        await signOut();
        // Stale portfolio selection must not leak into the next login.
        localStorage.removeItem("beobeo.activePortfolioId");
        setPortfolioCookie(null);
        router.push("/signin");
        router.refresh();
      }}
    >
      <LogOut className="mr-1.5 size-3.5" />
      Sign out
    </Button>
  );
}
