import assert from "node:assert/strict";
import { timingSafeEqual as nodeTimingSafeEqual } from "node:crypto";
import test from "node:test";

import worker, {
  FRIDAY_TRIGGER,
  PostHub,
  chunkDocument,
  extractEmbeddingVectors,
  extractFridayText,
  integerSetting,
  postFromMetadata,
  utcDayKey,
} from "./worker.js";

if (!crypto.subtle.timingSafeEqual) {
  Object.defineProperty(crypto.subtle, "timingSafeEqual", {
    value(left, right) {
      return nodeTimingSafeEqual(
        Buffer.from(left.buffer || left, left.byteOffset || 0, left.byteLength),
        Buffer.from(right.buffer || right, right.byteOffset || 0, right.byteLength),
      );
    },
  });
}

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  async get(key) {
    return this.values.get(key);
  }

  async put(key, value) {
    this.values.set(key, value);
  }

  async delete(key) {
    const keys = Array.isArray(key) ? key : [key];
    return keys.reduce(
      (count, item) => count + (this.values.delete(item) ? 1 : 0),
      0,
    );
  }

  async transaction(callback) {
    return callback(this);
  }

  async list({ prefix = "", limit = 100, reverse = false } = {}) {
    const entries = [...this.values.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .sort(([left], [right]) => left.localeCompare(right));
    if (reverse) entries.reverse();
    return new Map(entries.slice(0, limit));
  }
}

const createWorkerEnvironment = () => {
  const state = {
    storage: new MemoryStorage(),
    acceptWebSocket() {},
    getWebSockets() {
      return [];
    },
  };
  const hub = new PostHub(state);
  const objects = new Map();
  return {
    env: {
      AI: {
        async run(model) {
          assert.equal(model, "@cf/zai-org/glm-4.7-flash");
          return {
            choices: [
              { message: { content: "Use `print()` to display a value." } },
            ],
          };
        },
      },
      API_RATE_LIMITER: { async limit() { return { success: true }; } },
      FRIDAY_DAILY_LIMIT: "20",
      FRIDAY_DEVICE_LIMIT: "8",
      FRIDAY_MAX_OUTPUT_TOKENS: "600",
      FRIDAY_ADMIN_TOKEN: "correct-horse-battery-staple",
      FRIDAY_KNOWLEDGE: {
        async query() { return { matches: [] }; },
      },
      HOST_FILES: {
        async put(key, value) { objects.set(key, value); },
        async delete(key) {
          const keys = Array.isArray(key) ? key : [key];
          keys.forEach((item) => objects.delete(item));
        },
        async get(key) { return objects.get(key) || null; },
      },
      POST_HUB: {
        idFromName(name) { return name; },
        get() {
          return {
            fetch(input, init) {
              return hub.fetch(new Request(input, init));
            },
          };
        },
      },
    },
    state,
  };
};

test("Friday trigger only matches at the beginning", () => {
  assert.equal(FRIDAY_TRIGGER.test("@Friday explain this"), true);
  assert.equal(FRIDAY_TRIGGER.test("@friday"), true);
  assert.equal(FRIDAY_TRIGGER.test("hello @Friday"), false);
  assert.equal(FRIDAY_TRIGGER.test("@FridayNight"), false);
});

test("document chunking keeps content bounded and ordered", () => {
  const source = Array.from(
    { length: 150 },
    (_, index) => `Section ${index}. This is a short classroom reference.`,
  ).join("\n\n");
  const chunks = chunkDocument(source, 500, 50);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 501));
  assert.match(chunks[0], /Section 0/);
  assert.match(chunks.at(-1), /Section 149/);
});

test("Friday output extraction supports chat completion responses", () => {
  assert.equal(
    extractFridayText({
      choices: [{ message: { content: "  Use a for loop.  " } }],
    }),
    "Use a for loop.",
  );
  assert.equal(extractFridayText({ response: "Fallback" }), "Fallback");
  assert.equal(
    extractFridayText({ choices: [{ text: "Legacy completion" }] }),
    "Legacy completion",
  );
  assert.equal(extractFridayText({ output_text: "Responses output" }), "Responses output");
});

test("embedding extraction supports Workers AI responses", () => {
  assert.deepEqual(
    extractEmbeddingVectors({ data: [[0.1, 0.2], [0.3, 0.4]] }),
    [[0.1, 0.2], [0.3, 0.4]],
  );
});

test("post metadata exposes bot identity without trusting an author name", () => {
  const post = postFromMetadata({
    id: "one",
    author: "Friday",
    message: "Hello",
    createdAt: "2026-08-20T00:00:00.000Z",
    hasFile: "0",
    bot: "1",
  });
  assert.equal(post.bot, true);
  assert.equal(post.file, null);
  assert.equal(post.canDelete, false);
});

test("numeric settings are clamped and UTC day keys are stable", () => {
  assert.equal(integerSetting("1000", 20, 1, 500), 500);
  assert.equal(integerSetting("bad", 20, 1, 500), 20);
  assert.equal(utcDayKey(new Date("2026-08-20T23:59:00Z")), "2026-08-20");
});

test("Friday quota stops at the configured daily limit", async () => {
  const { env } = createWorkerEnvironment();
  env.FRIDAY_DAILY_LIMIT = "2";
  env.FRIDAY_DEVICE_LIMIT = "2";
  const hub = env.POST_HUB.get();
  const reserve = (actor, now) =>
    hub.fetch("https://host.internal/friday/reserve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actor,
        day: "2026-08-20",
        now,
        cooldownMs: 0,
        dailyLimit: 2,
        deviceLimit: 2,
      }),
    });

  assert.equal((await (await reserve("one", 1000)).json()).allowed, true);
  assert.equal((await (await reserve("two", 2000)).json()).allowed, true);
  const blocked = await (await reserve("three", 3000)).json();
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "daily");
  assert.equal(blocked.announce, true);
});

test("posting @Friday creates a stored AI reply through the live hub", async () => {
  const { env } = createWorkerEnvironment();
  const pending = [];
  const formData = new FormData();
  formData.set("author", "Jake");
  formData.set("message", "@Friday how do I print a value in Python?");
  const request = new Request("https://example.test/api/host/posts", {
    method: "POST",
    headers: { "CF-Connecting-IP": "192.0.2.10" },
    body: formData,
  });

  const response = await worker.fetch(request, env, {
    waitUntil(promise) { pending.push(promise); },
  });
  assert.equal(response.status, 201);
  assert.equal(pending.length, 0);

  const feed = await worker.fetch(
    new Request("https://example.test/api/host/posts"),
    env,
    { waitUntil() {} },
  );
  const data = await feed.json();
  assert.equal(data.posts.length, 2);
  assert.equal(data.posts[0].author, "Friday");
  assert.equal(data.posts[0].bot, true);
  assert.match(data.posts[0].message, /print/);
  assert.equal(data.posts[0].reply.id, data.posts[1].id);
});

test("pseudocode requests receive the strict classroom rules", async () => {
  const { env } = createWorkerEnvironment();
  let modelOptions;
  env.AI.run = async (_model, options) => {
    modelOptions = options;
    return { choices: [{ message: { content: "```text\nSERVE coffee\n```" } }] };
  };
  const formData = new FormData();
  formData.set("author", "Jake");
  formData.set("message", "@Friday make pseudocode for making coffee");

  const response = await worker.fetch(
    new Request("https://example.test/api/host/posts", {
      method: "POST",
      headers: { "X-Host-Device": "p".repeat(64) },
      body: formData,
    }),
    env,
    { waitUntil() {} },
  );

  assert.equal(response.status, 201);
  assert.equal(modelOptions.temperature, 0.1);
  const pseudocodeRules = modelOptions.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n");
  assert.match(pseudocodeRules, /PRINT or WRITE only displays information/);
  assert.match(pseudocodeRules, /SERVE coffee, not PRINT coffee/);
  assert.match(pseudocodeRules, /Never use an object, variable, or result before/);
});

test("Friday retries once when the model returns no visible answer", async () => {
  const { env } = createWorkerEnvironment();
  let attempts = 0;
  env.AI.run = async () => {
    attempts += 1;
    return attempts === 1
      ? { choices: [{ message: { content: null }, finish_reason: "length" }] }
      : { choices: [{ message: { content: "Here is the final answer." } }] };
  };
  const formData = new FormData();
  formData.set("author", "Jake");
  formData.set("message", "@Friday answer this");
  const response = await worker.fetch(
    new Request("https://example.test/api/host/posts", {
      method: "POST",
      headers: { "X-Host-Device": "d".repeat(64) },
      body: formData,
    }),
    env,
    { waitUntil() {} },
  );
  assert.equal(response.status, 201);
  assert.equal(attempts, 2);

  const feed = await worker.fetch(
    new Request("https://example.test/api/host/posts"),
    env,
    { waitUntil() {} },
  );
  assert.equal((await feed.json()).posts[0].message, "Here is the final answer.");
});

test("replies keep a compact snapshot of the target message", async () => {
  const { env } = createWorkerEnvironment();
  const device = "a".repeat(64);
  const createPost = async (message, replyTo = "") => {
    const formData = new FormData();
    formData.set("author", "Jake");
    formData.set("message", message);
    if (replyTo) formData.set("replyTo", replyTo);
    return worker.fetch(
      new Request("https://example.test/api/host/posts", {
        method: "POST",
        headers: { "X-Host-Device": device },
        body: formData,
      }),
      env,
      { waitUntil() {} },
    );
  };

  const first = await (await createPost("Original message")).json();
  const secondResponse = await createPost("Reply", first.post.id);
  assert.equal(secondResponse.status, 201);
  const second = await secondResponse.json();
  assert.deepEqual(second.post.reply, {
    id: first.post.id,
    author: "Jake",
    message: "Original message",
  });
});

test("message deletion requires the owning browser or the admin key", async () => {
  const { env } = createWorkerEnvironment();
  const ownerDevice = "b".repeat(64);
  const strangerDevice = "c".repeat(64);
  const formData = new FormData();
  formData.set("author", "Jake");
  formData.set("message", "Delete me");
  const created = await worker.fetch(
    new Request("https://example.test/api/host/posts", {
      method: "POST",
      headers: { "X-Host-Device": ownerDevice },
      body: formData,
    }),
    env,
    { waitUntil() {} },
  );
  const { post } = await created.json();
  assert.equal(post.canDelete, true);

  const forbidden = await worker.fetch(
    new Request(`https://example.test/api/host/posts/${post.id}`, {
      method: "DELETE",
      headers: { "X-Host-Device": strangerDevice },
    }),
    env,
    { waitUntil() {} },
  );
  assert.equal(forbidden.status, 403);

  const deleted = await worker.fetch(
    new Request(`https://example.test/api/host/posts/${post.id}`, {
      method: "DELETE",
      headers: { "X-Host-Device": ownerDevice },
    }),
    env,
    { waitUntil() {} },
  );
  assert.equal(deleted.status, 200);

  const feed = await worker.fetch(
    new Request("https://example.test/api/host/posts", {
      headers: { "X-Host-Device": ownerDevice },
    }),
    env,
    { waitUntil() {} },
  );
  assert.equal((await feed.json()).posts.length, 0);

  const legacyId = crypto.randomUUID();
  await env.POST_HUB.get().fetch("https://host.internal/posts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: legacyId,
      author: "Old browser",
      message: "Admin only",
      createdAt: new Date().toISOString(),
      hasFile: "0",
      bot: "0",
    }),
  });
  const adminDeleted = await worker.fetch(
    new Request(`https://example.test/api/host/posts/${legacyId}`, {
      method: "DELETE",
      headers: { "X-Friday-Admin": "correct-horse-battery-staple" },
    }),
    env,
    { waitUntil() {} },
  );
  assert.equal(adminDeleted.status, 200);
});
