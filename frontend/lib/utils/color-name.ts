type Rgb = [number, number, number];

const HEX_COLOR_PATTERN = /^(?:#|0x)?([0-9a-f]{3}|[0-9a-f]{6})$/i;

const EXACT_HEX_NAMES: Record<string, string> = {
  "000000": "Midnight",
  "2D3035": "Graphite",
  "808080": "Graphite Gray",
  "FFFFFF": "Snow White",
};

const COLOR_PALETTE: Array<{ name: string; rgb: Rgb }> = [
  { name: "Midnight", rgb: [0, 0, 0] },
  { name: "Graphite", rgb: [45, 48, 53] },
  { name: "Charcoal", rgb: [54, 69, 79] },
  { name: "Navy", rgb: [27, 42, 73] },
  { name: "Blue", rgb: [0, 102, 204] },
  { name: "Sky Blue", rgb: [77, 166, 255] },
  { name: "Teal", rgb: [0, 128, 128] },
  { name: "Green", rgb: [46, 125, 50] },
  { name: "Lime Green", rgb: [139, 195, 74] },
  { name: "Olive", rgb: [107, 142, 35] },
  { name: "Yellow", rgb: [255, 214, 10] },
  { name: "Amber", rgb: [255, 191, 0] },
  { name: "Orange", rgb: [255, 140, 0] },
  { name: "Coral", rgb: [255, 111, 97] },
  { name: "Red", rgb: [220, 20, 60] },
  { name: "Burgundy", rgb: [128, 0, 32] },
  { name: "Pink", rgb: [236, 64, 122] },
  { name: "Purple", rgb: [126, 87, 194] },
  { name: "Brown", rgb: [121, 85, 72] },
  { name: "Beige", rgb: [210, 180, 140] },
  { name: "Silver", rgb: [192, 192, 192] },
  { name: "Gray", rgb: [128, 128, 128] },
  { name: "White", rgb: [245, 245, 245] },
];

const toTitleCase = (value: string) =>
  value
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const normalizeHex = (value: string): string | null => {
  const raw = value.trim();
  const match = raw.match(HEX_COLOR_PATTERN);
  if (!match?.[1]) return null;
  const token = match[1].toUpperCase();
  if (token.length === 3) {
    return token
      .split("")
      .map((ch) => `${ch}${ch}`)
      .join("");
  }
  return token;
};

const hexToRgb = (hex: string): Rgb => [
  Number.parseInt(hex.slice(0, 2), 16),
  Number.parseInt(hex.slice(2, 4), 16),
  Number.parseInt(hex.slice(4, 6), 16),
];

const distanceSq = (a: Rgb, b: Rgb) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

const nearestColorName = (rgb: Rgb) => {
  if (!COLOR_PALETTE.length) return "Color";

  let nearest = COLOR_PALETTE[0]!;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const item of COLOR_PALETTE) {
    const currentDistance = distanceSq(rgb, item.rgb);
    if (currentDistance < bestDistance) {
      bestDistance = currentDistance;
      nearest = item;
    }
  }
  return nearest.name;
};

export const colorNameFromHex = (value: string): string | null => {
  const normalized = normalizeHex(value);
  if (!normalized) return null;
  const exact = EXACT_HEX_NAMES[normalized];
  if (exact) return exact;
  return nearestColorName(hexToRgb(normalized));
};

export const formatColorValue = (value: string): string => {
  const byHex = colorNameFromHex(value);
  if (byHex) return byHex;
  const normalized = value.trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ").toLowerCase();
  if (!normalized) return "-";
  return toTitleCase(normalized);
};
