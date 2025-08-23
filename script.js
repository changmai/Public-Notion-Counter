const PROXY_URL = 'https://crimson-salad-9cb7.code0630.workers.dev';

const $ = (sel) => document.querySelector(sel);

$('#loginBtn').onclick = async () => {
  window.location.href = PROXY_URL + '/oauth/login';
};

$('#loadPropsBtn').onclick = async () => {
  const dbId = $('#dbId').value.trim();
  const res = await fetch(PROXY_URL + '/props', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ databaseId: dbId }),
  });
  const data = await res.json();
  if (data.ok) {
    const select = $('#propSelect');
    select.innerHTML = '';
    Object.keys(data.properties).forEach(key => {
      const opt = document.createElement('option');
      opt.value = key; opt.textContent = key;
      select.appendChild(opt);
    });
  }
};

$('#sumBtn').onclick = async () => {
  const dbId = $('#dbId').value.trim();
  const prop = $('#propSelect').value;
  const res = await fetch(PROXY_URL + '/sum', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ databaseId: dbId, prop }),
  });
  const data = await res.json();
  $('#resultBox').textContent = data.ok ? `합계: ${data.sum} (건수: ${data.counted})` : `오류: ${data.error}`;
};
