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

// 강제 자동 새로고침 관리 (1분 고정)
let forcedRefreshInterval = null;
let lastCalculationResult = null;
let isCalculating = false;

// 애니메이션 정리 함수
let currentAnimationCleanup = null;

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

// 상태 저장/복원 함수들
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
      timestamp: Date.now()
    };
    
    localStorage.setItem('notion_app_state', JSON.stringify(state));
    console.log("상태 저장 완료");
  } catch (error) {
    console.error("상태 저장 실패:", error);
  }
}

function loadAppState() {
  try {
    const saved = localStorage.getItem('notion_app_state');
    if (!saved) return null;
    
    const state = JSON.parse(saved);
    
    // 30일 이상 된 상태만 무시
    if (Date.now() - state.timestamp > 30 * 24 * 60 * 60 * 1000) {
      console.log("30일 이상 된 상태 데이터 정리");
      localStorage.removeItem('notion_app_state');
      return null;
    }
    
    console.log("저장된 앱 상태 발견:", state);
    return state;
  } catch (error) {
    console.error("상태 복원 실패:", error);
    return null;
  }
}

// 토큰 관리 함수들
function saveToken(token) {
  try {
    const tokenData = {
      token: token,
      timestamp: Date.now(),
      expiry: Date.now() + (4 * 60 * 60 * 1000) // 4시간 유효
    };
    
    localStorage.setItem('notion_access_token_data', JSON.stringify(tokenData));
    console.log("토큰 저장 완료 (4시간 유효)");
    return true;
  } catch (error) {
    console.error("토큰 저장 실패:", error);
    return false;
  }
}

function getToken() {
  try {
    const tokenDataStr = localStorage.getItem('notion_access_token_data');
    if (!tokenDataStr) return null;
    
    const tokenData = JSON.parse(tokenDataStr);
    
    // 토큰 만료 확인
    if (Date.now() > tokenData.expiry) {
      console.log("토큰 만료됨 (4시간 경과)");
      clearToken();
      return null;
    }
    
    return tokenData.token;
  } catch (error) {
    console.error("토큰 조회 실패:", error);
    clearToken();
    return null;
  }
}

function clearToken() {
  try {
    localStorage.removeItem('notion_access_token_data');
    console.log("토큰 삭제 완료");
  } catch (error) {
    console.error("토큰 삭제 실패:", error);
  }
}

// API 호출 함수
async function callProxy(path, body = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  
  try {
    console.log(`API 호출: ${path}`, body);
    
    const token = getToken();
    if (token) {
      body.token = token;
      console.log("localStorage 토큰 사용");
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
    
    console.log(`응답 상태: ${response.status}`);
    
    if (!response.ok) {
      let errorText;
      try {
        const errorData = await response.json();
        errorText = errorData.error || `HTTP ${response.status}`;
        console.log("에러 응답:", errorData);
      } catch {
        errorText = await response.text() || `HTTP ${response.status}`;
        console.log("텍스트 에러:", errorText);
      }
      
      if (response.status === 401) {
        console.log("인증 필요 - 토큰 삭제");
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
    console.log("성공 응답:", result);
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

// GIF 애니메이션 카운터 생성
function createAnimatedCounter(number, container) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  container.appendChild(canvas);
  
  // 캔버스 설정
  const digits = String(number).replace(/,/g, '').split('');
  const digitWidth = 60;
  const digitHeight = 80;
  const padding = 10;
  const canvasWidth = (digits.length * digitWidth) + ((digits.length - 1) * padding) + (padding * 2);
  const canvasHeight = digitHeight + (padding * 2);
  
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  canvas.style.borderRadius = '15px';
  canvas.style.boxShadow = '0 5px 15px rgba(0,0,0,0.3)';
  
  let animationId;
  
  function animate() {
    // 캔버스 클리어
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    
    // 배경 그라데이션
    const gradient = ctx.createLinearGradient(0, 0, 0, canvasHeight);
    gradient.addColorStop(0, '#667eea');
    gradient.addColorStop(1, '#764ba2');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    
    // 각 숫자 그리기
    ctx.font = 'bold 48px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    const time = Date.now() / 1000;
    
    digits.forEach((digit, index) => {
      const x = padding + (index * (digitWidth + padding)) + (digitWidth / 2);
      const y = canvasHeight / 2;
      
      // 숫자 배경 - 펄스 효과
      const pulse = Math.sin(time * 3 + index * 0.5) * 0.1 + 0.9;
      ctx.fillStyle = `rgba(255, 255, 255, ${pulse})`;
      ctx.beginPath();
      
      const rectWidth = digitWidth * pulse;
      const rectHeight = digitHeight * pulse;
      ctx.roundRect(x - rectWidth/2, y - rectHeight/2, rectWidth, rectHeight, 10);
      ctx.fill();
      
      // 숫자 텍스트
      ctx.fillStyle = '#2c3e50';
      ctx.fillText(digit, x, y);
      
      // 반짝이는 효과들
      for (let i = 0; i < 3; i++) {
        const sparkle = Math.sin(time * 4 + index * 2 + i * 1.5) * 0.3 + 0.7;
        const sparkleX = x + (Math.cos(time * 2 + i) * digitWidth/3);
        const sparkleY = y + (Math.sin(time * 2 + i) * digitHeight/3);
        
        ctx.fillStyle = `rgba(255, 215, 0, ${sparkle * 0.6})`;
        ctx.beginPath();
        ctx.arc(sparkleX, sparkleY, 2 + Math.sin(time * 3 + i) * 1, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    
    animationId = requestAnimationFrame(animate);
  }
  
  animate();
  
  // 정리 함수 반환
  return () => {
    if (animationId) {
      cancelAnimationFrame(animationId);
    }
    if (canvas.parentNode) {
      canvas.parentNode.removeChild(canvas);
    }
  };
}

// 외부 GIF URL 생성
function generateCounterGifUrl(number) {
  const cleanNumber = String(number).replace(/,/g, '');
  const formattedNumber = formatNumber(number);
  
  return {
    counter_api: `https://count.getloli.com/get/@notion-db-${cleanNumber}?theme=rule34`,
    custom_badge: `https://img.shields.io/badge/Total-${encodeURIComponent(formattedNumber)}-brightgreen?style=for-the-badge&logo=notion&logoColor=white`,
    animated_text: `https://readme-typing-svg.herokuapp.com/?lines=Total:+${encodeURIComponent(formattedNumber)}&font=Fira%20Code&center=true&width=300&height=50&duration=3000&pause=1000`,
    hit_counter: `https://hitcounter.pythonanywhere.com/count/tag.svg?url=notion-db-${cleanNumber}`
  };
}

// 결과를 GIF로 표시
function displayResultAsGif(total, count) {
  const resultContainer = $("#resultBox");
  const resultNumberEl = $("#resultNumber");
  
  // 기존 애니메이션 정리
  if (currentAnimationCleanup) {
    currentAnimationCleanup();
    currentAnimationCleanup = null;
  }
  
  // 텍스트 숨기고 GIF 컨테이너 생성
  resultNumberEl.style.display = 'none';
  
  // GIF 컨테이너 생성
  let gifContainer = resultContainer.querySelector('.gif-container');
  if (!gifContainer) {
    gifContainer = document.createElement('div');
    gifContainer.className = 'gif-container';
    resultNumberEl.parentNode.insertBefore(gifContainer, resultNumberEl.nextSibling);
  }
  
  // 기존 내용 클리어
  gifContainer.innerHTML = '';
  
  // 1. 애니메이션 캔버스 생성
  const canvasContainer = document.createElement('div');
  canvasContainer.style.marginBottom = '15px';
  gifContainer.appendChild(canvasContainer);
  
  currentAnimationCleanup = createAnimatedCounter(total, canvasContainer);
  
  // 2. 외부 GIF URL들 제공
  const gifUrls = generateCounterGifUrl(total);
  
  const urlContainer = document.createElement('div');
  urlContainer.style.cssText = `
    background: #f8f9fa;
    border-radius: 10px;
    padding: 15px;
    margin-top: 15px;
    text-align: left;
  `;
  
  urlContainer.innerHTML = `
    <h4 style="margin-bottom: 10px; color: #2c3e50;">📊 GIF 카운터 링크들:</h4>
    <div style="font-family: monospace; font-size: 12px; line-height: 1.6;">
      <div style="margin-bottom: 8px;">
        <strong>애니메이션 카운터:</strong><br>
        <a href="${gifUrls.counter_api}" target="_blank">${gifUrls.counter_api}</a>
      </div>
      
      <div style="margin-bottom: 8px;">
        <strong>뱃지 스타일:</strong><br>
        <a href="${gifUrls.custom_badge}" target="_blank">${gifUrls.custom_badge}</a>
      </div>
      
      <div style="margin-bottom: 8px;">
        <strong>타이핑 애니메이션:</strong><br>
        <a href="${gifUrls.animated_text}" target="_blank">${gifUrls.animated_text}</a>
      </div>
      
      <div style="margin-bottom: 8px;">
        <strong>히트 카운터:</strong><br>
        <a href="${gifUrls.hit_counter}" target="_blank">${gifUrls.hit_counter}</a>
      </div>
    </div>
    
    <div style="margin-top: 10px; font-size: 11px; color: #666;">
      💡 위 링크들을 복사하여 다른 곳에서 사용하실 수 있습니다.
    </div>
  `;
  
  gifContainer.appendChild(urlContainer);
  
  // 3. 미리보기 이미지들 표시
  const previewContainer = document.createElement('div');
  previewContainer.style.cssText = `
    margin-top: 15px;
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    justify-content: center;
  `;
  
  // 각 GIF 미리보기 (hit_counter 제외)
  Object.entries(gifUrls).forEach(([key, url]) => {
    if (key !== 'hit_counter') {
      const img = document.createElement('img');
      img.src = url;
      img.style.cssText = `
        max-width: 200px;
        height: auto;
        border-radius: 5px;
        box-shadow: 0 2px 5px rgba(0,0,0,0.2);
        cursor: pointer;
      `;
      img.alt = `${key} counter`;
      img.title = `${key} - 클릭하여 크게 보기`;
      img.onclick = () => window.open(url, '_blank');
      previewContainer.appendChild(img);
    }
  });
  
  gifContainer.appendChild(previewContainer);
}

// 강제 1분 자동 업데이트 함수들
function startForcedAutoRefresh() {
  // 기존 interval 정리
  if (forcedRefreshInterval) {
    clearInterval(forcedRefreshInterval);
  }
  
  // 무조건 1분(60초) 간격으로 설정
  const FORCED_INTERVAL_MS = 60 * 1000;
  
  forcedRefreshInterval = setInterval(async () => {
    // 로그인 상태와 데이터베이스 연결 상태 확인
    const token = getToken();
    if (!token || !selectedDatabase || !$("#propSelect").value) {
      console.log("자동 업데이트 조건 불충족 - 로그인/데이터베이스/속성 확인 필요");
      return;
    }
    
    if (!isCalculating) {
      console.log("강제 자동 업데이트 실행 (1분 간격)");
      await calculateSum(true); // silent 모드로 실행
    } else {
      console.log("계산 중이므로 이번 업데이트 스킵");
    }
  }, FORCED_INTERVAL_MS);
  
  console.log("강제 자동 업데이트 시작: 1분 간격 고정");
  updateForcedRefreshStatus();
}

function stopForcedAutoRefresh() {
  if (forcedRefreshInterval) {
    clearInterval(forcedRefreshInterval);
    forcedRefreshInterval = null;
  }
  console.log("강제 자동 업데이트 중지");
  updateForcedRefreshStatus();
}

function updateForcedRefreshStatus() {
  const statusEl = $("#autoRefreshStatus");
  
  if (forcedRefreshInterval) {
    const nextUpdate = new Date(Date.now() + 60 * 1000);
    statusEl.innerHTML = `🔄 자동 업데이트 활성화 (1분 간격 고정) | 다음 업데이트: ${nextUpdate.toLocaleTimeString()}`;
    statusEl.style.color = "#27ae60";
  } else {
    statusEl.innerHTML = "자동 업데이트가 비활성화되어 있습니다.";
    statusEl.style.color = "#666";
  }
}

// 변경사항 표시
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

// 속성 정규화
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

// OAuth 토큰 처리
function handleOAuthToken() {
  const urlParams = new URLSearchParams(window.location.search);
  const accessToken = urlParams.get('access_token');
  
  if (accessToken) {
    console.log("OAuth 토큰 수신:", accessToken.substring(0, 8) + "...");
    
    // 토큰 저장
    if (saveToken(accessToken)) {
      // URL에서 토큰 제거
      window.history.replaceState({}, document.title, window.location.pathname);
      
      setStatus("loginStatus", "로그인 처리 중...", "info");
      
      // 로그인 상태 확인
      setTimeout(async () => {
        const success = await checkLoginStatus();
        if (success) {
          setStatus("loginStatus", "🎉 로그인 성공!", "success");
        }
        updateDebugInfo();
      }, 1000);
      
      return true;
    }
  }
  
  return false;
}

// 로그인 상태 확인
async function checkLoginStatus() {
  try {
    console.log("로그인 상태 확인 시작...");
    
    const response = await callProxy("/me");
    console.log("/me API 응답:", response);
    
    if (response.ok && response.me) {
      isLoggedIn = true;
      userInfo = response.me;
      displayUserInfo(userInfo);
      
      $("#loginBtn").classList.add("hidden");
      $("#logoutBtn").classList.remove("hidden");
      
      setStatus("loginStatus", "Notion에 성공적으로 로그인되었습니다.", "success", true);
      
      // 다음 단계 활성화
      setTimeout(() => activateStep(2), 1000);
      
      return true;
    } else {
      console.log("로그인 실패:", response);
      throw new Error("로그인 정보를 가져올 수 없습니다.");
    }
  } catch (error) {
    console.log("로그인 상태 확인 오류:", error.message);
    isLoggedIn = false;
    return false;
  }
}

// 로그인 처리
async function handleLogin() {
  try {
    setStatus("loginStatus", "Notion 로그인 페이지로 이동 중...", "info");
    
    const loginUrl = `${PROXY_URL}/oauth/login?redirect=${encodeURIComponent(location.href)}`;
    location.href = loginUrl;
  } catch (error) {
    setStatus("loginStatus", `로그인 오류: ${error.message}`, "error");
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
    stopForcedAutoRefresh();
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
    
    setStatus("loginStatus", "로그아웃되었습니다.", "info", true);
    activateStep(1);
    updateDebugInfo();
  } catch (error) {
    setStatus("loginStatus", `로그아웃 오류: ${error.message}`, "error");
  }
}

// 데이터베이스 연결
async function connectDatabase() {
  try {
    if (!isLoggedIn) {
      throw new Error("먼저 Notion에 로그인해주세요.");
    }
    
    const databaseId = extractDbId($("#databaseInput").value);
    
    setStatus("dbStatus", "데이터베이스 연결 중...", "info");
    
    const response = await callProxy("/props", { databaseId });
    
    if (response.ok) {
      selectedDatabase = {
        id: databaseId,
        properties: response.props
      };
      
      setStatus("dbStatus", "데이터베이스가 성공적으로 연결되었습니다.", "success", true);
      
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
    
    if (error.message.includes('권한') || error.message.includes('unauthorized') || error.message.includes('403')) {
      errorMessage = `데이터베이스 접근 권한이 없습니다.\n\n해결 방법:\n1. Notion에서 해당 데이터베이스 페이지로 이동\n2. 페이지 우상단 "⋯" → "연결 추가" 클릭\n3. Integration 연결\n4. 다시 시도해주세요`;
    } else if (error.message.includes('찾을 수 없습니다') || error.message.includes('404')) {
      errorMessage = `데이터베이스를 찾을 수 없습니다.\n\n확인사항:\n• URL이 올바른지 확인\n• 데이터베이스가 삭제되지 않았는지 확인\n• 공유 설정이 올바른지 확인`;
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
    
    setStatus("propStatus", "속성을 불러오는 중...", "info");
    
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
    
    setStatus("propStatus", `${properties.length}개의 숫자 속성을 불러왔습니다.`, "success", true);
    
    // 상태 저장
    saveAppState();
    
    // 다음 단계 활성화
    setTimeout(() => activateStep(4), 1000);
  } catch (error) {
    updateStepStatus(3, 'error');
    setStatus("propStatus", `${error.message}`, "error");
  }
}

// 합계 계산 (GIF로 표시)
async function calculateSum(silent = false) {
  if (isCalculating) return;
  
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
      setStatus("calculateStatus", "데이터를 분석하고 합계를 계산 중...", "info");
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
    
    // 결과를 GIF로 표시
    displayResultAsGif(total, count);
    
    // 라벨과 시간 업데이트
    $("#resultLabel").textContent = `총 ${formatNumber(count)}개 항목의 합계`;
    $("#lastUpdate").textContent = new Date().toLocaleString();
    $("#resultBox").classList.remove("hidden");
    $("#resultBox").classList.add("fade-in");
    
    if (!silent) {
      setStatus("calculateStatus", `계산 완료! 총 ${formatNumber(count)}개 항목의 합계: ${formatNumber(total)}`, "success");
      updateStepStatus(4, 'completed');
      
      // 첫 계산 완료 후 강제 자동 업데이트 시작
      if (!forcedRefreshInterval) {
        $("#autoRefreshEnabled").checked = true;
        startForcedAutoRefresh();
        console.log("첫 계산 완료 - 강제 자동 업데이트 시작");
      }
    } else {
      console.log(`자동 업데이트 완료: ${formatNumber(total)} (${formatNumber(count)}개 항목)`);
    }
    
    // 결과 저장
    lastCalculationResult = currentResult;
    saveAppState();
    
  } catch (error) {
    if (!silent) {
      updateStepStatus(4, 'error');
      setStatus("calculateStatus", `${error.message}`, "error");
    } else {
      console.error("자동 합계 계산 오류:", error.message);
      if (error.message.includes('로그인') || error.message.includes('권한')) {
        stopForcedAutoRefresh();
        $("#autoRefreshEnabled").checked = false;
        setStatus("calculateStatus", "자동 업데이트 중 인증 오류가 발생하여 중지되었습니다.", "error");
      }
    }
  } finally {
    isCalculating = false;
  }
}

// 브라우저 가시성 변경 감지
function handleVisibilityChange() {
  if (!document.hidden && $("#autoRefreshEnabled").checked) {
    // 탭이 다시 활성화되면 즉시 한 번 계산
    console.log("브라우저 탭 활성화 - 즉시 업데이트");
    setTimeout(() => {
      if (!isCalculating && selectedDatabase && $("#propSelect").value) {
        calculateSum(true);
      }
    }, 1000);
  }
}

// 정리 함수
function cleanup() {
  stopForcedAutoRefresh();
  if (currentAnimationCleanup) {
    currentAnimationCleanup();
  }
}

// 초기화
document.addEventListener("DOMContentLoaded", async () => {
  console.log("웹앱 초기화 시작");
  
  try {
    // 초기 단계 활성화
    activateStep(1);
    
    // 디버그 정보 초기화
    updateDebugInfo();
    
    // OAuth 토큰 처리 (우선순위)
    const hasOAuthToken = handleOAuthToken();
    
    if (!hasOAuthToken) {
      // 기존 토큰으로 로그인 상태 확인
      setStatus("loginStatus", "로그인 상태 확인 중...", "info");
      const loginSuccess = await checkLoginStatus();
      updateDebugInfo();
      
      if (!loginSuccess) {
        setStatus("loginStatus", "Notion에 로그인하여 시작해보세요.", "info");
        $("#refreshBtn").classList.remove("hidden");
      }
    }
    
    // 이벤트 리스너 등록
    $("#loginBtn").addEventListener("click", withLoading($("#loginBtn"), handleLogin));
    $("#logoutBtn").addEventListener("click", withLoading($("#logoutBtn"), handleLogout));
    $("#refreshBtn").addEventListener("click", withLoading($("#refreshBtn"), checkLoginStatus));
    $("#connectDbBtn").addEventListener("click", withLoading($("#connectDbBtn"), connectDatabase));
    $("#loadPropsBtn").addEventListener("click", withLoading($("#loadPropsBtn"), loadProperties));
    $("#calculateBtn").addEventListener("click", withLoading($("#calculateBtn"), () => calculateSum(false)));
    
    // 자동 새로고침 체크박스 이벤트 (1분 고정)
    $("#autoRefreshEnabled").addEventListener("change", function() {
      if (this.checked) {
        if (selectedDatabase && $("#propSelect").value) {
          startForcedAutoRefresh();
          saveAppState();
        } else {
          this.checked = false;
          alert("먼저 데이터베이스를 연결하고 속성을 선택해주세요.");
        }
      } else {
        stopForcedAutoRefresh();
        saveAppState();
      }
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
    
    console.log("웹앱 초기화 완료");
    
  } catch (error) {
    console.error("초기화 오류:", error);
    setStatus("loginStatus", `초기화 오류: ${error.message}`, "error");
  }
});
