// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// server/worker.js — Cloudflare Workers 변형(무인·무료 호스팅)
// -----------------------------------------------------------------------------
// index.mjs(Node 프록시)와 동일한 task 라우팅 · 모델/캐싱/비용 규칙을 사용하되,
// 서버를 직접 운영하지 않아도 되도록 Cloudflare Workers 무료 티어에서 동작합니다.
// Anthropic REST(/v1/messages)를 직접 호출하고 어시스턴트 텍스트를 스트리밍(SSE 릴레이)합니다.
//
// 🔒 API 키는 Worker 시크릿에만 존재합니다(브라우저/리포지토리에 두지 않음):
//    wrangler secret put ANTHROPIC_API_KEY
//
// 💸 비용 최적화: 기본 모델 claude-haiku-4-5(AI_MODEL 로 상향 가능) + 프롬프트 캐싱 +
//    작은 max_tokens + IP 당 분당 요청 제한 + 월 토큰 예산(초과 시 429 {fallback:true}).
// -----------------------------------------------------------------------------

const DISCLAIMER =
  "모든 답변은 의학적 조언이 아니라 규칙 기반 데모 데이터에 근거한 참고 정보임을 명확히 하고, " +
  "복용 전 의사·약사 등 전문가 상담을 반드시 권고한다.";

// task 별 시스템 프롬프트 + 사용자 메시지 (index.mjs 와 동일한 규칙).
function buildPrompt(task, payload = {}) {
  const data = JSON.stringify(payload);
  switch (task) {
    case "chat":
      return {
        system:
          "너는 '메딕스(Medix)' 영양제 셀렉트샵의 상담 도우미다. 사용자의 자연어 질문에 대해 " +
          "제공된 제품 데이터(products)와 설문(survey)에만 근거해 친절한 한국어로 접근 방식을 안내한다. " +
          "데이터에 없는 제품/효능을 지어내지 않는다. " +
          DISCLAIMER,
        user:
          "다음 JSON 은 사용자의 질문(question), 제품 목록(products), 선택적 설문(survey)이다. " +
          "질문 의도에 맞는 목적을 추정하고, 데이터 내 제품으로 접근 방식을 3가지 이하로 제안하라.\n\n" +
          data,
      };
    case "stack":
      return {
        system:
          "너는 '메딕스(Medix)'의 추천 설명 도우미다. 규칙 기반 추천 엔진이 고른 조합(picks)과 그 근거(reasons)를 " +
          "일반 사용자가 이해하기 쉬운 친근한 한국어 설명으로 풀어 준다. 데이터 밖의 주장을 추가하지 않는다. " +
          DISCLAIMER,
        user:
          "다음 JSON 은 설문(survey)과 제품 목록(products)이다. 설문에 맞는 맞춤 스택을 " +
          "각 제품이 왜 뽑혔는지 포함해 자연어로 설명하라.\n\n" +
          data,
      };
    case "interactions":
      return {
        system:
          "너는 '메딕스(Medix)'의 성분 안전 안내 도우미다. 장바구니 제품들의 성분 중복·상한 초과·상호작용을 " +
          "제공된 데이터에만 근거해 쉬운 한국어로 설명하고, 시간 분리 섭취 등 현실적인 주의사항을 덧붙인다. " +
          "과장하거나 진단하지 않는다. " +
          DISCLAIMER,
        user:
          "다음 JSON 은 장바구니 제품(cartProducts)과 영양성분 참조표(nutrients)다. " +
          "중복/과다/상호작용을 사용자 눈높이로 설명하고 대응 방법을 알려 주라.\n\n" +
          data,
      };
    default:
      return {
        system: "너는 도움이 되는 한국어 도우미다. " + DISCLAIMER,
        user: "다음 요청을 처리하라:\n\n" + data,
      };
  }
}

const MAX_TOKENS = { chat: 700, stack: 800, interactions: 700 };
const DEFAULT_MAX_TOKENS = 700;

// 비용 가드레일(Worker 인스턴스 메모리 기준 — 완벽하진 않지만 폭주는 억제).
const RATE_PER_MIN_DEFAULT = 20;
const MONTHLY_TOKEN_CAP_DEFAULT = 2_000_000;
const rateHits = new Map();
let usedTokens = 0;
let usageMonth = new Date().getUTCMonth();

function rateLimited(ip, max) {
  const now = Date.now();
  const arr = (rateHits.get(ip) || []).filter((t) => now - t < 60_000);
  if (arr.length >= max) {
    rateHits.set(ip, arr);
    return true;
  }
  arr.push(now);
  rateHits.set(ip, arr);
  return false;
}
function budgetExceeded(cap) {
  const m = new Date().getUTCMonth();
  if (m !== usageMonth) {
    usageMonth = m;
    usedTokens = 0;
  }
  return usedTokens >= cap;
}
function addUsage(u) {
  if (!u) return;
  usedTokens +=
    (u.input_tokens || 0) +
    (u.output_tokens || 0) +
    (u.cache_creation_input_tokens || 0) +
    (u.cache_read_input_tokens || 0);
}

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": (env && env.ALLOWED_ORIGIN) || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(env);
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const MODEL = (env && env.AI_MODEL) || "claude-haiku-4-5";
    const IS_HAIKU = MODEL.startsWith("claude-haiku");

    if (request.method === "GET" && url.pathname === "/health") {
      return new Response(
        JSON.stringify({ ok: true, model: MODEL, usedTokens }),
        { headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } }
      );
    }
    if (request.method !== "POST" || url.pathname !== "/api/ai") {
      return new Response("Not Found", { status: 404, headers: cors });
    }

    // 비용 가드레일 → 429 {fallback:true} (프런트가 Mock 으로 자동 대체)
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    const ratePerMin = Number(env && env.AI_RATE_PER_MIN) || RATE_PER_MIN_DEFAULT;
    const cap = Number(env && env.AI_MONTHLY_TOKEN_CAP) || MONTHLY_TOKEN_CAP_DEFAULT;
    if (rateLimited(ip, ratePerMin) || budgetExceeded(cap)) {
      return new Response(JSON.stringify({ fallback: true }), {
        status: 429,
        headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
      });
    }

    if (!env || !env.ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ fallback: true }), {
        status: 429,
        headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
      });
    }

    let task, payload;
    try {
      const body = await request.json();
      task = body.task;
      payload = body.payload || {};
    } catch {
      return new Response("잘못된 JSON 요청입니다.", { status: 400, headers: cors });
    }

    const { system, user } = buildPrompt(task, payload);

    const reqBody = {
      model: MODEL,
      max_tokens: MAX_TOKENS[task] || DEFAULT_MAX_TOKENS,
      stream: true,
      // 프롬프트 캐싱: 안정적인 system 블록을 캐시 → 반복 호출 비용 절감.
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: user }],
    };
    // Haiku 4.5 는 adaptive thinking / effort 미지원(400 방지).
    if (!IS_HAIKU) {
      reqBody.thinking = { type: "adaptive" };
      reqBody.output_config = { effort: (env && env.AI_EFFORT) || "low" };
    }

    let upstream;
    try {
      upstream = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify(reqBody),
      });
    } catch {
      // 네트워크 오류 → 프런트가 Mock 으로 대체하도록 429 신호.
      return new Response(JSON.stringify({ fallback: true }), {
        status: 429,
        headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
      });
    }

    if (!upstream.ok || !upstream.body) {
      return new Response(JSON.stringify({ fallback: true }), {
        status: 429,
        headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
      });
    }

    // SSE 를 파싱해 text 델타만 text/plain 으로 릴레이(프런트 계약과 동일).
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async pull(controller) {
        const { value, done } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          const s = line.trim();
          if (!s.startsWith("data:")) continue;
          const json = s.slice(5).trim();
          if (!json || json === "[DONE]") continue;
          try {
            const evt = JSON.parse(json);
            if (evt.type === "content_block_delta" && evt.delta && evt.delta.text) {
              controller.enqueue(encoder.encode(evt.delta.text));
            } else if (evt.type === "message_delta" && evt.usage) {
              addUsage(evt.usage); // 월 예산 누적
            } else if (evt.type === "message_start" && evt.message && evt.message.usage) {
              addUsage(evt.message.usage);
            }
          } catch {
            /* 부분 라인은 무시(다음 청크에서 이어짐) */
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        ...cors,
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  },
};
