import { FavoritesClient, ProfileClient, RecentlyViewedClient } from "@/features/user/account-pages";

export default function ProfilePage() {
  return <ProfileClient />;
}

export const FavoritesPage = () => <FavoritesClient />;
export const RecentlyViewedPage = () => <RecentlyViewedClient />;

