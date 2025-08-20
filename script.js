// 프록시 URL 하드코딩 - GitHub Pages 주소에 맞게 수정
const PROXY_URL = 'https://crimson-salad-9cb7.code0630.workers.dev';

// 유틸리티 함수들
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// 상태 관리
let currentStep = 1;
let isLoggedIn = false;
let selectedDatabase = null;
let userInfo = null;

// 자동 새로고침 관리
let autoRefreshInterval = null;
let lastCalculationResult = null;
let isCalculating = false;

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

// 상태 저장/복원 함수들 (보안 개선)
function saveAppState() {
  try {
    const state = {
      isLoggedIn,
      userInfo,
      selectedDatabase,
      databaseInput: $("#databaseInput").value,
      selectedProperty: $("#propSelect").value,
      lastCalculationResult,
      autoRefreshEnabled: $("#autoRefreshEnabled").checked,
      refreshInterval: $("#refreshInterval").value,
      timestamp: Date.now()
    };
    
    // 앱 상태는 localStorage에 저장 (민감하지 않은 정보)
    localStorage.setItem('notion_app_state', JSON.stringify(state));
    console.log("💾 앱 상태 저장 완료");
  } catch (error) {
    console.error("❌ 상태 저장 실패:", error);
  }
}

function loadAppState() {
  try {
    const saved = localStorage.getItem('notion_app_state');
    if (!saved) return null;
    
    const state = JSON.parse(saved);
    
    // 30일 이상 된 상태만 무시 (매우 오래된 데이터만 정리)
    if (Date.now() - state.timestamp > 30 * 24 * 60 * 60 * 1000) {
      console.log("📅 30일 이상 된 상태 데이터 정리");
      localStorage.removeItem('notion_app_state');
      return null;
    }
    
    console.log("📂 저장된 앱 상태 발견:", state);
    return state;
  } catch (error) {
    console.error("❌ 상태 복원 실패:", error);
    return null;
  }
}

function restoreAppState(state) {
  if (!state) return false;
  
  try {
    // 토큰이 있는지 먼저 확인
    const token = getToken();
    if (!token) {
      console.log("⚠️ 토큰이 없어서 로그인 상태만 초기화");
      isLoggedIn = false;
      userInfo = null;
      // 나머지 데이터베이스 관련 상태는 유지
      selectedDatabase = state.selectedDatabase;
      lastCalculationResult = state.lastCalculationResult;
    } else {
      // 토큰이 있으면 모든 상태 복원
      isLoggedIn = state.isLoggedIn || true; // 토큰이 있으면 로그인된 것으로 간주
      userInfo = state.userInfo;
      selectedDatabase = state.selectedDatabase;
      lastCalculationResult = state.lastCalculationResult;
    }
    
    // UI 요소 복원 (토큰 유무와 관계없이)
    if (state.databaseInput) {
      $("#databaseInput").value = state.databaseInput;
    }
    
    if (state.autoRefreshEnabled) {
      $("#autoRefreshEnabled").checked = true;
    }
    
    if (state.refreshInterval) {
      $("#refreshInterval").value = state.refreshInterval;
    }
    
    // 로그인 상태 UI 복원 (토큰이 있을 때만)
    if (isLoggedIn && token) {
      if (userInfo) {
        displayUserInfo(userInfo);
      }
      $("#loginBtn").classList.add("hidden");
      $("#logoutBtn").classList.remove("hidden");
      
      // 토큰이 있고 저장된 데이터베이스가 있으면 자동 연결 시도
      if (selectedDatabase && state.databaseInput) {
        autoConnectDatabase(state);
        return true;
      } else {
        activateStep(2);
      }
    } else {
      // 토큰이 없으면 로그인 버튼 표시하지만 다른 정보는 유지
      $("#loginBtn").classList.remove("hidden");
      $("#logoutBtn").classList.add("hidden");
      activateStep(1);
      
      // 토큰이 없어도 이전 결과는 표시
      if (lastCalculationResult) {
        $("#resultNumber").textContent = formatNumber(lastCalculationResult.total || 0);
        $("#resultLabel").textContent = `총 ${formatNumber(lastCalculationResult.count || 0)}개 항목의 합계 (이전 결과)`;
        $("#lastUpdate").textContent = new Date(lastCalculationResult.timestamp).toLocaleString();
        $("#resultBox").classList.remove("hidden");
        setStatus("calculateStatus", "💾 이전 계산 결과입니다. 실시간 업데이트를 위해 로그인해주세요.", "info");
      }
      
      // 데이터베이스 정보도 표시 (연결은 안 되지만 정보는 보여줌)
      if (selectedDatabase) {
        setStatus("dbStatus", "💾 이전에 연결된 데이터베이스 정보입니다. 실시간 업데이트를 위해 로그인해주세요.", "info");
        restoreDatabaseProperties(selectedDatabase.properties, state.selectedProperty);
      }
    }
    
    console.log("✅ 앱 상태 복원 완료");
    return true;
  } catch (error) {
    console.error("❌ 상태 복원 중 오류:", error);
    return false;
  }
}

// 자동 데이터베이스 연결 함수
async function autoConnectDatabase(state) {
  try {
    setStatus("dbStatus", "🔄 저장된 데이터베이스 자동 연결 중...", "info");
    
    const databaseId = extractDbId(state.databaseInput);
    
    // 데이터베이스 접근 테스트
    const response = await callProxy("/props", { databaseId });
    
    if (response.ok) {
      selectedDatabase = {
        id: databaseId,
        properties: response.props
      };
      
      setStatus("dbStatus", "✅ 데이터베이스가 자동으로 연결되었습니다.", "success");
      
      // 속성 자동 복원
      await autoLoadProperties(state);
      
    } else {
      throw new Error("데이터베이스 자동 연결에 실패했습니다.");
    }
  } catch (error) {
    console.error("자동 연결 실패:", error);
    setStatus("dbStatus", "⚠️ 자동 연결 실패. 수동으로 '데이터베이스 연결 테스트' 버튼을 클릭해주세요.", "error");
    activateStep(2);
  }
}

// 자동 속성 로딩 함수 (개선)
async function autoLoadProperties(state) {
  try {
    setStatus("propStatus", "🔄 저장된 속성 자동 복원 중...", "info");
    
    const properties = normalizeProps(selectedDatabase.properties);
    const select = $("#propSelect");
    
    // 옵션 초기화
    select.innerHTML = '<option value="">속성을 선택하세요</option>';
    
    if (properties.length === 0) {
      throw new Error("집계 가능한 숫자 속성이 없습니다.");
    }
    
    // 속성 옵션 추가 및 이전 선택값 복원
    let selectedFound = false;
    properties.forEach(prop => {
      const option = document.createElement("option");
      option.value = prop.name;
      option.textContent = prop.displayName;
      if (prop.name === state.selectedProperty) {
        option.selected = true;
        selectedFound = true;
      }
      select.appendChild(option);
    });
    
    setStatus("propStatus", `✅ ${properties.length}개의 속성이 자동으로 복원되었습니다.`, "success");
    
    // 이전에 선택된 속성이 있고 실제로 선택되었으면 자동으로 계산까지 수행
    if (state.selectedProperty && selectedFound) {
      console.log(`🎯 선택된 속성 복원됨: ${state.selectedProperty}`);
      activateStep(4);
      updateStepStatus(4, 'completed');
      
      // 계산 결과 복원
      if (state.lastCalculationResult) {
        lastCalculationResult = state.lastCalculationResult;
        $("#resultNumber").textContent = formatNumber(lastCalculationResult.total || 0);
        $("#resultLabel").textContent = `총 ${formatNumber(lastCalculationResult.count || 0)}개 항목의 합계`;
        $("#lastUpdate").textContent = new Date(lastCalculationResult.timestamp).toLocaleString();
        $("#resultBox").classList.remove("hidden");
        setStatus("calculateStatus", "✅ 모든 설정이 자동으로 복원되었습니다. 실시간 업데이트가 시작됩니다.", "success");
        
        // 자동 새로고침 시작 (체크되어 있다면)
        if (state.autoRefreshEnabled && $("#autoRefreshEnabled").checked) {
          setTimeout(() => {
            console.log("🔄 자동 새로고침 시작");
            startAutoRefresh();
          }, 3000); // 3초 후 시작
        }
        
        // 한 번 즉시 업데이트
        setTimeout(() => {
          console.log("🔄 즉시 업데이트 실행");
          calculateSum(true); // silent 모드로 즉시 업데이트
        }, 5000); // 5초 후 첫 업데이트
      } else {
        // 계산 결과가 없으면 한 번 계산
        setTimeout(() => {
          console.log("🔄 초기 계산 실행");
          calculateSum(false);
        }, 3000);
      }
    } else {
      console.log("⚠️ 선택된 속성을 찾을 수 없어서 수동 선택 필요");
      activateStep(3);
      setStatus("propStatus", "속성을 선택한 후 합계 계산을 진행해주세요.", "info");
    }
    
  } catch (error) {
    console.error("자동 속성 로딩 실패:", error);
    setStatus("propStatus", "⚠️ 속성 자동 복원 실패. 수동으로 '속성 불러오기' 버튼을 클릭해주세요.", "error");
    activateStep(3);
  }
}

// 보안 개선된 토큰 관리 함수들
function saveToken(token) {
  try {
    // sessionStorage 사용 (더 안전)
    sessionStorage.setItem('notion_access_token', token);
    // 토큰 만료 시간 설정 (1시간)
    const expiry = Date.now() + (60 * 60 * 1000);
    sessionStorage.setItem('notion_token_expiry', expiry.toString());
    console.log("✅ 토큰 저장 완료 (1시간 유효)");
    return true;
  } catch (error) {
    console.error("❌ 토큰 저장 실패:", error);
    return false;
  }
}

function getToken() {
  try {
    const token = sessionStorage.getItem('notion_access_token');
    const expiry = sessionStorage.getItem('notion_token_expiry');
    
    // 토큰 만료 확인
    if (token && expiry) {
      if (Date.now() > parseInt(expiry)) {
        console.log("⏰ 토큰 만료됨");
        clearToken();
        return null;
      }
      return token;
    }
    return null;
  } catch (error) {
    console.error("❌ 토큰 조회 실패:", error);
    return null;
  }
}

function clearToken() {
  try {
    sessionStorage.removeItem('notion_access_token');
    sessionStorage.removeItem('notion_token_expiry');
    console.log("✅ 토큰 삭제 완료");
  } catch (error) {
    console.error("❌ 토큰 삭제 실패:", error);
  }
}

// API 호출 with token from localStorage
async function callProxy(path, body = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  
  try {
    console.log(`🌐 API 호출: ${path}`, body);
    
    // localStorage에서 토큰 가져오기
    const token = getToken();
    if (token) {
      body.token = token;
      console.log("🔑 localStorage 토큰 사용");
    }
    
    const response = await fetch(`${PROXY_URL}${path}`, {
      method: "POST",
      headers: { 
        "content-type": "application/json",
        "Accept": "application/json"
      },
      credentials: "include",
      body: JSON.stringify(body),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    console.log(`📡 응답 상태: ${response.status}`);
    
    if (!response.ok) {
      let errorText;
      try {
        const errorData = await response.json();
        errorText = errorData.error || `HTTP ${response.status}`;
        console.log("❌ 에러 응답:", errorData);
      } catch {
        errorText = await response.text() || `HTTP ${response.status}`;
        console.log("❌ 텍스트 에러:", errorText);
      }
      
      if (response.status === 401) {
        console.log("🔐 인증 필요 - 토큰 삭제");
        clearToken();
        isLoggedIn = false;
        throw new Error("로그인이 필요합니다. Notion으로 다시 로그인해주세요.");
      } else if (response.status === 403) {
        throw new Error("접근 권한이 없습니다. CORS 설정이나 데이터베이스 권한을 확인해주세요.");
      } else if (response.status === 404) {
        throw new Error("요청한 리소스를 찾을 수 없습니다.");
      } else if (response.status >= 500) {
        throw new Error("서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
      } else {
        throw new Error(errorText);
      }
    }
    
    const result = await response.json();
    console.log("✅ 성공 응답:", result);
    return result;
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error.name === 'AbortError') {
      throw new Error("요청 시간이 초과되었습니다. 네트워크 상태를 확인하고 다시 시도해주세요.");
    }
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new Error("네트워크 연결을 확인해주세요. 인터넷 연결이 불안정할 수 있습니다.");
    }
    throw error;
  }
}

// 연결 상태 테스트
async function testConnection() {
  try {
    const response = await fetch(`${PROXY_URL}/health`, {
      method: "GET",
      credentials: "include"
    });
    return response.ok;
  } catch {
    return false;
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

// 속성 정규화 (숫자 타입만) - 서버에서 이미 필터링됨
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

// 디버그 정보 업데이트
function updateDebugInfo() {
  const token = getToken();
  const savedState = loadAppState();
  
  $("#sessionDebug").textContent = token ? `존재 (${token.substring(0, 8)}...)` : "없음";
  $("#apiDebug").textContent = isLoggedIn ? "로그인됨" : "로그아웃됨";
  $("#stateDebug").textContent = savedState ? "저장됨" : "없음";
}

// 로그인 상태 확인 with detailed debugging
async function checkLoginStatus() {
  try {
    console.log("🔍 로그인 상태 확인 시작...");
    
    const response = await callProxy("/me");
    console.log("✅ /me API 응답:", response);
    
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
    } else {
      console.log("❌ 로그인 실패:", response);
      throw new Error("로그인 정보를 가져올 수 없습니다.");
    }
  } catch (error) {
    console.log("❌ 로그인 상태 확인 오류:", error.message);
    isLoggedIn = false;
    return false;
  }
}

// 수동으로 로그인 상태 새로고침
async function refreshLoginStatus() {
  setStatus("loginStatus", "🔄 로그인 상태 새로고침 중...", "info");
  
  const success = await checkLoginStatus();
  if (!success) {
    setStatus("loginStatus", "❌ 로그인 상태를 확인할 수 없습니다. 페이지를 새로고침하거나 다시 로그인해주세요.", "error");
  }
  updateDebugInfo();
}

// OAuth 토큰 처리
function handleOAuthToken() {
  const urlParams = new URLSearchParams(window.location.search);
  const accessToken = urlParams.get('access_token');
  
  if (accessToken) {
    console.log("🎉 OAuth 토큰 수신:", accessToken.substring(0, 8) + "...");
    
    // 토큰 저장
    if (saveToken(accessToken)) {
      // URL에서 토큰 제거
      window.history.replaceState({}, document.title, window.location.pathname);
      
      setStatus("loginStatus", "🔄 로그인 처리 중...", "info");
      
      // 로그인 상태 확인 및 저장된 상태 복원
      setTimeout(async () => {
        const success = await checkLoginStatus();
        if (success) {
          setStatus("loginStatus", "🎉 로그인 성공!", "success");
          
          // 저장된 상태가 있으면 자동으로 모든 과정 수행
          const savedState = loadAppState();
          if (savedState && savedState.databaseInput && savedState.selectedProperty) {
            console.log("🔄 저장된 설정으로 자동 설정 시작");
            await autoConnectDatabase(savedState);
          } else {
            activateStep(2);
          }
        }
        updateDebugInfo();
      }, 1000);
      
      return true;
    }
  }
  
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
    // 토큰 삭제
    clearToken();
    
    isLoggedIn = false;
    userInfo = null;
    selectedDatabase = null;
    
    // 자동 새로고침 중지
    stopAutoRefresh();
    $("#autoRefreshEnabled").checked = false;
    
    $("#userInfo").classList.add("hidden");
    $("#loginBtn").classList.remove("hidden");
    $("#logoutBtn").classList.add("hidden");
    $("#refreshBtn").classList.add("hidden");
    
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
    updateDebugInfo();
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
      
      // 상태 저장
      saveAppState();
      
      // 다음 단계 활성화
      setTimeout(() => activateStep(3), 1000);
    } else {
      throw new Error("데이터베이스 연결에 실패했습니다.");
    }
  } catch (error) {
    updateStepStatus(2, 'error');
    
    let errorMessage = error.message;
    
    // 권한 관련 에러인 경우 구체적인 안내 제공
    if (error.message.includes('권한') || error.message.includes('unauthorized') || error.message.includes('403')) {
      errorMessage = `❌ 데이터베이스 접근 권한이 없습니다.\n\n📋 해결 방법:\n1. Notion에서 해당 데이터베이스 페이지로 이동\n2. 페이지 우상단 "⋯" → "연결 추가" 클릭\n3. Integration 연결\n4. 다시 시도해주세요`;
    } else if (error.message.includes('찾을 수 없습니다') || error.message.includes('404')) {
      errorMessage = `❌ 데이터베이스를 찾을 수 없습니다.\n\n확인사항:\n• URL이 올바른지 확인\n• 데이터베이스가 삭제되지 않았는지 확인\n• 공유 설정이 올바른지 확인`;
    }
    
    setStatus("dbStatus", errorMessage, "error");
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
    
    // 상태 저장
    saveAppState();
    
    // 다음 단계 활성화
    setTimeout(() => activateStep(4), 1000);
  } catch (error) {
    updateStepStatus(3, 'error');
    setStatus("propStatus", `❌ ${error.message}`, "error");
  }
}

// 합계 계산 (자동/수동 모드 지원)
async function calculateSum(silent = false) {
  if (isCalculating) return; // 중복 실행 방지
  
  try {
    isCalculating = true;
    
    if (!selectedDatabase) {
      throw new Error("먼저 데이터베이스를 연결해주세요.");
    }
    
    const prop = $("#propSelect").value;
    if (!prop) {
      throw new Error("집계할 속성을 선택해주세요.");
    }
    
    if (!silent) {
      setStatus("calculateStatus", "🔄 데이터를 분석하고 합계를 계산 중...", "info");
    }
    
    const response = await callProxy("/sum", { 
      databaseId: selectedDatabase.id, 
      prop 
    });
    
    if (!response.ok) {
      throw new Error("합계 계산에 실패했습니다.");
    }
    
    const total = response.total || response.sum || 0;
    const count = response.count || 0;
    const currentResult = { total, count, timestamp: Date.now() };
    
    // 변경사항 확인 및 표시
    if (silent && lastCalculationResult) {
      showChangeIndicator(lastCalculationResult, currentResult);
    }
    
    // 결과 표시
    $("#resultNumber").textContent = formatNumber(total);
    $("#resultLabel").textContent = `총 ${formatNumber(count)}개 항목의 합계`;
    $("#lastUpdate").textContent = new Date().toLocaleString();
    $("#resultBox").classList.remove("hidden");
    $("#resultBox").classList.add("fade-in");
    
    if (!silent) {
      setStatus("calculateStatus", `🎉 계산 완료! 총 ${formatNumber(count)}개 항목의 합계: ${formatNumber(total)}`, "success");
      updateStepStatus(4, 'completed');
    } else {
      console.log(`🔄 자동 업데이트 완료: ${formatNumber(total)} (${formatNumber(count)}개 항목)`);
    }
    
    // 결과 저장
    lastCalculationResult = currentResult;
    
    // 상태 저장
    saveAppState();
    
  } catch (error) {
    if (!silent) {
      updateStepStatus(4, 'error');
      setStatus("calculateStatus", `❌ ${error.message}`, "error");
    } else {
      console.error("자동 합계 계산 오류:", error.message);
      // 자동 새로고침 중 오류 발생 시 일시 중지
      if (error.message.includes('로그인') || error.message.includes('권한')) {
        stopAutoRefresh();
        $("#autoRefreshEnabled").checked = false;
        setStatus("calculateStatus", "❌ 자동 새로고침 중 인증 오류가 발생하여 중지되었습니다.", "error");
      }
    }
  } finally {
    isCalculating = false;
  }
}

// 자동 새로고침 관련 함수들 (개선)
function startAutoRefresh() {
  const intervalSeconds = parseInt($("#refreshInterval").value);
  const intervalMs = intervalSeconds * 1000;
  
  // 자동 새로고침 전 필수 조건 확인
  if (!selectedDatabase) {
    console.log("❌ 자동 새로고침 실패: 데이터베이스 미연결");
    return false;
  }
  
  const selectedProp = $("#propSelect").value;
  if (!selectedProp) {
    console.log("❌ 자동 새로고침 실패: 속성 미선택");
    return false;
  }
  
  // 기존 interval 정리
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
  }
  
  autoRefreshInterval = setInterval(async () => {
    if (!isCalculating && selectedDatabase && $("#propSelect").value) {
      console.log("🔄 자동 새로고침 실행");
      await calculateSum(true); // silent 모드
    } else {
      console.log("⏸️ 자동 새로고침 조건 불충족 - 대기");
    }
  }, intervalMs);
  
  updateAutoRefreshStatus();
  console.log(`✅ 자동 새로고침 시작: ${intervalSeconds}초 간격, 속성: ${selectedProp}`);
  return true;
}

function stopAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
  updateAutoRefreshStatus();
  console.log("⏹️ 자동 새로고침 중지");
}

function updateAutoRefreshStatus() {
  const statusEl = $("#autoRefreshStatus");
  const isEnabled = $("#autoRefreshEnabled").checked;
  const interval = $("#refreshInterval").value;
  
  if (isEnabled && autoRefreshInterval) {
    const nextUpdate = new Date(Date.now() + parseInt(interval) * 1000);
    statusEl.innerHTML = `🔄 자동 새로고침 활성화 (${interval}초 간격) | 다음 업데이트: ${nextUpdate.toLocaleTimeString()}`;
    statusEl.style.color = "#27ae60";
  } else {
    statusEl.innerHTML = "자동 새로고침이 비활성화되어 있습니다.";
    statusEl.style.color = "#666";
  }
}

function showChangeIndicator(oldResult, newResult) {
  const indicator = $("#changeIndicator");
  
  if (!oldResult || !newResult) return;
  
  const oldTotal = oldResult.total || 0;
  const newTotal = newResult.total || 0;
  const difference = newTotal - oldTotal;
  
  if (difference === 0) {
    indicator.innerHTML = "📊 변경사항 없음";
    indicator.style.color = "#666";
  } else if (difference > 0) {
    indicator.innerHTML = `📈 증가: +${formatNumber(difference)}`;
    indicator.style.color = "#27ae60";
    indicator.style.animation = "pulse 2s ease-in-out";
  } else {
    indicator.innerHTML = `📉 감소: ${formatNumber(difference)}`;
    indicator.style.color = "#e74c3c";
    indicator.style.animation = "pulse 2s ease-in-out";
  }
  
  // 애니메이션 후 제거
  setTimeout(() => {
    indicator.style.animation = "";
  }, 2000);
}

// 브라우저 가시성 변경 감지
function handleVisibilityChange() {
  if (!document.hidden && $("#autoRefreshEnabled").checked) {
    // 탭이 다시 활성화되면 즉시 한 번 계산
    console.log("👁️ 브라우저 탭 활성화 - 즉시 업데이트");
    setTimeout(() => {
      if (!isCalculating && selectedDatabase && $("#propSelect").value) {
        calculateSum(true);
      }
    }, 1000);
  }
}

// 페이지 언로드 시 정리
function cleanup() {
  stopAutoRefresh();
}

// 초기화 with auto-refresh support
document.addEventListener("DOMContentLoaded", async () => {
  console.log("🚀 웹앱 초기화 시작");
  
  try {
    // 초기 단계 활성화
    activateStep(1);
    
    // 디버그 정보 초기화
    updateDebugInfo();
    
    // OAuth 토큰 처리 (우선순위)
    const hasOAuthToken = handleOAuthToken();
    
    // 저장된 상태 복원 시도
    const savedState = loadAppState();
    let stateRestored = false;
    
    if (savedState && !hasOAuthToken) {
      stateRestored = restoreAppState(savedState);
      if (stateRestored) {
        setStatus("loginStatus", "📂 이전 상태가 복원되었습니다.", "info", true);
        updateDebugInfo();
      }
    }
    
    if (hasOAuthToken) {
      console.log("🔑 OAuth 토큰 처리 중...");
    } else if (!stateRestored) {
      // 연결 상태 테스트
      setStatus("loginStatus", "🔄 서버 연결 상태 확인 중...", "info");
      const isConnected = await testConnection();
      
      if (!isConnected) {
        setStatus("loginStatus", "❌ 서버에 연결할 수 없습니다. 네트워크 상태를 확인해주세요.", "error");
        return;
      }
      
      // URL 파라미터 확인 (에러 처리)
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.has('error')) {
        const error = urlParams.get('error');
        setStatus("loginStatus", `❌ OAuth 로그인 오류: ${error}`, "error");
        window.history.replaceState({}, document.title, window.location.pathname);
        return;
      }
      
      // 기존 토큰으로 로그인 상태 확인
      setStatus("loginStatus", "🔄 로그인 상태 확인 중...", "info");
      const loginSuccess = await checkLoginStatus();
      updateDebugInfo();
      
      if (!loginSuccess) {
        setStatus("loginStatus", "👋 Notion에 로그인하여 시작해보세요.", "info");
        $("#refreshBtn").classList.remove("hidden");
      }
    }
    
    // 기본 이벤트 리스너 등록
    $("#loginBtn").addEventListener("click", withLoading($("#loginBtn"), handleLogin));
    $("#logoutBtn").addEventListener("click", withLoading($("#logoutBtn"), handleLogout));
    $("#refreshBtn").addEventListener("click", withLoading($("#refreshBtn"), refreshLoginStatus));
    $("#connectDbBtn").addEventListener("click", withLoading($("#connectDbBtn"), connectDatabase));
    $("#loadPropsBtn").addEventListener("click", withLoading($("#loadPropsBtn"), loadProperties));
    $("#calculateBtn").addEventListener("click", withLoading($("#calculateBtn"), () => calculateSum(false)));
    
    function restoreDatabaseProperties(properties, selectedProperty) {
  if (!properties) return;
  
  const normalizedProps = normalizeProps(properties);
  const select = $("#propSelect");
  
  // 옵션 초기화
  select.innerHTML = '<option value="">속성을 선택하세요</option>';
  
  // 속성 옵션 추가
  normalizedProps.forEach(prop => {
    const option = document.createElement("option");
    option.value = prop.name;
    option.textContent = prop.displayName;
    if (prop.name === selectedProperty) {
      option.selected = true;
    }
    select.appendChild(option);
  });
  
  if (normalizedProps.length > 0) {
    const token = getToken();
    if (token && isLoggedIn) {
      setStatus("propStatus", `💾 ${normalizedProps.length}개의 숫자 속성이 복원되었습니다.`, "success");
      if (selectedProperty) {
        activateStep(4);
        updateStepStatus(4, 'completed');
      }
    } else {
      setStatus("propStatus", `💾 ${normalizedProps.length}개의 속성 정보 (로그인 후 활성화)`, "info");
    }
  }
}
    
    $("#refreshInterval").addEventListener("change", function() {
      if ($("#autoRefreshEnabled").checked) {
        startAutoRefresh(); // 간격 변경 시 재시작
      }
      saveAppState(); // 설정 저장
    });
    
    // 속성 선택 변경 시 상태 저장
    $("#propSelect").addEventListener("change", function() {
      saveAppState();
    });
    
    // 데이터베이스 입력 변경 시 상태 저장
    $("#databaseInput").addEventListener("input", function() {
      saveAppState();
    });
    
    // 브라우저 가시성 변경 감지
    document.addEventListener("visibilitychange", handleVisibilityChange);
    
    // 페이지 언로드 시 정리
    window.addEventListener("beforeunload", cleanup);
    
    console.log("✅ 웹앱 초기화 완료");
    
  } catch (error) {
    console.error("❌ 초기화 오류:", error);
    setStatus("loginStatus", `❌ 초기화 오류: ${error.message}`, "error");
  }
});
