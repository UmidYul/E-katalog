import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { env } from "@/config/env";
import { ProductClientPage } from "@/features/product/product-client-page";
import { serverGet } from "@/lib/api/server";

const parseProductId = (slug: string) => {
  const match = slug.match(/^(\d+)/);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isFinite(id) ? id : null;
};

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const id = parseProductId(params.slug);
  if (!id) {
    return { title: "Product" };
  }

  try {
    const product = await serverGet<{ normalized_title: string }>(`/products/${id}`);
    return {
      title: product.normalized_title,
      openGraph: {
        title: product.normalized_title,
        url: `${env.appUrl}/product/${params.slug}`
      },
      alternates: { canonical: `${env.appUrl}/product/${params.slug}` }
    };
  } catch {
    return { title: "Product" };
  }
}

export default function ProductPage({ params }: { params: { slug: string } }) {
  const id = parseProductId(params.slug);
  if (!id) {
    notFound();
  }
  return <ProductClientPage productId={id} slug={params.slug} />;
}

