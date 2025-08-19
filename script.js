// 프록시 URL 하드코딩
const PROXY_URL = 'https://crimson-salad-9cb7.code0630.workers.dev';

// 유틸리티 함수들
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// 상태 관리
let currentStep = 1;
let isLoggedIn = false;
let selectedDatabase = null;
let userInfo = null;

// 숫자 포맷팅
function formatNumber(num) {
  return new Intl.NumberFormat('ko-KR').format(num);
}

// 상태 메시지 표시
function setStatus(elementId, msg, type = "", autoClear = false) {
  const el = $(elementId);
  if (!el) return;
  
  el.textContent = msg;
  el.className = `status ${type}`;
  
  // 애니메이션 효과
  el.style.animation = "none";
  el.offsetHeight; // reflow 강제
  el.style.animation = "fadeIn 0.5s ease";
  
  // 자동 클리어
  if (autoClear && type === "success") {
    setTimeout(() => {
      el.textContent = "";
      el.className = "status";
    }, 3000);
  }
}

// 단계 상태 업데이트
function updateStepStatus(stepNum, status) {
  const step = $(`#step${stepNum}`);
  if (!step) return;
  
  // 모든 상태 클래스 제거
  step.classList.remove('active', 'completed', 'error');
  
  // 새 상태 적용
  if (status) {
    step.classList.add(status);
  }
  
  // 활성 단계 애니메이션
  if (status === 'active') {
    step.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// 다음 단계 활성화
function activateStep(stepNum) {
  currentStep = stepNum;
  
  // 모든 단계 비활성화
  for (let i = 1; i <= 4; i++) {
    updateStepStatus(i, '');
  }
  
  // 완료된 단계들 표시
  for (let i = 1; i < stepNum; i++) {
    updateStepStatus(i, 'completed');
  }
  
  // 현재 단계 활성화
  updateStepStatus(stepNum, 'active');
}

// DB ID 추출 및 검증
function extractDbId(input) {
  if (!input) throw new Error("데이터베이스 URL 또는 ID를 입력해주세요.");
  
  const s = String(input).trim();
  
  // URL인 경우
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      if (u.hostname.endsWith("notion.so")) {
        let path = u.pathname.split("/").pop() || "";
        const hex = path.replace(/[^0-9a-f]/gi, "");
        if (hex.length >= 32) return hex.slice(0, 32).toLowerCase();
        throw new Error("올바른 Notion 데이터베이스 URL이 아닙니다.");
      }
    } catch (e) {
      throw new Error("올바른 URL 형식이 아닙니다.");
    }
  }
  
  // 직접 ID인 경우
  const m = s.match(/[0-9a-f]{32}/i);
  if (m) return m[0].toLowerCase();
  
  throw new Error("올바른 Notion 데이터베이스 ID가 아닙니다.");
}

// API 호출
async function callProxy(path, body = {}) {
  try {
    const response = await fetch(`${PROXY_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      
      if (response.status === 401) {
        throw new Error("로그인이 필요합니다. Notion으로 다시 로그인해주세요.");
      } else if (response.status === 403) {
        throw new Error("데이터베이스 접근 권한이 없습니다. 데이터베이스를 공유하거나 권한을 확인해주세요.");
      } else {
        throw new Error(`서버 오류(${response.status}): ${errorText}`);
      }
    }
    
    return await response.json();
  } catch (error) {
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new Error("네트워크 연결을 확인해주세요.");
    }
    throw error;
  }
}

// 로딩 상태 관리
function withLoading(btn, fn) {
  return async () => {
    const prevText = btn.textContent;
    const prevDisabled = btn.disabled;
    
    btn.disabled = true;
    btn.textContent = "⏳ 처리 중...";
    
    try {
      await fn();
    } catch (error) {
      console.error("Error:", error);
      throw error;
    } finally {
      btn.disabled = prevDisabled;
      btn.textContent = prevText;
    }
  };
}

// 속성 정규화 (숫자 타입만)
function normalizeProps(props) {
  const out = [];
  const numericTypes = ['number', 'formula', 'rollup'];
  
  if (!props || typeof props !== 'object') return out;
  
  for (const [name, def] of Object.entries(props)) {
    if (def && numericTypes.includes(def.type)) {
      out.push({ 
        name, 
        type: def.type,
        displayName: `${name} (${def.type})`
      });
    }
  }
  
  return out;
}

// 사용자 정보 표시
function displayUserInfo(user) {
  if (!user) return;
  
  const userInfoEl = $("#userInfo");
  const userNameEl = $("#userName");
  
  if (user.name) {
    userNameEl.textContent = user.name;
    userInfoEl.classList.remove("hidden");
  }
}

// 로그인 상태 확인
async function checkLoginStatus() {
  try {
    const response = await callProxy("/me");
    if (response.ok && response.me) {
      isLoggedIn = true;
      userInfo = response.me;
      displayUserInfo(userInfo);
      
      $("#loginBtn").classList.add("hidden");
      $("#logoutBtn").classList.remove("hidden");
      
      setStatus("loginStatus", "✅ Notion에 성공적으로 로그인되었습니다.", "success", true);
      
      // 다음 단계 활성화
      setTimeout(() => activateStep(2), 1000);
      
      return true;
    }
  } catch (error) {
    console.log("Not logged in:", error.message);
  }
  
  isLoggedIn = false;
  return false;
}

// 로그인 처리
async function handleLogin() {
  try {
    setStatus("loginStatus", "🔄 Notion 로그인 페이지로 이동 중...", "info");
    
    const loginUrl = `${PROXY_URL}/oauth/login?redirect=${encodeURIComponent(location.href)}`;
    location.href = loginUrl;
  } catch (error) {
    setStatus("loginStatus", `❌ 로그인 오류: ${error.message}`, "error");
  }
}

// 로그아웃 처리
async function handleLogout() {
  try {
    await callProxy("/oauth/logout");
    
    isLoggedIn = false;
    userInfo = null;
    selectedDatabase = null;
    
    $("#userInfo").classList.add("hidden");
    $("#loginBtn").classList.remove("hidden");
    $("#logoutBtn").classList.add("hidden");
    
    // 폼 초기화
    $("#databaseInput").value = "";
    $("#propSelect").innerHTML = '<option value="">속성을 선택하세요</option>';
    $("#resultBox").classList.add("hidden");
    
    // 모든 상태 메시지 클리어
    ["loginStatus", "dbStatus", "propStatus", "calculateStatus"].forEach(id => {
      setStatus(id, "", "");
    });
    
    setStatus("loginStatus", "👋 로그아웃되었습니다.", "info", true);
    activateStep(1);
  } catch (error) {
    setStatus("loginStatus", `❌ 로그아웃 오류: ${error.message}`, "error");
  }
}

// 데이터베이스 연결
async function connectDatabase() {
  try {
    if (!isLoggedIn) {
      throw new Error("먼저 Notion에 로그인해주세요.");
    }
    
    const databaseId = extractDbId($("#databaseInput").value);
    
    setStatus("dbStatus", "🔄 데이터베이스 연결 중...", "info");
    
    // 데이터베이스 접근 테스트
    const response = await callProxy("/props", { databaseId });
    
    if (response.ok) {
      selectedDatabase = {
        id: databaseId,
        properties: response.props
      };
      
      setStatus("dbStatus", "✅ 데이터베이스가 성공적으로 연결되었습니다.", "success", true);
      
      // 다음 단계 활성화
      setTimeout(() => activateStep(3), 1000);
    } else {
      throw new Error("데이터베이스 연결에 실패했습니다.");
    }
  } catch (error) {
    updateStepStatus(2, 'error');
    setStatus("dbStatus", `❌ ${error.message}`, "error");
  }
}

// 속성 불러오기
async function loadProperties() {
  try {
    if (!selectedDatabase) {
      throw new Error("먼저 데이터베이스를 연결해주세요.");
    }
    
    setStatus("propStatus", "🔄 속성을 불러오는 중...", "info");
    
    const properties = normalizeProps(selectedDatabase.properties);
    const select = $("#propSelect");
    
    // 옵션 초기화
    select.innerHTML = '<option value="">속성을 선택하세요</option>';
    
    if (properties.length === 0) {
      throw new Error("집계 가능한 숫자 속성이 없습니다. (number, formula, rollup 타입만 지원)");
    }
    
    // 속성 옵션 추가
    properties.forEach(prop => {
      const option = document.createElement("option");
      option.value = prop.name;
      option.textContent = prop.displayName;
      select.appendChild(option);
    });
    
    setStatus("propStatus", `✅ ${properties.length}개의 숫자 속성을 불러왔습니다.`, "success", true);
    
    // 다음 단계 활성화
    setTimeout(() => activateStep(4), 1000);
  } catch (error) {
    updateStepStatus(3, 'error');
    setStatus("propStatus", `❌ ${error.message}`, "error");
  }
}

// 합계 계산
async function calculateSum() {
  try {
    if (!selectedDatabase) {
      throw new Error("먼저 데이터베이스를 연결해주세요.");
    }
    
    const prop = $("#propSelect").value;
    if (!prop) {
      throw new Error("집계할 속성을 선택해주세요.");
    }
    
    setStatus("calculateStatus", "🔄 데이터를 분석하고 합계를 계산 중...", "info");
    
    const response = await callProxy("/sum", { 
      databaseId: selectedDatabase.id, 
      prop 
    });
    
    if (!response.ok) {
      throw new Error("합계 계산에 실패했습니다.");
    }
    
    const total = response.total || response.sum || 0;
    const count = response.count || 0;
    
    // 결과 표시
    $("#resultNumber").textContent = formatNumber(total);
    $("#resultLabel").textContent = `총 ${formatNumber(count)}개 항목의 합계`;
    $("#resultBox").classList.remove("hidden");
    $("#resultBox").classList.add("fade-in");
    
    setStatus("calculateStatus", `🎉 계산 완료! 총 ${formatNumber(count)}개 항목의 합계: ${formatNumber(total)}`, "success");
    updateStepStatus(4, 'completed');
    
  } catch (error) {
    updateStepStatus(4, 'error');
    setStatus("calculateStatus", `❌ ${error.message}`, "error");
  }
}

// 초기화
document.addEventListener("DOMContentLoaded", async () => {
  // 초기 단계 활성화
  activateStep(1);
  
  // 이벤트 리스너 등록
  $("#loginBtn").addEventListener("click", withLoading($("#loginBtn"), handleLogin));
  $("#logoutBtn").addEventListener("click", withLoading($("#logoutBtn"), handleLogout));
  $("#connectDbBtn").addEventListener("click", withLoading($("#connectDbBtn"), connectDatabase));
  $("#loadPropsBtn").addEventListener("click", withLoading($("#loadPropsBtn"), loadProperties));
  $("#calculateBtn").addEventListener("click", withLoading($("#calculateBtn"), calculateSum));
  
  // 로그인 상태 확인
  setStatus("loginStatus", "🔄 로그인 상태 확인 중...", "info");
  const loginSuccess = await checkLoginStatus();
  
  if (!loginSuccess) {
    setStatus("loginStatus", "👋 Notion에 로그인하여 시작해보세요.", "info");
  }
  
  // URL 파라미터에서 OAuth 결과 확인
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('code')) {
    // OAuth 콜백 후 페이지 새로고침
    window.history.replaceState({}, document.title, window.location.pathname);
    setTimeout(() => location.reload(), 1000);
  }
});
