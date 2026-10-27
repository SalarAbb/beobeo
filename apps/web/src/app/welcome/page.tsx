import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { WelcomeFlow } from "@/components/welcome/welcome-flow";

/** After sign-up (R-005): three calm, skippable setup steps outside the app
 *  shell — taxes, accounts, first holding. */
export default async function WelcomePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/signin");
  return <WelcomeFlow name={session.user.name} />;
}
