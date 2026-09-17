// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// storage.js — localStorage 래퍼 (try/catch 안전 처리 + 초기화)
// 데모 모드: 실제 DB가 아니라 브라우저 localStorage에만 저장됩니다.

const PREFIX = "medix.";
const KEYS = {
  survey: PREFIX + "survey",
  cart: PREFIX + "cart",
  wish: PREFIX + "wish",
  routine: PREFIX + "routine",
  subscribe: PREFIX + "subscribe",
  prefs: PREFIX + "prefs",
  orders: PREFIX + "orders",
};

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(KEYS[key] || key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.warn("[storage] load 실패:", key, e);
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(KEYS[key] || key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn("[storage] save 실패:", key, e);
    return false;
  }
}

export function remove(key) {
  try {
    localStorage.removeItem(KEYS[key] || key);
    return true;
  } catch (e) {
    console.warn("[storage] remove 실패:", key, e);
    return false;
  }
}

/** 모든 Medix 데이터 초기화 */
export function resetAll() {
  try {
    Object.values(KEYS).forEach((k) => localStorage.removeItem(k));
    return true;
  } catch (e) {
    console.warn("[storage] resetAll 실패:", e);
    return false;
  }
}

export { KEYS };
export default { load, save, remove, resetAll, KEYS };
