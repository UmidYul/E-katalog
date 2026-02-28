import { redirect } from "next/navigation";

export default function LegacyB2BCampaignsRedirectPage() {
  redirect("/dashboard/seller/campaigns");
}
