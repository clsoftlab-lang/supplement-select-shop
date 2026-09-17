// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// check.mjs — CI 검증기 (의존성 없음, node check.mjs)
//   1) 모든 JSON 파싱   2) 모든 JS `node --check`
//   3) index.html 필수 컨테이너   4) recommender.js / interactions.js 단위 테스트

import { readFileSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { recommend, scoreProduct } from "./js/recommender.js";
import { analyzeCart } from "./js/interactions.js";
import { AI_ENDPOINT } from "./ai/config.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log(`  ✓ ${name}`); };
const bad = (name, err) => { fail++; console.error(`  ✗ ${name}${err ? " — " + err : ""}`); };
function assert(cond, name) { cond ? ok(name) : bad(name); }

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    if (f === "node_modules" || f.startsWith(".git")) continue;
    const p = join(dir, f);
    statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}
const files = walk(ROOT);

// 1) JSON 파싱 ---------------------------------------------------------------
console.log("\n[1] JSON 파싱");
let supplements, nutrients;
for (const f of files.filter((f) => extname(f) === ".json")) {
  try {
    const data = JSON.parse(readFileSync(f, "utf8"));
    if (f.endsWith("supplements.json")) supplements = data;
    if (f.endsWith("nutrients.json")) nutrients = data;
    ok(`파싱: ${f.replace(ROOT, "").replace(/\\/g, "/")}`);
  } catch (e) { bad(`파싱: ${f}`, e.message); }
}

// 2) JS 문법 검사 ------------------------------------------------------------
console.log("\n[2] node --check (JS 문법)");
for (const f of files.filter((f) => [".js", ".mjs"].includes(extname(f)))) {
  try {
    execSync(`node --check "${f}"`, { stdio: "pipe" });
    ok(`문법: ${f.replace(ROOT, "").replace(/\\/g, "/")}`);
  } catch (e) { bad(`문법: ${f}`, String(e.stderr || e.message).slice(0, 200)); }
}

// 3) index.html 필수 컨테이너 -------------------------------------------------
console.log("\n[3] index.html 필수 컨테이너");
const html = readFileSync(join(ROOT, "index.html"), "utf8");
for (const needle of [
  'id="app"', 'id="view"', 'id="nav"', 'id="disclaimer"',
  'data-nav="catalog"', 'data-nav="survey"', 'data-nav="cart"', 'data-nav="routine"',
  './js/app.js',
]) {
  assert(html.includes(needle), `포함: ${needle}`);
}

// 데이터 무결성 --------------------------------------------------------------
console.log("\n[4] 데이터 무결성");
const products = supplements?.products || [];
assert(products.length >= 36, `제품 36개 이상 (실제 ${products.length}개)`);
assert(Object.keys(nutrients?.nutrients || {}).length >= 20, "영양성분 참조표 20종 이상");
const ids = new Set();
let idOk = true, fieldOk = true;
for (const p of products) {
  if (ids.has(p.id)) idOk = false;
  ids.add(p.id);
  if (!p.name || !p.brand || !Array.isArray(p.purposes) || !Array.isArray(p.ingredients) || !p.ingredients.length || typeof p.price !== "number") fieldOk = false;
}
assert(idOk, "제품 id 중복 없음");
assert(fieldOk, "모든 제품 필수 필드(name/brand/purposes/ingredients/price) 보유");
const purposeSet = new Set(products.flatMap((p) => p.purposes));
assert(["면역", "피로", "수면", "관절", "눈", "장건강"].every((g) => purposeSet.has(g)), "6개 목적 모두 커버");

// 5) recommender.js 단위 테스트 ----------------------------------------------
console.log("\n[5] recommender.js 단위 테스트");
const nref = nutrients.nutrients;

// (a) 수면 목적 → 최상위 추천이 수면 제품
{
  const { picks } = recommend({ age: 40, gender: "female", goals: ["수면"], taking: [] }, products, { max: 3 });
  assert(picks.length > 0, "추천 결과 존재");
  assert(picks[0].product.purposes.includes("수면"), "수면 설문 → 최상위 추천이 수면 제품");
  assert(picks[0].reasons.length > 0, "추천에 이유(reasons) 포함");
}
// (b) 다목적 커버: 면역+관절 → 두 목적 각각 커버하는 제품 포함
{
  const { picks } = recommend({ age: 55, gender: "male", goals: ["면역", "관절"], taking: [] }, products, { max: 4 });
  const covered = new Set(picks.flatMap((x) => x.product.purposes));
  assert(covered.has("면역") && covered.has("관절"), "면역+관절 설문 → 두 목적 모두 커버");
}
// (c) 중복 회피: 이미 복용 중인 성분 포함 제품은 점수가 낮아짐
{
  const magProduct = products.find((p) => p.ingredients.some((i) => i.name === "마그네슘"));
  const base = scoreProduct(magProduct, { goals: ["수면"], taking: [] }).score;
  const withTaking = scoreProduct(magProduct, { goals: ["수면"], taking: ["마그네슘"] }).score;
  assert(withTaking < base, "복용 중 성분 중복 시 점수 감산");
}
// (d) 연령 보정: 50세 이상 관절 가산
{
  const jointP = products.find((p) => p.purposes.includes("관절"));
  const young = scoreProduct(jointP, { age: 25, goals: ["관절"] }).score;
  const senior = scoreProduct(jointP, { age: 60, goals: ["관절"] }).score;
  assert(senior > young, "50세 이상 관절 제품 가산");
}

// 6) interactions.js 단위 테스트 ---------------------------------------------
console.log("\n[6] interactions.js 단위 테스트");
const P = (id) => products.find((p) => p.id === id);

// (a) 성분 중복 감지: 마그네슘 두 제품
{
  const cart = [P("fat-mag-400"), P("sleep-mag-glycinate")].filter(Boolean);
  assert(cart.length === 2, "테스트용 마그네슘 제품 2종 존재");
  const a = analyzeCart(cart, nref);
  assert(a.overlaps.some((o) => o.name === "마그네슘"), "중복 성분(마그네슘) 감지");
  assert(a.overAmounts.some((w) => w.name === "마그네슘" && w.level === "경고"), "마그네슘 합산 상한 초과 경고");
  assert(a.hasWarning === true, "경고 플래그 true");
}
// (b) 성분 쌍 상호작용: 멜라토닌 + GABA
{
  const cart = [P("sleep-melatonin"), P("sleep-gaba")].filter(Boolean);
  const a = analyzeCart(cart, nref);
  assert(a.pairWarnings.some((w) => (w.a === "멜라토닌" && w.b === "GABA") || (w.a === "GABA" && w.b === "멜라토닌")), "멜라토닌+GABA 상호작용 경고");
}
// (c) 안전한 조합: 경고 없음
{
  const cart = [P("imm-vitc-mini")].filter(Boolean);
  const a = analyzeCart(cart, nref);
  assert(a.hasWarning === false, "단일 안전 제품 → 경고 없음");
}
// (d) 일일 합산 계산: servingPerDay 반영
{
  const cart = [P("gut-glutamine")].filter(Boolean); // 3000mg × 2회 = 6000
  const a = analyzeCart(cart, nref);
  const g = a.totals.find((t) => t.name === "L-글루타민");
  assert(g && g.total === 6000, "servingPerDay 반영한 일일 합산(6000mg)");
}

// 7) AI-KIT 검증 -------------------------------------------------------------
console.log("\n[7] AI-KIT (ai/ + server/)");

// (a) ai/ 와 server/ 의 JS 를 node --check 로 명시적 문법 검사
for (const f of [
  join(ROOT, "ai", "config.js"),
  join(ROOT, "ai", "ai.js"),
  join(ROOT, "server", "index.mjs"),
  join(ROOT, "server", "worker.js"),
]) {
  try {
    execSync(`node --check "${f}"`, { stdio: "pipe" });
    ok(`문법: ${f.replace(ROOT, "").replace(/\\/g, "/")}`);
  } catch (e) { bad(`문법: ${f}`, String(e.stderr || e.message).slice(0, 200)); }
}

// (b) 데모 기본값: AI_ENDPOINT 는 빈 문자열(=내장 Mock 사용)이어야 한다
assert(AI_ENDPOINT === "", 'AI_ENDPOINT 기본값 빈 문자열("") = Mock 모드');

// (c) 리포지토리 어디에도 "실제" 키가 없어야 한다.
//     실제 키만 매칭하도록 길이 하한을 두어(20자+), README 의 `sk-ant…` 언급은 오탐하지 않는다.
//     (self-match 방지를 위해 접두사 문자열을 분할 구성)
const REAL_KEY_RE = new RegExp("sk-" + "ant-[A-Za-z0-9_-]{20,}");
let leaked = null;
for (const f of files.filter((f) => ![".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2"].includes(extname(f)))) {
  let text;
  try { text = readFileSync(f, "utf8"); } catch { continue; }
  if (REAL_KEY_RE.test(text)) {
    leaked = f.replace(ROOT, "").replace(/\\/g, "/");
    break;
  }
}
assert(leaked === null, leaked ? `키 노출 발견: ${leaked}` : `하드코딩된 실제 API 키 없음`);

// (d) .gitignore 가 .env 를 제외하고, 실제 .env 파일이 커밋되지 않았어야 한다
{
  let gi = "";
  try { gi = readFileSync(join(ROOT, ".gitignore"), "utf8"); } catch {}
  assert(/(^|\n)\.env(\s|$)/.test(gi), ".gitignore 가 .env 를 제외");
  const envCommitted = files.some((f) => /(^|[\\/])\.env$/.test(f));
  assert(!envCommitted, "실제 .env 파일이 리포지토리에 없음");
}

// 결과 -----------------------------------------------------------------------
console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
if (fail > 0) process.exit(1);
console.log("✅ 모든 검증 통과");
