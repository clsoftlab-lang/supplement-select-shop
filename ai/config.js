// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// ai/config.js — AI-KIT 연동 설정 (단일 스위치)
// -----------------------------------------------------------------------------
// AI_ENDPOINT 가 비어 있으면("") → 내장 MockProvider(오프라인 결정론 응답)로 동작.
// 실제 Claude 연동은 server/ 프록시를 배포한 뒤 그 주소를 여기에 넣습니다.
//   예) export const AI_ENDPOINT = "https://your-proxy.example.com/api/ai";
//
// ⚠️ 보안 원칙: API 키는 절대 브라우저/리포지토리에 두지 않습니다.
//    키는 server/ 프록시(서버 측 process.env.ANTHROPIC_API_KEY)에만 존재합니다.
//    이 파일에는 "주소"만 두며, 키를 적으면 안 됩니다.
// -----------------------------------------------------------------------------

/** 비어 있으면 내장 Mock 사용, 값이 있으면 해당 프록시로 POST. */
export const AI_ENDPOINT = "";

export default { AI_ENDPOINT };
