import { SignUpForm } from "@/components/auth/sign-up-form";
import { enabledSocialProviders } from "@/lib/auth";

export default function SignUpPage() {
  return <SignUpForm providers={enabledSocialProviders} />;
}
