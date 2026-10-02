import assert from "node:assert/strict";
import test from "node:test";

import { isMobileUserAgent } from "./mobile-ua.ts";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ANDROID_PHONE =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36";
const ANDROID_TABLET =
  "Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const IPAD_CLASSIC =
  "Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1";
// iPadOS 13+ in desktop mode: reports Macintosh, distinguished only by "Mobile".
const IPAD_DESKTOP_MODE =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const MAC_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const WINDOWS_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

test("phones are treated as mobile", () => {
  assert.equal(isMobileUserAgent(IPHONE), true);
  assert.equal(isMobileUserAgent(ANDROID_PHONE), true);
});

test("tablets are treated as mobile", () => {
  assert.equal(isMobileUserAgent(IPAD_CLASSIC), true);
  assert.equal(isMobileUserAgent(ANDROID_TABLET), true);
});

test("iPadOS desktop-mode UA is detected via Macintosh + Mobile", () => {
  assert.equal(isMobileUserAgent(IPAD_DESKTOP_MODE), true);
});

test("desktops are NOT treated as mobile — a narrowed window must keep the desktop UI", () => {
  assert.equal(isMobileUserAgent(MAC_SAFARI), false);
  assert.equal(isMobileUserAgent(MAC_CHROME), false);
  assert.equal(isMobileUserAgent(WINDOWS_CHROME), false);
});

test("missing or empty user agents are not mobile", () => {
  assert.equal(isMobileUserAgent(null), false);
  assert.equal(isMobileUserAgent(undefined), false);
  assert.equal(isMobileUserAgent(""), false);
});
