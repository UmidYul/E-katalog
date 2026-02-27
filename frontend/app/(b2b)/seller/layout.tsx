import { SellerShell } from "@/components/layout/seller-shell";

export default function SellerLayout({ children }: { children: React.ReactNode }) {
  return <SellerShell>{children}</SellerShell>;
}
