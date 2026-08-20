import assert from "node:assert/strict";
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
  await Promise.all(pending);

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
});
