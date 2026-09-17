// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// interactions.js — 성분 중복/상호작용/과다 체커 (규칙 기반, 실제 작동)
// -----------------------------------------------------------------------------
// 장바구니에 담긴 제품들의 성분을 합산하여 아래를 탐지한다.
//   A) 성분 중복(overlaps)    : 동일 성분이 2개 이상 제품에 존재
//   B) 일일 권장/상한 초과(overAmounts):
//        - 합산 일일량 > 상한(UL)            → level "경고"
//        - UL 미설정이나 권장량(RDA)의 3배 초과 → level "주의"
//   C) 성분 쌍 상호작용(pairWarnings): 사전 정의된 규칙 쌍이 동시에 담긴 경우
// 일일 합산량 = 성분 함량(amount) × 제품의 servingPerDay
// 본 체커는 의학적 판단이 아니며, 규칙 기반 데모 경고이다.
// -----------------------------------------------------------------------------

/** 성분 쌍 상호작용 규칙 (허구/일반 상식 수준의 데모 규칙) */
export const INTERACTION_RULES = [
  { a: "칼슘", b: "철분", level: "주의", message: "칼슘과 철분을 함께 먹으면 철분 흡수가 떨어질 수 있어요. 섭취 시간을 2시간 이상 벌려보세요." },
  { a: "아연", b: "철분", level: "주의", message: "아연과 철분은 흡수 경로가 겹쳐 서로 흡수를 방해할 수 있어요. 시간을 나눠 드세요." },
  { a: "아연", b: "칼슘", level: "주의", message: "아연과 칼슘은 흡수 경쟁이 있어 고용량 동시 섭취는 피하는 게 좋아요." },
  { a: "멜라토닌", b: "GABA", level: "경고", message: "멜라토닌과 GABA는 진정 작용이 겹쳐 과도한 졸림·나른함이 생길 수 있어요." },
  { a: "멜라토닌", b: "L-테아닌", level: "주의", message: "수면 성분이 중복됩니다. 함께 드실 경우 용량을 낮추는 것을 고려하세요." },
  { a: "L-테아닌", b: "GABA", level: "주의", message: "진정 계열 성분이 중복됩니다. 낮 시간 섭취 시 주의하세요." },
  { a: "트립토판", b: "멜라토닌", level: "경고", message: "트립토판과 멜라토닌은 수면 경로가 겹쳐 과도한 진정이 될 수 있어요." },
];

/** 정규 키(성분명 공백 제거·소문자) */
function norm(name) {
  return String(name || "").replace(/\s+/g, "").toLowerCase();
}

/**
 * 장바구니 성분 합산.
 * @returns Map<이름, {name, unit, total, sources:[{id,name,amount}]}>
 */
export function aggregateIngredients(cartProducts = []) {
  const map = new Map();
  for (const p of cartProducts) {
    const perDay = Number(p.servingPerDay) || 1;
    for (const ing of p.ingredients || []) {
      const key = norm(ing.name);
      const daily = (Number(ing.amount) || 0) * perDay;
      if (!map.has(key)) {
        map.set(key, { name: ing.name, unit: ing.unit, total: 0, sources: [] });
      }
      const entry = map.get(key);
      entry.total += daily;
      entry.sources.push({ id: p.id, name: p.name, amount: daily, unit: ing.unit });
    }
  }
  return map;
}

/**
 * 장바구니 분석.
 * @param {Array} cartProducts 제품 배열
 * @param {object} nutrientRef data/nutrients.json 의 nutrients 맵
 * @param {Array}  [rules]     상호작용 규칙(기본 INTERACTION_RULES)
 * @returns {{overlaps,overAmounts,pairWarnings,totals,hasWarning}}
 */
export function analyzeCart(cartProducts = [], nutrientRef = {}, rules = INTERACTION_RULES) {
  const agg = aggregateIngredients(cartProducts);

  // A) 중복
  const overlaps = [];
  for (const entry of agg.values()) {
    if (entry.sources.length >= 2) {
      overlaps.push({
        name: entry.name,
        unit: entry.unit,
        total: Math.round(entry.total * 1000) / 1000,
        products: entry.sources.map((s) => s.name),
      });
    }
  }

  // B) 권장/상한 초과
  const overAmounts = [];
  const totals = [];
  for (const entry of agg.values()) {
    const ref = nutrientRef[entry.name] || {};
    const rda = ref.rda;
    const ul = ref.ul;
    const percentRda = rda ? Math.round((entry.total / rda) * 100) : null;
    totals.push({
      name: entry.name,
      unit: entry.unit,
      total: Math.round(entry.total * 1000) / 1000,
      rda: rda ?? null,
      ul: ul ?? null,
      percentRda,
    });
    if (ul != null && entry.total > ul) {
      overAmounts.push({
        name: entry.name,
        unit: entry.unit,
        total: Math.round(entry.total * 1000) / 1000,
        limit: ul,
        limitType: "상한(UL)",
        level: "경고",
        message: `${entry.name} 합산 일일량 ${Math.round(entry.total * 100) / 100}${entry.unit}이 상한 ${ul}${entry.unit}을 초과했어요.`,
      });
    } else if (ul == null && rda != null && entry.total > rda * 3) {
      overAmounts.push({
        name: entry.name,
        unit: entry.unit,
        total: Math.round(entry.total * 1000) / 1000,
        limit: rda * 3,
        limitType: "권장량 3배",
        level: "주의",
        message: `${entry.name} 합산 일일량이 권장량의 3배를 넘었어요. 과다 섭취가 아닌지 확인하세요.`,
      });
    }
  }

  // C) 성분 쌍 상호작용
  const present = new Set([...agg.keys()]);
  const pairWarnings = [];
  for (const rule of rules) {
    if (present.has(norm(rule.a)) && present.has(norm(rule.b))) {
      pairWarnings.push({ a: rule.a, b: rule.b, level: rule.level, message: rule.message });
    }
  }

  const hasWarning = overlaps.length > 0 || overAmounts.length > 0 || pairWarnings.length > 0;
  return { overlaps, overAmounts, pairWarnings, totals, hasWarning };
}

export default { analyzeCart, aggregateIngredients, INTERACTION_RULES };
