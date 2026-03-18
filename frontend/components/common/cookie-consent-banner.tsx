"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

const COOKIE_CONSENT_KEY = "doxx_cookie_consent";

type CookieConsentChoice = "all" | "essential";

export function CookieConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const existing = window.localStorage.getItem(COOKIE_CONSENT_KEY);
      setVisible(!existing);
    } catch {
      setVisible(true);
    }
  }, []);

  const saveChoice = (choice: CookieConsentChoice) => {
    try {
      window.localStorage.setItem(COOKIE_CONSENT_KEY, choice);
    } catch {
      // ignore storage errors
    }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 p-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-foreground">Биз сайт тажрибасини яхшилаш учун cookies ишлатамиз.</p>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => saveChoice("all")}>
            Қабул қилиш
          </Button>
          <Button size="sm" variant="outline" onClick={() => saveChoice("essential")}>
            Фақат зарурийлари
          </Button>
        </div>
      </div>
    </div>
  );
}
