import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const sections = [
  { title: "Applications", href: "/dashboard/admin/sellers", description: "Intake queue and decision workflow for seller applications." },
  { title: "Shops", href: "/dashboard/admin/sellers", description: "Approved seller stores, status updates, and operational actions." },
  { title: "Product Moderation", href: "/dashboard/admin/sellers", description: "Seller product moderation queue and review decisions." },
  { title: "Seller Finance", href: "/dashboard/admin/sellers", description: "Balances, transactions, and payout-related controls." },
  { title: "Tariffs", href: "/dashboard/admin/sellers", description: "Pricing plans and tariff assignments for seller accounts." },
];

export default function AdminSellersPage() {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Sellers</h2>
        <p className="text-sm text-muted-foreground">Replacement entry point for the old B2B Control area.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sections.map((item) => (
          <Card key={item.title}>
            <CardHeader>
              <CardTitle className="text-base">{item.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">{item.description}</p>
              <Link href={item.href} className="text-sm font-medium text-primary hover:underline">
                Open
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
