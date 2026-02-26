# EK.UA Parity Matrix (Implemented / Partial / Missing)

Updated: 2026-02-26  
Source audit: `docs/EK_UA_FUNCTIONALITY_FULL_AUDIT.md`

## Status Legend

- `implemented`: production-ready baseline exists in current project.
- `partial`: baseline exists, but major functionality from EK.UA is still missing.
- `missing`: no equivalent implementation in current project.

## Parity Matrix

| Feature block (from audit) | Parity status | Current project evidence | Tracked task |
| --- | --- | --- | --- |
| Global navigation (search/categories/auth/public pages) | implemented | Global search + category nav + auth + home/catalog/PDP flows are implemented | - |
| Catalog listing with filters/sort/pagination | implemented | Catalog filters + sorting + pagination + sticky filters are implemented | - |
| PDP core (offers/specs/buy CTA) | implemented | PDP offers table, specs blocks, buy CTA, availability/price labels | - |
| Price alerts (price drop/stock) | implemented | API + worker delivery (`telegram`/`email`) and client hydration are implemented | - |
| Product comparison matrix | implemented | Compare page supports matrix, search by characteristic, key-spec mode, share links | - |
| Reviews and Q&A baseline | partial | Basic reviews/questions/answers + moderation statuses + votes/report/pin baseline | `PARITY-01` |
| Discussions/forum extension | missing | Category-level forum and threaded discussion parity is not implemented | `PARITY-01` |
| Category ratings and analytic ranking pages | partial | Home has category pulse/popular blocks, but no full ranking methodology pages/charts | `PARITY-02` |
| Popular requests deep filter scenarios | partial | Shortcut blocks exist, but no dedicated intent pages with full filter combinations | `PARITY-03` |
| Encyclopedia/descriptions section | partial | Guide/editorial blocks exist, but no dedicated brand-model encyclopedia tree | `PARITY-04` |
| Editorial content hub and article pages | partial | Home editorial cards exist, but no full article listing/detail CMS flow | `PARITY-05` |
| Brands catalog and brand pages | partial | Brand support exists in catalog filters, but no dedicated A-Z brands directory pages | `PARITY-06` |
| Personalization lists (favorites/history/my lists) | partial | Favorites/history baseline exists; advanced named-list workflows are limited | `PARITY-07` |
| B2B store cabinet and ad tools | partial | Public B2B page `/for-shops` with tariff/placement baseline exists; merchant cabinet and ad tooling are still missing | `PARITY-08` |
| Legal/storefront compliance pages | implemented | Public pages `/privacy`, `/terms`, `/cookies`, `/contacts`, `/status` and footer links are implemented | `PARITY-09 (done)` |

## Converted Missing/Partial Blocks into Tracked Dev Tasks

1. `PARITY-01`: Reviews/Q&A/discussions extension  
Scope: threaded discussions, category/forum feed, moderation queue UX, search/filter by unresolved questions.
2. `PARITY-02`: Category ratings parity  
Scope: dedicated ranking page, methodology section, top-N list with paging, parameter slices/charts.
3. `PARITY-03`: Popular requests parity  
Scope: intent pages with persisted filter presets and SEO-friendly routes.
4. `PARITY-04`: Encyclopedia/descriptions parity  
Scope: category knowledge pages with brand-model reference trees and buying glossary.
5. `PARITY-05`: Editorial hub parity  
Scope: article list/detail pages, author/date/read-time metadata, cross-link product cards.
6. `PARITY-06`: Brands catalog parity  
Scope: A-Z brand index + brand landing pages with category/model counters.
7. `PARITY-07`: Personal lists parity  
Scope: named lists, save-search/list states, list sharing/export baseline.
8. `PARITY-08`: B2B cabinet and ad tooling  
Scope: merchant onboarding flow, tariff pages, click stats, placement/bid controls, ads surfaces.
9. `PARITY-09`: Legal/compliance storefront baseline  
Scope: public privacy/terms/cookie/contact/status pages and footer linkage.
