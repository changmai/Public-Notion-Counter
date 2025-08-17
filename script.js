const $ = (sel) => document.querySelector(sel);
function setStatus(msg, type = "") {
  const el = $("#status");
  el.textContent = msg;
  el.className = type; // "success" | "error" | ""
  el.style.animation = "none"; el.offsetHeight; el.style.animation = null;
}
function extractDbId(input) {
  if (!input) return "";
  const s = String(input).trim();
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      if (u.hostname.endsWith("notion.so")) {
        let path = u.pathname.split("/").pop() || "";
        const hex = path.replace(/[^0-9a-f]/gi, "");
        if (hex.length >= 32) return hex.slice(0, 32);
        return path;
      }
    } catch {}
  }
  const m = s.match(/[0-9a-f]{32}/i);
  if (m) return m[0];
  return s;
}
function loadCfg(){ try { return JSON.parse(localStorage.getItem("notionDbCfg") || "{}"); } catch { return {}; } }
function saveCfg(cfg){ localStorage.setItem("notionDbCfg", JSON.stringify(cfg)); setStatus("✅ 설정을 저장했습니다.", "success"); }
function saveCfgSilent(cfg){ try { localStorage.setItem("notionDbCfg", JSON.stringify(cfg)); } catch {} }
function cfgFromUI(){
  return {
    proxy: $("#proxy").value.trim(),
    token: $("#token").value.trim(),              // 비워두면 OAuth 세션 쿠키 사용
    databaseId: extractDbId($("#databaseInput").value.trim()),
  };
}
async function callProxy(path, body){
  const cfg = cfgFromUI();
  if (!cfg.proxy) throw new Error("프록시 URL을 입력하세요.");
  const base = cfg.proxy.replace(/\/+$/, "");
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include", // ← OAuth 쿠키(ntk) 전송!
    body: JSON.stringify({ ...body, token: cfg.token || undefined })
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`프록시 오류(${res.status}): ${t}`);
  }
  return res.json();
}
function withLoading(btn, fn){
  return async () => {
    const prev = btn.textContent;
    btn.disabled = true; btn.textContent = "⏳ 처리 중...";
    try { await fn(); } finally { btn.disabled = false; btn.textContent = prev; }
  };
}
function normalizeProps(props){
  const out = [];
  if (!props) return out;
  if (Array.isArray(props)){
    for (const item of props){
      if (typeof item === "string") out.push({ name: item, type: "prop" });
      else if (item && typeof item === "object") out.push({ name: item.name, type: item.type || "prop" });
    }
    return out;
  }
  if (typeof props === "object"){
    for (const [name, def] of Object.entries(props)) out.push({ name, type: def?.type || "prop" });
  }
  return out;
}

document.addEventListener("DOMContentLoaded", async () => {
  const saved = loadCfg();
  if (saved.proxy) $("#proxy").value = saved.proxy;
  if (saved.token) $("#token").value = saved.token;
  if (saved.databaseId) $("#databaseInput").value = saved.databaseId;

  $("#login").addEventListener("click", () => {
    const proxy = $("#proxy").value.trim();
    if (!proxy) { setStatus("❌ 먼저 프록시 URL을 입력하세요.", "error"); return; }
    const url = proxy.replace(/\/+$/, "") + "/oauth/login?redirect=" + encodeURIComponent(location.href);
    location.href = url;
  });

  $("#save").addEventListener("click", () => {
    const cfg = cfgFromUI();
    if (!cfg.databaseId) { setStatus("❌ 데이터베이스 링크 또는 ID를 입력하세요.", "error"); return; }
    saveCfg(cfg);
  });

  $("#loadProps").addEventListener("click", withLoading($("#loadProps"), async () => {
    const cfgNow = cfgFromUI();
    if (!cfgNow.databaseId) { setStatus("❌ 데이터베이스 링크 또는 ID를 입력하세요.", "error"); return; }

    const { ok, props } = await callProxy("/props", { databaseId: cfgNow.databaseId });
    if (!ok) throw new Error("속성 불러오기 실패");

    const list = normalizeProps(props);
    const sel = $("#propSelect");
    sel.innerHTML = "";
    for (const p of list) {
      if (!p?.name) continue;
      const opt = document.createElement("option");
      opt.value = p.name;
      opt.textContent = p.type ? `${p.name} (${p.type})` : p.name;
      sel.appendChild(opt);
    }
    if (!sel.options.length) { setStatus("⚠️ 표시할 속성이 없습니다.", "error"); return; }

    setStatus(`📥 속성 ${sel.options.length}개를 불러왔습니다.`, "success");
    saveCfgSilent({ ...cfgNow, prop: sel.value });
  }));

  $("#sumBtn").addEventListener("click", withLoading($("#sumBtn"), async () => {
    const cfgNow = cfgFromUI();
    const prop = $("#propSelect").value;
    if (!cfgNow.databaseId) { setStatus("❌ 데이터베이스 링크 또는 ID를 입력하세요.", "error"); return; }
    if (!prop) { setStatus("❌ 속성을 먼저 불러오고 선택하세요.", "error"); return; }

    const resp = await callProxy("/sum", { databaseId: cfgNow.databaseId, prop });
    if (!resp || resp.ok === false) throw new Error("합계 계산 실패");

    const sumVal =
      typeof resp.sum === "number" ? resp.sum :
      typeof resp.total === "number" ? resp.total : 0;
    const countVal = typeof resp.count === "number" ? resp.count : undefined;
    const tail = countVal !== undefined ? ` (페이지 ${countVal}개)` : "";

    setStatus(`🎉 합계: ${sumVal}${tail}`, "success");
    const keep = loadCfg();
    saveCfgSilent({ ...keep, databaseId: cfgNow.databaseId, prop });
  }));
});
