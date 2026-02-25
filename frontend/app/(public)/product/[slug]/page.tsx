import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { env } from "@/config/env";
import { ProductClientPage } from "@/features/product/product-client-page";
import { serverGet } from "@/lib/api/server";

const UUID_PREFIX_PATTERN =
  /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})(?:-|$)/;

const parseProductRef = (slug: string) => {
  const uuidMatch = slug.match(UUID_PREFIX_PATTERN);
  if (uuidMatch?.[1]) {
    return uuidMatch[1].toLowerCase();
  }
  return null;
};

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const productRef = parseProductRef(params.slug);
  if (!productRef) {
    return { title: "Товар" };
  }

  try {
    const product = await serverGet<{ title: string }>(`/products/${productRef}`);
    return {
      title: product.title,
      openGraph: {
        title: product.title,
        url: `${env.appUrl}/product/${params.slug}`
      },
      alternates: { canonical: `${env.appUrl}/product/${params.slug}` }
    };
  } catch {
    return { title: "Товар" };
  }
}

export default async function ProductPage({ params }: { params: { slug: string } }) {
  const productRef = parseProductRef(params.slug);
  if (!productRef) {
    notFound();
  }
  try {
    await serverGet<{ id: string }>(`/products/${productRef}`);
  } catch {
    notFound();
  }
  return <ProductClientPage productId={productRef} slug={params.slug} />;
}

