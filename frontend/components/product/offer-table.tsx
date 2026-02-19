"use client";

import { ExternalLink, Share2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPrice } from "@/lib/utils/format";
import type { ProductOffer } from "@/types/domain";

export function OfferTable({ offers }: { offers: ProductOffer[] }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Price comparison</CardTitle>
        <Button
          variant="ghost"
          size="sm"
          className="gap-2"
          onClick={() => navigator.share?.({ url: window.location.href, title: "Product" })}
        >
          <Share2 className="h-4 w-4" /> Share
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {offers.map((offer) => (
          <div key={offer.id} className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-3">
            <div>
              <p className="font-medium">{offer.store.name}</p>
              <p className="text-xs text-muted-foreground">Updated {new Date(offer.scraped_at).toLocaleString()}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge className={offer.in_stock ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}>
                {offer.in_stock ? "In stock" : "Out of stock"}
              </Badge>
              <span className="text-base font-semibold text-primary">{formatPrice(offer.price_amount, offer.currency)}</span>
              <a href={offer.external_url} target="_blank" rel="noreferrer" className="rounded-lg p-2 hover:bg-secondary">
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

