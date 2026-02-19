export const formatPrice = (value: number, currency: string = "UZS") =>
  new Intl.NumberFormat("uz-UZ", {
    style: "currency",
    currency,
    maximumFractionDigits: 0
  }).format(value);

export const debounceMs = {
  search: 300,
  filters: 200
} as const;

