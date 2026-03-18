"use client";

import { ExternalLink, Share2 } from "lucide-react";
import { useMemo, useState } from "react";

import { useLocale } from "@/components/common/locale-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDateTime, formatPrice } from "@/lib/utils/format";
import type { OffersByStore } from "@/types/domain";

const formatScrapedAt = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return formatDateTime(date);
};

export function OfferTable({ offersByStore }: { offersByStore: OffersByStore[] }) {
  const { locale } = useLocale();
  const isUz = locale === "uz-Cyrl-UZ";
  const tr = (ru: string, uz: string) => (isUz ? uz : ru);

  const [sortBy, setSortBy] = useState<"best_value" | "price" | "seller_rating" | "delivery">("best_value");

  const sortedStores = useMemo(() => {
    const copy = [...offersByStore];
    if (sortBy === "price") {
      return copy.sort((a, b) => a.minimal_price - b.minimal_price);
    }
    if (sortBy === "best_value") {
      const bestValue = (store: OffersByStore) =>
        store.offers.length ? Math.max(...store.offers.map((offer) => Number(offer.best_value_score ?? offer.trust_score ?? 0))) : 0;
      return copy.sort((a, b) => bestValue(b) - bestValue(a));
    }
    if (sortBy === "delivery") {
      const minDelivery = (store: OffersByStore) => Math.min(...store.offers.map((offer) => offer.delivery_days ?? 999));
      return copy.sort((a, b) => minDelivery(a) - minDelivery(b));
    }
    return copy.sort((a, b) => b.offers_count - a.offers_count);
  }, [offersByStore, sortBy]);

  return (
    <Card className="rounded-xl border-border">
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <CardTitle className="font-heading text-xl font-bold">{tr("Сравнение цен по магазинам", "Дўконлар бўйича нарх солиштируви")}</CardTitle>
        <div className="flex items-center gap-2">
          <Select value={sortBy} onValueChange={(value) => setSortBy(value as "best_value" | "price" | "seller_rating" | "delivery")}>
            <div className="w-[220px]">
              <SelectTrigger className="rounded-lg">
                <SelectValue />
              </SelectTrigger>
            </div>
            <SelectContent>
              <SelectItem value="best_value">{tr("Лучшее соотношение", "Энг яхши нисбат")}</SelectItem>
              <SelectItem value="price">{tr("Сначала по цене", "Аввал нарх бўйича")}</SelectItem>
              <SelectItem value="seller_rating">{tr("По числу предложений", "Таклифлар сонига кўра")}</SelectItem>
              <SelectItem value="delivery">{tr("По скорости доставки", "Етказиш тезлиги бўйича")}</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="sm"
            className="gap-2"
            onClick={() => navigator.share?.({ url: window.location.href, title: tr("Предложения по товару", "Товар таклифлари") })}
          >
            <Share2 className="h-4 w-4" /> {tr("Поделиться", "Улашиш")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {sortedStores.map((storeBlock) => (
          <div key={storeBlock.store_id} className="space-y-2 rounded-xl border border-border p-3">
            <div className="flex items-center justify-between">
              <p className="font-medium">{storeBlock.store}</p>
              <Badge className="bg-accent/10 text-accent">{formatPrice(storeBlock.minimal_price)}</Badge>
            </div>
            <div className="space-y-2">
              {storeBlock.offers.map((offer, index) => (
                <div key={offer.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-3">
                  <div>
                    <p className="font-medium">{tr("Предложение", "Таклиф")} #{index + 1}</p>
                    <p className="text-xs text-muted-foreground">{tr("Обновлено", "Янгиланди")}: {formatScrapedAt(offer.scraped_at)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={offer.in_stock ? "border-success/40 bg-success/15 text-success" : "border-destructive/40 bg-destructive/15 text-destructive"}>
                      {offer.in_stock ? tr("В наличии", "Мавжуд") : tr("Нет в наличии", "Мавжуд эмас")}
                    </Badge>
                    {offer.trust_score != null ? (
                      <Badge className="border-accent/30 bg-accent/10 text-accent">{tr("Доверие", "Ишонч")}: {Math.round(Number(offer.trust_score) * 100)}%</Badge>
                    ) : null}
                    {offer.delivery_days !== null && offer.delivery_days !== undefined ? <Badge>{offer.delivery_days} {tr("дн.", "кун")}</Badge> : null}
                    <span className="text-base font-semibold text-foreground">{formatPrice(offer.price_amount, offer.currency)}</span>
                    <a
                      href={offer.link}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-semibold transition-colors hover:bg-secondary"
                    >
                      {tr("Купить", "Сотиб олиш")} <ExternalLink className="h-3.5 w-3.5" />
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
