import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { getIntlLocale, getLanguage, languageStorageKey, restoreLanguage, setLanguage, subscribeLanguage, t, translateLabel } from "./language";
import { messages } from "./messages";
import { displayNestedValue, summarizeChange } from "../features/admin/components/audit-log-display";

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
  Reflect.deleteProperty(globalThis, "document");
  setLanguage("en");
});

test("English is the default, and changing language notifies subscribers only once", () => {
  assert.equal(getLanguage(), "en");
  assert.equal(getIntlLocale(), "en-US");
  assert.equal(t("Language"), "Language");
  let notifications = 0;
  const unsubscribe = subscribeLanguage(() => notifications++);
  setLanguage("vi");
  setLanguage("vi");
  assert.equal(t("Language"), "Ngôn ngữ");
  assert.equal(getIntlLocale(), "vi-VN");
  assert.equal(notifications, 1);
  unsubscribe();
  setLanguage("en");
  assert.equal(notifications, 1);
});

test("every translation preserves the source interpolation parameters", () => {
  const parameters = (value: string) => [...value.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)].map((match) => match[1]).sort();
  for (const [source, translated] of Object.entries(messages)) {
    assert.ok(translated.trim(), `Empty translation: ${source}`);
    assert.deepEqual(parameters(translated), parameters(source), source);
  }
});

test("stored UI messages can switch both ways without changing their parameters", () => {
  setLanguage("vi");
  const translated = translateLabel('Editing "Điện thoại <test>"');
  assert.equal(translated, 'Đang chỉnh sửa "Điện thoại <test>"');
  setLanguage("en");
  assert.equal(translateLabel(translated), 'Editing "Điện thoại <test>"');
  assert.equal(translateLabel("Không thể tải chi tiết đơn hàng."), "Could not load order details.");
  assert.equal(translateLabel("Thời trang"), "Fashion");
  assert.equal(translateLabel("refund_pending"), "Refund pending");
});

test("unknown labels and prototype property names are safe and preserved", () => {
  for (const language of ["en", "vi"] as const) {
    setLanguage(language);
    for (const value of ["Custom category", "toString", "constructor", "__proto__"]) assert.equal(translateLabel(value), value);
    assert.equal(translateLabel(undefined), "");
    assert.equal(translateLabel(null), "");
  }
});

test("audit values stay intact while surrounding labels are localized", () => {
  setLanguage("vi");
  assert.equal(displayNestedValue("Pending"), "Pending");
  assert.equal(displayNestedValue(""), "(chuỗi rỗng)");
  assert.equal(summarizeChange({ before: "Pending", after: "Paid" }, "status"), "Pending -> Paid");
  assert.equal(summarizeChange({ before: '[]', after: '["product:create"]' }, "permissions"), "Đã thêm product:create");
});

test("selection persists, restores and updates the document language", () => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value)
  } } });
  const root = { lang: "en" };
  Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement: root } });
  setLanguage("vi");
  assert.equal(storage.get(languageStorageKey), "vi");
  assert.equal(root.lang, "vi");
  storage.set(languageStorageKey, "en");
  restoreLanguage();
  assert.equal(getLanguage(), "en");
  storage.set(languageStorageKey, "vi");
  restoreLanguage();
  assert.equal(getLanguage(), "vi");
  storage.set(languageStorageKey, "unsupported");
  restoreLanguage();
  assert.equal(getLanguage(), "en");
});

test("language switching works when browser storage is denied", () => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
    getItem: () => { throw new Error("Storage denied"); },
    setItem: () => { throw new Error("Storage denied"); }
  } } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement: { lang: "en" } } });
  restoreLanguage();
  assert.equal(getLanguage(), "en");
  setLanguage("vi");
  assert.equal(getLanguage(), "vi");
});
