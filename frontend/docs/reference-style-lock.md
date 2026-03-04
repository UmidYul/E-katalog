# Reference Style Lock (Non-Role Routes)

This document defines immutable visual rules for non-role routes:

- `app/(public)`
- `app/(auth)`
- `app/(account)`

Do not apply this style lock to admin/seller dashboard areas.

## 1. Color Tokens (Light)

Reference source: `reference/app/globals.css`.

- `--background`: `#F5F7FA`
- `--foreground`: `#0F1B2D`
- `--card`: `#FFFFFF`
- `--card-foreground`: `#0F1B2D`
- `--primary`: `#0F1B2D`
- `--primary-foreground`: `#FFFFFF`
- `--secondary`: `#EDF0F5`
- `--secondary-foreground`: `#0F1B2D`
- `--muted`: `#EDF0F5`
- `--muted-foreground`: `#5A6A7E`
- `--accent`: `#FF6B00`
- `--accent-foreground`: `#FFFFFF`
- `--border`: `#DDE3EC`
- `--input`: `#DDE3EC`
- `--ring`: `#FF6B00`

## 2. Typography

- Body font: Inter.
- Heading font: Montserrat.
- Keep font assignment scoped to non-role layouts.
- Preserve current app functionality and semantics.

Target text scale:

- `h1`: 2.25rem-3rem, weight 800.
- `h2`: 1.75rem-2.25rem, weight 700-800.
- `h3`: 1.125rem-1.5rem, weight 700.
- body: 0.875rem-1rem.
- small/meta: 0.75rem.

## 3. Shape, Border, Shadow

- Radius baseline: ~12px (`rounded-xl` / `rounded-2xl` where appropriate).
- Border color uses `--border`.
- Soft elevation style for cards and panels (`shadow-soft`).
- Hover states: subtle lift, border tint, and shadow increase.

## 4. Layout Rhythm

- Main content container: `max-w-7xl`.
- Section spacing: consistent vertical rhythm (`py-8`, `py-10`, `py-12` depending on section role).
- Components should align to the same horizontal grid.

## 5. Motion

- Keep transitions short and meaningful.
- Card hover lift and opacity changes are allowed.
- Slider/carousel timing should stay near reference behavior.

## 6. Component Patterns

Use reference-like patterns for:

- Header (top service strip + navigation + search area behavior by breakpoint).
- Footer (column links + legal/social/payment strip style).
- Cards, badges, tabs, filters.
- CTA blocks, info blocks, and content sections.

## 7. Scope Guardrails

- Keep API contracts unchanged.
- Keep route behavior and state logic unchanged.
- Do not replace existing brand assets (`public/*`) unless explicitly requested.
- Theme isolation is done through `.public-theme` wrappers in non-role layouts.
