import { redirect } from "next/navigation";

export default function LegacyB2BFeedsRedirectPage() {
  redirect("/dashboard/seller/feeds");
}
