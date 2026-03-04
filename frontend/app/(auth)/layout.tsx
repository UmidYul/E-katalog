import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { publicInter, publicMontserrat } from "@/lib/theme/public-fonts";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`public-theme min-h-screen ${publicInter.variable} ${publicMontserrat.variable}`}>
      <SiteHeader />
      <main>{children}</main>
      <SiteFooter />
    </div>
  );
}
