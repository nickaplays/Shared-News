import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  isRetryableError,
  isRetryableHttpStatus,
  withRetries,
} from "./http-retry.js";

describe("http-retry", () => {
  test("retryable statuses include 404 and 5xx", () => {
    assert.equal(isRetryableHttpStatus(404), true);
    assert.equal(isRetryableHttpStatus(500), true);
    assert.equal(isRetryableHttpStatus(429), true);
    assert.equal(isRetryableHttpStatus(403), false);
    assert.equal(isRetryableHttpStatus(400), false);
  });

  test("withRetries succeeds after transient failures", async () => {
    let calls = 0;
    const sleeps = [];
    const result = await withRetries(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error("Status code 404");
        return "ok";
      },
      {
        delaysMs: [1, 1, 1],
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
    );
    assert.equal(result, "ok");
    assert.equal(calls, 3);
    assert.deepEqual(sleeps, [1, 1]);
  });

  test("withRetries exhausts and rethrows", async () => {
    await assert.rejects(
      () =>
        withRetries(
          async () => {
            throw new Error("Status code 500");
          },
          { attempts: 3, delaysMs: [0, 0, 0], sleep: async () => {} },
        ),
      /Status code 500/,
    );
  });

  test("does not retry abort or timeout messages", () => {
    const abortErr = new Error("aborted");
    abortErr.name = "AbortError";
    assert.equal(isRetryableError(abortErr), false);
    assert.equal(isRetryableError(new Error("timed out after 20000ms")), false);
    assert.equal(isRetryableError(new Error("Status code 404")), true);
  });
});
