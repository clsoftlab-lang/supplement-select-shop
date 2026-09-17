<!--
SPDX-License-Identifier: Apache-2.0
Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
-->

# 메딕스 Medix — 참조용 AI 프록시 (server/)

정적 데모 사이트는 기본적으로 **내장 Mock**으로 AI 기능이 동작합니다.
**실제 Claude**를 연동하려면, 운영자가 이 프록시를 **자신의 서버**에 배포하고
서버 측 환경변수로 API 키를 제공하면 됩니다.

> 🔒 **키는 서버에만.** API 키는 절대 브라우저나 리포지토리에 두지 않습니다.
> 브라우저는 `{task, payload}`만 이 프록시로 보내고, 프록시가 서버 측
> `ANTHROPIC_API_KEY`로 Claude를 호출한 뒤 텍스트를 스트리밍으로 되돌려줍니다.

> ⚠️ 이 리포지토리(데모/CI) 안에서는 프록시를 **실행하지 않습니다.**
> CI는 `node --check` 문법 검사만 수행하며, 실제 API 호출은 일어나지 않습니다.

## 동작 방식

```
[브라우저 정적 사이트]  --POST {task,payload}-->  [server/ 프록시]  --키 사용-->  [Claude API]
        ^                                                   |
        +-------------------  스트리밍 텍스트  --------------+
```

- 엔드포인트: `POST /api/ai`  (본문: `{"task": "...", "payload": {...}}`)
- 헬스체크: `GET /health` → `{"ok":true,"model":"claude-opus-5"}`
- 응답: `text/plain` 스트리밍 (토큰이 생성되는 대로 흘려보냄)
- 모델: `claude-opus-5` · `max_tokens: 2048` · `thinking: {type:"adaptive"}` · 스트리밍
- 지원 task: `chat`(영양 상담), `stack`(맞춤 스택 설명), `interactions`(성분 상호작용 설명)

## 배포 / 실행 (운영자 전용)

```bash
cd server
npm install                 # @anthropic-ai/sdk 설치
cp .env.example .env        # .env 에 실제 키 입력 (커밋 금지)
ANTHROPIC_API_KEY=... npm start
# 또는 .env 를 로드하는 프로세스 매니저로 구동
```

그런 다음 정적 사이트의 `ai/config.js`에서 프록시 주소를 지정합니다:

```js
export const AI_ENDPOINT = "https://your-proxy.example.com/api/ai";
```

`AI_ENDPOINT`가 비어 있으면(`""`) 사이트는 계속 내장 Mock으로 동작합니다.

## 환경변수

| 변수 | 필수 | 기본값 | 설명 |
|------|------|--------|------|
| `ANTHROPIC_API_KEY` | ✅ | — | **서버 측** API 키. 브라우저/리포지토리에 두지 말 것 |
| `PORT` | ❌ | `8787` | 프록시 포트 |
| `ALLOWED_ORIGIN` | ❌ | `*` | CORS 허용 출처(운영 시 정적 사이트 출처로 제한 권장) |

## 보안 원칙

- **API 키는 서버 측에만 존재합니다.** 프런트엔드 번들·리포지토리·URL에 절대 넣지 않습니다.
- `.env`는 커밋하지 않습니다(`.gitignore` 포함). 커밋용 예시는 `.env.example`뿐입니다.
- 운영 배포 시 `ALLOWED_ORIGIN`을 실제 사이트 출처로 좁히고, 필요하면 요청 속도 제한을 추가하세요.

## 라이선스

Apache-2.0 · **Not an official Anthropic product.**
