import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { env } from "@/config/env";
import { CatalogClientPage } from "@/features/catalog/catalog-client-page";
import { serverGet } from "@/lib/api/server";

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  return {
    title: `Category: ${params.slug}`,
    alternates: { canonical: `${env.appUrl}/category/${params.slug}` }
  };
}

export default async function CategoryPage({ params }: { params: { slug: string } }) {
  const categories = await serverGet<Array<{ id: number; slug: string; name: string }>>("/categories");
  const category = categories.find((item) => item.slug === params.slug);

  if (!category) {
    notFound();
  }

  return <CatalogClientPage categoryId={category.id} />;
}

