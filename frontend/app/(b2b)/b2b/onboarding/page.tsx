import { redirect } from "next/navigation";

export default function LegacyB2BOnboardingRedirectPage() {
  redirect("/dashboard/seller/onboarding");
}
