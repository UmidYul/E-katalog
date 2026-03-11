import { cookies } from "next/headers";

import { LOCALE_COOKIE_NAME } from "./constants.ts";
import { resolveLocale } from "./locale.ts";
import type { Locale } from "./types.ts";

export const getRequestLocale = (): Locale => {
  const cookieStore = cookies();
  return resolveLocale(cookieStore.get(LOCALE_COOKIE_NAME)?.value ?? null);
};


