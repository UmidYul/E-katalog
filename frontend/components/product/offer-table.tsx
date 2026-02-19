"use client";

import { ExternalLink, Share2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatPrice } from "@/lib/utils/format";
import type { OffersByStore } from "@/types/domain";

export function OfferTable({ offersByStore }: { offersByStore: OffersByStore[] }) {
  const [sortBy, setSortBy] = useState<"price" | "seller_rating" | "delivery">("price");

  const sortedStores = useMemo(() => {
    const copy = [...offersByStore];
    if (sortBy === "price") {
      return copy.sort((a, b) => a.minimal_price - b.minimal_price);
    }
    if (sortBy === "delivery") {
      const minDelivery = (store: OffersByStore) => Math.min(...store.offers.map((offer) => offer.delivery_days ?? 999));
      return copy.sort((a, b) => minDelivery(a) - minDelivery(b));
    }
    return copy.sort((a, b) => b.offers_count - a.offers_count);
  }, [offersByStore, sortBy]);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <CardTitle>Price comparison by store</CardTitle>
        <div className="flex items-center gap-2">
          <Select value={sortBy} onValueChange={(value) => setSortBy(value as "price" | "seller_rating" | "delivery")}>
            <div className="w-[180px]">
              <SelectTrigger>
              <SelectValue />
              </SelectTrigger>
            </div>
            <SelectContent>
              <SelectItem value="price">Sort by price</SelectItem>
              <SelectItem value="seller_rating">Sort by sellers count</SelectItem>
              <SelectItem value="delivery">Sort by delivery</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="sm"
            className="gap-2"
            onClick={() => navigator.share?.({ url: window.location.href, title: "Product offers" })}
          >
            <Share2 className="h-4 w-4" /> Share
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {sortedStores.map((storeBlock) => (
          <div key={storeBlock.store_id} className="space-y-2 rounded-2xl border border-border p-3">
            <div className="flex items-center justify-between">
              <p className="font-medium">{storeBlock.store}</p>
              <Badge>{formatPrice(storeBlock.minimal_price)}</Badge>
            </div>
            <div className="space-y-2">
              {storeBlock.offers.map((offer) => (
                <div key={offer.id} className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-3">
                  <div>
                    <p className="font-medium">{offer.seller_name}</p>
                    <p className="text-xs text-muted-foreground">Updated {new Date(offer.scraped_at).toLocaleString()}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={offer.in_stock ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}>
                      {offer.in_stock ? "In stock" : "Out of stock"}
                    </Badge>
                    {offer.delivery_days !== null && offer.delivery_days !== undefined ? (
                      <Badge>{offer.delivery_days}d</Badge>
                    ) : null}
                    <span className="text-base font-semibold text-primary">{formatPrice(offer.price_amount, offer.currency)}</span>
                    <a href={offer.link} target="_blank" rel="noreferrer" className="rounded-lg p-2 hover:bg-secondary">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
