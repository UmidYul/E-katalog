import { redirect } from "next/navigation";

export default function LegacyB2BBillingRedirectPage() {
  redirect("/dashboard/seller/billing");
}
