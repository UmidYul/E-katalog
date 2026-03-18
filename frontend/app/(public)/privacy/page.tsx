import type { Metadata } from "next";

import { LegalPage } from "@/components/common/legal-page";
import { env } from "@/config/env";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Махфийлик сиёсати",
    alternates: { canonical: `${env.appUrl}/privacy` },
  };
}

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Махфийлик сиёсати"
      updatedAt="15 март 2026"
      description="Ушбу саҳифа Doxx платформасида шахсий маълумотлар билан ишлашнинг қисқа кўриниши. Тўлиқ ҳуқуқий редакция кейин юрист томонидан тўлдирилади."
      sections={[
        {
          id: "data-collected",
          title: "Қандай маълумот йиғилади",
          content: (
            <>
              <p>Аккаунт маълумотлари, техник логлар, танланган товарлар ва огоҳлантириш параметрлари сақланиши мумкин.</p>
              <p>[TODO: юрист тўлдиради]</p>
            </>
          ),
        },
        {
          id: "data-usage",
          title: "Маълумот қандай ишлатилади",
          content: (
            <>
              <p>Маълумотлар нарх мониторинги, шахсийлаштириш, хавфсизлик ва қўллаб-қувватлаш сифати учун ишлатилади.</p>
              <p>[TODO: юрист тўлдиради]</p>
            </>
          ),
        },
        {
          id: "third-parties",
          title: "Маълумот учинчи шахсларга берилиши",
          content: (
            <>
              <p>Маълумотлар ҳамкор сервислар ва қонуний талаблар доирасида чекланган ҳолда узатилиши мумкин.</p>
              <p>[TODO: юрист тўлдиради]</p>
            </>
          ),
        },
        {
          id: "cookies-tracking",
          title: "Cookies ва трекинг",
          content: (
            <>
              <p>Сессия, интерфейс афзалликлари ва аналитика учун cookies ишлатилади. Танловингиз consent баннер орқали сақланади.</p>
              <p>[TODO: юрист тўлдиради]</p>
            </>
          ),
        },
        {
          id: "user-rights",
          title: "Фойдаланувчи ҳуқуқлари (GDPR/local law)",
          content: (
            <>
              <p>Фойдаланувчи маълумотга кириш, тузатиш, ўчириш ва қайта ишлашга қарши чиқиш бўйича сўров юбориши мумкин.</p>
              <p>[TODO: юрист тўлдиради]</p>
            </>
          ),
        },
        {
          id: "dpo-contact",
          title: "Алоқа (DPO email)",
          content: (
            <>
              <p>Махфийлик масалалари бўйича алоқа: <a className="text-accent hover:underline" href="mailto:security@doxx.uz">security@doxx.uz</a>.</p>
              <p>[TODO: юрист тўлдиради]</p>
            </>
          ),
        },
      ]}
    />
  );
}
