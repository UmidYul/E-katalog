import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { env } from "@/config/env";
import { ProductClientPage } from "@/features/product/product-client-page";
import { serverGet } from "@/lib/api/server";
import { getRequestLocale } from "@/lib/i18n/server";
import type { Locale } from "@/lib/i18n/types";
import { buildProductFaq, toFaqJsonLd } from "@/lib/seo/content";

type ProductSeoPayload = {
  id: string;
  title: string;
  category?: string | null;
  brand?: string | null;
  short_description?: string | null;
  main_image?: string | null;
};

const UUID_PREFIX_PATTERN =
  /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})(?:-|$)/;

const parseProductRef = (slug: string) => {
  const uuidMatch = slug.match(UUID_PREFIX_PATTERN);
  if (uuidMatch?.[1]) {
    return uuidMatch[1].toLowerCase();
  }
  return null;
};

const buildDescription = (product: ProductSeoPayload, locale: Locale) => {
  const base = product.short_description?.trim();
  if (base) return base.slice(0, 160);
  const category = product.category?.trim();
  const brand = product.brand?.trim();
  if (locale === "uz-Cyrl-UZ") {
    if (brand && category) return `${product.title}. ${category} категориясида ${brand} бренди бўйича нарх ва таклифларни солиштиринг.`;
    if (category) return `${product.title}. ${category} категориясида нарх ва таклифларни солиштиринг.`;
    return `${product.title}. Текширилган дўконлар таклифлари ва нархларини солиштиринг.`;
  }

  if (brand && category) return `${product.title}. Сравнение цен и предложений в категории ${category}, бренд ${brand}.`;
  if (category) return `${product.title}. Сравнение цен и предложений в категории ${category}.`;
  return `${product.title}. Сравнение цен и предложений от проверенных магазинов.`;
};

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const locale = getRequestLocale();
  const productRef = parseProductRef(params.slug);
  if (!productRef) {
    return {
      title: locale === "uz-Cyrl-UZ" ? "Товар" : "Товар",
      robots: { index: false, follow: true }
    };
  }

  const canonical = `${env.appUrl}/product/${params.slug}`;

  try {
    const product = await serverGet<ProductSeoPayload>(`/products/${productRef}`);
    const description = buildDescription(product, locale);
    const image = product.main_image || undefined;

    return {
      title: product.title,
      description,
      keywords: locale === "uz-Cyrl-UZ"
        ? [product.title, product.brand ?? "", product.category ?? "", "нарх", "сотиб олиш"].filter(Boolean)
        : [product.title, product.brand ?? "", product.category ?? "", "цена", "купить"].filter(Boolean),
      openGraph: {
        title: `${product.title} | ${env.siteName}`,
        description,
        url: canonical,
        type: "website",
        images: image ? [{ url: image, alt: product.title }] : undefined
      },
      twitter: {
        card: image ? "summary_large_image" : "summary",
        title: `${product.title} | ${env.siteName}`,
        description,
        images: image ? [image] : undefined
      },
      alternates: { canonical }
    };
  } catch {
    return {
      title: locale === "uz-Cyrl-UZ" ? "Товар" : "Товар",
      alternates: { canonical },
      robots: { index: false, follow: true }
    };
  }
}

export default async function ProductPage({ params }: { params: { slug: string } }) {
  const locale = getRequestLocale();
  const productRef = parseProductRef(params.slug);
  if (!productRef) {
    notFound();
  }

  let product: ProductSeoPayload;
  try {
    product = await serverGet<ProductSeoPayload>(`/products/${productRef}`);
  } catch {
    notFound();
  }

  const faq = buildProductFaq(product.title, product.category, locale);

  return (
    <>
      <ProductClientPage productId={productRef} slug={params.slug} />
      <section className="mx-auto max-w-7xl space-y-2 px-4 pb-8 text-sm text-muted-foreground">
        <p>
          {locale === "uz-Cyrl-UZ"
            ? `${product.title} турли сотувчиларда мавжуд: сотиб олишдан олдин нарх, мавжудлик ва етказиб бериш шартларини солиштиринг.`
            : `${product.title} доступен у разных продавцов: сравните цену, наличие и условия доставки перед покупкой.`}
        </p>
        <p>
          {locale === "uz-Cyrl-UZ"
            ? "Нарх тарихи ва товар хусусиятларидан фойдаланиб, нарх ва параметрлар мувозанати бўйича энг яхши таклифни танланг."
            : "Используйте историю цен и характеристики товара, чтобы выбрать лучшее предложение по соотношению цены и параметров."}
        </p>
      </section>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(toFaqJsonLd(faq))
        }}
      />
    </>
  );
}
