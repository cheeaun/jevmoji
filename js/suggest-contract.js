/** Shared input + error contract for the suggest APIs. */

export const MAX_INPUT = 40;

export function normalizeInput(raw) {
  const text = String(raw ?? "");
  const points = [...text];
  const truncated = points.slice(0, MAX_INPUT).join("");
  return {
    original: text,
    text: truncated,
    length: points.length,
    trimmed: truncated.trim(),
    overLimit: points.length > MAX_INPUT,
  };
}

export function errorPayload(code, message) {
  return { error: { code, message } };
}
