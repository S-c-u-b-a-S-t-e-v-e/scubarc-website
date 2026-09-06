"use strict";

function mix32(seed, iterations, onProgress) {
  let x = seed >>> 0;
  const chunk = Math.max(1000, Math.floor(iterations / 100));
  for (let i = 0; i < iterations; i += 1) {
    x ^= (x << 13) >>> 0;
    x ^= x >>> 17;
    x ^= (x << 5) >>> 0;
    x = Math.imul(x ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
    if (i % chunk === 0) onProgress(Math.min(99, Math.floor((i / iterations) * 100)));
  }
  return x >>> 0;
}

self.onmessage = (event) => {
  const { work_id, work_type, seed, iterations } = event.data || {};
  if (work_type !== "mix32_v1") {
    self.postMessage({ type: "error", error: "unsupported_work_type" });
    return;
  }
  if (!Number.isInteger(seed) || !Number.isInteger(iterations) || iterations < 1 || iterations > 5000000) {
    self.postMessage({ type: "error", error: "invalid_work_envelope" });
    return;
  }

  const started = performance.now();
  const result = mix32(seed, iterations, (percent) => self.postMessage({ type: "progress", percent }));
  const runtime_ms = Math.max(0, Math.round(performance.now() - started));
  self.postMessage({
    type: "result",
    work_id,
    result,
    runtime_ms,
    client_version: "cc-alpha-0.1"
  });
};
