// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// app.js — 메딕스(Medix) 셀렉트샵 SPA (데모 모드, no-build)
// 브라우저에서 fetch 로 데이터 로드 → 해시 라우팅 → 렌더.

import { recommend } from "./recommender.js";
import { analyzeCart } from "./interactions.js";
import store from "./storage.js";
import { askAI, TASKS } from "../ai/ai.js";

// ---------------------------------------------------------------- 상태
const state = {
  products: [],
  nutrients: {},
  cart: store.load("cart", []), // [{id, qty}]
  wish: store.load("wish", []), // [id]
  survey: store.load("survey", null),
  routine: store.load("routine", { 아침: [], 점심: [], 저녁: [] }),
  subscribe: store.load("subscribe", false),
  orders: store.load("orders", []),
  prefs: store.load("prefs", { theme: "auto", large: false }),
  filters: { purposes: [], brand: "", q: "", sort: "추천", maxPrice: 0 },
};

const PURPOSES = ["면역", "피로", "수면", "관절", "눈", "장건강"];
const COMMON_ING = ["비타민 C", "비타민 D", "마그네슘", "오메가3", "루테인", "아연", "철분", "프로바이오틱스"];

// ---------------------------------------------------------------- 유틸
const $ = (sel, el = document) => el.querySelector(sel);
const won = (n) => (Number(n) || 0).toLocaleString("ko-KR") + "원";
const byId = (id) => state.products.find((p) => p.id === id);
const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 1900);
}

function svgArt(product, size = 120) {
  const c = product.color || "#3faa7a";
  const label = esc((product.name || "?").slice(0, 2));
  return `<svg viewBox="0 0 120 120" width="${size}" height="${size}" role="img" aria-label="${esc(product.name)} 제품 이미지">
    <defs><linearGradient id="g${esc(product.id)}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="#ffffff33"/></linearGradient></defs>
    <rect x="34" y="18" width="52" height="84" rx="12" fill="url(#g${esc(product.id)})" stroke="#00000022"/>
    <rect x="42" y="10" width="36" height="16" rx="6" fill="${c}" stroke="#00000022"/>
    <rect x="40" y="48" width="40" height="30" rx="4" fill="#ffffffcc"/>
    <text x="60" y="68" text-anchor="middle" font-size="14" font-weight="700" fill="${c}">${label}</text>
  </svg>`;
}

function stars(r) {
  const full = Math.round(Number(r) || 0);
  return "★★★★★☆☆☆☆☆".slice(5 - full, 10 - full);
}

// ---------------------------------------------------------------- 영속
function persist() {
  store.save("cart", state.cart);
  store.save("wish", state.wish);
  store.save("routine", state.routine);
  store.save("subscribe", state.subscribe);
  store.save("prefs", state.prefs);
  store.save("orders", state.orders);
}

function cartCount() {
  return state.cart.reduce((n, c) => n + c.qty, 0);
}
function cartProducts() {
  return state.cart.map((c) => ({ ...byId(c.id), qty: c.qty })).filter((p) => p && p.id);
}
function addToCart(id, qty = 1) {
  const row = state.cart.find((c) => c.id === id);
  if (row) row.qty += qty;
  else state.cart.push({ id, qty });
  persist();
  updateBadges();
  toast("장바구니에 담았어요");
}
function toggleWish(id) {
  const i = state.wish.indexOf(id);
  if (i >= 0) state.wish.splice(i, 1);
  else state.wish.push(id);
  persist();
  updateBadges();
}

// ---------------------------------------------------------------- 테마/접근성
function applyPrefs() {
  const root = document.documentElement;
  if (state.prefs.theme === "dark") root.setAttribute("data-theme", "dark");
  else if (state.prefs.theme === "light") root.setAttribute("data-theme", "light");
  else root.removeAttribute("data-theme");
  document.body.classList.toggle("large-text", !!state.prefs.large);
  const tb = $("#theme-btn");
  if (tb) tb.textContent = state.prefs.theme === "dark" ? "☀️" : "🌙";
  const lb = $("#large-btn");
  if (lb) lb.setAttribute("aria-pressed", String(!!state.prefs.large));
}

// ---------------------------------------------------------------- 라우터
function router() {
  const hash = location.hash.replace(/^#\/?/, "") || "catalog";
  const [route, arg] = hash.split("/");
  const main = $("#view");
  window.scrollTo(0, 0);
  const map = {
    catalog: renderCatalog,
    product: () => renderDetail(arg),
    survey: renderSurvey,
    ai: renderAiChat,
    cart: renderCart,
    routine: renderRoutine,
    wish: renderWish,
    subscribe: renderSubscribe,
  };
  (map[route] || renderCatalog)(main);
  document.querySelectorAll("[data-nav]").forEach((a) =>
    a.classList.toggle("active", a.getAttribute("data-nav") === route)
  );
}

// ---------------------------------------------------------------- 카탈로그
function filteredProducts() {
  const f = state.filters;
  let list = state.products.slice();
  if (f.purposes.length)
    list = list.filter((p) => f.purposes.every((g) => (p.purposes || []).includes(g)));
  if (f.brand) list = list.filter((p) => p.brand === f.brand);
  if (f.maxPrice) list = list.filter((p) => p.price <= f.maxPrice);
  if (f.q) {
    const q = f.q.toLowerCase();
    list = list.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q) ||
        (p.ingredients || []).some((i) => i.name.toLowerCase().includes(q))
    );
  }
  const s = f.sort;
  if (s === "가격↑") list.sort((a, b) => a.price - b.price);
  else if (s === "가격↓") list.sort((a, b) => b.price - a.price);
  else if (s === "평점") list.sort((a, b) => b.rating - a.rating);
  else list.sort((a, b) => b.rating * b.reviewCount - a.rating * a.reviewCount); // 추천=인기
  return list;
}

function productCard(p) {
  const wished = state.wish.includes(p.id);
  return `<article class="card">
    <a class="card-art" href="#/product/${esc(p.id)}">${svgArt(p, 96)}</a>
    <button class="wish ${wished ? "on" : ""}" data-wish="${esc(p.id)}" aria-label="찜">${wished ? "♥" : "♡"}</button>
    <div class="card-body">
      <div class="tags">${(p.purposes || []).map((g) => `<span class="tag">${esc(g)}</span>`).join("")}</div>
      <a class="card-title" href="#/product/${esc(p.id)}">${esc(p.name)}</a>
      <div class="brand">${esc(p.brand)}</div>
      <div class="rate">${stars(p.rating)} <span>${p.rating} (${p.reviewCount})</span></div>
      <div class="card-foot">
        <strong>${won(p.price)}</strong>
        <button class="btn small" data-add="${esc(p.id)}">담기</button>
      </div>
    </div>
  </article>`;
}

function renderCatalog(main) {
  const f = state.filters;
  const brands = [...new Set(state.products.map((p) => p.brand))].sort();
  const list = filteredProducts();
  main.innerHTML = `
  <section id="view-catalog">
    <div class="filters" role="region" aria-label="필터">
      <input id="q" class="input" type="search" placeholder="제품·브랜드·성분 검색" value="${esc(f.q)}" />
      <div class="chips" role="group" aria-label="목적">
        ${PURPOSES.map(
          (g) => `<button class="chip ${f.purposes.includes(g) ? "on" : ""}" data-purpose="${g}">${g}</button>`
        ).join("")}
      </div>
      <div class="filter-row">
        <select id="brand" class="input">
          <option value="">전체 브랜드</option>
          ${brands.map((b) => `<option ${b === f.brand ? "selected" : ""}>${esc(b)}</option>`).join("")}
        </select>
        <select id="sort" class="input">
          ${["추천", "가격↑", "가격↓", "평점"].map((s) => `<option ${s === f.sort ? "selected" : ""}>${s}</option>`).join("")}
        </select>
      </div>
      <label class="price-range">최대가격: <b id="price-out">${f.maxPrice ? won(f.maxPrice) : "제한없음"}</b>
        <input id="price" type="range" min="0" max="40000" step="1000" value="${f.maxPrice}" />
      </label>
      <div class="count">${list.length}개 제품</div>
    </div>
    <div id="product-grid" class="grid">
      ${list.map(productCard).join("") || '<p class="empty">조건에 맞는 제품이 없어요.</p>'}
    </div>
  </section>`;

  $("#q").addEventListener("input", (e) => {
    f.q = e.target.value;
    refreshGrid();
  });
  $("#brand").addEventListener("change", (e) => {
    f.brand = e.target.value;
    refreshGrid();
  });
  $("#sort").addEventListener("change", (e) => {
    f.sort = e.target.value;
    refreshGrid();
  });
  $("#price").addEventListener("input", (e) => {
    f.maxPrice = Number(e.target.value);
    $("#price-out").textContent = f.maxPrice ? won(f.maxPrice) : "제한없음";
    refreshGrid();
  });
  main.querySelectorAll("[data-purpose]").forEach((b) =>
    b.addEventListener("click", () => {
      const g = b.getAttribute("data-purpose");
      const i = f.purposes.indexOf(g);
      if (i >= 0) f.purposes.splice(i, 1);
      else f.purposes.push(g);
      b.classList.toggle("on");
      refreshGrid();
    })
  );
}

function refreshGrid() {
  const grid = $("#product-grid");
  if (!grid) return;
  const list = filteredProducts();
  grid.innerHTML = list.map(productCard).join("") || '<p class="empty">조건에 맞는 제품이 없어요.</p>';
  const c = $(".count");
  if (c) c.textContent = `${list.length}개 제품`;
}

// ---------------------------------------------------------------- 게이지
function gauge(ing, nutrients) {
  const ref = nutrients[ing.name] || {};
  if (!ref.rda) return "";
  const pct = Math.min(300, Math.round((ing.amount / ref.rda) * 100));
  const over = ref.ul && ing.amount > ref.ul;
  return `<div class="gauge ${over ? "over" : ""}">
    <div class="gauge-label"><span>${esc(ing.name)}</span><span>${ing.amount}${esc(ing.unit)} · 권장 대비 ${pct}%</span></div>
    <div class="gauge-bar"><span style="width:${Math.min(100, pct)}%"></span></div>
    ${over ? `<div class="gauge-warn">⚠ 상한 ${ref.ul}${esc(ing.unit)} 초과</div>` : ""}
  </div>`;
}

// ---------------------------------------------------------------- 상세
function renderDetail(id) {
  const main = $("#view");
  const p = byId(id);
  if (!p) {
    main.innerHTML = `<section id="view-detail"><p class="empty">제품을 찾을 수 없어요. <a href="#/catalog">카탈로그로</a></p></section>`;
    return;
  }
  const wished = state.wish.includes(p.id);
  main.innerHTML = `
  <section id="view-detail" class="detail">
    <a class="back" href="#/catalog">← 카탈로그</a>
    <div class="detail-top">
      <div class="detail-art">${svgArt(p, 200)}</div>
      <div class="detail-info">
        <div class="tags">${(p.purposes || []).map((g) => `<span class="tag">${esc(g)}</span>`).join("")}</div>
        <h1>${esc(p.name)}</h1>
        <div class="brand">${esc(p.brand)} · ${esc(p.form)} · 1일 ${p.servingPerDay}회</div>
        <div class="rate">${stars(p.rating)} ${p.rating} (${p.reviewCount} 리뷰)</div>
        <div class="price-big">${won(p.price)}</div>
        <div class="detail-actions">
          <button class="btn" data-add="${esc(p.id)}">장바구니 담기</button>
          <button class="btn ghost" data-wish="${esc(p.id)}">${wished ? "♥ 찜됨" : "♡ 찜"}</button>
          <button class="btn ghost" data-routine="${esc(p.id)}">루틴에 추가</button>
        </div>
      </div>
    </div>
    <div class="detail-grid">
      <div class="panel">
        <h2>성분·함량 (일일 권장량 대비)</h2>
        ${(p.ingredients || []).map((i) => gauge(i, state.nutrients) || `<div class="gauge"><div class="gauge-label"><span>${esc(i.name)}</span><span>${i.amount}${esc(i.unit)}</span></div></div>`).join("")}
      </div>
      <div class="panel">
        <h2>복용법</h2><p>${esc(p.usage)}</p>
        <h2>주의사항</h2><p class="caution">⚠ ${esc(p.caution)}</p>
      </div>
    </div>
    <div class="panel">
      <h2>리뷰 (${p.reviewCount})</h2>
      ${(p.reviews || []).map((r) => `<div class="review"><b>${esc(r.user)}</b> ${stars(r.score)}<p>${esc(r.text)}</p></div>`).join("") || "<p>리뷰가 없어요.</p>"}
      <p class="fine">※ 리뷰는 데모용 허구입니다.</p>
    </div>
  </section>`;

  main.querySelector("[data-routine]").addEventListener("click", () => {
    if (!state.routine["아침"].includes(p.id)) {
      state.routine["아침"].push(p.id);
      persist();
      toast("아침 루틴에 추가했어요");
    } else toast("이미 아침 루틴에 있어요");
  });
}

// ---------------------------------------------------------------- 설문
function renderSurvey() {
  const main = $("#view");
  const s = state.survey || { age: "", gender: "", goals: [], taking: [], budget: "" };
  main.innerHTML = `
  <section id="view-survey">
    <h1>맞춤 추천 설문</h1>
    <p class="lead">간단한 설문으로 목적에 맞는 조합을 추천해 드려요. (규칙 기반 · 의학적 처방 아님)</p>
    <form id="survey-form" class="survey">
      <label>나이 <input class="input" name="age" type="number" min="1" max="120" value="${esc(s.age)}" required></label>
      <fieldset><legend>성별</legend>
        ${[["female", "여성"], ["male", "남성"], ["other", "선택안함"]]
          .map((g) => `<label class="radio"><input type="radio" name="gender" value="${g[0]}" ${s.gender === g[0] ? "checked" : ""}>${g[1]}</label>`)
          .join("")}
      </fieldset>
      <fieldset><legend>목적 (복수 선택)</legend>
        <div class="chips">${PURPOSES.map((g) => `<label class="chip-check"><input type="checkbox" name="goal" value="${g}" ${s.goals.includes(g) ? "checked" : ""}>${g}</label>`).join("")}</div>
      </fieldset>
      <fieldset><legend>현재 복용 중 (중복 회피에 사용)</legend>
        <div class="chips">${COMMON_ING.map((g) => `<label class="chip-check"><input type="checkbox" name="taking" value="${g}" ${s.taking.includes(g) ? "checked" : ""}>${g}</label>`).join("")}</div>
      </fieldset>
      <label>월 예산(선택) <input class="input" name="budget" type="number" min="0" step="1000" placeholder="예: 60000" value="${esc(s.budget)}"></label>
      <button class="btn" type="submit">추천 받기</button>
    </form>
    <div id="survey-result"></div>
  </section>`;

  $("#survey-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const survey = {
      age: Number(fd.get("age")) || 0,
      gender: fd.get("gender") || "other",
      goals: fd.getAll("goal"),
      taking: fd.getAll("taking"),
      budget: Number(fd.get("budget")) || 0,
    };
    state.survey = survey;
    store.save("survey", survey);
    showRecommendation(survey);
  });

  if (state.survey) showRecommendation(state.survey);
}

function showRecommendation(survey) {
  const box = $("#survey-result");
  if (!survey.goals || !survey.goals.length) {
    box.innerHTML = `<p class="empty">목적을 1개 이상 선택해 주세요.</p>`;
    return;
  }
  const { picks } = recommend(survey, state.products, { max: 4 });
  if (!picks.length) {
    box.innerHTML = `<p class="empty">조건에 맞는 추천이 없어요.</p>`;
    return;
  }
  const total = picks.reduce((n, x) => n + x.product.price, 0);
  box.innerHTML = `
    <h2>추천 조합 (${picks.length}종)</h2>
    <p class="lead">예상 합계 <b>${won(total)}</b>${survey.budget ? ` · 월 예산 ${won(survey.budget)}` : ""}</p>
    <div class="rec-list">
      ${picks
        .map(
          (x) => `<div class="rec">
        <a class="rec-art" href="#/product/${esc(x.product.id)}">${svgArt(x.product, 72)}</a>
        <div class="rec-body">
          <a class="rec-title" href="#/product/${esc(x.product.id)}">${esc(x.product.name)}</a>
          <div class="brand">${esc(x.product.brand)} · ${won(x.product.price)} · 점수 ${x.score}</div>
          <ul class="reasons">${x.reasons.map((r) => `<li>✔ ${esc(r)}</li>`).join("")}</ul>
        </div>
        <button class="btn small" data-add="${esc(x.product.id)}">담기</button>
      </div>`
        )
        .join("")}
    </div>
    <div class="rec-actions">
      <button class="btn" id="add-all">추천 전체 담기</button>
      <button class="btn ghost" id="ai-explain">🤖 AI 맞춤 설명</button>
    </div>
    <div id="ai-stack" class="ai-out" hidden></div>
    <p class="fine">※ 규칙 기반 추천이며 의학적 조언이 아닙니다. 복용 전 전문가와 상담하세요.</p>`;
  $("#add-all").addEventListener("click", () => {
    picks.forEach((x) => addToCart(x.product.id, 1));
    location.hash = "#/cart";
  });
  $("#ai-explain").addEventListener("click", (e) => {
    const out = $("#ai-stack");
    out.hidden = false;
    runAiInto(TASKS.STACK, { survey, products: state.products }, out, e.currentTarget);
  });
}

// ---------------------------------------------------------------- 장바구니
function warningBlock(a) {
  if (!a.hasWarning) return `<div class="ok">✔ 성분 중복·과다·상호작용 경고가 없어요.</div>`;
  let h = "";
  if (a.pairWarnings.length)
    h += `<div class="warn-group"><h3>⚠ 성분 상호작용</h3>${a.pairWarnings.map((w) => `<div class="warn ${w.level === "경고" ? "danger" : ""}"><b>[${esc(w.level)}] ${esc(w.a)} + ${esc(w.b)}</b><p>${esc(w.message)}</p></div>`).join("")}</div>`;
  if (a.overAmounts.length)
    h += `<div class="warn-group"><h3>⚠ 권장/상한 초과</h3>${a.overAmounts.map((w) => `<div class="warn ${w.level === "경고" ? "danger" : ""}"><b>[${esc(w.level)}] ${esc(w.name)}</b><p>${esc(w.message)}</p></div>`).join("")}</div>`;
  if (a.overlaps.length)
    h += `<div class="warn-group"><h3>ℹ 중복 성분</h3>${a.overlaps.map((o) => `<div class="warn"><b>${esc(o.name)}</b> — ${esc(o.products.join(", "))} (합산 ${o.total}${esc(o.unit)})</div>`).join("")}</div>`;
  return h;
}

function renderCart() {
  const main = $("#view");
  const items = cartProducts();
  const analysis = analyzeCart(items, state.nutrients);
  const subtotal = items.reduce((n, p) => n + p.price * p.qty, 0);
  const subDiscount = state.subscribe ? Math.round(subtotal * 0.15) : 0;
  const total = subtotal - subDiscount;

  main.innerHTML = `
  <section id="view-cart">
    <h1>장바구니 (${cartCount()})</h1>
    ${
      items.length
        ? `
    <div class="cart-layout">
      <div class="cart-items">
        ${items
          .map(
            (p) => `<div class="cart-row">
          ${svgArt(p, 56)}
          <div class="cart-meta"><a href="#/product/${esc(p.id)}">${esc(p.name)}</a><div class="brand">${esc(p.brand)}</div></div>
          <div class="qty"><button data-dec="${esc(p.id)}">−</button><span>${p.qty}</span><button data-inc="${esc(p.id)}">+</button></div>
          <div class="cart-price">${won(p.price * p.qty)}</div>
          <button class="rm" data-rm="${esc(p.id)}" aria-label="삭제">✕</button>
        </div>`
          )
          .join("")}
      </div>
      <aside class="cart-side">
        <div id="cart-warnings" class="panel">
          <h2>성분 안전 체크</h2>
          ${warningBlock(analysis)}
          <button class="btn ghost small" id="ai-warn-btn">🤖 AI 경고 설명</button>
          <div id="ai-warn" class="ai-out" hidden></div>
        </div>
        <div class="panel">
          <h2>일일 성분 합산</h2>
          ${analysis.totals
            .filter((t) => t.percentRda != null)
            .map(
              (t) => `<div class="gauge ${t.ul && t.total > t.ul ? "over" : ""}">
              <div class="gauge-label"><span>${esc(t.name)}</span><span>${t.total}${esc(t.unit)} · ${t.percentRda}%</span></div>
              <div class="gauge-bar"><span style="width:${Math.min(100, t.percentRda)}%"></span></div></div>`
            )
            .join("") || "<p class='fine'>권장량 기준 성분이 없어요.</p>"}
        </div>
        <div class="panel summary">
          <label class="sub-toggle"><input type="checkbox" id="sub-chk" ${state.subscribe ? "checked" : ""}> 정기구독(모의) 15% 할인</label>
          <div class="sum-row"><span>상품합계</span><b>${won(subtotal)}</b></div>
          ${subDiscount ? `<div class="sum-row discount"><span>구독할인</span><b>-${won(subDiscount)}</b></div>` : ""}
          <div class="sum-row total"><span>결제예정</span><b>${won(total)}</b></div>
          <button class="btn" id="checkout">모의 결제하기</button>
          <p class="fine">※ 실제 결제·구독이 아닙니다(데모).</p>
        </div>
      </aside>
    </div>`
        : `<p class="empty">장바구니가 비었어요. <a href="#/catalog">쇼핑하러 가기</a> 또는 <a href="#/survey">추천 받기</a></p>`
    }
  </section>`;

  main.querySelectorAll("[data-inc]").forEach((b) => b.addEventListener("click", () => changeQty(b.dataset.inc, 1)));
  main.querySelectorAll("[data-dec]").forEach((b) => b.addEventListener("click", () => changeQty(b.dataset.dec, -1)));
  main.querySelectorAll("[data-rm]").forEach((b) =>
    b.addEventListener("click", () => {
      state.cart = state.cart.filter((c) => c.id !== b.dataset.rm);
      persist();
      updateBadges();
      renderCart();
    })
  );
  const sub = $("#sub-chk");
  if (sub) sub.addEventListener("change", (e) => { state.subscribe = e.target.checked; persist(); renderCart(); });
  const co = $("#checkout");
  if (co) co.addEventListener("click", () => checkout(items, total));
  const aiWarn = $("#ai-warn-btn");
  if (aiWarn)
    aiWarn.addEventListener("click", (e) => {
      const out = $("#ai-warn");
      out.hidden = false;
      runAiInto(TASKS.INTERACTIONS, { cartProducts: items, nutrients: state.nutrients }, out, e.currentTarget);
    });
}

function changeQty(id, delta) {
  const row = state.cart.find((c) => c.id === id);
  if (!row) return;
  row.qty += delta;
  if (row.qty <= 0) state.cart = state.cart.filter((c) => c.id !== id);
  persist();
  updateBadges();
  renderCart();
}

function checkout(items, total) {
  const order = {
    id: "ORD-" + Date.now(),
    date: new Date().toISOString().slice(0, 10),
    items: items.map((p) => ({ id: p.id, name: p.name, qty: p.qty })),
    total,
    subscribe: state.subscribe,
  };
  state.orders.push(order);
  state.cart = [];
  persist();
  updateBadges();
  const main = $("#view");
  main.innerHTML = `<section id="view-cart" class="thanks">
    <h1>✅ 모의 결제 완료</h1>
    <p>주문번호 <b>${esc(order.id)}</b> · 결제금액 <b>${won(total)}</b>${order.subscribe ? " · 정기구독(모의)" : ""}</p>
    <p class="fine">실제 결제가 이루어지지 않았습니다. 데모 모드입니다.</p>
    <div class="detail-actions"><a class="btn" href="#/catalog">계속 쇼핑</a><a class="btn ghost" href="#/routine">복용 루틴 설정</a></div>
  </section>`;
}

// ---------------------------------------------------------------- 루틴
function renderRoutine() {
  const main = $("#view");
  const slots = ["아침", "점심", "저녁"];
  const owned = [...new Set([...state.cart.map((c) => c.id), ...state.wish, ...state.orders.flatMap((o) => o.items.map((i) => i.id))])];
  main.innerHTML = `
  <section id="view-routine">
    <h1>내 영양 루틴</h1>
    <p class="lead">담았거나 찜한 제품을 시간대별 복용 스케줄로 관리하세요.</p>
    <div class="routine-grid">
      ${slots
        .map(
          (slot) => `<div class="routine-slot"><h2>${slot}</h2>
        ${(state.routine[slot] || [])
          .map((id) => {
            const p = byId(id);
            return p ? `<div class="routine-item">${svgArt(p, 40)}<span>${esc(p.name)}</span><button data-rr="${slot}|${esc(id)}">✕</button></div>` : "";
          })
          .join("") || "<p class='fine'>비어있음</p>"}
        <select class="input" data-radd="${slot}">
          <option value="">+ 제품 추가</option>
          ${owned.map((id) => { const p = byId(id); return p ? `<option value="${esc(id)}">${esc(p.name)}</option>` : ""; }).join("")}
        </select>
      </div>`
        )
        .join("")}
    </div>
    <p class="fine">※ 스케줄은 브라우저(localStorage)에만 저장됩니다.</p>
  </section>`;

  main.querySelectorAll("[data-rr]").forEach((b) =>
    b.addEventListener("click", () => {
      const [slot, id] = b.dataset.rr.split("|");
      state.routine[slot] = state.routine[slot].filter((x) => x !== id);
      persist();
      renderRoutine();
    })
  );
  main.querySelectorAll("[data-radd]").forEach((sel) =>
    sel.addEventListener("change", () => {
      const slot = sel.dataset.radd;
      if (sel.value && !state.routine[slot].includes(sel.value)) {
        state.routine[slot].push(sel.value);
        persist();
        renderRoutine();
      }
    })
  );
}

// ---------------------------------------------------------------- 찜
function renderWish() {
  const main = $("#view");
  const items = state.wish.map(byId).filter(Boolean);
  main.innerHTML = `<section id="view-catalog"><h1>찜 목록 (${items.length})</h1>
    <div id="product-grid" class="grid">${items.map(productCard).join("") || '<p class="empty">찜한 제품이 없어요.</p>'}</div></section>`;
}

// ---------------------------------------------------------------- 구독 안내
function renderSubscribe() {
  const main = $("#view");
  main.innerHTML = `<section id="view-cart"><h1>정기구독 (모의)</h1>
    <p class="lead">장바구니에서 정기구독을 켜면 15% 할인된 금액으로 매월 자동 결제되는 것으로 <b>시뮬레이션</b>됩니다.</p>
    <ul class="feature-list">
      <li>✔ 매월 자동 배송(모의) · 언제든 해지</li>
      <li>✔ 구독 15% 할인 반영</li>
      <li>✔ 복용 루틴과 연동해 리마인드(데모)</li>
    </ul>
    <a class="btn" href="#/cart">장바구니에서 구독 켜기</a>
    <p class="fine">※ 실제 결제/구독/배송이 발생하지 않습니다.</p></section>`;
}

// ---------------------------------------------------------------- AI 기능
// askAI 호출 결과를 대상 요소에 스트리밍(textContent, XSS 안전)으로 채운다.
async function runAiInto(task, payload, targetEl, btn) {
  if (!targetEl) return;
  targetEl.textContent = "생각 중…";
  targetEl.classList.add("ai-streaming");
  if (btn) btn.disabled = true;
  let first = true;
  try {
    await askAI(task, payload, {
      onToken: (t) => {
        if (first) { targetEl.textContent = ""; first = false; }
        targetEl.textContent += t;
      },
    });
  } catch (e) {
    targetEl.textContent = "AI 응답을 가져오지 못했어요: " + (e && e.message ? e.message : e);
  } finally {
    targetEl.classList.remove("ai-streaming");
    if (btn) btn.disabled = false;
  }
}

// (1) AI 영양 상담 챗봇
function renderAiChat() {
  const main = $("#view");
  main.innerHTML = `
  <section id="view-ai">
    <h1>🤖 AI 영양 상담</h1>
    <p class="lead">건강 목적을 자연어로 물어보세요. 예: “요즘 피로하고 잠을 잘 못 자요, 뭘 챙기면 좋을까요?”</p>
    <div id="ai-log" class="ai-log" aria-live="polite"></div>
    <form id="ai-form" class="ai-form">
      <input id="ai-q" class="input" type="text" autocomplete="off"
        placeholder="궁금한 점을 입력하세요 (예: 면역과 눈 건강을 같이 챙기고 싶어요)" required />
      <button class="btn" type="submit">질문</button>
    </form>
    <div class="ai-examples">
      ${["요즘 너무 피로하고 잠을 못 자요", "면역과 눈 건강을 같이 챙기고 싶어요", "관절이 안 좋은데 뭐가 좋을까요"]
        .map((q) => `<button type="button" class="chip" data-ai-ex="${esc(q)}">${esc(q)}</button>`)
        .join("")}
    </div>
    <p class="fine">🤖 AI 응답은 기본적으로 내장 Mock(오프라인·결정론)으로 생성됩니다. 규칙 엔진 데이터에 근거하며 <b>의학적 조언이 아닙니다</b>.</p>
  </section>`;

  const log = $("#ai-log");
  const input = $("#ai-q");

  async function ask(question) {
    const q = String(question || "").trim();
    if (!q) return;
    const userEl = document.createElement("div");
    userEl.className = "ai-bubble ai-user";
    userEl.textContent = q;
    log.appendChild(userEl);
    const botEl = document.createElement("div");
    botEl.className = "ai-bubble ai-bot";
    log.appendChild(botEl);
    log.scrollTop = log.scrollHeight;
    await runAiInto(
      TASKS.CHAT,
      { question: q, products: state.products, survey: state.survey },
      botEl,
      $("#ai-form button")
    );
    log.scrollTop = log.scrollHeight;
  }

  $("#ai-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = input.value;
    input.value = "";
    ask(q);
  });
  main.querySelectorAll("[data-ai-ex]").forEach((b) =>
    b.addEventListener("click", () => ask(b.getAttribute("data-ai-ex")))
  );
}

// ---------------------------------------------------------------- 배지/전역
function updateBadges() {
  const cb = $("#cart-badge");
  if (cb) cb.textContent = cartCount();
  const wb = $("#wish-badge");
  if (wb) wb.textContent = state.wish.length;
}

function bindGlobal() {
  // 이벤트 위임: 담기/찜
  document.body.addEventListener("click", (e) => {
    const add = e.target.closest("[data-add]");
    if (add) { addToCart(add.getAttribute("data-add")); return; }
    const wish = e.target.closest("[data-wish]");
    if (wish) {
      toggleWish(wish.getAttribute("data-wish"));
      wish.classList.toggle("on");
      if (wish.textContent.trim() === "♡" || wish.textContent.includes("찜됨") || wish.textContent.includes("♡"))
        router();
      return;
    }
  });
  $("#theme-btn").addEventListener("click", () => {
    state.prefs.theme = state.prefs.theme === "dark" ? "light" : "dark";
    persist();
    applyPrefs();
  });
  $("#large-btn").addEventListener("click", () => {
    state.prefs.large = !state.prefs.large;
    persist();
    applyPrefs();
  });
  $("#reset-btn").addEventListener("click", () => {
    if (confirm("모든 데모 데이터(장바구니·찜·설문·루틴)를 초기화할까요?")) {
      store.resetAll();
      location.reload();
    }
  });
  const menu = $("#menu-btn");
  if (menu) menu.addEventListener("click", () => $("#nav").classList.toggle("open"));
  document.querySelectorAll("[data-nav]").forEach((a) =>
    a.addEventListener("click", () => $("#nav").classList.remove("open"))
  );
  window.addEventListener("hashchange", router);
}

// ---------------------------------------------------------------- 부팅
async function boot() {
  applyPrefs();
  bindGlobal();
  updateBadges();
  try {
    const [prods, nutr] = await Promise.all([
      fetch("./data/supplements.json").then((r) => r.json()),
      fetch("./data/nutrients.json").then((r) => r.json()),
    ]);
    state.products = prods.products || [];
    state.nutrients = nutr.nutrients || {};
  } catch (e) {
    console.error("데이터 로드 실패:", e);
    $("#view").innerHTML = `<p class="empty">데이터를 불러오지 못했어요. 로컬 서버(예: python -m http.server)로 실행했는지 확인하세요.</p>`;
    return;
  }
  updateBadges();
  router();
}

document.addEventListener("DOMContentLoaded", boot);
