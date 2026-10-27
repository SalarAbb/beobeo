import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { PortfolioProvider } from "@/components/portfolio-context";
import { Toaster } from "@/components/ui/sonner";
import { WelcomeFlow } from "@/components/welcome/welcome-flow";

/** After sign-up (R-005): three calm, skippable setup steps outside the app
 *  shell — taxes, accounts, first holding. */
export default async function WelcomePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/signin");
  // Step 3 opens the app's add-transaction form in place, which reads the
  // portfolio selection and reports through toasts.
  return (
    <PortfolioProvider userId={session.user.id}>
      <WelcomeFlow name={session.user.name} />
      <Toaster />
    </PortfolioProvider>
  );
}
