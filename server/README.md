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
- 헬스체크: `GET /health` → `{"ok":true,"model":"claude-haiku-4-5", ...}`
- 응답: `text/plain` 스트리밍 (토큰이 생성되는 대로 흘려보냄)
- 모델: 기본 **`claude-haiku-4-5`**(비용 우선, `AI_MODEL` 로 상향) · task 별 `max_tokens`(~700) ·
  프롬프트 캐싱(`cache_control: ephemeral`) · 스트리밍
  - Haiku 4.5 는 adaptive thinking / effort 를 받지 않으므로(400 방지) 해당 파라미터를 보내지
    않습니다. `claude-sonnet-5` / `claude-opus-5` 등에서는 `thinking:{type:"adaptive"}` +
    `output_config:{effort}` 를 전송합니다.
- 비용 가드레일: IP 당 분당 요청 제한(`AI_RATE_PER_MIN`, 기본 20) + 월 토큰 예산
  (`AI_MONTHLY_TOKEN_CAP`, 기본 2,000,000). 초과 시 **HTTP 429 `{fallback:true}`** 반환 →
  프런트가 내장 Mock 으로 자동 대체.
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
| `AI_MODEL` | ❌ | `claude-haiku-4-5` | 비용 우선 기본. 상향: `claude-sonnet-5` / `claude-opus-5` |
| `AI_EFFORT` | ❌ | `low` | Haiku 외 모델에서만 `output_config.effort` 로 전송 |
| `AI_MONTHLY_TOKEN_CAP` | ❌ | `2000000` | 월 토큰 예산. 초과 시 429 `{fallback:true}` |
| `AI_RATE_PER_MIN` | ❌ | `20` | IP 당 분당 요청 제한 |
| `PORT` | ❌ | `8787` | 프록시 포트 |
| `ALLOWED_ORIGIN` | ❌ | `*` | CORS 허용 출처(운영 시 정적 사이트 출처로 제한 권장) |

## Cloudflare Workers 배포 (무인·무료 티어)

서버를 직접 운영하지 않으려면 동일한 로직의 **Workers 변형**(`worker.js` + `wrangler.toml`)을
무료 티어에 배포하세요. Anthropic REST(`/v1/messages`)를 직접 호출하며 규칙은 동일합니다.

```bash
cd server
npm i -g wrangler
wrangler secret put ANTHROPIC_API_KEY   # 키는 Worker 시크릿에만 저장(브라우저/리포지토리 금지)
wrangler deploy
```

배포 후 정적 사이트의 `ai/config.js` 에서:

```js
export const AI_ENDPOINT = "https://medix-ai-proxy.<계정>.workers.dev/api/ai";
```

모델·예산·요청 제한은 `wrangler.toml` 의 `[vars]` 로 조정합니다(키는 시크릿으로만 설정).
호출이 실패하거나 429 `{fallback:true}` 이면 프런트가 내장 Mock 으로 자동 대체합니다.

## 보안 원칙

- **API 키는 서버 측에만 존재합니다.** 프런트엔드 번들·리포지토리·URL에 절대 넣지 않습니다.
- `.env`는 커밋하지 않습니다(`.gitignore` 포함). 커밋용 예시는 `.env.example`뿐입니다.
- 운영 배포 시 `ALLOWED_ORIGIN`을 실제 사이트 출처로 좁히고, 필요하면 요청 속도 제한을 추가하세요.

## 라이선스

Apache-2.0 · **Not an official Anthropic product.**
