import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_LOCALE } from "../lib/i18n/constants.ts";
import { resolveLocale } from "../lib/i18n/locale.ts";
import { messages, ruMessages } from "../lib/i18n/messages.ts";
import { translate } from "../lib/i18n/translate.ts";
import { formatDateTime, formatNumber, formatPrice } from "../lib/utils/format.ts";
import { formatSpecLabel } from "../lib/utils/specs.ts";

test("i18n locale resolver: default and supported locales", () => {
  assert.equal(resolveLocale(undefined), DEFAULT_LOCALE);
  assert.equal(resolveLocale(null), DEFAULT_LOCALE);
  assert.equal(resolveLocale("ru-RU"), "ru-RU");
  assert.equal(resolveLocale("uz-Cyrl-UZ"), "uz-Cyrl-UZ");
  assert.equal(resolveLocale("en-US"), DEFAULT_LOCALE);
});

test("translate: returns localized values and interpolates params", () => {
  const ru = translate("ru-RU", "footer.rights", { year: 2026 });
  const uz = translate("uz-Cyrl-UZ", "footer.rights", { year: 2026 });

  assert.match(ru, /2026/);
  assert.match(uz, /2026/);
  assert.notEqual(ru, uz);
});

test("translate: fallback to ru when uz key is missing", () => {
  const uz = messages["uz-Cyrl-UZ"] as unknown as { authForm: { requestError?: string } };
  const backup = uz.authForm.requestError;

  delete uz.authForm.requestError;
  const result = translate("uz-Cyrl-UZ", "authForm.requestError");
  uz.authForm.requestError = backup;

  assert.equal(result, ruMessages.authForm.requestError);
});

test("format helpers: return localized strings without errors", () => {
  const numberRu = formatNumber(1234567, "ru-RU");
  const numberUz = formatNumber(1234567, "uz-Cyrl-UZ");
  const priceRu = formatPrice(12500000, "UZS", "ru-RU");
  const priceUz = formatPrice(12500000, "UZS", "uz-Cyrl-UZ");

  assert.equal(typeof numberRu, "string");
  assert.equal(typeof numberUz, "string");
  assert.equal(typeof priceRu, "string");
  assert.equal(typeof priceUz, "string");
  assert.match(numberRu, /\d/);
  assert.match(numberUz, /\d/);

  assert.equal(formatDateTime("invalid-date", "ru-RU"), "-");
});

test("spec labels: localized ru/uz and fallback", () => {
  assert.equal(formatSpecLabel("storage_gb", "ru-RU"), "Встроенная память");
  assert.equal(formatSpecLabel("storage_gb", "uz-Cyrl-UZ"), "Ички хотира");
  assert.equal(formatSpecLabel("unknown_spec_key", "uz-Cyrl-UZ"), "unknown spec key");
});
