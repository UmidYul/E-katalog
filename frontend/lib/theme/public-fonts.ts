import { Inter, Montserrat } from "next/font/google";

export const publicInter = Inter({
  subsets: ["latin", "cyrillic"],
  variable: "--font-inter"
});

export const publicMontserrat = Montserrat({
  subsets: ["latin", "cyrillic"],
  variable: "--font-montserrat"
});
