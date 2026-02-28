import { SellerShell } from "@/components/layout/seller-shell";

export default function DashboardSellerLayout({ children }: { children: React.ReactNode }) {
  return <SellerShell>{children}</SellerShell>;
}
