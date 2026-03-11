import { getActiveClientLocale } from "../i18n/locale.ts";
import type { Locale } from "../i18n/types.ts";
const SPEC_KEY_ALIASES: Record<string, string> = {
  storage: "storage_gb",
  "storage gb": "storage_gb",
  built_in_memory: "storage_gb",
  "built in memory": "storage_gb",
  "встроенная память": "storage_gb",
  "встроенная_память": "storage_gb",
  "объем встроенной памяти": "storage_gb",
  "объем_встроенной_памяти": "storage_gb",

  ram: "ram_gb",
  "ram gb": "ram_gb",
  "оперативная память": "ram_gb",
  "оперативная_память": "ram_gb",

  battery: "battery_mah",
  "battery mah": "battery_mah",
  "емкость аккумулятора": "battery_mah",
  "емкость_аккумулятора": "battery_mah",

  camera: "camera_mp",
  "camera mp": "camera_mp",
  "main camera": "main_camera_mp",
  "front camera": "front_camera_mp",
  "основная камера": "main_camera_mp",
  "фронтальная камера": "front_camera_mp",

  display: "display_inches",
  "display inches": "display_inches",
  "screen inches": "display_inches",
  "диагональ экрана": "display_inches",
  "диагональ_экрана": "display_inches",

  "cpu frequency": "cpu_frequency_mhz",
  "частота процессора": "cpu_frequency_mhz",
  "частота_процессора": "cpu_frequency_mhz",

  "refresh rate": "refresh_rate_hz",
  "refresh rate hz": "refresh_rate_hz",
  "частота обновления экрана": "refresh_rate_hz",
  "частота_обновления_экрана": "refresh_rate_hz",

  wifi: "wifi_standard",
  "wi fi": "wifi_standard",
  bluetooth: "bluetooth_standard",

  "operating system": "os",
  "операционная система": "os",
  "версия ос на начало продаж": "os",
  "версия_ос_на_начало_продаж": "os",

  "тип sim карты": "sim_count",
  "тип_sim_карты": "sim_count",
  "количество sim карт": "sim_count",
  "количество_sim_карт": "sim_count",

  "тип устройства": "device_type",
  "тип_устройства": "device_type",

  "стандарты связи": "network_standard",
  "стандарт связи": "network_standard",
  "сеть": "network_standard",

  "разъем зарядки": "charging_connector",
  "разъём зарядки": "charging_connector",
  "разъем_зарядки": "charging_connector",
  "разъём_зарядки": "charging_connector",

  "выход на наушники": "headphone_connector",
  "выход_на_наушники": "headphone_connector",
  "разъем для наушников": "headphone_connector",
  "разъем_для_наушников": "headphone_connector",

  "беспроводные интерфейсы": "wireless_interfaces",
  "беспроводные_интерфейсы": "wireless_interfaces",
  "геопозиционирование": "gps",

  "процессор": "cpu",
  "цвет": "color",

  code: "code",
  "код": "code",
  article: "code",
  sku: "code"
};

const SPEC_KEY_ALIASES_RUNTIME: Record<string, string> = {
  sim_type_card: "sim_count",
  sim_type: "sim_count",
  sim: "sim_count",
  headphone_output: "headphone_connector",
  headphone_jack: "headphone_connector",
  headset_jack: "headphone_connector"
};


const SPEC_LABELS_RU: Record<string, string> = {
  price_min: "Минимальная цена",
  price_max: "Максимальная цена",
  store_count: "Количество магазинов",

  storage_gb: "Встроенная память",
  ram_gb: "Оперативная память",
  virtual_ram_gb: "Виртуальная оперативная память",
  battery_mah: "Емкость аккумулятора",
  camera_mp: "Камера",
  main_camera_mp: "Основная камера",
  front_camera_mp: "Фронтальная камера",
  display_inches: "Диагональ экрана",
  refresh_rate_hz: "Частота обновления экрана",
  cpu_frequency_mhz: "Частота процессора",
  wifi_standard: "Стандарт Wi-Fi",
  bluetooth_standard: "Стандарт Bluetooth",
  os: "Операционная система",
  network_standard: "Стандарты связи",
  cpu: "Процессор",
  gpu: "Графический процессор",
  device_type: "Тип устройства",
  color: "Цвет",
  sim_type: "Тип SIM-карты",
  sim_count: "Количество SIM-карт",
  screen_resolution: "Разрешение экрана",
  charging_connector: "Разъем зарядки",
  dimensions_mm: "Габариты",
  weight_g: "Вес",
  display_matrix_type: "Тип матрицы экрана",
  charging_power_w: "Мощность зарядки",
  charging_features: "Функции зарядки",
  unlock_type: "Тип разблокировки",
  body_material: "Материал корпуса",
  frame_material: "Материал рамки",
  camera_count: "Количество камер",
  camera_features: "Характеристики камеры",
  gps: "Геопозиционирование",
  headphone_connector: "Выход на наушники",
  wireless_interfaces: "Беспроводные интерфейсы"
};

const SPEC_LABELS_UZ: Record<string, string> = {
  price_min: "Энг паст нарх",
  price_max: "Энг юқори нарх",
  store_count: "Дўконлар сони",

  storage_gb: "Ички хотира",
  ram_gb: "Оператив хотира",
  virtual_ram_gb: "Виртуал оператив хотира",
  battery_mah: "Батарея сиғими",
  camera_mp: "Камера",
  main_camera_mp: "Асосий камера",
  front_camera_mp: "Олд камера",
  display_inches: "Экран диагонали",
  refresh_rate_hz: "Янгиланиш частотаси",
  cpu_frequency_mhz: "Процессор частотаси",
  wifi_standard: "Wi-Fi стандарти",
  bluetooth_standard: "Bluetooth стандарти",
  os: "Операцион тизим",
  network_standard: "Алоқа стандартлари",
  cpu: "Процессор",
  gpu: "График процессор",
  device_type: "Қурилма тури",
  color: "Ранг",
  sim_type: "SIM-карта тури",
  sim_count: "SIM-карталар сони",
  screen_resolution: "Экран ўлчами",
  charging_connector: "Зарядлаш порти",
  dimensions_mm: "Ўлчамлар",
  weight_g: "Оғирлик",
  display_matrix_type: "Экран матрицаси тури",
  charging_power_w: "Зарядлаш қуввати",
  charging_features: "Зарядлаш хусусиятлари",
  unlock_type: "Қулфдан чиқариш тури",
  body_material: "Корпус материали",
  frame_material: "Рамка материали",
  camera_count: "Камералар сони",
  camera_features: "Камера хусусиятлари",
  gps: "Геолокация",
  headphone_connector: "Қулоқчин чиқиши",
  wireless_interfaces: "Симсиз интерфейслар"
};

const PLACEHOLDER_VALUES = new Set(["", "-", "--", "—", "n/a", "na", "none", "null", "unknown", "not specified", "не указано"]);
const HIDDEN_SPEC_KEYS = new Set(["code", "код"]);
const MEMORY_KEYS = new Set(["ram_gb", "storage_gb"]);

const normalizeWhitespace = (value: string) => value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();

const normalizeUsbTypeC = (value: string): string => {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return normalized;
  if (/(?:usb\s*(?:type)?\s*-?\s*c|type\s*-?\s*c)/i.test(normalized)) {
    return "USB Type-C";
  }
  return normalized;
};

const normalizeDeviceType = (value: string): string => {
  const normalized = normalizeWhitespace(value);
  const lower = normalized.toLowerCase();
  if (lower === "smartphone" || lower === "смартфон") return "Smartphone";
  return normalized;
};

const normalizeSimValue = (value: string): string => {
  const normalized = normalizeWhitespace(value);
  const lower = normalized.toLowerCase();

  const hasNanoSim = /nano\s*-?\s*sim|nanosim/.test(lower);
  const hasESim = /\be\s*-?\s*sim\b|\besim\b/.test(lower);
  const hasDualSim = /dual\s*sim|2\s*sim|две\s*sim|2\s*карты|2\s*сим/.test(lower);

  if (hasNanoSim && hasESim) return "Nano-SIM + eSIM";
  if (hasDualSim) return "Dual SIM";
  if (hasNanoSim) return "Nano-SIM";
  if (hasESim) return "eSIM";
  return normalized;
};

const normalizeNetworkValue = (value: string): string => {
  const normalized = normalizeWhitespace(value);
  const lower = normalized.toLowerCase();

  const ordered: Array<[RegExp, string]> = [
    [/\b2g\b/i, "2G"],
    [/\b3g\b/i, "3G"],
    [/\b4g\b/i, "4G"],
    [/\blte\b/i, "LTE"],
    [/\b5g\b/i, "5G"],
    [/\b6g\b/i, "6G"]
  ];

  const values = ordered.filter(([pattern]) => pattern.test(lower)).map(([, label]) => label);
  if (!values.length) return normalized;
  return values.join(", ");
};

const normalizeWifiValue = (value: string): string => {
  const normalized = normalizeWhitespace(value);
  const lower = normalized.toLowerCase();

  const wifiGenMatch = lower.match(/wi[\s-]?fi\s*([4-7])/i);
  const wifiGeneration = wifiGenMatch ? `Wi-Fi ${wifiGenMatch[1]}` : null;

  const order = ["a", "b", "g", "n", "ac", "ax", "be"];
  const allowed = new Set(order);
  const tokens: string[] = [];
  const tokenRegex = /802\.11\s*([a-z0-9/\s,.-]+)/gi;
  for (const match of lower.matchAll(tokenRegex)) {
    const chunk = String(match[1] ?? "").toLowerCase();
    for (const rawToken of chunk.split(/[/,\s.-]+/g)) {
      const token = rawToken.trim().toLowerCase();
      if (!allowed.has(token) || tokens.includes(token)) continue;
      tokens.push(token);
    }
  }

  const compactRegex = /802\.11([a-z]{1,2})/gi;
  for (const match of lower.matchAll(compactRegex)) {
    const token = String(match[1] ?? "").toLowerCase();
    if (!allowed.has(token) || tokens.includes(token)) continue;
    tokens.push(token);
  }

  const orderedTokens = order.filter((token) => tokens.includes(token));

  if (!wifiGeneration && !orderedTokens.length) return normalized;
  if (wifiGeneration && orderedTokens.length) return `${wifiGeneration} 802.11 ${orderedTokens.join("/")}`;
  if (wifiGeneration) return wifiGeneration;
  return `802.11 ${orderedTokens.join("/")}`;
};

const normalizeChargingPowerValue = (value: string): string => {
  const normalized = normalizeWhitespace(value);
  const match = normalized.match(/(\d{1,4}(?:[.,]\d+)?)\s*(?:w|вт)/i);
  if (!match) return normalized;
  const power = (match[1] ?? "").replace(",", ".");
  return power ? `${power} Вт` : normalized;
};

const normalizeValueByKey = (key: string, value: string): string => {
  if (key === "device_type") return normalizeDeviceType(value);
  if (key === "sim_count" || key === "sim_type") return normalizeSimValue(value);
  if (key === "network_standard" || key === "network") return normalizeNetworkValue(value);
  if (key === "wifi_standard") return normalizeWifiValue(value);
  if (key === "charging_power_w") return normalizeChargingPowerValue(value);
  if (key === "charging_connector" || key === "headphone_connector") return normalizeUsbTypeC(value);
  return normalizeWhitespace(value);
};

const normalizeSpecEntries = (key: string, value: string): Array<{ key: string; value: string }> => {
  if (key !== "charging_connector") {
    return [{ key, value: normalizeValueByKey(key, value) }];
  }

  const normalized = normalizeWhitespace(value);
  const lower = normalized.toLowerCase();
  const entries: Array<{ key: string; value: string }> = [];

  const chargingPower = normalizeChargingPowerValue(normalized);
  if (/(\d{1,4}(?:[.,]\d+)?)\s*(?:w|вт)/i.test(normalized)) {
    entries.push({ key: "charging_power_w", value: chargingPower });
  }

  if (/беспровод|wireless|qi|magsafe/i.test(lower)) {
    entries.push({ key: "charging_features", value: "Беспроводная зарядка" });
  }

  const usbTypeC = normalizeUsbTypeC(normalized);
  if (usbTypeC === "USB Type-C") {
    entries.push({ key: "charging_connector", value: usbTypeC });
  }

  if (!entries.length) {
    entries.push({ key: "charging_connector", value: normalizeValueByKey("charging_connector", normalized) });
  }

  const deduplicated = new Map<string, string>();
  for (const entry of entries) {
    deduplicated.set(`${entry.key}:${entry.value}`, entry.value);
  }

  return Array.from(deduplicated.keys()).map((entryKey) => {
    const [entrySpecKey = ""] = entryKey.split(":", 1);
    return { key: entrySpecKey, value: deduplicated.get(entryKey) ?? "" };
  });
};

export const normalizeSpecKey = (value: string): string => {
  const normalized = normalizeWhitespace(value.toLowerCase())
    .replace(/[_/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";

  const alias = SPEC_KEY_ALIASES[normalized] ?? normalized;
  const snake = alias
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  if (!snake) return "";

  const canonical = SPEC_KEY_ALIASES[snake] ?? snake;
  return SPEC_KEY_ALIASES_RUNTIME[canonical] ?? canonical;
};

const normalizeSpecValueToString = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value === "string") {
    const normalized = normalizeWhitespace(value);
    return normalized || null;
  }
  if (Array.isArray(value)) {
    const parts = value.map((item) => normalizeSpecValueToString(item)).filter((item): item is string => Boolean(item));
    if (!parts.length) return null;
    return Array.from(new Set(parts)).join(", ");
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => {
        const normalized = normalizeSpecValueToString(item);
        if (!normalized) return null;
        const safeKey = normalizeWhitespace(key);
        return safeKey ? `${safeKey}: ${normalized}` : normalized;
      })
      .filter((item): item is string => Boolean(item));
    return entries.length ? entries.join("; ") : null;
  }
  return normalizeWhitespace(String(value));
};

const isPlaceholder = (value: string) => PLACEHOLDER_VALUES.has(value.toLowerCase());

const parseNumber = (value: string): number | null => {
  const match = normalizeWhitespace(value).replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
};

const tokenCount = (value: string): number =>
  normalizeWhitespace(value)
    .split(/[,/|+]+/)
    .map((item) => item.trim())
    .filter(Boolean).length;

const pickPreferredValue = (key: string, current: string | undefined, candidate: string): string => {
  if (!current) return candidate;
  if (isPlaceholder(current) && !isPlaceholder(candidate)) return candidate;
  if (isPlaceholder(candidate)) return current;

  if (MEMORY_KEYS.has(key)) {
    const currentNumeric = parseNumber(current);
    const candidateNumeric = parseNumber(candidate);
    if (currentNumeric !== null && candidateNumeric !== null) {
      if (currentNumeric <= 0 && candidateNumeric > 0) return candidate;
      if (candidateNumeric <= 0 && currentNumeric > 0) return current;
    }
  }

  if (["network_standard", "wifi_standard", "sim_count"].includes(key)) {
    const currentTokens = tokenCount(current);
    const candidateTokens = tokenCount(candidate);
    if (candidateTokens > currentTokens) return candidate;
  }

  const currentDigits = (current.match(/\d/g) ?? []).length;
  const candidateDigits = (candidate.match(/\d/g) ?? []).length;
  if (candidateDigits > currentDigits) return candidate;
  if (candidate.length > current.length) return candidate;
  return current;
};

export const normalizeSpecsMap = (specs: Record<string, unknown> | null | undefined): Record<string, string> => {
  if (!specs) return {};

  const normalized: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(specs)) {
    const key = normalizeSpecKey(rawKey);
    if (!key || HIDDEN_SPEC_KEYS.has(key)) continue;

    const value = normalizeSpecValueToString(rawValue);
    if (!value) continue;

    for (const normalizedEntry of normalizeSpecEntries(key, value)) {
      const entryKey = normalizeSpecKey(normalizedEntry.key);
      if (!entryKey || HIDDEN_SPEC_KEYS.has(entryKey)) continue;

      const entryValue = normalizeValueByKey(entryKey, normalizedEntry.value);
      if (!entryValue || isPlaceholder(entryValue)) continue;

      normalized[entryKey] = pickPreferredValue(entryKey, normalized[entryKey], entryValue);
    }
  }
  return normalized;
};

export const isMeaningfulSpecValue = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return normalizeWhitespace(value) !== "" && !isPlaceholder(normalizeWhitespace(value));
  return true;
};

export const formatSpecLabel = (normalizedKey: string, locale: Locale = getActiveClientLocale()): string => {
  const localized = locale === "uz-Cyrl-UZ" ? SPEC_LABELS_UZ[normalizedKey] : SPEC_LABELS_RU[normalizedKey];
  if (localized) return localized;

  const fallback = SPEC_LABELS_RU[normalizedKey];
  return fallback ?? normalizedKey.replace(/_/g, " ");
};




