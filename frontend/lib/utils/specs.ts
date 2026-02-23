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

  "тип sim карты": "sim_type",
  "тип_sim_карты": "sim_type",

  "тип устройства": "device_type",
  "тип_устройства": "device_type",

  "процессор": "cpu",
  "цвет": "color"
};

const SPEC_LABELS: Record<string, string> = {
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
  network: "Сеть",
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
  gps: "Геопозиционирование"
};

const PLACEHOLDER_VALUES = new Set(["", "-", "--", "—", "n/a", "na", "none", "null", "unknown", "not specified", "не указано"]);

const normalizeWhitespace = (value: string) => value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();

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
  return SPEC_KEY_ALIASES[snake] ?? snake;
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

const pickPreferredValue = (current: string | undefined, candidate: string): string => {
  if (!current) return candidate;
  if (isPlaceholder(current) && !isPlaceholder(candidate)) return candidate;
  if (isPlaceholder(candidate)) return current;

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
    if (!key) continue;
    const value = normalizeSpecValueToString(rawValue);
    if (!value) continue;
    normalized[key] = pickPreferredValue(normalized[key], value);
  }
  return normalized;
};

export const isMeaningfulSpecValue = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return normalizeWhitespace(value) !== "" && !isPlaceholder(normalizeWhitespace(value));
  return true;
};

export const formatSpecLabel = (normalizedKey: string): string => SPEC_LABELS[normalizedKey] ?? normalizedKey.replace(/_/g, " ");