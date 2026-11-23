import test from "node:test";
import assert from "node:assert/strict";
import {
  DraftBuffer,
  SubmissionLatch,
  VersionGate,
  locationOffset,
  pollingDelay,
} from "../src/state";
import { ApiClient, ApiError } from "../src/api";

test("default fetch retains the browser host receiver", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async function(this: unknown) {
    assert.equal(this, globalThis, "Browser host methods reject a foreign receiver");
    return new Response('{"ok":true}', {status: 200});
  };
  try {
    assert.deepEqual(await new ApiClient().json('/v1/auth/session'), {ok: true});
  } finally {
    globalThis.fetch = original;
  }
});

test("edits made while a save is in flight are saved with the new revision", async () => {
  const draft = new DraftBuffer({ source: "initial" }, 0);
  draft.set({ source: "first" });
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writes: { source: string; revision: number }[] = [];
  const pending = draft.flush(async (value, revision) => {
    writes.push({ ...value, revision });
    if (revision === 0) await barrier;
    return { revision: revision + 1 };
  });
  draft.set({ source: "second" });
  release();
  await pending;
  assert.deepEqual(writes, [
    { source: "first", revision: 0 },
    { source: "second", revision: 1 },
  ]);
  assert.equal(draft.revision, 2);
  assert.equal(draft.dirty, false);
});
test("conflicting tabs preserve local input and block silent overwrites", async () => {
  const draft = new DraftBuffer({ source: "server" }, 3);
  draft.set({ source: "mine" });
  let calls = 0;
  const writer = async () => {
    calls++;
    throw new ApiError("draft_conflict", 409);
  };
  await assert.rejects(draft.flush(writer));
  assert.equal(draft.conflict, true);
  assert.equal(draft.value.source, "mine");
  await assert.rejects(draft.flush(writer));
  assert.equal(calls, 1);
  assert.equal(draft.revision, 3);
});
test("network failure does not acknowledge a draft or replace its content", async () => {
  const draft = new DraftBuffer({ source: "one" }, 2);
  draft.set({ source: "two" });
  await assert.rejects(
    draft.flush(async () => {
      throw new Error("offline");
    }),
  );
  assert.equal(draft.dirty, true);
  assert.equal(draft.revision, 2);
  await draft.flush(async (value, revision) => {
    assert.equal(value.source, "two");
    return { revision: revision + 1 };
  });
  assert.equal(draft.dirty, false);
});
test("session/auth generation rejects a late response after switching", () => {
  const gate = new VersionGate();
  const old = gate.next();
  gate.next();
  assert.equal(gate.accepts(old), false);
  const a = new DraftBuffer({ source: "A" }, 0),
    b = new DraftBuffer({ source: "" }, 0);
  a.set({ source: "private A" });
  assert.equal(b.value.source, "");
});
test("ambiguous submit retry uses the same idempotency key and exact body", () => {
  let count = 0;
  const latch = new SubmissionLatch(() => String(++count));
  assert.equal(latch.forBody("a").key, latch.forBody("a").key);
  assert.notEqual(latch.forBody("b").key, "1");
  latch.accepted();
  assert.equal(latch.forBody("b").key, "3");
});
test("API errors preserve request IDs and never retry mutations automatically", async () => {
  let calls = 0;
  const client = new ApiClient(async () => {
    calls++;
    return new Response(JSON.stringify({ error: "storage_unavailable" }), {
      status: 503,
      headers: { "X-Request-ID": "correlation", "Retry-After": "10" },
    });
  });
  await assert.rejects(
    client.json("/v1/runs", { method: "POST", body: "{}" }),
    (e: unknown) =>
      e instanceof ApiError &&
      e.requestId === "correlation" &&
      e.retryAfter === 10,
  );
  assert.equal(calls, 1);
});
test("browser transport uses bounded cookie auth and CSRF, never a retained bearer token", async () => {
  const client = new ApiClient(async (_path, options) => {
    const headers = new Headers(options?.headers);
    assert.equal(options?.credentials, "same-origin");
    assert.equal(headers.get("Authorization"), null);
    assert.equal(headers.get("X-CSRF-Token"), "csrf");
    return new Response("{}");
  });
  client.csrf = "csrf";
  await client.json("/v1/sessions", { method: "PATCH", body: "{}" });
});
test("diagnostic offsets use UTF-16 and polling stays bounded", () => {
  const source = "// 🚗\npart motor;";
  assert.equal(
    locationOffset(source, { line: 2, column: 6 }),
    source.indexOf("motor"),
  );
  assert.equal(locationOffset(source, { offset: 9999 }), source.length);
  assert.equal(pollingDelay(100), 30000);
  assert.equal(pollingDelay(0, true), 10000);
});
