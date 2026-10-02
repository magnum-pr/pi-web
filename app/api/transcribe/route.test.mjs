import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});

const { isWav } = await jiti.import("@/lib/wav.ts");
const { POST } = await jiti.import("./route.ts");

function makeWavHeader() {
  const bytes = new Uint8Array(44);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  bytes.set([0x57, 0x41, 0x56, 0x45], 8); // "WAVE"
  return bytes;
}

test("isWav accepts a RIFF/WAVE header", () => {
  assert.equal(isWav(makeWavHeader()), true);
});

test("isWav rejects non-WAV and short buffers", () => {
  assert.equal(isWav(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])), false);
  assert.equal(isWav(new Uint8Array(4)), false);
});

test("POST rejects a non-WAV body with 400 without touching the server", async () => {
  // This route is guarded by isApiRequestAllowed (added 2026-09-27 — it serves
  // transcription and was previously protected only by Tailnet isolation). A
  // request must therefore look like a trusted same-origin one, or the guard
  // answers 403 before the WAV check is reached. The assertion under test is the
  // 400, so the request is made trusted deliberately.
  const req = new Request("http://localhost/api/transcribe", {
    method: "POST",
    headers: { host: "localhost", origin: "http://localhost", "sec-fetch-site": "same-origin" },
    body: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]),
  });
  const res = await POST(req);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /WAV/);
});

test("POST rejects an untrusted request with 403 before reading the body", async () => {
  const req = new Request("http://evil.example/api/transcribe", {
    method: "POST",
    // `host` must be set explicitly: the guard reads the Host header, and
    // `new Request()` does not derive it from the URL. A non-local, non-IP host
    // that is not in PI_WEB_ALLOWED_HOSTS is rejected.
    headers: { host: "evil.example", origin: "http://evil.example", "sec-fetch-site": "cross-site" },
    body: makeWavHeader(),
  });
  const res = await POST(req);
  assert.equal(res.status, 403);
});
