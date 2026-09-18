/**
 * Retry async work on transient failures.
 */

export const DEFAULT_RETRY_ATTEMPTS = 3;
export const DEFAULT_RETRY_DELAYS_MS = [250, 500, 1000];

/**
 * @param {number} status
 * @returns {boolean}
 */
export function isRetryableHttpStatus(status) {
  return (
    status === 404 ||
    status === 408 ||
    status === 429 ||
    (status >= 500 && status <= 599)
  );
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
export function isRetryableError(error) {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  const statusMatch = message.match(/Status code (\d+)/);
  if (statusMatch) {
    return isRetryableHttpStatus(Number(statusMatch[1]));
  }
  if (error?.name === "AbortError") return false;
  if (message.includes("timed out")) return false;
  return true;
}

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{
 *   attempts?: number,
 *   delaysMs?: number[],
 *   sleep?: (ms: number) => Promise<void>,
 *   shouldRetry?: (error: unknown, attempt: number) => boolean,
 * }} [options]
 * @returns {Promise<T>}
 */
export async function withRetries(
  fn,
  {
    attempts = DEFAULT_RETRY_ATTEMPTS,
    delaysMs = DEFAULT_RETRY_DELAYS_MS,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    shouldRetry = isRetryableError,
  } = {},
) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !shouldRetry(error, attempt)) {
        throw error;
      }
      const delay = delaysMs[Math.min(attempt - 1, delaysMs.length - 1)] ?? 0;
      if (delay > 0) {
        await sleep(delay);
      }
    }
  }
  throw lastError;
}
