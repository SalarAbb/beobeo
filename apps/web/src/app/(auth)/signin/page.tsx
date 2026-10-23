import { Suspense } from "react";
import { SignInForm } from "@/components/auth/sign-in-form";
import { enabledSocialProviders } from "@/lib/auth";

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm providers={enabledSocialProviders} />
    </Suspense>
  );
}
