import type { Config } from "tailwindcss";
import tailwindAnimate from "tailwindcss-animate";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./features/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    "./store/**/*.{ts,tsx}"
  ],
  theme: {
    container: {
      center: true,
      padding: "1rem",
      screens: {
        "2xl": "1280px"
      }
    },
    extend: {
      screens: {
        sm: "640px",
        md: "768px",
        lg: "1024px",
        xl: "1280px"
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        surface: "hsl(var(--surface))",
        accent: {
          DEFAULT: "hsl(var(--accent))",
          hover: "hsl(var(--accent-hover))",
          foreground: "hsl(var(--accent-foreground))"
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))"
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))"
        },
        danger: {
          DEFAULT: "hsl(var(--danger))",
          foreground: "hsl(var(--danger-foreground))"
        },
        destructive: {
          DEFAULT: "hsl(var(--danger))",
          foreground: "hsl(var(--danger-foreground))"
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))"
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))"
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))"
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))"
        }
      },
      borderRadius: {
        sm: "4px",
        md: "8px",
        lg: "12px",
        xl: "16px",
        "2xl": "24px"
      },
      boxShadow: {
        soft: "0 6px 18px -14px hsl(var(--primary) / 0.24)",
        sm: "0 1px 3px rgba(0,0,0,0.06)",
        md: "0 4px 16px rgba(0,0,0,0.08)",
        lg: "0 8px 32px rgba(0,0,0,0.12)"
      },
      fontFamily: {
        sans: ["var(--font-body)", "Inter", "Segoe UI", "system-ui", "sans-serif"],
        heading: ["var(--font-heading)", "Inter", "Segoe UI", "system-ui", "sans-serif"]
      },
      fontSize: {
        "2xs": "12px",
        xs: "14px",
        sm: "14px",
        base: "16px",
        lg: "18px",
        xl: "24px",
        "2xl": "32px",
        "3xl": "48px"
      },
      lineHeight: {
        body: "1.5",
        heading: "1.2"
      },
      maxWidth: {
        container: "1280px"
      },
      keyframes: {
        "marquee-scroll": {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" }
        },
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(20px)" },
          "100%": { opacity: "1", transform: "translateY(0)" }
        },
        "heart-burst": {
          "0%": { transform: "scale(1)" },
          "30%": { transform: "scale(1.35)" },
          "60%": { transform: "scale(0.9)" },
          "100%": { transform: "scale(1)" }
        }
      },
      animation: {
        "marquee-scroll": "marquee-scroll 30s linear infinite",
        "fade-in-up": "fade-in-up 0.4s ease-out both",
        "heart-burst": "heart-burst 0.4s ease-out"
      }
    }
  },
  plugins: [tailwindAnimate]
};

export default config;

