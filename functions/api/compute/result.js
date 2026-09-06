import { json, readJson, newId, authenticateNode, clampInt } from "./_lib.js";

export async function onRequestPost({ request, env }) {
  if (!env.COMMUNITY_DB) return json({ error: "community_compute_not_configured" }, 503);

  try {
    const body = await readJson(request, 4096);
    const node = await authenticateNode(env, request, String(body.node_id || ""));
    if (!node) return json({ error: "unauthorized_node" }, 401);

    const workId = String(body.work_id || "");
    const assignment = await env.COMMUNITY_DB.prepare(
      `SELECT a.assignment_id, a.status, a.expires_at, w.expected_result, w.replication_factor
       FROM assignments a JOIN work_units w ON w.work_id = a.work_id
       WHERE a.work_id = ?1 AND a.node_id = ?2 ORDER BY a.issued_at DESC LIMIT 1`
    ).bind(workId, node.node_id).first();

    if (!assignment || assignment.status !== "issued") return json({ error: "assignment_not_found" }, 404);
    if (new Date(assignment.expires_at).getTime() < Date.now()) return json({ error: "assignment_expired" }, 409);

    const result = Number(body.result);
    if (!Number.isInteger(result) || result < 0 || result > 0xffffffff) return json({ error: "invalid_result_schema" }, 400);

    const runtimeMs = clampInt(body.runtime_ms, 0, 60 * 60 * 1000, 0);
    const verified = result === Number(assignment.expected_result);
    const receiptId = newId("ccr");
    const nowIso = new Date().toISOString();

    await env.COMMUNITY_DB.batch([
      env.COMMUNITY_DB.prepare(
        `INSERT INTO receipts
         (receipt_id, assignment_id, work_id, node_id, result_value, runtime_ms, client_version, received_at, verification_status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
      ).bind(receiptId, assignment.assignment_id, workId, node.node_id, result, runtimeMs, String(body.client_version || "").slice(0, 40), nowIso, verified ? "verified" : "rejected"),
      env.COMMUNITY_DB.prepare("UPDATE assignments SET status = ?1 WHERE assignment_id = ?2").bind(verified ? "verified" : "rejected", assignment.assignment_id),
      env.COMMUNITY_DB.prepare("UPDATE nodes SET last_seen = ?1 WHERE node_id = ?2").bind(nowIso, node.node_id)
    ]);

    if (verified) {
      await env.COMMUNITY_DB.prepare("UPDATE work_units SET verified_count = verified_count + 1 WHERE work_id = ?1").bind(workId).run();
      const current = await env.COMMUNITY_DB.prepare("SELECT verified_count, replication_factor FROM work_units WHERE work_id = ?1").bind(workId).first();
      if (current && Number(current.verified_count) >= Number(current.replication_factor)) {
        await env.COMMUNITY_DB.prepare("UPDATE work_units SET status = 'verified' WHERE work_id = ?1").bind(workId).run();
      }
    }

    return json({ receipt_id: receiptId, verified });
  } catch (_) {
    return json({ error: "result_rejected" }, 400);
  }
}
