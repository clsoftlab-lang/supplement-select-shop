# 메딕스 Medix — Supplement Select-Shop (Demo)

**한국어 문서: [README.ko.md](./README.ko.md)**

A curated supplement/vitamin **select-shop** SPA that recommends products per customer,
built as a **no-build static site** (plain HTML + CSS + ES-module JS). It runs entirely
in the browser in **demo mode** and deploys to GitHub Pages.

**🔗 LIVE DEMO: https://clsoftlab-lang.github.io/supplement-select-shop/**

---

## ⚕️ Health disclaimer (read first)

**This is NOT medical advice.** Medix is a rule-based demo. Products, brands, ingredient
amounts, and reviews are **fictional** and for demonstration only. Nothing here diagnoses,
treats, or prevents any condition. **Always consult a qualified professional (doctor or
pharmacist) before taking any supplement**, especially if pregnant, nursing, on medication,
or managing a health condition.

---

## What it is

Medix helps a shopper browse a supplement catalog, get a **personalized stack** from a short
survey, and **check their cart for ingredient overlaps, over-dosing, and interactions** —
all with transparent, explainable rules.

## Features

- **Catalog** — filter by purpose (면역·피로·수면·관절·눈·장건강), brand, and price; search
  by product/brand/ingredient; sort by 추천/가격/평점.
- **Product detail** — ingredients & amounts with **% of daily recommended amount gauges**,
  usage, cautions, and reviews.
- **Personalized survey** — age, gender, goals, and what you already take → a recommended
  stack **with a reason for every pick**.
- **Ingredient overlap / interaction checker** — the cart is analyzed live for duplicated
  ingredients, amounts over the upper limit, and known interaction pairs.
- **Subscription (simulated)** — 15% discount toggle.
- **Cart + simulated checkout** — quantities, totals, mock order confirmation.
- **Wishlist (찜)** and **My routine** — schedule products across 아침/점심/저녁.
- **Extras** — daily-recommended gauges, **budget-aware** recommendation, **large-text**
  option, light/dark theme, one-click demo reset.

## How the recommender works (`js/recommender.js`)

Each product is scored against the survey, then a greedy pass builds a balanced stack:

| Rule | Effect |
|------|--------|
| Purpose match | **+30** per goal the product covers |
| Age boost | 50+ → 관절/눈 **+12**; under 30 → 피로 **+6** |
| Gender boost | female + 피로 goal + contains 철분 → **+8** |
| Budget | over monthly budget → **−20**; cheap within budget → **+4** |
| Overlap avoidance | contains an ingredient you already take → **−25** |
| Rating | `rating × 0.8` tie-breaker |

`recommend()` sorts by score, then **covers each selected goal** with its best product before
filling remaining slots by score — so the stack spans your goals and each pick ships with the
reasons that earned it.

## How the interaction checker works (`js/interactions.js`)

The cart's ingredients are aggregated as **daily totals** (`amount × servingPerDay`) and three
checks run against `data/nutrients.json`:

1. **Overlap** — an ingredient present in **2+ products** is flagged.
2. **Over-amount** — daily total **> upper limit (UL)** → **경고**; if no UL is defined but the
   total exceeds **3× the recommended amount (RDA)** → **주의**.
3. **Pair interactions** — predefined ingredient pairs (e.g. 칼슘+철분 absorption, 멜라토닌+GABA
   sedation) trigger a documented warning when both are in the cart.

## 🤖 AI 기능 (API 연동)

Medix ships an **optional, pluggable AI layer** with three features:

1. **AI 영양 상담 챗봇** (`#/ai`) — ask goals in natural language → a recommended approach,
   grounded in the catalog data. **This is NOT medical advice — consult a professional.**
2. **설문 → 맞춤 스택 설명** — turns the recommender's picks into a friendly natural-language
   explanation (survey result → "🤖 AI 맞춤 설명").
3. **성분 상호작용 자연어 경고** — explains the cart's overlap / over-amount / interaction
   warnings in plain Korean with practical cautions (cart → "🤖 AI 경고 설명").

**The live demo works out of the box via a built-in mock** (`AI_ENDPOINT = ""` in
`ai/config.js`). The mock is offline and deterministic, and **reuses the real
`recommender.js` / `interactions.js` engines**, so answers are grounded in the app's own data.

### Enable real Claude (operator)

Deploy the **reference proxy** in [`server/`](./server/README.md) on your own server and point
the site at it. The browser only ever sends `{task, payload}`; the proxy calls Claude with a
server-side key and streams the text back.

```bash
cd server && npm install
cp .env.example .env          # put your key in .env (never committed)
ANTHROPIC_API_KEY=... npm start
```

```js
// ai/config.js — point at your deployed proxy (empty string ⇒ built-in mock)
export const AI_ENDPOINT = "https://your-proxy.example.com/api/ai";
```

The proxy uses `@anthropic-ai/sdk` with model **`claude-opus-5`**, adaptive thinking, and
streaming (`server/index.mjs`).

> **🔒 KEYS ARE SERVER-SIDE ONLY.** The API key lives **only** in the proxy's
> `ANTHROPIC_API_KEY` environment variable — never in the browser, the static bundle, a URL,
> or this repository. `check.mjs` enforces that no key is committed. Do **not** run the proxy
> inside this repo/CI (CI only runs `node --check` on it — no API calls).

## Run locally

No build step. Serve the folder over HTTP (ES modules need `http://`, not `file://`):

```bash
python -m http.server 8995
# open http://localhost:8995
```

## Verify / test

```bash
node check.mjs
```

`check.mjs` (used by CI) parses all JSON, runs `node --check` on every JS file (including
`ai/` + `server/`), asserts the required `index.html` containers, **unit-tests both engines**
(survey → expected picks; overlapping ingredients → warning triggered), and verifies the
**AI-KIT** (`AI_ENDPOINT` empty by default; **no API key committed anywhere**).
CI: `.github/workflows/ci.yml`.

## 🔒 DEMO-MODE boundaries

- **Fictional products & rule-based advice — NOT medical advice; consult a professional.**
- **Simulated payment & subscription — no money moves, no real orders.**
- **localStorage is not a real database** — data lives only in your browser and can be reset.
- **No accounts, no PII collected.**
- **A real build would add:** a real licensed catalog, professional medical/pharmacist review,
  real payments, real accounts, and a server-side database.

## Tech

Vanilla **HTML + CSS + ES-module JavaScript**, no framework, no bundler, relative paths only.
Responsive mobile-first, light + dark, inline-SVG product art. Deployable to GitHub Pages as-is.

## Structure

```
index.html            # SPA shell (required containers + disclaimer)
css/styles.css        # theme tokens, responsive, light/dark
js/app.js             # SPA: routing, catalog, detail, survey, cart, routine
js/recommender.js     # recommendation engine (scored, explainable)
js/interactions.js    # overlap / over-amount / pair-interaction engine
js/storage.js         # localStorage wrapper (try/catch + reset)
ai/config.js          # AI_ENDPOINT switch ("" ⇒ built-in mock)
ai/ai.js              # askAI(task,payload) — mock ↔ real proxy, task ids
server/               # REFERENCE Claude proxy (operator deploys with their key)
data/supplements.json # 38 fictional supplements (ingredients + daily amounts)
data/nutrients.json   # nutrient reference (RDA / UL) for gauges & checks
check.mjs             # CI checks + engine unit tests + AI-KIT checks
.github/workflows/ci.yml
```

## Contributors

- **Dr. Lee Il-guk (이일국)** — idea, direction
- **LWJ**, **LMJ**
- **Claude** (Anthropic) — implementation assistant

## License

- Code: **Apache-2.0** — see [LICENSE](./LICENSE)
- Documentation: **CC BY 4.0**
- SPDX headers: `Apache-2.0`, `Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)`

**Not an official Anthropic product.**

## 🎓 Idea origin

The seed idea for this project came from the **entrepreneurship class taught by Dr. Lee Il-guk (이일국) at Yongin University (용인대학교)**. The students in that class produced startup ideas of remarkable, standout creativity — this project is one of those exceptional ideas, finally brought to life as a working service. Built with deep admiration and gratitude for those students' imagination. *(No student personal information is included; only the idea itself was used, implemented clean-room.)*
