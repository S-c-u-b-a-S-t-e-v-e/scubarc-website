"use strict";

(() => {
  const config = window.SCUBARC_COMPUTE_CONFIG || { apiBase: "/api/compute", turnstileSiteKey: "" };
  const form = document.getElementById("compute-form");
  const statusEl = document.getElementById("compute-status");
  const startButton = document.getElementById("compute-start");
  const readout = document.getElementById("device-readout");
  const workPanel = document.getElementById("work-panel");
  const workDetail = document.getElementById("work-detail");
  const progress = document.getElementById("compute-progress");
  const receiptCard = document.getElementById("receipt-card");
  let turnstileWidgetId = null;

  const capabilities = {
    logical_processors: navigator.hardwareConcurrency || 1,
    platform: navigator.userAgentData?.platform || navigator.platform || "unknown",
    user_agent: navigator.userAgent.slice(0, 300),
    wasm_support: typeof WebAssembly === "object",
    webgpu_support: Boolean(navigator.gpu),
    device_class: /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ? "mobile" : "desktop"
  };

  readout.innerHTML = `
    <div><strong>Device class</strong><span>${escapeHtml(capabilities.device_class)}</span></div>
    <div><strong>Platform</strong><span>${escapeHtml(capabilities.platform)}</span></div>
    <div><strong>Logical processors</strong><span>${capabilities.logical_processors}</span></div>
    <div><strong>WebAssembly</strong><span>${capabilities.wasm_support ? "Available" : "Unavailable"}</span></div>
    <div><strong>WebGPU</strong><span>${capabilities.webgpu_support ? "Available" : "Not detected"}</span></div>`;

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  }

  async function api(path, options = {}) {
    const response = await fetch(`${config.apiBase}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `request_failed_${response.status}`);
    return body;
  }

  function loadTurnstile() {
    if (!config.turnstileSiteKey) return;
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (!window.turnstile) return;
      turnstileWidgetId = window.turnstile.render("#turnstile-slot", {
        sitekey: config.turnstileSiteKey,
        theme: "dark"
      });
    };
    document.head.appendChild(script);
  }

  function turnstileToken() {
    if (!config.turnstileSiteKey) return "";
    if (!window.turnstile || turnstileWidgetId === null) return "";
    return window.turnstile.getResponse(turnstileWidgetId) || "";
  }

  async function refreshStats() {
    try {
      const stats = await api("/stats", { method: "GET", headers: {} });
      document.getElementById("stat-contributors").textContent = Number(stats.contributors || 0).toLocaleString();
      document.getElementById("stat-nodes").textContent = Number(stats.nodes || 0).toLocaleString();
      document.getElementById("stat-threads").textContent = Number(stats.logical_threads || 0).toLocaleString();
      document.getElementById("stat-verified").textContent = Number(stats.verified_work_units || 0).toLocaleString();
      document.getElementById("stat-hours").textContent = (Number(stats.compute_ms || 0) / 3600000).toFixed(1);
    } catch (_) {
      document.getElementById("compute-stats")?.classList.add("stats-offline");
    }
  }

  function runWork(envelope) {
    return new Promise((resolve, reject) => {
      const worker = new Worker("compute-worker.js");
      worker.onmessage = (event) => {
        if (event.data?.type === "progress") {
          progress.style.width = `${event.data.percent}%`;
          workDetail.textContent = `Running ${envelope.work_id} — ${event.data.percent}%`;
        } else if (event.data?.type === "result") {
          progress.style.width = "100%";
          worker.terminate();
          resolve(event.data);
        } else if (event.data?.type === "error") {
          worker.terminate();
          reject(new Error(event.data.error || "worker_error"));
        }
      };
      worker.onerror = (error) => { worker.terminate(); reject(error); };
      worker.postMessage(envelope);
    });
  }

  async function enrollIfNeeded(payload) {
    const existingNodeId = localStorage.getItem("scubarc_cc_node_id") || "";
    const existingNodeToken = localStorage.getItem("scubarc_cc_node_token") || "";
    if (existingNodeId && existingNodeToken) return { node_id: existingNodeId, node_token: existingNodeToken, reused: true };

    const enrollment = await api("/enroll", { method: "POST", body: JSON.stringify(payload) });
    localStorage.setItem("scubarc_cc_node_id", enrollment.node_id);
    localStorage.setItem("scubarc_cc_node_token", enrollment.node_token);
    return enrollment;
  }

  async function contribute(payload) {
    statusEl.textContent = "Registering this device…";
    let enrollment = await enrollIfNeeded(payload);

    statusEl.textContent = "Requesting a bounded work unit…";
    let work;
    try {
      work = await api("/work", {
        method: "POST",
        headers: { Authorization: `Bearer ${enrollment.node_token}` },
        body: JSON.stringify({ node_id: enrollment.node_id })
      });
    } catch (error) {
      if (enrollment.reused && error.message === "unauthorized_node") {
        localStorage.removeItem("scubarc_cc_node_id");
        localStorage.removeItem("scubarc_cc_node_token");
        enrollment = await enrollIfNeeded(payload);
        work = await api("/work", {
          method: "POST",
          headers: { Authorization: `Bearer ${enrollment.node_token}` },
          body: JSON.stringify({ node_id: enrollment.node_id })
        });
      } else {
        throw error;
      }
    }

    workPanel.hidden = false;
    receiptCard.hidden = true;
    progress.style.width = "0%";
    workPanel.scrollIntoView({ behavior: "smooth", block: "center" });
    workDetail.textContent = `Running ${work.work_id}…`;

    const result = await runWork(work);
    workDetail.textContent = "Returning constrained result receipt for verification…";

    const receipt = await api("/result", {
      method: "POST",
      headers: { Authorization: `Bearer ${enrollment.node_token}` },
      body: JSON.stringify({
        node_id: enrollment.node_id,
        work_id: result.work_id,
        result: result.result,
        runtime_ms: result.runtime_ms,
        client_version: result.client_version
      })
    });

    receiptCard.hidden = false;
    receiptCard.innerHTML = `
      <strong>${receipt.verified ? "Verified work unit" : "Result received for review"}</strong>
      <span>Work ID: ${escapeHtml(result.work_id)}</span>
      <span>Runtime: ${(result.runtime_ms / 1000).toFixed(1)} seconds</span>
      <span>Receipt: ${escapeHtml(receipt.receipt_id)}</span>`;
    workDetail.textContent = "Thank you. Your device completed its first Community Compute work unit.";
    statusEl.textContent = "Contribution complete.";
    await refreshStats();
  }

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!capabilities.wasm_support) {
      statusEl.textContent = "This browser does not support the required web runtime.";
      return;
    }

    const data = new FormData(form);
    if (!data.get("consent")) return;
    if (config.turnstileSiteKey && !turnstileToken()) {
      statusEl.textContent = "Please complete the human verification check.";
      return;
    }

    startButton.disabled = true;
    try {
      await contribute({
        display_name: String(data.get("display_name") || "").trim(),
        email: String(data.get("email") || "").trim(),
        locality: String(data.get("locality") || "").trim(),
        virginia_opt_in: Boolean(data.get("virginia_opt_in")),
        consent_version: "cc-alpha-2026-09-04",
        turnstile_token: turnstileToken(),
        capabilities
      });
      if (window.turnstile && turnstileWidgetId !== null) window.turnstile.reset(turnstileWidgetId);
    } catch (error) {
      statusEl.textContent = `Unable to complete the Alpha work unit: ${error.message}`;
      workDetail.textContent = "Work unit stopped.";
    } finally {
      startButton.disabled = false;
    }
  });

  loadTurnstile();
  refreshStats();
})();
