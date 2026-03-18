export type FilterType = "checkbox" | "range" | "toggle";

export type FilterOption = {
  value: string;
  label: string;
};

export interface FilterGroup {
  key: string;
  label: string;
  type: FilterType;
  options?: FilterOption[];
  min?: number;
  max?: number;
  unit?: string;
}

export const DEFAULT_VISIBLE_CHECKBOX_OPTIONS = 6;

export const COMMON_FILTER_KEYS = [
  "price",
  "brand",
  "shop",
  "delivery_days",
  "in_stock",
  "has_discount",
  "min_rating",
] as const;

export const COMMON_DELIVERY_OPTIONS: FilterOption[] = [
  { value: "today", label: "Бугун" },
  { value: "days_1_3", label: "1-3 кун" },
  { value: "week", label: "Ҳафта ичида" },
];

export const COMMON_MIN_RATING_OPTIONS: FilterOption[] = [
  { value: "4", label: "★4 дан юқори" },
  { value: "3", label: "★3 дан юқори" },
];

export const CATEGORY_FILTERS: Record<string, FilterGroup[]> = {
  smartphones: [
    {
      key: "os",
      label: "Операцион тизим",
      type: "checkbox",
      options: [
        { value: "android", label: "Android" },
        { value: "ios", label: "iOS" },
        { value: "harmonyos", label: "HarmonyOS" },
      ],
    },
    {
      key: "cpu",
      label: "Процессор",
      type: "checkbox",
      options: [
        { value: "apple_a_series", label: "Apple A-series" },
        { value: "snapdragon_8_gen", label: "Snapdragon 8 Gen" },
        { value: "dimensity_9000_plus", label: "Dimensity 9000+" },
        { value: "exynos", label: "Exynos" },
        { value: "kirin", label: "Kirin" },
      ],
    },
    {
      key: "ram",
      label: "Оператив хотира",
      type: "checkbox",
      options: [
        { value: "4", label: "4 ГБ" },
        { value: "6", label: "6 ГБ" },
        { value: "8", label: "8 ГБ" },
        { value: "12", label: "12 ГБ" },
        { value: "16_plus", label: "16+ ГБ" },
      ],
    },
    {
      key: "storage",
      label: "Доимий хотира",
      type: "checkbox",
      options: [
        { value: "64", label: "64 ГБ" },
        { value: "128", label: "128 ГБ" },
        { value: "256", label: "256 ГБ" },
        { value: "512", label: "512 ГБ" },
        { value: "1_tb", label: "1 ТБ" },
      ],
    },
    { key: "screen_size", label: "Экран ўлчами", type: "range", min: 4.5, max: 7.5, unit: "\"" },
    {
      key: "screen_hz",
      label: "Янгиланиш частотаси",
      type: "checkbox",
      options: [
        { value: "60", label: "60 Гц" },
        { value: "90", label: "90 Гц" },
        { value: "120", label: "120 Гц" },
        { value: "144_plus", label: "144+ Гц" },
      ],
    },
    {
      key: "screen_type",
      label: "Экран тури",
      type: "checkbox",
      options: [
        { value: "oled", label: "OLED" },
        { value: "amoled", label: "AMOLED" },
        { value: "ips", label: "IPS" },
        { value: "ltpo", label: "LTPO" },
      ],
    },
    { key: "camera_mp", label: "Камера", type: "range", min: 8, max: 200, unit: "Мп" },
    { key: "battery", label: "Батарея", type: "range", min: 2000, max: 7000, unit: "мАч" },
    { key: "has_5g", label: "5G бор", type: "toggle" },
    { key: "has_nfc", label: "NFC бор", type: "toggle" },
    { key: "has_wireless_charge", label: "Симсиз қувватлаш", type: "toggle" },
  ],
  laptops: [
    {
      key: "cpu",
      label: "Процессор",
      type: "checkbox",
      options: [
        { value: "intel_i3", label: "Intel i3" },
        { value: "intel_i5", label: "Intel i5" },
        { value: "intel_i7", label: "Intel i7" },
        { value: "intel_i9", label: "Intel i9" },
        { value: "ryzen_5", label: "AMD Ryzen 5" },
        { value: "ryzen_7", label: "AMD Ryzen 7" },
        { value: "ryzen_9", label: "AMD Ryzen 9" },
        { value: "apple_m", label: "Apple M" },
      ],
    },
    {
      key: "ram",
      label: "Оператив хотира",
      type: "checkbox",
      options: [
        { value: "8", label: "8 ГБ" },
        { value: "16", label: "16 ГБ" },
        { value: "32", label: "32 ГБ" },
        { value: "64_plus", label: "64+ ГБ" },
      ],
    },
    {
      key: "gpu",
      label: "Видеокарта",
      type: "checkbox",
      options: [
        { value: "integrated", label: "Ички" },
        { value: "nvidia_gtx", label: "NVIDIA GTX" },
        { value: "nvidia_rtx", label: "NVIDIA RTX" },
        { value: "amd_radeon", label: "AMD Radeon" },
      ],
    },
    {
      key: "screen_size",
      label: "Экран ўлчами",
      type: "checkbox",
      options: [
        { value: "13", label: "13\"" },
        { value: "14", label: "14\"" },
        { value: "15_6", label: "15.6\"" },
        { value: "16", label: "16\"" },
        { value: "17_plus", label: "17+\"" },
      ],
    },
    {
      key: "storage_type",
      label: "Хотира тури",
      type: "checkbox",
      options: [
        { value: "ssd", label: "SSD" },
        { value: "hdd", label: "HDD" },
        { value: "ssd_hdd", label: "SSD + HDD" },
      ],
    },
    {
      key: "storage_size",
      label: "Хотира ҳажми",
      type: "checkbox",
      options: [
        { value: "256_gb", label: "256 ГБ" },
        { value: "512_gb", label: "512 ГБ" },
        { value: "1_tb", label: "1 ТБ" },
        { value: "2_tb_plus", label: "2 ТБ+" },
      ],
    },
    {
      key: "os",
      label: "Операцион тизим",
      type: "checkbox",
      options: [
        { value: "windows_11", label: "Windows 11" },
        { value: "macos", label: "macOS" },
        { value: "linux", label: "Linux" },
        { value: "no_os", label: "ОСсиз" },
      ],
    },
    {
      key: "resolution",
      label: "Ечимлилик",
      type: "checkbox",
      options: [
        { value: "full_hd", label: "Full HD" },
        { value: "qhd_2k", label: "2K QHD" },
        { value: "4k", label: "4K" },
        { value: "retina", label: "Retina" },
      ],
    },
    {
      key: "screen_hz",
      label: "Янгиланиш частотаси",
      type: "checkbox",
      options: [
        { value: "60", label: "60 Гц" },
        { value: "90", label: "90 Гц" },
        { value: "120", label: "120 Гц" },
        { value: "144_plus", label: "144+ Гц" },
      ],
    },
    {
      key: "purpose",
      label: "Мақсад",
      type: "checkbox",
      options: [
        { value: "study", label: "Ўқиш" },
        { value: "office", label: "Офис" },
        { value: "gaming", label: "Ўйин" },
        { value: "design", label: "Дизайн" },
        { value: "ultrabook", label: "Ультрабук" },
      ],
    },
    { key: "has_touch", label: "Сенсор экран", type: "toggle" },
    { key: "has_backlit_kb", label: "Ёритилган клавиатура", type: "toggle" },
  ],
  tv: [
    { key: "screen_size", label: "Экран ўлчами", type: "range", min: 32, max: 85, unit: "\"" },
    {
      key: "resolution",
      label: "Ечимлилик",
      type: "checkbox",
      options: [
        { value: "hd", label: "HD" },
        { value: "full_hd", label: "Full HD" },
        { value: "4k_uhd", label: "4K UHD" },
        { value: "8k", label: "8K" },
      ],
    },
    {
      key: "matrix_type",
      label: "Матрица тури",
      type: "checkbox",
      options: [
        { value: "oled", label: "OLED" },
        { value: "qled", label: "QLED" },
        { value: "mini_led", label: "Mini-LED" },
        { value: "ips", label: "IPS" },
        { value: "va", label: "VA" },
      ],
    },
    {
      key: "screen_hz",
      label: "Янгиланиш частотаси",
      type: "checkbox",
      options: [
        { value: "50", label: "50 Гц" },
        { value: "60", label: "60 Гц" },
        { value: "100", label: "100 Гц" },
        { value: "120", label: "120 Гц" },
        { value: "144_plus", label: "144+ Гц" },
      ],
    },
    {
      key: "smart_os",
      label: "Smart тизим",
      type: "checkbox",
      options: [
        { value: "android_tv", label: "Android TV" },
        { value: "tizen", label: "Tizen" },
        { value: "webos", label: "webOS" },
        { value: "google_tv", label: "Google TV" },
        { value: "no_smart", label: "Smartсиз" },
      ],
    },
    {
      key: "hdr",
      label: "HDR",
      type: "checkbox",
      options: [
        { value: "hdr10", label: "HDR10" },
        { value: "hdr10_plus", label: "HDR10+" },
        { value: "dolby_vision", label: "Dolby Vision" },
        { value: "hlg", label: "HLG" },
      ],
    },
    { key: "sound_power", label: "Овоз қуввати", type: "range", min: 10, max: 100, unit: "Вт" },
    { key: "has_hdmi21", label: "HDMI 2.1 бор", type: "toggle" },
    { key: "has_game_mode", label: "Game mode бор", type: "toggle" },
    { key: "is_curved", label: "Қийшиқ экран", type: "toggle" },
  ],
  headphones: [
    {
      key: "type",
      label: "Тури",
      type: "checkbox",
      options: [
        { value: "on_ear", label: "Қулоқ усти" },
        { value: "in_ear", label: "Қулоқ ичи" },
        { value: "tws", label: "TWS" },
        { value: "neckband", label: "На шею" },
      ],
    },
    {
      key: "connection",
      label: "Уланиш",
      type: "checkbox",
      options: [
        { value: "bluetooth", label: "Bluetooth" },
        { value: "3_5mm", label: "3.5мм" },
        { value: "usb_c", label: "USB-C" },
        { value: "lightning", label: "Lightning" },
      ],
    },
    {
      key: "bt_version",
      label: "Bluetooth версияси",
      type: "checkbox",
      options: [
        { value: "5_0", label: "5.0" },
        { value: "5_2", label: "5.2" },
        { value: "5_3_plus", label: "5.3+" },
      ],
    },
    { key: "battery_life", label: "Ишлаш вақти", type: "range", min: 0, max: 60, unit: "соат" },
    { key: "has_anc", label: "ANC бор", type: "toggle" },
    { key: "has_mic", label: "Микрофон бор", type: "toggle" },
    {
      key: "waterproof",
      label: "Сувдан ҳимоя",
      type: "checkbox",
      options: [
        { value: "ipx4", label: "IPX4" },
        { value: "ipx5", label: "IPX5" },
        { value: "ipx7_plus", label: "IPX7+" },
      ],
    },
    {
      key: "codec",
      label: "Кодек",
      type: "checkbox",
      options: [
        { value: "aac", label: "AAC" },
        { value: "aptx", label: "aptX" },
        { value: "aptx_hd", label: "aptX HD" },
        { value: "ldac", label: "LDAC" },
        { value: "lhdc", label: "LHDC" },
      ],
    },
    {
      key: "purpose",
      label: "Мақсад",
      type: "checkbox",
      options: [
        { value: "sport", label: "Спорт" },
        { value: "studio", label: "Студия учун" },
        { value: "gaming", label: "Ўйин учун" },
        { value: "daily", label: "Кундалик" },
      ],
    },
  ],
  tablets: [
    {
      key: "os",
      label: "Операцион тизим",
      type: "checkbox",
      options: [
        { value: "android", label: "Android" },
        { value: "ipados", label: "iPadOS" },
        { value: "windows", label: "Windows" },
        { value: "harmonyos", label: "HarmonyOS" },
      ],
    },
    { key: "screen_size", label: "Экран ўлчами", type: "range", min: 7, max: 13, unit: "\"" },
    {
      key: "ram",
      label: "Оператив хотира",
      type: "checkbox",
      options: [
        { value: "4", label: "4 ГБ" },
        { value: "6", label: "6 ГБ" },
        { value: "8", label: "8 ГБ" },
        { value: "12_plus", label: "12+ ГБ" },
      ],
    },
    {
      key: "storage",
      label: "Доимий хотира",
      type: "checkbox",
      options: [
        { value: "64", label: "64 ГБ" },
        { value: "128", label: "128 ГБ" },
        { value: "256", label: "256 ГБ" },
        { value: "512_plus", label: "512+ ГБ" },
      ],
    },
    {
      key: "connectivity",
      label: "Уланиш",
      type: "checkbox",
      options: [
        { value: "wifi_only", label: "Wi-Fi only" },
        { value: "wifi_sim_4g", label: "Wi-Fi + SIM 4G" },
        { value: "wifi_sim_5g", label: "Wi-Fi + SIM 5G" },
      ],
    },
    {
      key: "screen_hz",
      label: "Янгиланиш частотаси",
      type: "checkbox",
      options: [
        { value: "60", label: "60 Гц" },
        { value: "90", label: "90 Гц" },
        { value: "120", label: "120 Гц" },
        { value: "144_plus", label: "144+ Гц" },
      ],
    },
    {
      key: "resolution",
      label: "Ечимлилик",
      type: "checkbox",
      options: [
        { value: "full_hd", label: "Full HD" },
        { value: "2k", label: "2K" },
        { value: "retina_4k", label: "Retina/4K" },
      ],
    },
    { key: "has_stylus", label: "Стилус бор", type: "toggle" },
    { key: "has_keyboard", label: "Клавиатура бор", type: "toggle" },
  ],
  cameras: [
    {
      key: "type",
      label: "Камера тури",
      type: "checkbox",
      options: [
        { value: "dslr", label: "Кўзгули" },
        { value: "mirrorless", label: "Кўзгусиз" },
        { value: "compact", label: "Ихчам" },
        { value: "action", label: "Экшен" },
        { value: "webcam", label: "Веб-камера" },
      ],
    },
    { key: "megapixels", label: "Мегапиксель", type: "range", min: 8, max: 100, unit: "Мп" },
    {
      key: "sensor_size",
      label: "Сенсор ўлчами",
      type: "checkbox",
      options: [
        { value: "1_2_3", label: "1/2.3\"" },
        { value: "micro_4_3", label: "Micro 4/3" },
        { value: "aps_c", label: "APS-C" },
        { value: "full_frame", label: "Full Frame" },
        { value: "medium_format", label: "Medium Format" },
      ],
    },
    {
      key: "video",
      label: "Видео",
      type: "checkbox",
      options: [
        { value: "full_hd", label: "Full HD" },
        { value: "4k", label: "4K" },
        { value: "4k_60fps", label: "4K 60fps" },
        { value: "8k", label: "8K" },
      ],
    },
    {
      key: "mount",
      label: "Байонет",
      type: "checkbox",
      options: [
        { value: "canon_ef_rf", label: "Canon EF/RF" },
        { value: "nikon_f_z", label: "Nikon F/Z" },
        { value: "sony_e", label: "Sony E" },
        { value: "fuji_x", label: "Fuji X" },
        { value: "l_mount", label: "L-mount" },
      ],
    },
    { key: "has_ois", label: "OIS бор", type: "toggle" },
    { key: "has_evf", label: "EVF бор", type: "toggle" },
    { key: "is_weathersealed", label: "Ҳимояланган корпус", type: "toggle" },
    { key: "has_wifi", label: "Wi-Fi бор", type: "toggle" },
  ],
  gaming: [
    {
      key: "device_type",
      label: "Қурилма тури",
      type: "checkbox",
      options: [
        { value: "console", label: "Консоль" },
        { value: "gamepad", label: "Геймпад" },
        { value: "mouse", label: "Сичқонча" },
        { value: "keyboard", label: "Клавиатура" },
        { value: "monitor", label: "Монитор" },
        { value: "headset", label: "Гарнитура" },
      ],
    },
    {
      key: "platform",
      label: "Платформа",
      type: "checkbox",
      options: [
        { value: "ps5", label: "PlayStation 5" },
        { value: "xbox_series", label: "Xbox Series" },
        { value: "nintendo_switch", label: "Nintendo Switch" },
        { value: "pc", label: "PC" },
      ],
    },
    {
      key: "connection",
      label: "Уланиш",
      type: "checkbox",
      options: [
        { value: "wired", label: "Симли" },
        { value: "wireless", label: "Симсиз" },
      ],
    },
    {
      key: "monitor_hz",
      label: "Монитор частотаси",
      type: "checkbox",
      options: [
        { value: "144", label: "144 Гц" },
        { value: "165", label: "165 Гц" },
        { value: "240", label: "240 Гц" },
        { value: "360_plus", label: "360+ Гц" },
      ],
    },
    { key: "monitor_size", label: "Монитор ўлчами", type: "range", min: 21, max: 40, unit: "\"" },
    {
      key: "switch_type",
      label: "Switch тури",
      type: "checkbox",
      options: [
        { value: "mechanical", label: "Механик" },
        { value: "membrane", label: "Мембрана" },
        { value: "optical", label: "Оптик" },
      ],
    },
    { key: "has_rgb", label: "RGB бор", type: "toggle" },
  ],
  accessories: [
    {
      key: "subcategory",
      label: "Қисм категория",
      type: "checkbox",
      options: [
        { value: "chargers", label: "Қувватлагичлар" },
        { value: "cables", label: "Кабеллар" },
        { value: "cases", label: "Ғилофлар" },
        { value: "power_bank", label: "Power Bank" },
        { value: "smart_watches", label: "Ақлли соатлар" },
        { value: "bands", label: "Браслетлар" },
      ],
    },
    {
      key: "compatibility",
      label: "Мослик",
      type: "checkbox",
      options: [
        { value: "apple", label: "Apple" },
        { value: "samsung", label: "Samsung" },
        { value: "xiaomi", label: "Xiaomi" },
        { value: "universal", label: "Универсал" },
      ],
    },
    { key: "charge_power", label: "Қувватлаш қуввати", type: "range", min: 5, max: 240, unit: "Вт" },
    {
      key: "connector",
      label: "Коннектор",
      type: "checkbox",
      options: [
        { value: "usb_c", label: "USB-C" },
        { value: "lightning", label: "Lightning" },
        { value: "micro_usb", label: "Micro-USB" },
        { value: "usb_a", label: "USB-A" },
      ],
    },
  ],
};

export const CATEGORY_FILTER_KEYS = new Set(
  Object.values(CATEGORY_FILTERS).flatMap((groups) => groups.map((group) => group.key)),
);

export const getCategoryFilterGroups = (category?: string | null): FilterGroup[] => {
  if (!category) return [];
  return CATEGORY_FILTERS[category] ?? [];
};

export const getCategoryFilterGroupByKey = (category: string | null | undefined, key: string) =>
  getCategoryFilterGroups(category).find((group) => group.key === key);

export const isKnownCategoryFilterKey = (key: string) => CATEGORY_FILTER_KEYS.has(key);

export const serializeRangeValue = (min: number, max: number) => `${min}-${max}`;

export const parseRangeValue = (value: string): { min: number; max: number } | null => {
  const match = String(value ?? "").trim().match(/^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const left = Number(match[1]);
  const right = Number(match[2]);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  return {
    min: Math.min(left, right),
    max: Math.max(left, right),
  };
};
