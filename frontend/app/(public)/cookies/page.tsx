import type { Metadata } from "next";

import { LegalPage } from "@/components/common/legal-page";
import { env } from "@/config/env";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Cookie сиёсати",
    alternates: { canonical: `${env.appUrl}/cookies` },
  };
}

export default function CookiesPage() {
  return (
    <LegalPage
      title="Cookie сиёсати"
      updatedAt="15 март 2026"
      description="Cookie созламалари сайт тажрибасини бошқаришга ёрдам беради. Бу саҳифа ҳуқуқий финал версия эмас ва кейинчалик кенгайтирилади."
      sections={[
        {
          id: "cookie-types",
          title: "Cookie турлари (зарурий / аналитик / маркетинг)",
          content: (
            <>
              <p>Зарурий cookieлар сайт ишлаши учун мажбурий; аналитик ва маркетинг cookieлар эса алоҳида розиликка боғлиқ.</p>
              <p>[TODO: юрист тўлдиради]</p>
            </>
          ),
        },
        {
          id: "consent-banner",
          title: "Consent banner",
          content: (
            <>
              <p>Биринчи ташрифда consent баннер чиқади: «Қабул қилиш» ёки «Фақат зарурийлари» танлови localStorageда сақланади.</p>
              <p>[TODO: юрист тўлдиради]</p>
            </>
          ),
        },
        {
          id: "manage-cookies",
          title: "Бошқариш: браузер орқали ўчириш йўриқномаси",
          content: (
            <>
              <p>Cookieларни браузер созламалари орқали ўчириш ёки чеклаш мумкин. Шундан сўнг айрим функциялар чекланиши мумкин.</p>
              <p>[TODO: юрист тўлдиради]</p>
            </>
          ),
        },
      ]}
    />
  );
}
