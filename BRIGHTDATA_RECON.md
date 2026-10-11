# Bright Data recon — PayCrew

Run 2026-10-10 ~16:00 PT on one real vendor (Grainger). Raw responses: `recon/brightdata/*.json`. Script: `recon/smoke_bd.py`, `recon/poll_bd.py`.
Builds on the verified endpoints in `~/Desktop/talktouser/RECON.md` (same account, zones `serp_api1`, `mcp_unlocker`, `mcp_browser`).

## Dataset IDs (from `GET /datasets/list`, 1,857 datasets)
| Source | Dataset | Input | Sync result | Fields we use |
|---|---|---|---|---|
| Crunchbase | `gd_l1vijqt9jfj7olije` | `{url}` (crunchbase.com/organization/<slug>) | 202 → snapshot ready ~60s | name, website, operating_status, num_employees, founded_date, contact_phone, address, legal_name |
| Trustpilot | `gd_lm5zmhwd2sni130p` | `{url}` (trustpilot.com/review/<domain>) | 202 → snapshot ~60s, **one row per review (160 rows, 490 KB)** | company_overall_rating, company_total_reviews, company_website, review_content (keyword scan only: scam/fraud/impersonat/phishing/fake invoice) |
| Indeed company | `gd_l7qekxkv2i7ve6hx1s` | `{url}` (indeed.com/cmp/<Name>) | 202 → snapshot ~60s | name, website, headquarters, company_size, jobs_count |
| LinkedIn company | `gd_l1vikfnt1wgvvqz95w` | `{url}` | 200 in 2.5s | name, website, founded, employees_in_linkedin, headquarters |
| Google Maps | `gd_m8ebnr0q2qlklc02fz` | `{url}` or discover_by=location `{country,lat,long,zoom_level,keyword}` | discover ~57s | name, address, phone, category, rating, reviews_count, open_website |
| Amazon search | `gd_lwdb4vjm1ehb499uxs` | `{keyword, url:"https://www.amazon.com", pages_to_search:1}` | 200 in 6.7s | name, final_price, currency, url |
| Walmart products | `gd_l95fol7l1ru6rlo116` | discover_by=keyword `{keyword, domain:"https://www.walmart.com"}` (`domain` required — first try 400) | see poll log | name, final_price, url |
| Business Search | `POST /search/company` `source: linkedin_company` | `{query}` | 200 in 1.3s | documents[].data: name, url, website, about, headquarters |
| SERP | `POST /request` zone `serp_api1`, `brd_json=1` | Google URL | 200 in 3.3s | organic[].link/title/description |
| Web Unlocker | `POST /request` zone `mcp_unlocker`, `data_format: markdown` | page URL | grainger.com contact page: **200 + empty body after 83s** (bot wall / rate limit) → retry with `render:true`; fallback = SERP snippet phone + Maps phone |

## Findings that change the design
1. **Never resolve an entity by slug/name.** `crunchbase.com/organization/grainger` = *Grainger plc* (UK landlord, graingerplc.co.uk, +44 phone). `linkedin.com/company/grainger` = a Ukrainian company. The correct LinkedIn is `w.w.-grainger`, found via SERP and Business Search. → `findOfficialDomain` (SERP) runs first; every other source is accepted only if its `website` domain == official_domain (else `match: mismatch`, "different company with the same name").
2. **Big real vendor, terrible Trustpilot:** Grainger = 1.5★ / 263 reviews (reviews are about ads/shipping). This is the tricky_real case: reputation may lower the score but **must never alone produce very_low/red**.
3. **Crunchbase/Trustpilot/Indeed take ~60s** (async snapshot). Web Verifier triggers them in parallel, polls, and the Risk Judge proceeds with whatever has landed by a 90s deadline (late sources = "pending", not "not found"). Cache makes demo instant.
4. Trustpilot returns full review text with reviewer names → we store only rating, count, and keyword-hit counts + the review_url of hits (no reviewer identity).
5. Account rate limit (~20 req/min, `x-brd-err-code: client_10110` with HTTP 200 + empty body) → client concurrency 4, backoff, cache by (source, query, date).

## Usage this recon
serp 1, unlocker 2, business_search 1, scraper: crunchbase 1, trustpilot 1, indeed 1, linkedin 1, amazon 1, walmart 2, progress/snapshot polls ~6.
