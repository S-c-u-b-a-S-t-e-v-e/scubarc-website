import { json } from "./_lib.js";

export async function onRequestGet({ env }) {
  if (!env.COMMUNITY_DB) return json({ error: "community_compute_not_configured" }, 503);

  try {
    const [contributors, nodes, threads, verified, compute, virginia] = await Promise.all([
      env.COMMUNITY_DB.prepare("SELECT COUNT(*) AS n FROM contributors").first(),
      env.COMMUNITY_DB.prepare("SELECT COUNT(*) AS n FROM nodes WHERE status = 'active'").first(),
      env.COMMUNITY_DB.prepare("SELECT COALESCE(SUM(logical_processors),0) AS n FROM nodes WHERE status = 'active'").first(),
      env.COMMUNITY_DB.prepare("SELECT COUNT(*) AS n FROM receipts WHERE verification_status = 'verified'").first(),
      env.COMMUNITY_DB.prepare("SELECT COALESCE(SUM(runtime_ms),0) AS n FROM receipts WHERE verification_status = 'verified'").first(),
      env.COMMUNITY_DB.prepare("SELECT COUNT(*) AS n FROM contributors WHERE virginia_opt_in = 1").first()
    ]);

    return json({
      contributors: Number(contributors?.n || 0),
      nodes: Number(nodes?.n || 0),
      logical_threads: Number(threads?.n || 0),
      verified_work_units: Number(verified?.n || 0),
      compute_ms: Number(compute?.n || 0),
      virginia_contributors: Number(virginia?.n || 0)
    });
  } catch (_) {
    return json({ error: "stats_unavailable" }, 500);
  }
}
