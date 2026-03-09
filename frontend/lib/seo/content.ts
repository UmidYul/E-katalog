type FaqItem = {
  question: string;
  answer: string;
};

const normalize = (value: string) => value.trim();

export function buildCategorySeoParagraphs(topic: string): string[] {
  const label = normalize(topic);
  return [
    `В разделе "${label}" вы можете быстро сравнить предложения по цене, наличию и условиям доставки от разных магазинов.`,
    `Используйте фильтры по брендам, стоимости и характеристикам, чтобы выбрать оптимальный вариант покупки без переплаты.`,
    `Карточки товаров регулярно обновляются, поэтому вы видите актуальные цены и можете принять решение на основе свежих данных.`
  ];
}

export function buildCategoryFaq(topic: string): FaqItem[] {
  const label = normalize(topic);
  return [
    {
      question: `Как выбрать лучший товар в категории ${label}?`,
      answer:
        "Сравните цены, характеристики, доступность и количество предложений от разных продавцов, затем отсортируйте по нужному приоритету."
    },
    {
      question: "Как часто обновляются цены в каталоге?",
      answer:
        "Данные в каталоге обновляются регулярно, чтобы отображать максимально актуальные предложения магазинов."
    },
    {
      question: "Можно ли отфильтровать товары по бренду и цене?",
      answer:
        "Да, в каталоге доступны фильтры по брендам, диапазону цен, продавцам и другим параметрам."
    }
  ];
}

export function buildProductFaq(productTitle: string, category?: string | null): FaqItem[] {
  const product = normalize(productTitle);
  const categoryLabel = normalize(category ?? "");
  const categoryPart = categoryLabel ? ` в категории ${categoryLabel}` : "";

  return [
    {
      question: `Где выгоднее купить ${product}?`,
      answer:
        "На странице товара вы можете сравнить предложения продавцов, минимальную цену и условия покупки, чтобы выбрать лучший вариант."
    },
    {
      question: `Как проверить актуальность цены на ${product}?`,
      answer:
        "Смотрите блок предложений и историю цен: они помогают оценить текущую стоимость и изменение цены со временем."
    },
    {
      question: `На что смотреть при выборе модели${categoryPart}?`,
      answer:
        "Сравните ключевые характеристики, отзывы и условия доставки, а затем выберите предложение с лучшим балансом цены и параметров."
    }
  ];
}

export function toFaqJsonLd(faq: FaqItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer
      }
    }))
  };
}

