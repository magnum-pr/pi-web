import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

// Point the agent dir at a temp location *before* importing the route, so the
// suite can never touch the developer's real ~/.pi/agent/voice-config.json.
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const testAgentDir = await mkdtemp(join(tmpdir(), "pi-web-voicecfg-route-"));
process.env.PI_CODING_AGENT_DIR = testAgentDir;

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET, PUT } = await jiti.import("./route.ts");

after(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await rm(testAgentDir, { recursive: true, force: true });
});

/**
 * PUT /api/voice-config is the only write path to voice config, and its whole
 * reason for existing at a machine-local path is that the repo's tracked
 * voice-config.json must never be touched by a request. These tests hold both
 * halves: the patch lands, and the tracked file is byte-identical.
 */

function put(body) {
  return PUT(
    new Request("http://localhost/api/voice-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

test("a valid patch returns the resolved config, reflecting the clamp", async () => {
  const res = await put({ vad: { silenceMs: 999999 } });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.config.vad.silenceMs, 15000, "out-of-range must clamp, not persist");
});

test("a non-object body is rejected rather than written", async () => {
  for (const body of ["[]", '"a string"', "null", "{ bad json"]) {
    const res = await put(body);
    assert.ok(res.status === 400, `expected 400 for ${body}, got ${res.status}`);
  }
});

test("the response never discloses the server's filesystem paths", async () => {
  const res = await put({ sticky: { lapseS: 45 } });
  const data = await res.json();
  assert.equal(data.path, undefined, "the write target is a server-side detail");
  // Broader: nothing anywhere in the payload may leak an absolute path.
  const serialized = JSON.stringify(data);
  assert.doesNotMatch(serialized, /"\/(Users|home|var|tmp)\//, `leaked a filesystem path: ${serialized}`);
});

test("the override still lands inside the isolated agent dir", async () => {
  // The write target is no longer reported, so assert it on disk instead.
  await put({ wakeWord: { phrase: "landed" } });
  const onDisk = JSON.parse(await readFile(join(testAgentDir, "voice-config.json"), "utf8"));
  assert.equal(onDisk.wakeWord.phrase, "landed");
});

test("a PUT leaves the repo's tracked voice-config.json byte-identical", async () => {
  const tracked = join(process.cwd(), "voice-config.json");
  const before = await readFile(tracked, "utf8");
  await put({ wakeWord: { phrase: "definitely-not-oracle" }, vad: { silenceMs: 1234 } });
  const after = await readFile(tracked, "utf8");
  assert.equal(after, before, "the tracked config must be read-only from the API");

  // And git agrees, which is the check that actually protects the workflow.
  const diff = execFileSync("git", ["diff", "--name-only", "--", "voice-config.json"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(diff.trim(), "", "the tracked config must not appear in git diff");
});

test("GET still answers with the resolved config shape consumers expect", async () => {
  const res = await GET();
  assert.equal(res.status, 200);
  const data = await res.json();
  for (const key of ["wakeWord", "stopWord", "vad", "recording", "sticky"]) {
    assert.ok(key in data, `GET lost the ${key} section`);
  }
  assert.equal(typeof data.wakeWord.phrase, "string");
  assert.equal(typeof data.vad.silenceMs, "number");
});

test("a PUT is visible to a subsequent GET — the hot-reload loop closes", async () => {
  await put({ wakeWord: { phrase: "computer" } });
  const data = await (await GET()).json();
  assert.equal(data.wakeWord.phrase, "computer");
  // Sibling keys in the same section survive the patch.
  assert.equal(typeof data.wakeWord.threshold, "number");
});

test("GET sends no-store so a hot-reload poll always sees fresh config", async () => {
  const res = await GET();
  assert.match(res.headers.get("Cache-Control") ?? "", /no-store/);
});

test("a structurally hostile patch cannot inject unknown sections", async () => {
  await put({ evil: { inject: true }, wakeWord: { phrase: "ok" } });
  const data = await (await GET()).json();
  assert.equal(data.evil, undefined);
  assert.equal(data.polluted, undefined);
});
