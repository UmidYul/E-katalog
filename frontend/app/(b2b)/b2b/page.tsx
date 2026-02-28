import { redirect } from "next/navigation";

export default function LegacyB2BDashboardRedirectPage() {
  redirect("/dashboard/seller");
}
