type PublicFontVariable = {
  variable: string;
};

// Keep public layouts independent from build-time Google Fonts downloads.
export const publicInter: PublicFontVariable = {
  variable: "font-inter-fallback"
};

export const publicMontserrat: PublicFontVariable = {
  variable: "font-montserrat-fallback"
};
