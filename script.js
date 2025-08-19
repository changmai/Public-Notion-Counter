// ===== Helpers =====
const $ = (s) => document.querySelector(s);
const DEFAULT_PROXY = "https://crimson-salad-9cb7.code0630.workers.dev";

function setStep(elDot, elPill, state, text) {
  const map = {
    wait: { cls: "wait", pill: "대기" },
    do:   { cls: "do",   pill: "진행중" },
    ok:   { cls: "done", pill: "완료" },
    err:  { cls: "wait", pill: "오류" },
  };
  const m = map[state] || map.wait;
  elDot.className = `dot ${m.cls}`;
  elPill.className = `pill ${state==="ok"?"ok":state==="do"?"do":state==="err"?"err":""}`;
  elPill.textContent = text || m.pill;
}

function setStatus(el, type, msg) {
  el.className = `status ${type}`;
  el.textContent = msg;
}

function extractDbId(input) {
  if (!input) return "";
  const s = String(input).trim();
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      let core = u.pathname.split("/").pop() || "";
      const m32 = core.replace(/[^0-9a-f]/gi, "").match(/[0-9a-f]{32}/i);
      if (m32) return m32[0];
      return core;
    } catch {}
  }
  const m = s.match(/[0-9a-f]{32}/i);
  return m ? m[0] : s;
}

function saveCfg(obj) { localStorage.setItem("notionPublicCfg", JSON.stringify(obj)); }
function loadCfg() { try { return JSON.parse(localStorage.getItem("notionPublicCfg")||"{}"); } catch { return {}; } }

async function api(path, body) {
  const proxy = ($("#proxy").value || DEFAULT_PROXY).replace(/\/+$/,"");
  const res = await fetch(proxy + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include", // 중요: 쿠키(ntk) 포함
    body: JSON.stringify(body || {})
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`프록시 오류(${res.status}): ${t}`);
  }
  return res.json();
}

function normalizeProps(props) {
  const out = [];
  if (!props) return out;
  if (Array.isArray(props)) {
    for (const it of props) {
      if (typeof it === "string") out.push({ name: it, type: "prop" });
      else if (it && typeof it === "object") out.push({ name: it.name, type: it.type || "prop" });
    }
  } else if (typeof props === "object") {
    for (const [name, def] of Object.entries(props)) out.push({ name, type: def?.type || "prop" });
  }
  return out;
}

// ===== State refs =====
const s1 = { dot: $("#s1dot"), pill: $("#s1pill"), status: $("#s1status") };
const s2 = { dot: $("#s2dot"), pill: $("#s2pill"), status: $("#s2status"), propSelect: $("#propSelect") };
const s3 = { dot: $("#s3dot"), pill: $("#s3pill"), status: $("#s3status") };

// ===== Setup =====
document.addEventListener("DOMContentLoaded", async () => {
  // Prefill proxy
  const saved = loadCfg();
  $("#proxy").value = saved.proxy || DEFAULT_PROXY;
  if (saved.db) $("#dbInput").value = saved.db;

  // Step 1: try session check
  await checkSession();

  // Events
  $("#loginBtn").addEventListener("click", onLogin);
  $("#loadPropsBtn").addEventListener("click", onLoadProps);
  $("#sumBtn").addEventListener("click", onSum);
  $("#logoutBtn").addEventListener("click", onLogout);
  $("#propSelect").addEventListener("change", () => {
    if ($("#propSelect").value) {
      $("#sumBtn").disabled = false;
      setStatus(s3.status, "info", "선택한 속성으로 합계를 계산할 수 있습니다.");
      setStep(s3.dot, s3.pill, "wait", "대기");
    }
  });
});

async function checkSession() {
  setStep(s1.dot, s1.pill, "do", "연결 확인중");
  try {
    const { ok, me, error } = await api("/me", {});
    if (!ok) throw new Error(error || "세션 없음");
    const name = me?.bot?.owner?.user?.name || me?.name || me?.owner?.type || "Notion";
    setStep(s1.dot, s1.pill, "ok", "연결됨");
    setStatus(s1.status, "ok", `✅ 연결 성공: ${name} (워크스페이스 접근 가능)`);
    // enable step 2
    $("#loadPropsBtn").disabled = false;
    $("#dbInput").disabled = false;
    setStatus(s2.status, "info", "DB 링크/ID를 입력하고 '속성 불러오기'를 눌러주세요.");
  } catch (e) {
    setStep(s1.dot, s1.pill, "wait", "대기");
    setStatus(s1.status, "info", "아직 로그인되지 않았습니다. 'Notion으로 로그인'을 눌러 진행하세요.");
    $("#loadPropsBtn").disabled = true;
    $("#dbInput").disabled = false; // 로그인 전에 입력해도 됨
  }
}

function onLogin() {
  const proxy = ($("#proxy").value || DEFAULT_PROXY).replace(/\/+$/,"");
  const back = location.href;
  location.href = `${proxy}/oauth/login?redirect=${encodeURIComponent(back)}`;
}

async function onLoadProps() {
  const raw = $("#dbInput").value.trim();
  const id = extractDbId(raw);
  if (!id) {
    setStatus(s2.status, "err", "❌ DB 링크/ID를 입력하세요.");
    setStep(s2.dot, s2.pill, "err", "오류");
    return;
  }

  setStep(s2.dot, s2.pill, "do", "속성 불러오는 중");
  setStatus(s2.status, "info", "잠시만요… DB 메타데이터를 불러오는 중입니다.");

  try {
    const { ok, props, error } = await api("/props", { databaseId: id });
    if (!ok) throw new Error(error || "속성 불러오기 실패");

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
    if (!sel.options.length) {
      setStep(s2.dot, s2.pill, "err", "오류");
      setStatus(s2.status, "err", "⚠️ 표시할 속성이 없습니다. DB 권한/속성 타입(number/formula/rollup) 확인");
      $("#propSelect").disabled = true;
      $("#sumBtn").disabled = true;
      return;
    }
    $("#propSelect").disabled = false;
    $("#sumBtn").disabled = false;
    setStep(s2.dot, s2.pill, "ok", "속성 로드");
    setStatus(s2.status, "ok", `📥 속성 ${sel.options.length}개 불러왔습니다. 합계를 계산할 속성을 선택하세요.`);

    saveCfg({ proxy: $("#proxy").value, db: id, prop: sel.value });
    // Step3 안내
    setStep(s3.dot, s3.pill, "wait", "대기");
    setStatus(s3.status, "info", "이제 '합계 계산'을 눌러 결과를 확인하세요.");
  } catch (e) {
    setStep(s2.dot, s2.pill, "err", "오류");
    setStatus(s2.status, "err", `❌ ${e.message}`);
    $("#propSelect").disabled = true;
    $("#sumBtn").disabled = true;
  }
}

async function onSum() {
  const id = extractDbId($("#dbInput").value.trim());
  const prop = $("#propSelect").value;
  if (!id || !prop) {
    setStatus(s3.status, "err", "❌ DB와 속성을 먼저 설정하세요.");
    setStep(s3.dot, s3.pill, "err", "오류");
    return;
  }
  setStep(s3.dot, s3.pill, "do", "합계 계산중");
  setStatus(s3.status, "info", "데이터를 집계하고 있어요…");

  try {
    const resp = await api("/sum", { databaseId: id, prop });
    if (!resp || resp.ok === false) throw new Error(resp?.error || "합계 계산 실패");
    const sumVal =
      typeof resp.sum === "number" ? resp.sum :
      typeof resp.total === "number" ? resp.total : 0;
    const countVal = typeof resp.count === "number" ? resp.count : undefined;
    const tail = countVal !== undefined ? ` (페이지 ${countVal}개)` : "";
    $("#sumResult").textContent = `🎉 합계: ${sumVal}${tail}`;
    setStep(s3.dot, s3.pill, "ok", "완료");
    setStatus(s3.status, "ok", "✅ 계산이 완료되었습니다.");
  } catch (e) {
    setStep(s3.dot, s3.pill, "err", "오류");
    setStatus(s3.status, "err", `❌ ${e.message}`);
  }
}

async function onLogout() {
  try {
    await api("/oauth/logout", {});
    setStatus(s1.status, "info", "로그아웃되었습니다. 다시 로그인하여 연결하세요.");
    setStep(s1.dot, s1.pill, "wait", "대기");
    // 비활성화
    $("#loadPropsBtn").disabled = true;
    $("#propSelect").disabled = true;
    $("#sumBtn").disabled = true;
    $("#sumResult").textContent = "";
    setStatus(s2.status, "info", "로그인 후에 진행할 수 있습니다.");
    setStatus(s3.status, "info", "속성을 먼저 선택하세요.");
  } catch (e) {
    setStatus(s1.status, "err", `❌ 로그아웃 실패: ${e.message}`);
  }
}
