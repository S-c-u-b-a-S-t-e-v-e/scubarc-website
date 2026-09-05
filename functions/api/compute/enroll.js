import { json, readJson, newId, safeText, clampInt, sha256Hex, verifyTurnstile } from "./_lib.js";

export async function onRequestPost({ request, env }) {
  if (!env.COMMUNITY_DB) return json({ error: "community_compute_not_configured" }, 503);

  try {
    const body = await readJson(request, 8192);
    const humanOk = await verifyTurnstile(env.TURNSTILE_SECRET, safeText(body.turnstile_token, 2048), request);
    if (!humanOk) return json({ error: "human_verification_failed" }, 403);

    const cap = body.capabilities || {};
    const contributorId = newId("ccp");
    const nodeId = newId("ccn");
    const nodeToken = `${crypto.randomUUID()}${crypto.randomUUID()}`;
    const tokenHash = await sha256Hex(nodeToken);
    const now = new Date().toISOString();

    const displayName = safeText(body.display_name, 80);
    const locality = safeText(body.locality, 100);
    const consentVersion = safeText(body.consent_version, 80);
    if (!consentVersion) return json({ error: "consent_required" }, 400);

    const logicalProcessors = clampInt(cap.logical_processors, 1, 256, 1);
    const platform = safeText(cap.platform, 80);
    const userAgent = safeText(cap.user_agent, 300);
    const deviceClass = cap.device_class === "mobile" ? "mobile" : "desktop";
    const wasmSupport = cap.wasm_support ? 1 : 0;
    const webgpuSupport = cap.webgpu_support ? 1 : 0;
    if (!wasmSupport) return json({ error: "wasm_required" }, 400);

    await env.COMMUNITY_DB.batch([
      env.COMMUNITY_DB.prepare(
        `INSERT INTO contributors
         (contributor_id, created_at, display_name, virginia_opt_in, locality, consent_version)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
      ).bind(contributorId, now, displayName, body.virginia_opt_in ? 1 : 0, locality, consentVersion),
      env.COMMUNITY_DB.prepare(
        `INSERT INTO nodes
         (node_id, contributor_id, created_at, last_seen, platform, user_agent, logical_processors,
          wasm_support, webgpu_support, device_class, token_hash, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'active')`
      ).bind(nodeId, contributorId, now, now, platform, userAgent, logicalProcessors, wasmSupport, webgpuSupport, deviceClass, tokenHash)
    ]);

    return json({ contributor_id: contributorId, node_id: nodeId, node_token: nodeToken });
  } catch (error) {
    return json({ error: error.message === "payload_too_large" ? "payload_too_large" : "invalid_enrollment" }, 400);
  }
}
