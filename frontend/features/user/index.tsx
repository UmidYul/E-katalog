import { ProfileClient, RecentlyViewedClient } from "@/features/user/account-pages";
import { FavoritesWatchlistClient } from "@/features/user/favorites-watchlist-client";

export default function ProfilePage() {
  return <ProfileClient />;
}

export const FavoritesPage = () => <FavoritesWatchlistClient />;
export const RecentlyViewedPage = () => <RecentlyViewedClient />;

