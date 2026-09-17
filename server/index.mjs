// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// server/index.mjs — 참조용(REFERENCE) AI 프록시
// -----------------------------------------------------------------------------
// 운영자가 자신의 서버에 배포하는 예시 프록시입니다. 브라우저(정적 사이트)는
// {task,payload} 만 이 프록시로 보내고, 프록시가 서버 측 API 키로 Claude 를
// 호출한 뒤 텍스트를 스트리밍으로 되돌려줍니다.
//
// 🔒 API 키는 오직 서버(process.env.ANTHROPIC_API_KEY)에만 존재합니다.
//    브라우저나 리포지토리에는 절대 키를 두지 않습니다.
//
// ⚠️ 이 리포지토리(데모/CI)에서는 절대 실행하지 마세요. 키가 있는 운영 환경에서만
//    `npm install && npm start` 로 구동합니다. (CI 는 node --check 문법 검사만 수행)
//
// 실행:
//   cd server && npm install
//   ANTHROPIC_API_KEY=... npm start
// 그런 다음 ai/config.js 의 AI_ENDPOINT 를 "http://<host>:<port>/api/ai" 로 지정.
//
// 💸 비용 최적화(고도화):
//   - 기본 모델은 비용 우선 claude-haiku-4-5 (환경변수 AI_MODEL 로 교체 가능).
//     품질을 더 원하면 AI_MODEL=claude-sonnet-5 또는 AI_MODEL=claude-opus-5 로 상향.
//   - 안정적인 task 별 system 프롬프트는 프롬프트 캐싱(cache_control: ephemeral)으로
//     반복 호출 비용을 낮춥니다.
//   - task 별 max_tokens 를 작게(기본 ~700) 두어 출력 비용을 억제합니다.
//   - IP 당 분당 요청 제한 + 월 토큰 예산(AI_MONTHLY_TOKEN_CAP)으로 폭주 비용을 막고,
//     초과 시 HTTP 429 {fallback:true} 를 반환해 프런트가 내장 Mock 으로 자동 대체합니다.
// -----------------------------------------------------------------------------

import http from "node:http";
import Anthropic from "@anthropic-ai/sdk";

const PORT = Number(process.env.PORT) || 8787;
// 비용 우선 기본 모델. 필요 시 AI_MODEL 로 상향(claude-sonnet-5 / claude-opus-5).
const MODEL = process.env.AI_MODEL || "claude-haiku-4-5";
// Haiku 4.5 는 adaptive thinking / effort 를 받지 않는다(400 방지) → 모델별 분기에 사용.
const IS_HAIKU = MODEL.startsWith("claude-haiku");
// CORS: 정적 사이트 출처. 기본은 개발 편의를 위한 "*" (운영 시 특정 출처로 제한 권장).
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

// ---- 비용 가드레일 -----------------------------------------------------------
// task 별 출력 상한(작게 유지, 정말 필요한 곳만 상향).
const MAX_TOKENS = { chat: 700, stack: 800, interactions: 700 };
const DEFAULT_MAX_TOKENS = 700;
// IP 당 분당 요청 제한(간단한 인메모리 슬라이딩 윈도).
const RATE_PER_MIN = Number(process.env.AI_RATE_PER_MIN) || 20;
const rateHits = new Map(); // ip -> number[] (요청 타임스탬프)
function rateLimited(ip) {
  const now = Date.now();
  const arr = (rateHits.get(ip) || []).filter((t) => now - t < 60_000);
  if (arr.length >= RATE_PER_MIN) {
    rateHits.set(ip, arr);
    return true;
  }
  arr.push(now);
  rateHits.set(ip, arr);
  return false;
}
// 월 토큰 예산(스트림 최종 usage 를 누적, 달이 바뀌면 리셋).
const MONTHLY_TOKEN_CAP = Number(process.env.AI_MONTHLY_TOKEN_CAP) || 2_000_000;
let usedTokens = 0;
let usageMonth = new Date().getUTCMonth();
function budgetExceeded() {
  const m = new Date().getUTCMonth();
  if (m !== usageMonth) {
    usageMonth = m;
    usedTokens = 0;
  }
  return usedTokens >= MONTHLY_TOKEN_CAP;
}
function addUsage(u) {
  if (!u) return;
  usedTokens +=
    (u.input_tokens || 0) +
    (u.output_tokens || 0) +
    (u.cache_creation_input_tokens || 0) +
    (u.cache_read_input_tokens || 0);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    "[server] ANTHROPIC_API_KEY 가 설정되지 않았습니다. 서버 측 환경변수로 키를 제공하세요.\n" +
      "         이 프록시는 키가 있는 운영 환경에서만 실행합니다."
  );
  process.exit(1);
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DISCLAIMER =
  "모든 답변은 의학적 조언이 아니라 규칙 기반 데모 데이터에 근거한 참고 정보임을 명확히 하고, " +
  "복용 전 의사·약사 등 전문가 상담을 반드시 권고한다.";

// task 별 시스템 프롬프트 + 사용자 메시지 구성 (payload 데이터에 grounding).
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

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 1_000_000) reject(new Error("payload too large"));
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(
      JSON.stringify({ ok: true, model: MODEL, usedTokens, cap: MONTHLY_TOKEN_CAP })
    );
  }
  if (req.method !== "POST" || (req.url || "").split("?")[0] !== "/api/ai") {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Not Found");
  }

  // 비용 가드레일: 분당 요청 제한 / 월 토큰 예산 초과 → 429 {fallback:true}
  // (프런트는 이 신호를 받으면 내장 Mock 으로 자동 대체하여 서비스가 끊기지 않는다.)
  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket.remoteAddress ||
    "unknown";
  if (rateLimited(ip) || budgetExceeded()) {
    res.writeHead(429, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ fallback: true }));
  }

  let task, payload;
  try {
    const body = JSON.parse((await readBody(req)) || "{}");
    task = body.task;
    payload = body.payload || {};
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("잘못된 JSON 요청입니다.");
  }

  const { system, user } = buildPrompt(task, payload);

  try {
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    });
    // 스트리밍: 긴 입력/출력에서도 타임아웃을 피하고 토큰을 즉시 흘려보낸다.
    const params = {
      model: MODEL,
      max_tokens: MAX_TOKENS[task] || DEFAULT_MAX_TOKENS,
      // 프롬프트 캐싱: 안정적인 task 별 system 프롬프트를 캐시 블록으로 전송 →
      // 반복 호출 시 캐시 읽기로 비용 절감.
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: user }],
    };
    // Haiku 4.5 는 adaptive thinking / effort 를 받지 않는다(400 방지).
    if (!IS_HAIKU) {
      params.thinking = { type: "adaptive" };
      params.output_config = { effort: process.env.AI_EFFORT || "low" };
    }
    const stream = client.messages.stream(params);
    stream.on("text", (delta) => res.write(delta));
    const finalMsg = await stream.finalMessage();
    addUsage(finalMsg && finalMsg.usage); // 월 예산 누적
    res.end();
  } catch (err) {
    console.error("[server] Claude 호출 실패:", err);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    }
    res.end("\n[AI 오류] 잠시 후 다시 시도해 주세요.");
  }
});

server.listen(PORT, () => {
  console.log(`[server] AI 프록시 실행 중: http://localhost:${PORT}/api/ai (model=${MODEL})`);
});
