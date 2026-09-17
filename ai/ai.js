// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// ai/ai.js — AI-KIT 클라이언트 (플러그러블: Mock ↔ 실제 Claude 프록시)
// -----------------------------------------------------------------------------
// 하나의 진입점 askAI(task, payload, {onToken}) 로 세 가지 AI 기능을 제공합니다.
//   - AI_ENDPOINT 가 빈 문자열이면 → 내장 MockProvider(결정론 한국어, 오프라인).
//     Mock 은 앱의 "실제 엔진"(recommender.js / interactions.js)을 재사용해
//     데이터에 근거한 설명을 만듭니다(환각 없음, 데모에서 바로 동작).
//   - AI_ENDPOINT 가 설정되면 → {task,payload} 를 프록시에 POST 하고
//     서버가 흘려보내는 텍스트를 스트리밍으로 받습니다.
//
// ⚠️ 이 모듈은 브라우저에서 실행됩니다. API 키를 절대 다루지 않습니다.
//    실제 Claude 호출은 server/ 프록시(서버 측 키)에서만 일어납니다.
//
// ⚕️ 모든 응답은 의학적 조언이 아니며 규칙 기반 데모 결과입니다.
// -----------------------------------------------------------------------------

import { AI_ENDPOINT } from "./config.js";
import { recommend } from "../js/recommender.js";
import { analyzeCart } from "../js/interactions.js";

/** 지원하는 작업(task) id — UI/서버가 공유하는 계약. */
export const TASKS = {
  /** AI 영양 상담 챗봇: 자연어 질문 → 접근 방식 안내 */
  CHAT: "chat",
  /** 설문 → 맞춤 스택 자연어 설명 */
  STACK: "stack",
  /** 성분 중복/상호작용 경고를 쉬운 한국어로 설명 */
  INTERACTIONS: "interactions",
};

/** 사람이 읽는 라벨(선택적 UI 표시용). */
export const TASK_LABELS = {
  [TASKS.CHAT]: "AI 영양 상담",
  [TASKS.STACK]: "맞춤 스택 설명",
  [TASKS.INTERACTIONS]: "성분 상호작용 설명",
};

const NOT_MEDICAL =
  "\n\n⚕️ 참고: 위 안내는 의학적 조언이 아니라 규칙 기반 데모 결과입니다. " +
  "복용 전에는 반드시 의사·약사 등 전문가와 상담하세요.";

const PURPOSE_KEYWORDS = {
  면역: ["면역", "감기", "환절기", "잔병"],
  피로: ["피로", "피곤", "활력", "기운", "에너지", "지침"],
  수면: ["수면", "잠", "불면", "숙면", "잠들"],
  관절: ["관절", "무릎", "연골", "뼈마디"],
  눈: ["눈", "시력", "블루라이트", "눈피로", "안구"],
  장건강: ["장", "소화", "유산균", "변비", "장건강", "배변"],
};

// -----------------------------------------------------------------------------
// 공개 API
// -----------------------------------------------------------------------------

/**
 * 단일 진입점. AI_ENDPOINT 유무에 따라 Mock 또는 실제 프록시로 분기.
 * @param {string} task            TASKS 중 하나
 * @param {object} payload         작업별 입력(제품/설문/장바구니/영양표 등)
 * @param {{onToken?:(t:string)=>void}} [opts]  스트리밍 콜백
 * @returns {Promise<string>}      최종 전체 텍스트
 */
export async function askAI(task, payload = {}, { onToken } = {}) {
  if (AI_ENDPOINT) return callRemote(task, payload, onToken);
  const text = mockProvider(task, payload);
  return streamString(text, onToken);
}

export default { askAI, TASKS, TASK_LABELS };

// -----------------------------------------------------------------------------
// 원격(실제 Claude) 경로 — server/ 프록시가 text 를 스트리밍한다.
// -----------------------------------------------------------------------------
async function callRemote(task, payload, onToken) {
  const res = await fetch(AI_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task, payload }),
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`AI 서버 오류 (${res.status}) ${detail}`.trim());
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    if (chunk) {
      full += chunk;
      if (onToken) onToken(chunk);
    }
  }
  const tail = decoder.decode();
  if (tail) {
    full += tail;
    if (onToken) onToken(tail);
  }
  return full;
}

// -----------------------------------------------------------------------------
// 스트리밍 시뮬레이터 — Mock 텍스트를 토큰처럼 조금씩 흘려보낸다(결정론적 내용).
// -----------------------------------------------------------------------------
async function streamString(text, onToken) {
  if (!onToken) return text;
  const parts = text.match(/[\s\S]{1,16}/g) || [text];
  for (const p of parts) {
    onToken(p);
    // 렌더 체감을 위한 소량 지연(내용은 결정론적).
    await new Promise((r) => setTimeout(r, 12));
  }
  return text;
}

// -----------------------------------------------------------------------------
// MockProvider — 실제 엔진을 재사용하는 결정론 한국어 생성기.
// -----------------------------------------------------------------------------
function mockProvider(task, payload) {
  switch (task) {
    case TASKS.CHAT:
      return mockChat(payload);
    case TASKS.STACK:
      return mockStack(payload);
    case TASKS.INTERACTIONS:
      return mockInteractions(payload);
    default:
      return `알 수 없는 작업(task)입니다: ${task}` + NOT_MEDICAL;
  }
}

/** 질문에서 목적 키워드 추출. */
function detectGoals(question = "") {
  const q = String(question);
  const goals = [];
  for (const [goal, words] of Object.entries(PURPOSE_KEYWORDS)) {
    if (words.some((w) => q.includes(w))) goals.push(goal);
  }
  return goals;
}

/** (1) AI 영양 상담 챗봇 — 자연어 질문 → 접근 방식 + 근거 있는 추천. */
function mockChat(payload = {}) {
  const { question = "", products = [], survey = null } = payload;
  const detected = detectGoals(question);
  const merged = {
    ...(survey || {}),
    goals: detected.length ? detected : (survey && survey.goals) || [],
  };

  const lines = [];
  lines.push(`💬 "${String(question).trim() || "(질문 없음)"}"에 대한 안내예요.`);

  if (!merged.goals.length) {
    lines.push(
      "질문에서 특정 건강 목적을 찾지 못했어요. 예를 들어 " +
        "‘요즘 피로하고 잠을 잘 못 자요’처럼 목적(면역·피로·수면·관절·눈·장건강)을 " +
        "함께 알려 주시면 더 맞춤으로 안내해 드릴게요."
    );
    return lines.join("\n\n") + NOT_MEDICAL;
  }

  lines.push(`파악한 목적: ${merged.goals.map((g) => `‘${g}’`).join(", ")}`);

  const { picks } = recommend(merged, products, { max: 3 });
  if (!picks.length) {
    lines.push("현재 데모 카탈로그에서는 딱 맞는 제품을 찾지 못했어요.");
    return lines.join("\n\n") + NOT_MEDICAL;
  }

  lines.push("규칙 기반 엔진이 데이터에서 골라본 접근 방식은 이래요:");
  picks.forEach((x, i) => {
    const why = x.reasons[0] ? ` (${x.reasons[0]})` : "";
    lines.push(`${i + 1}. ${x.product.name} — ${x.product.brand}${why}`);
  });
  lines.push(
    "우선 목적에 가장 잘 맞는 1~2종부터 시작하고, 몸의 반응을 보며 조절하는 것을 권해요. " +
      "여러 제품을 함께 담으면 장바구니의 성분 상호작용 점검도 꼭 확인하세요."
  );
  return lines.join("\n\n") + NOT_MEDICAL;
}

/** (2) 설문 → 맞춤 스택 자연어 설명. */
function mockStack(payload = {}) {
  const { survey = {}, products = [] } = payload;
  if (!survey || !(survey.goals || []).length) {
    return "먼저 설문에서 목적을 1개 이상 선택해 주세요. 그러면 맞춤 조합을 풀어서 설명해 드릴게요." + NOT_MEDICAL;
  }
  const { picks } = recommend(survey, products, { max: 4 });
  if (!picks.length) {
    return "선택하신 조건에 맞는 추천 조합을 찾지 못했어요. 목적이나 예산을 조정해 보세요." + NOT_MEDICAL;
  }

  const total = picks.reduce((n, x) => n + x.product.price, 0);
  const who = [];
  if (survey.age) who.push(`${survey.age}세`);
  if (survey.gender === "female") who.push("여성");
  else if (survey.gender === "male") who.push("남성");

  const lines = [];
  lines.push(
    `${who.length ? who.join(" ") + " · " : ""}목적 ‘${(survey.goals || []).join(", ")}’ 기준으로 ` +
      `${picks.length}종 조합을 제안드려요. 각 제품이 왜 뽑혔는지 풀어서 설명할게요.`
  );
  picks.forEach((x, i) => {
    const reasonText = x.reasons.length ? x.reasons.join(", ") : "종합 점수 기준 상위";
    lines.push(
      `${i + 1}. ${x.product.name} (${x.product.brand}, ${x.product.price.toLocaleString("ko-KR")}원) — ` +
        `${x.coversGoal ? `‘${x.coversGoal}’ 목적을 담당하며, ` : ""}${reasonText}.`
    );
  });
  lines.push(
    `예상 합계는 ${total.toLocaleString("ko-KR")}원이에요` +
      (survey.budget ? ` (설정하신 월 예산 ${survey.budget.toLocaleString("ko-KR")}원 대비 참고).` : ".")
  );
  lines.push(
    "이 조합은 목적을 고르게 아우르도록 구성했어요. 처음에는 핵심 1~2종으로 시작하고, " +
      "함께 복용할 때는 성분 중복·상호작용 점검을 꼭 확인하세요."
  );
  return lines.join("\n\n") + NOT_MEDICAL;
}

/** (3) 장바구니 성분 상호작용 경고를 쉬운 한국어로 설명. */
function mockInteractions(payload = {}) {
  const { cartProducts = [], nutrients = {} } = payload;
  const a = analyzeCart(cartProducts, nutrients);

  if (!cartProducts.length) {
    return "장바구니가 비어 있어요. 제품을 담으면 성분 중복·과다·상호작용을 함께 살펴 드릴게요." + NOT_MEDICAL;
  }
  if (!a.hasWarning) {
    return (
      "현재 담긴 조합에서는 성분 중복·과다·상호작용 경고가 발견되지 않았어요. " +
      "그래도 새로운 제품을 추가하면 다시 확인하는 습관을 권해요." + NOT_MEDICAL
    );
  }

  const lines = [];
  lines.push("장바구니 성분을 함께 살펴보니 아래 사항을 확인하면 좋겠어요:");

  if (a.pairWarnings.length) {
    lines.push("• 성분 상호작용");
    a.pairWarnings.forEach((w) => {
      const tag = w.level === "경고" ? "‼️ 경고" : "⚠️ 주의";
      lines.push(`  ${tag} — ${w.a} + ${w.b}: ${w.message}`);
    });
  }
  if (a.overAmounts.length) {
    lines.push("• 권장/상한 초과");
    a.overAmounts.forEach((w) => {
      const tag = w.level === "경고" ? "‼️ 경고" : "⚠️ 주의";
      lines.push(`  ${tag} — ${w.message}`);
    });
  }
  if (a.overlaps.length) {
    lines.push("• 중복 성분(같은 성분이 여러 제품에 들어 있어요)");
    a.overlaps.forEach((o) => {
      lines.push(`  ℹ️ ${o.name}: ${o.products.join(", ")} (합산 ${o.total}${o.unit})`);
    });
  }
  lines.push(
    "권장 대응: 흡수를 방해하는 조합은 섭취 시간을 2시간 이상 벌리고, 상한을 넘는 성분은 " +
      "제품 수나 용량을 줄여 조정하세요. 진정 계열 중복은 낮 시간 활동에 영향을 줄 수 있어요."
  );
  return lines.join("\n") + NOT_MEDICAL;
}
