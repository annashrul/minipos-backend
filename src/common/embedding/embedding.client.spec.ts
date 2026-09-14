import assert from "node:assert/strict";
import { test } from "node:test";
import { EmbeddingClient } from "./embedding.client";

test("EmbeddingClient.isReachable returns true when AI service is healthy", async () => {
  process.env.AI_SERVICE_URL = "http://localhost:8000";
  const originalFetch = global.fetch;
  global.fetch = (async () => ({
    ok: true,
    text: async () => JSON.stringify({ status: "ok", model: "test-model+tp3", dim: 768, preprocess: "tp3" }),
  }) as unknown as Response) as typeof fetch;

  try {
    const client = new EmbeddingClient();
    assert.equal(await client.isReachable(), true);
  } finally {
    global.fetch = originalFetch;
  }
});

test("EmbeddingClient.isReachable returns false when AI service is unreachable", async () => {
  process.env.AI_SERVICE_URL = "http://localhost:8000";
  const originalFetch = global.fetch;
  global.fetch = (async () => {
    throw new Error("ECONNREFUSED");
  }) as typeof fetch;

  try {
    const client = new EmbeddingClient();
    assert.equal(await client.isReachable(), false);
  } finally {
    global.fetch = originalFetch;
  }
});
