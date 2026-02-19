"use client";

import Link from "next/link";

import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuthMe, useLogout } from "@/features/auth/use-auth";
import { useFavorites } from "@/features/user/use-favorites";
import { useRecentlyViewedStore } from "@/store/recentlyViewed.store";

export function ProfileClient() {
  const me = useAuthMe();
  const logout = useLogout();

  return (
    <div className="container py-6">
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">Email: {me.data?.email ?? "-"}</p>
          <p className="text-sm text-muted-foreground">Name: {me.data?.full_name ?? "-"}</p>
          <Button variant="outline" onClick={() => logout.mutate()}>
            Logout
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export function FavoritesClient() {
  const favorites = useFavorites();

  return (
    <div className="container py-6">
      <h1 className="mb-4 text-2xl font-semibold">Favorites</h1>
      {(favorites.data?.length ?? 0) === 0 ? (
        <EmptyState title="Favorites are empty" message="Save products to compare them later." />
      ) : (
        <div className="space-y-3">
          {favorites.data?.map((item) => (
            <Card key={item.product_id}>
              <CardContent className="p-4">
                <Link href={`/product/${item.product_id}`} className="text-sm font-medium text-primary">
                  Product #{item.product_id}
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export function RecentlyViewedClient() {
  const { items, clear } = useRecentlyViewedStore();

  return (
    <div className="container py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Recently viewed</h1>
        <Button variant="ghost" onClick={clear}>
          Clear
        </Button>
      </div>
      {items.length === 0 ? (
        <EmptyState title="No recent views" message="Your visited products will appear here." />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={item.id}>
              <CardContent className="p-4">
                <Link href={`/product/${item.slug}`} className="text-sm font-medium">
                  {item.title}
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

