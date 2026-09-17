// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// recommender.js — 맞춤 추천 엔진 (규칙 기반, 설명 가능)
// -----------------------------------------------------------------------------
// 입력: 설문(survey) + 제품 목록(products)
// 출력: 점수순 추천 조합(picks) + 각 추천의 "이유(reasons)"
//
// 점수 규칙(모두 문서화된 가산/감산):
//   1) 목적 일치        : 설문 목적과 겹치는 product.purposes 1개당 +30
//   2) 다목적 보너스    : 여러 목적을 동시에 만족하면 목적당 소폭 가산에 이미 반영
//   3) 연령 보정        : 50세 이상 → 관절/눈 +12, 30세 미만 → 피로 +6
//   4) 성별 보정        : 여성 + 피로 목적 → 철분 함유 제품 +8
//   5) 예산 보정        : 월예산 초과 제품 감산(-20), 예산 내 저렴하면 소폭 가산
//   6) 중복 회피        : 이미 복용 중인 성분을 포함하면 -25 (과다/중복 방지)
//   7) 평점 보정        : rating(0~5)을 소수 가산해 동점 시 정렬 안정화
// 최종적으로 목적을 고르게 커버하도록 그리디 선택(coverGoals)로 조합을 구성한다.
// 이 로직은 의학적 처방이 아니며, 규칙 기반 데모 추천이다.
// -----------------------------------------------------------------------------

/** 두 배열의 교집합 */
export function intersect(a = [], b = []) {
  const setB = new Set(b);
  return a.filter((x) => setB.has(x));
}

/** 제품이 포함한 성분 이름 목록 */
export function ingredientNames(product) {
  return (product.ingredients || []).map((i) => i.name);
}

/**
 * 단일 제품 점수 계산.
 * @returns {{score:number, reasons:string[]}}
 */
export function scoreProduct(product, survey = {}) {
  const reasons = [];
  let score = 0;

  const goals = survey.goals || [];
  const matched = intersect(product.purposes || [], goals);
  if (matched.length > 0) {
    score += matched.length * 30;
    reasons.push(`선택한 목적 [${matched.join(", ")}]에 부합`);
  }

  const age = Number(survey.age) || 0;
  if (age >= 50 && intersect(product.purposes || [], ["관절", "눈"]).length > 0) {
    score += 12;
    reasons.push("50세 이상: 관절·눈 건강 강화 가산");
  }
  if (age > 0 && age < 30 && (product.purposes || []).includes("피로")) {
    score += 6;
    reasons.push("20~30대: 활력/피로 관리 가산");
  }

  const names = ingredientNames(product);
  if (survey.gender === "female" && goals.includes("피로") && names.includes("철분")) {
    score += 8;
    reasons.push("여성·피로 목적: 철분 보충 가산");
  }

  // 예산 보정 (월 예산; 없으면 무시)
  const budget = Number(survey.budget) || 0;
  if (budget > 0) {
    if (product.price > budget) {
      score -= 20;
      reasons.push("월 예산 초과: 감산");
    } else if (product.price <= budget * 0.4) {
      score += 4;
      reasons.push("예산 대비 합리적 가격");
    }
  }

  // 이미 복용 중인 성분과 중복이면 감산
  const taking = survey.taking || [];
  const dup = intersect(names, taking);
  if (dup.length > 0) {
    score -= 25;
    reasons.push(`이미 복용 중인 성분과 중복 가능성: ${dup.join(", ")}`);
  }

  // 평점 소수 가산 (정렬 안정화)
  score += (Number(product.rating) || 0) * 0.8;

  return { score: Math.round(score * 100) / 100, reasons };
}

/**
 * 추천 조합 생성.
 * @param {object} survey  설문
 * @param {Array}  products 제품 배열
 * @param {object} [opts]  { max=4, minScore=1 }
 * @returns {{picks:Array<{product,score,reasons,coversGoal}>, scored:Array}}
 */
export function recommend(survey = {}, products = [], opts = {}) {
  const max = opts.max || 4;
  const minScore = opts.minScore != null ? opts.minScore : 1;

  const scored = products
    .map((p) => {
      const s = scoreProduct(p, survey);
      return { product: p, score: s.score, reasons: s.reasons };
    })
    .filter((x) => x.score >= minScore)
    .sort((a, b) => b.score - a.score);

  // 목적을 고르게 커버하도록 그리디 선택
  const goals = survey.goals && survey.goals.length ? survey.goals : null;
  const picks = [];
  const covered = new Set();

  if (goals) {
    // 1) 각 목적별 최고 점수 제품을 우선 확보
    for (const goal of goals) {
      if (picks.length >= max) break;
      const best = scored.find(
        (x) => !picks.includes(x) && (x.product.purposes || []).includes(goal)
      );
      if (best) {
        best.coversGoal = goal;
        picks.push(best);
        covered.add(goal);
      }
    }
  }
  // 2) 남은 자리는 전체 점수 순으로 채움
  for (const x of scored) {
    if (picks.length >= max) break;
    if (!picks.includes(x)) {
      x.coversGoal = x.coversGoal || (intersect(x.product.purposes || [], goals || [])[0] || null);
      picks.push(x);
    }
  }

  return { picks, scored, coveredGoals: [...covered] };
}

export default { recommend, scoreProduct, ingredientNames, intersect };
