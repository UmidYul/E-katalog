import { redirect } from "next/navigation";

export default function LegacyDashboardB2BRedirectPage() {
  redirect("/dashboard/admin/sellers");
}
