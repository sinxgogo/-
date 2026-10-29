const API = 'https://api.frankfurter.app';
const STORAGE_KEY = 'hkd-cny-alert-v1';
const CHECK_INTERVAL = 60 * 60 * 1000;
const $ = (id) => document.getElementById(id);

const state = {
  rate: null,
  history: [],
  updatedAt: null,
  target: null,
  enabled: true,
  lastNotifiedDay: null,
  lastCheckAt: 0,
  swRegistration: null,
};

function readSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function persist() {
  const saved = {
    target: state.target,
    enabled: state.enabled,
    lastNotifiedDay: state.lastNotifiedDay,
    rate: state.rate,
    history: state.history,
    updatedAt: state.updatedAt,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  saveBackgroundSettings(saved).catch((error) => console.info('Could not sync alert settings:', error));
  if (state.swRegistration?.active) {
    state.swRegistration.active.postMessage({ type: 'SAVE_SETTINGS', settings: saved });
  }
}

function openSettingsDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('hkd-cny-alerts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveBackgroundSettings(settings) {
  if (!('indexedDB' in window)) return;
  const db = await openSettingsDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction('state', 'readwrite');
    transaction.objectStore('state').put(settings, 'settings');
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

async function loadBackgroundSettings() {
  if (!('indexedDB' in window)) return {};
  const db = await openSettingsDb();
  const settings = await new Promise((resolve, reject) => {
    const request = db.transaction('state').objectStore('state').get('settings');
    request.onsuccess = () => resolve(request.result || {});
    request.onerror = () => reject(request.error);
  });
  db.close();
  return settings;
}

function localDay() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function formatRate(value) {
  return Number(value).toFixed(4);
}

function render() {
  if (state.rate !== null) {
    $('rateValue').innerHTML = `${formatRate(state.rate)}<span> CNY</span>`;
    $('marketLabel').textContent = '参考价';
    $('updatedAt').textContent = state.updatedAt ? `更新于 ${new Date(state.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '已保存的汇率';
    $('marketLabel').previousElementSibling.classList.add('live');
  }
  $('alertEnabled').checked = state.enabled;
  $('targetRate').value = state.target ?? '';

  if (state.history.length) {
    const values = state.history.map((point) => point.rate);
    const low = Math.min(...values);
    const high = Math.max(...values);
    $('weekLow').textContent = formatRate(low);
    $('weekHigh').textContent = formatRate(high);
    const spread = high - low;
    const percent = spread > 0 ? ((state.rate - low) / spread) * 100 : 50;
    $('rateMarker').style.left = `${Math.max(2, Math.min(98, percent))}%`;
    if (values.length > 1) {
      const delta = values.at(-1) - values[0];
      const change = (delta / values[0]) * 100;
      const sign = change > 0 ? '+' : '';
      $('changeValue').textContent = `近 7 日 ${sign}${change.toFixed(2)}%`;
      $('changeValue').className = `change-value ${change > 0 ? 'positive' : change < 0 ? 'negative' : ''}`;
    }
  }

  const notice = notificationStatus();
  $('noticeStatus').textContent = notice.message;
  $('enableNotifications').textContent = notice.action;
  $('enableNotifications').hidden = !notice.showAction;
  $('deliveryStatus').textContent = '本机通知';
}

function notificationStatus() {
  if (!('Notification' in window)) return { message: '此浏览器不支持系统通知。', action: '', showAction: false };
  if (Notification.permission === 'denied') return { message: '通知权限已关闭，请在浏览器或系统设置中允许。', action: '查看设置', showAction: false };
  if (Notification.permission !== 'granted') return { message: '开启通知权限，汇率达到目标时通知你。', action: '开启通知', showAction: true };
  if (!state.enabled) return { message: '提醒已暂停。重新开启后会继续检查目标汇率。', action: '', showAction: false };
  if (state.target === null) return { message: '先设置目标汇率，达到时会通过本机通知你。', action: '', showAction: false };
  return { message: `目标为 ${formatRate(state.target)} CNY；达到或高于目标时提醒。`, action: '', showAction: false };
}

function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('visible'), 2600);
}

async function sendAlert(rate, background = false) {
  if (!state.enabled || state.target === null || rate < state.target) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const today = localDay();
  if (state.lastNotifiedDay === today) return;
  state.lastNotifiedDay = today;
  persist();
  const title = '港币汇率达到目标';
  const body = `当前参考价 1 HKD = ${formatRate(rate)} CNY，已达到你的目标 ${formatRate(state.target)}。`;
  try {
    if (state.swRegistration) {
      await state.swRegistration.showNotification(title, { body, icon: 'icon.svg', badge: 'icon.svg', tag: 'hkd-cny-target', renotify: true, data: { url: './' } });
    } else {
      new Notification(title, { body, tag: 'hkd-cny-target' });
    }
    if (!background && document.visibilityState === 'visible') showToast('汇率达到目标，已发送提醒');
  } catch {
    if (!background) showToast('无法显示通知，请检查系统通知权限');
  }
}

async function fetchLatest() {
  const response = await fetch(`${API}/latest?from=HKD&to=CNY`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`汇率服务返回 ${response.status}`);
  const data = await response.json();
  if (!Number.isFinite(data.rates?.CNY)) throw new Error('汇率数据格式异常');
  return { rate: data.rates.CNY, date: data.date };
}

async function fetchHistory() {
  const start = new Date();
  start.setDate(start.getDate() - 8);
  const date = start.toISOString().slice(0, 10);
  const response = await fetch(`${API}/${date}..${new Date().toISOString().slice(0, 10)}?from=HKD&to=CNY`, { cache: 'no-store' });
  if (!response.ok) throw new Error('历史数据暂不可用');
  const data = await response.json();
  return Object.entries(data.rates || {}).map(([day, rates]) => ({ date: day, rate: rates.CNY })).filter((point) => Number.isFinite(point.rate));
}

async function refreshRates({ quiet = false } = {}) {
  const button = $('refreshButton');
  button.disabled = true;
  try {
    const latest = await fetchLatest();
    state.rate = latest.rate;
    state.updatedAt = new Date().toISOString();
    try {
      state.history = await fetchHistory();
      if (!state.history.length || state.history.at(-1).date !== latest.date) state.history.push({ date: latest.date, rate: latest.rate });
    } catch {
      if (!state.history.length) state.history = [{ date: latest.date, rate: latest.rate }];
    }
    state.lastCheckAt = Date.now();
    persist();
    render();
    await sendAlert(state.rate);
    if (!quiet) showToast('汇率已更新');
  } catch (error) {
    $('marketLabel').textContent = state.rate === null ? '暂时无法连接' : '显示缓存数据';
    if (!quiet) showToast('暂时无法获取最新汇率，请检查网络后重试');
    console.warn('Rate refresh failed:', error);
  } finally {
    button.disabled = false;
  }
}

async function enableNotifications() {
  if (!('Notification' in window)) {
    showToast('此浏览器不支持系统通知');
    return;
  }
  const permission = await Notification.requestPermission();
  render();
  if (permission === 'granted') {
    showToast('通知已开启');
    await setupBackgroundCheck();
    if (state.rate !== null) await sendAlert(state.rate);
  } else {
    showToast('未获得通知权限');
  }
}

async function setupBackgroundCheck() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  try {
    state.swRegistration = await navigator.serviceWorker.register('./sw.js');
    await navigator.serviceWorker.ready;
    persist();
    const periodic = state.swRegistration.periodicSync;
    if (periodic && Notification.permission === 'granted') {
      try {
        const permission = await navigator.permissions.query({ name: 'periodic-background-sync' });
        if (permission.state === 'granted') {
          await periodic.register('daily-rate-check', { minInterval: 24 * 60 * 60 * 1000 });
          $('checkStatus').textContent = '浏览器已登记每日后台检查';
        }
      } catch (error) {
        console.info('Periodic background sync unavailable:', error);
      }
    }
  } catch (error) {
    console.info('Service worker unavailable:', error);
  }
}

async function saveTarget() {
  const raw = $('targetRate').value.trim();
  if (!raw) {
    state.target = null;
  } else {
    const target = Number(raw);
    if (!Number.isFinite(target) || target <= 0 || target >= 100) {
      showToast('请输入有效的目标汇率');
      return;
    }
    state.target = target;
  }
  state.lastNotifiedDay = null;
  persist();
  render();
  showToast(state.target === null ? '已清除目标汇率' : `目标已保存：${formatRate(state.target)} CNY`);
  if (state.target !== null && Notification.permission !== 'granted') await enableNotifications();
  else if (state.rate !== null) await sendAlert(state.rate);
}

async function initialize() {
  const saved = readSaved();
  let backgroundSaved = {};
  try {
    backgroundSaved = await loadBackgroundSettings();
  } catch (error) {
    console.info('Could not restore background alert settings:', error);
  }
  if (backgroundSaved.lastNotifiedDay && backgroundSaved.lastNotifiedDay > (saved.lastNotifiedDay || '')) {
    saved.lastNotifiedDay = backgroundSaved.lastNotifiedDay;
  }
  state.target = Number.isFinite(Number(saved.target)) && saved.target !== null ? Number(saved.target) : null;
  state.enabled = saved.enabled !== false;
  state.lastNotifiedDay = saved.lastNotifiedDay || null;
  state.rate = Number.isFinite(Number(saved.rate)) && saved.rate !== null ? Number(saved.rate) : null;
  state.history = Array.isArray(saved.history) ? saved.history.filter((point) => Number.isFinite(point.rate)) : [];
  state.updatedAt = saved.updatedAt || null;
  render();
  await setupBackgroundCheck();
  refreshRates({ quiet: true });
  setInterval(() => refreshRates({ quiet: true }), CHECK_INTERVAL);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - state.lastCheckAt > CHECK_INTERVAL) refreshRates({ quiet: true });
  });
  $('refreshButton').addEventListener('click', () => refreshRates());
  $('saveTarget').addEventListener('click', saveTarget);
  $('enableNotifications').addEventListener('click', enableNotifications);
  $('alertEnabled').addEventListener('change', (event) => {
    state.enabled = event.target.checked;
    persist();
    render();
  });
  $('targetRate').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') saveTarget();
  });
}

initialize();
