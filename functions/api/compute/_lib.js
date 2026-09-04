const encoder = new TextEncoder();

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

export async function readJson(request, maxBytes = 8192) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length && length > maxBytes) throw new Error("payload_too_large");
  const text = await request.text();
  if (text.length > maxBytes) throw new Error("payload_too_large");
  return JSON.parse(text || "{}");
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(String(value)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function newId(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

export function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

export function safeText(value, max) {
  return String(value || "").trim().slice(0, max);
}

export function mix32(seed, iterations) {
  let x = seed >>> 0;
  for (let i = 0; i < iterations; i += 1) {
    x ^= (x << 13) >>> 0;
    x ^= x >>> 17;
    x ^= (x << 5) >>> 0;
    x = Math.imul(x ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  }
  return x >>> 0;
}

export async function verifyTurnstile(secret, token, request) {
  if (!secret) return true;
  if (!token) return false;
  const form = new FormData();
  form.set("secret", secret);
  form.set("response", token);
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) form.set("remoteip", ip);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const result = await response.json();
  return Boolean(result.success);
}

export async function authenticateNode(env, request, claimedNodeId = "") {
  const auth = request.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  if (!token || token.length > 200) return null;
  const tokenHash = await sha256Hex(token);
  const row = await env.COMMUNITY_DB.prepare(
    "SELECT node_id, contributor_id, logical_processors, device_class, status FROM nodes WHERE token_hash = ?1"
  ).bind(tokenHash).first();
  if (!row || row.status !== "active") return null;
  if (claimedNodeId && row.node_id !== claimedNodeId) return null;
  return row;
}
