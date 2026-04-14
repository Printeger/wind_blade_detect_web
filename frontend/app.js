const LABEL_SCHEMA = [
  { id: 'crack', cn: '裂纹', tagClass: 'danger', dotClass: 'red', risk: '高' },
  { id: 'erosion', cn: '侵蚀', tagClass: 'warn', dotClass: 'orange', risk: '中' },
  { id: 'contamination', cn: '污染附着', tagClass: 'info', dotClass: 'blue', risk: '低' },
  { id: 'component_damage', cn: '部件损伤', tagClass: 'warn', dotClass: 'green', risk: '中' }
];

const LABEL_ALIAS_MAP = {
  crack: 'crack',
  '裂纹': 'crack',
  erosion: 'erosion',
  corrosion: 'erosion',
  '腐蚀': 'erosion',
  '侵蚀': 'erosion',
  contamination: 'contamination',
  pollution: 'contamination',
  '污垢': 'contamination',
  '污染': 'contamination',
  component_damage: 'component_damage',
  damage: 'component_damage',
  '涂层失效': 'component_damage',
  '粘接失效': 'component_damage',
  '部件损伤': 'component_damage'
};

const DEFAULT_CONFIG = {
  API_BASE: 'http://127.0.0.1:8000',
  ENDPOINTS: {
    predict: '/api/predict',
    predictBatch: '/api/predict-batch',
    taskDetail: '/api/tasks/{task_id}',
    health: '/api/health'
  }
};

const APP_STATE = {
  singleResult: null,
  batchFiles: [],
  taskSummaries: [],
  taskDetails: new Map(),
  healthInfo: null,
  currentTaskId: null,
  currentTaskDetail: null,
  batchPollTimer: null,
  batchLogKeys: new Set()
};

const pageMeta = {
  dashboard: { title: '平台总览', subtitle: '查看任务、缺陷统计、模型状态，以及 GitHub Pages + FastAPI 的联调信息。' },
  single: { title: '单张图片检测', subtitle: '上传单张风机叶片或塔筒图像，调用 FastAPI 预测接口，查看图像级检测结果与缺陷明细。' },
  batch: { title: '批量图片检测', subtitle: '创建批量任务、跟踪处理进度，并通过 task_id 轮询任务状态。' },
  results: { title: '任务结果', subtitle: '查看检测任务的统计、缩略图、缺陷列表与报告导出入口。' },
  review: { title: '结果复核', subtitle: '对检测结果进行人工确认、误检修正、漏检补充与备注保存。' },
  history: { title: '历史任务', subtitle: '检索过往任务、追溯模型版本、查看结果和导出历史报告。' },
  settings: { title: '接口与设置', subtitle: '配置 API_BASE、各接口路径，并进行 FastAPI 连接测试。' }
};

function byId(id) {
  return document.getElementById(id);
}

function normalizeApiBase(apiBase) {
  const raw = (apiBase || '').trim();
  if (!raw) return DEFAULT_CONFIG.API_BASE;
  const fixedHost = raw.replace(/^http:\/\/0\.0\.0\.0/i, 'http://127.0.0.1');
  return fixedHost.replace(/\/+$/, '');
}

function loadConfig() {
  const saved = localStorage.getItem('windDefectAppConfig');
  if (!saved) return structuredClone(DEFAULT_CONFIG);
  try {
    const parsed = JSON.parse(saved);
    return {
      API_BASE: normalizeApiBase(parsed.API_BASE || DEFAULT_CONFIG.API_BASE),
      ENDPOINTS: { ...DEFAULT_CONFIG.ENDPOINTS, ...(parsed.ENDPOINTS || {}) }
    };
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

let APP_CONFIG = loadConfig();

const navItems = document.querySelectorAll('.nav-item');
const views = document.querySelectorAll('.view');
const pageTitle = byId('pageTitle');
const pageSubtitle = byId('pageSubtitle');
const apiBaseChip = byId('apiBaseChip');
const singleEndpointText = byId('singleEndpointText');
const batchEndpointText = byId('batchEndpointText');
const serviceStatusText = byId('serviceStatusText');
const serviceStatusSubtext = byId('serviceStatusSubtext');
const serviceStatusCard = byId('serviceStatusCard');

const singleFileInput = byId('singleFileInput');
const singleUploadBox = byId('singleUploadBox');
const selectSingleBtn = byId('selectSingleBtn');
const singleOriginal = byId('singleOriginal');
const singleResult = byId('singleResult');
const singleFileName = byId('singleFileName');
const singleDetectionsCount = byId('singleDetectionsCount');
const singleBackendName = byId('singleBackendName');
const singleMaxConfidence = byId('singleMaxConfidence');
const singleInferenceTime = byId('singleInferenceTime');
const singleResultTableBody = byId('singleResultTableBody');
const singleApiTaskId = byId('singleApiTaskId');
const singleApiDetections = byId('singleApiDetections');
const singleApiResultImageUrl = byId('singleApiResultImageUrl');
const singleApiInferenceTime = byId('singleApiInferenceTime');

const batchFileInput = byId('batchFileInput');
const batchAddFilesBtn = byId('batchAddFilesBtn');
const batchFileTable = byId('batchFileTable');
const batchCount = byId('batchCount');
const batchTotal = byId('batchTotal');
const batchDone = byId('batchDone');
const batchLog = byId('batchLog');
const runBatchBtn = byId('runBatchBtn');
const batchProgressBar = byId('batchProgressBar');
const batchProgressText = byId('batchProgressText');

const apiTestResult = byId('apiTestResult');

let currentSingleFile = null;

function activateView(viewId) {
  navItems.forEach(btn => btn.classList.toggle('active', btn.dataset.view === viewId));
  views.forEach(view => view.classList.toggle('active', view.id === viewId));
  pageTitle.textContent = pageMeta[viewId].title;
  pageSubtitle.textContent = pageMeta[viewId].subtitle;
}

function normalizeClassName(rawName) {
  const source = String(rawName || '').trim();
  if (!source) return 'unknown';
  const key = source.toLowerCase().replace(/\s+/g, '_');
  return LABEL_ALIAS_MAP[key] || LABEL_ALIAS_MAP[source] || key;
}

function getLabelMeta(rawName) {
  const classId = normalizeClassName(rawName);
  return LABEL_SCHEMA.find(item => item.id === classId) || {
    id: classId,
    cn: classId,
    tagClass: 'info',
    dotClass: 'blue',
    risk: '中'
  };
}

function labelDisplay(rawName) {
  const meta = getLabelMeta(rawName);
  return `${meta.id} (${meta.cn})`;
}

function inferSeverity(rawSeverity, confidence, rawClass) {
  if (rawSeverity) return rawSeverity;
  const score = Number(confidence || 0);
  if (score >= 0.8) return '高';
  if (score >= 0.55) return '中';
  return getLabelMeta(rawClass).risk || '低';
}

function tagClassFromSeverity(severity) {
  if (severity === '高') return 'danger';
  if (severity === '中') return 'warn';
  return 'info';
}

function statusTag(status) {
  if (status === 'finished') return '<span class="tag success">已完成</span>';
  if (status === 'running') return '<span class="tag warn">进行中</span>';
  if (status === 'failed') return '<span class="tag danger">失败</span>';
  return '<span class="tag info">排队中</span>';
}

function getPredictUrl() {
  return `${APP_CONFIG.API_BASE}${APP_CONFIG.ENDPOINTS.predict}`;
}

function getBatchUrl() {
  return `${APP_CONFIG.API_BASE}${APP_CONFIG.ENDPOINTS.predictBatch}`;
}

function getHealthUrl() {
  return `${APP_CONFIG.API_BASE}${APP_CONFIG.ENDPOINTS.health}`;
}

function getTaskDetailUrl(taskId) {
  const tpl = APP_CONFIG.ENDPOINTS.taskDetail || '/api/tasks/{task_id}';
  return `${APP_CONFIG.API_BASE}${tpl.replace('{task_id}', encodeURIComponent(taskId))}`;
}

function getTaskListUrl() {
  return `${APP_CONFIG.API_BASE}/api/tasks`;
}

function applyConfigToUI() {
  apiBaseChip.textContent = `API_BASE：${APP_CONFIG.API_BASE}`;
  singleEndpointText.textContent = `POST ${getPredictUrl()}`;
  batchEndpointText.textContent = `POST ${getBatchUrl()}`;
  byId('apiBaseInput').value = APP_CONFIG.API_BASE;
  byId('predictPathInput').value = APP_CONFIG.ENDPOINTS.predict;
  byId('batchPathInput').value = APP_CONFIG.ENDPOINTS.predictBatch;
  byId('healthPathInput').value = APP_CONFIG.ENDPOINTS.health;
}

function updateServiceStatus(status, subtitle, online) {
  serviceStatusText.textContent = `FastAPI ${status}`;
  serviceStatusSubtext.textContent = subtitle;
  serviceStatusCard.classList.toggle('online', online);
  const dot = serviceStatusCard.querySelector('.status-dot');
  dot.classList.toggle('muted', !online);
}

function renderProviderOptions(availableBackends, activeBackend) {
  const providers = Array.isArray(availableBackends) && availableBackends.length
    ? [...new Set(availableBackends)]
    : ['mock', 'ultralytics', 'roboflow'];

  const allOptions = ['default', ...providers];
  const labelMap = {
    default: '默认（后端配置）',
    mock: 'Mock 演示',
    ultralytics: '本地 Ultralytics',
    roboflow: 'Roboflow'
  };

  ['singleProviderSelect', 'batchProviderSelect'].forEach(id => {
    const select = byId(id);
    if (!select) return;
    const previous = select.value;
    select.innerHTML = allOptions
      .map(item => `<option value="${item}">${labelMap[item] || item}</option>`)
      .join('');

    if (allOptions.includes(previous)) {
      select.value = previous;
    } else {
      select.value = 'default';
    }
  });

  const active = activeBackend || '-';
  if (singleBackendName && singleBackendName.textContent === '-') {
    singleBackendName.textContent = active;
  }
}

function renderHealthInfo(health) {
  APP_STATE.healthInfo = health || null;
  const backend = health?.backend || '-';
  const modelName = health?.default_model_name || '-';
  const modelPath = health?.active_model_path || '-';
  const available = Array.isArray(health?.available_backends) ? health.available_backends : [];

  const dashModelName = byId('dashModelName');
  const dashBackendName = byId('dashBackendName');
  const dashModelPath = byId('dashModelPath');
  const settingsModelName = byId('settingsModelName');
  const settingsBackendName = byId('settingsBackendName');
  const settingsAvailableBackends = byId('settingsAvailableBackends');

  if (dashModelName) dashModelName.textContent = modelName;
  if (dashBackendName) dashBackendName.textContent = backend;
  if (dashModelPath) dashModelPath.textContent = modelPath;
  if (settingsModelName) settingsModelName.textContent = modelName;
  if (settingsBackendName) settingsBackendName.textContent = backend;
  if (settingsAvailableBackends) settingsAvailableBackends.textContent = available.length ? available.join(' / ') : '-';

  renderProviderOptions(available, backend);
}

function renderLabelDrivenConfig() {
  const settingsBody = byId('settingsClassConfigBody');
  settingsBody.innerHTML = '';
  LABEL_SCHEMA.forEach(item => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${item.id} (${item.cn})</td><td><span class="color-dot ${item.dotClass}"></span></td><td>是</td><td>${item.risk}</td>`;
    settingsBody.appendChild(tr);
  });

  const reviewClassSelect = byId('reviewClassSelect');
  reviewClassSelect.innerHTML = LABEL_SCHEMA
    .map(item => `<option value="${item.id}">${item.id} (${item.cn})</option>`)
    .join('');
}

function previewSingle(file) {
  currentSingleFile = file;
  singleFileName.textContent = file.name;
  const reader = new FileReader();
  reader.onload = ev => {
    singleOriginal.innerHTML = '';
    const img = document.createElement('img');
    img.src = ev.target.result;
    img.alt = file.name;
    singleOriginal.appendChild(img);
  };
  reader.readAsDataURL(file);
}

function renderSingleResults(detections) {
  const items = detections || [];
  singleResultTableBody.innerHTML = '';
  if (!items.length) {
    singleResultTableBody.innerHTML = '<tr><td colspan="5">未检测到缺陷</td></tr>';
    singleDetectionsCount.textContent = '0 处';
    singleMaxConfidence.textContent = '-';
    return;
  }

  const maxScore = Math.max(...items.map(item => Number(item.confidence || 0)));
  singleDetectionsCount.textContent = `${items.length} 处`;
  singleMaxConfidence.textContent = maxScore.toFixed(2);

  items.forEach((det, index) => {
    const label = labelDisplay(det.class_name || det.class || 'unknown');
    const severity = inferSeverity(det.severity, det.confidence, det.class_name || det.class);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td>${label}</td>
      <td>${Number(det.confidence || 0).toFixed(2)}</td>
      <td>[${(det.bbox || []).join(', ')}]</td>
      <td><span class="tag ${tagClassFromSeverity(severity)}">${severity}</span></td>
    `;
    singleResultTableBody.appendChild(tr);
  });
}

function renderResultImage(url) {
  singleResult.innerHTML = '';
  const img = document.createElement('img');
  img.src = url;
  img.alt = '检测结果图';
  img.onerror = () => {
    singleResult.textContent = '结果图加载失败，请检查后端 /outputs 静态文件服务。';
  };
  singleResult.appendChild(img);
}

function renderSingleEmptyState(message = '等待检测结果...') {
  singleResult.innerHTML = '';
  singleResult.textContent = message;
}

function setSingleApiFieldValues(data) {
  const detections = data?.detections || [];
  const detectionSummary = detections.length
    ? `${detections.length} 条（含 class / confidence / bbox）`
    : '0 条';
  const imageUrl = data?.result_image_url
    ? (data.result_image_url.startsWith('http') ? data.result_image_url : `${APP_CONFIG.API_BASE}${data.result_image_url}`)
    : '-';

  if (singleApiTaskId) singleApiTaskId.textContent = data?.task_id || '-';
  if (singleApiDetections) singleApiDetections.textContent = detectionSummary;
  if (singleApiResultImageUrl) singleApiResultImageUrl.textContent = imageUrl;
  if (singleApiInferenceTime) singleApiInferenceTime.textContent = data?.inference_time !== undefined ? `${data.inference_time} s` : '-';
}

function clearSingleApiFieldValues() {
  if (singleApiTaskId) singleApiTaskId.textContent = '-';
  if (singleApiDetections) singleApiDetections.textContent = '-';
  if (singleApiResultImageUrl) singleApiResultImageUrl.textContent = '-';
  if (singleApiInferenceTime) singleApiInferenceTime.textContent = '-';
}

function renderDemoSingleResult() {
  singleInferenceTime.textContent = '0.81 s（演示）';
  if (singleBackendName) singleBackendName.textContent = 'mock（演示固定框）';
  const demo = [
    { class_name: 'crack', confidence: 0.87, bbox: [112, 84, 288, 140], severity: '高' },
    { class_name: 'erosion', confidence: 0.63, bbox: [320, 214, 450, 330], severity: '中' }
  ];
  renderSingleResults(demo);
  singleResult.innerHTML = '<div class="bbox b1">crack 0.87</div><div class="bbox b2">erosion 0.63</div>';
  setSingleApiFieldValues({
    task_id: 'demo-task',
    detections: demo,
    result_image_url: '',
    inference_time: 0.81,
  });
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function runSingleDetection() {
  const runSingleBtn = byId('runSingleBtn');
  if (!currentSingleFile) {
    alert('请先上传一张图片');
    return;
  }

  runSingleBtn.disabled = true;
  runSingleBtn.textContent = '检测中...';

  const formData = new FormData();
  formData.append('file', currentSingleFile);
  formData.append('conf', byId('confThreshold').value || '0.25');
  formData.append('iou', byId('iouThreshold').value || '0.45');
  formData.append('model_name', byId('singleModelSelect').value);
  formData.append('mode', byId('singleModeSelect').value);
  formData.append('provider', byId('singleProviderSelect')?.value || 'default');

  try {
    const data = await fetchJson(getPredictUrl(), { method: 'POST', body: formData });
    APP_STATE.singleResult = data;
    singleInferenceTime.textContent = `${data.inference_time ?? '-'} s`;
    if (singleBackendName) singleBackendName.textContent = data.inference_backend || APP_STATE.healthInfo?.backend || '-';
    setSingleApiFieldValues(data);
    renderSingleResults(data.detections || []);

    if (data.result_image_url) {
      const resultUrl = data.result_image_url.startsWith('http')
        ? data.result_image_url
        : `${APP_CONFIG.API_BASE}${data.result_image_url}`;
      renderResultImage(resultUrl);
    } else {
      renderSingleEmptyState('后端未返回 result_image_url。');
    }

    const backendName = data.inference_backend || APP_STATE.healthInfo?.backend || '-';
    if (backendName === 'mock') {
      updateServiceStatus('在线', '当前使用 mock 演示后端，框位置是固定示例，不是真实模型检测。', true);
    } else {
      updateServiceStatus('在线', `已成功调用 ${getPredictUrl()}，后端=${backendName}`, true);
    }
    renderDashboardFromState();
  } catch (error) {
    console.warn('predict request failed:', error);
    renderSingleResults([]);
    renderSingleEmptyState(`预测失败：${error.message}`);
    singleInferenceTime.textContent = '-';
    if (singleBackendName) singleBackendName.textContent = '-';
    clearSingleApiFieldValues();
    updateServiceStatus('未连接', '预测失败，未使用演示框兜底。请检查后端状态与 provider 配置。', false);
  } finally {
    runSingleBtn.disabled = false;
    runSingleBtn.textContent = '开始检测';
  }
}

function addBatchLog(text, key) {
  if (key && APP_STATE.batchLogKeys.has(key)) return;
  if (key) APP_STATE.batchLogKeys.add(key);

  const now = new Date();
  const time = now.toTimeString().split(' ')[0];
  const line = document.createElement('div');
  line.textContent = `[${time}] ${text}`;
  batchLog.appendChild(line);
  batchLog.scrollTop = batchLog.scrollHeight;
}

function clearBatchLog() {
  APP_STATE.batchLogKeys.clear();
  batchLog.innerHTML = '';
}

function renderBatchFileTable(statusMap = new Map()) {
  batchFileTable.innerHTML = '';
  if (!APP_STATE.batchFiles.length) {
    batchFileTable.innerHTML = '<tr><td colspan="5">尚未添加文件</td></tr>';
    batchCount.textContent = '0 张';
    batchTotal.textContent = '0';
    return;
  }

  APP_STATE.batchFiles.forEach((file, index) => {
    const status = statusMap.get(file.name) || 'queued';
    const statusHtml = status === 'finished'
      ? '<span class="tag success">已完成</span>'
      : status === 'running'
        ? '<span class="tag warn">处理中</span>'
        : status === 'failed'
          ? '<span class="tag danger">失败</span>'
          : '<span class="tag info">待处理</span>';

    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${file.name}</td>
      <td>${(file.size / 1024 / 1024).toFixed(1)} MB</td>
      <td>${statusHtml}</td>
      <td><a class="text-link" data-preview-index="${index}" href="#">查看</a></td>
      <td><a class="text-link danger-link" data-remove-index="${index}" href="#">移除</a></td>
    `;
    batchFileTable.appendChild(row);
  });

  batchCount.textContent = `${APP_STATE.batchFiles.length} 张`;
  batchTotal.textContent = String(APP_STATE.batchFiles.length);
}

function updateBatchProgress(completed, total) {
  const safeTotal = Math.max(total, 1);
  const progress = Math.min(100, Math.round((completed / safeTotal) * 100));
  batchDone.textContent = String(completed);
  batchTotal.textContent = String(total);
  batchProgressBar.style.width = `${progress}%`;
  batchProgressText.textContent = `${progress}%`;
}

function resetBatchProgress() {
  updateBatchProgress(0, APP_STATE.batchFiles.length);
}

function getTaskDetailStats(detail) {
  const resultItems = detail?.results || [];
  const classCounts = {};
  let detections = 0;
  let highRisk = 0;
  let latencySum = 0;
  let latencyCount = 0;

  resultItems.forEach(item => {
    latencySum += Number(item.inference_time || 0);
    latencyCount += 1;
    (item.detections || []).forEach(det => {
      const cls = normalizeClassName(det.class_name || det.class || 'unknown');
      classCounts[cls] = (classCounts[cls] || 0) + 1;
      detections += 1;
      if ((det.severity || '') === '高' || Number(det.confidence || 0) >= 0.8) highRisk += 1;
    });
  });

  return {
    detections,
    highRisk,
    classCounts,
    avgLatency: latencyCount ? latencySum / latencyCount : 0
  };
}

function renderClassBars(containerId, classCounts, totalCount) {
  const container = byId(containerId);
  if (!container) return;
  container.innerHTML = '';

  if (!totalCount) {
    container.innerHTML = '<div class="bar-row"><span>暂无数据</span><div class="bar"><i style="width:0%"></i></div><strong>0</strong></div>';
    return;
  }

  LABEL_SCHEMA.forEach(item => {
    const value = classCounts[item.id] || 0;
    const ratio = totalCount > 0 ? Math.round((value / totalCount) * 100) : 0;
    const row = document.createElement('div');
    row.className = 'bar-row';
    row.innerHTML = `<span>${item.id}</span><div class="bar"><i style="width:${ratio}%"></i></div><strong>${value}</strong>`;
    container.appendChild(row);
  });
}

function renderDashboardFromState() {
  const tasks = APP_STATE.taskSummaries;
  const details = Array.from(APP_STATE.taskDetails.values());

  const totalTasks = tasks.length;
  const totalImages = tasks.reduce((sum, t) => sum + Number(t.total_files || 0), 0);

  let totalDetections = 0;
  let highRisk = 0;
  let latencySum = 0;
  let latencyCount = 0;
  const classCounts = {};

  details.forEach(detail => {
    const stats = getTaskDetailStats(detail);
    totalDetections += stats.detections;
    highRisk += stats.highRisk;
    latencySum += stats.avgLatency * (detail.results || []).length;
    latencyCount += (detail.results || []).length;
    Object.entries(stats.classCounts).forEach(([k, v]) => {
      classCounts[k] = (classCounts[k] || 0) + v;
    });
  });

  if (!totalTasks && APP_STATE.singleResult) {
    const singleDetections = APP_STATE.singleResult.detections || [];
    totalDetections = singleDetections.length;
    highRisk = singleDetections.filter(det => Number(det.confidence || 0) >= 0.8).length;
    singleDetections.forEach(det => {
      const cls = normalizeClassName(det.class_name || det.class || 'unknown');
      classCounts[cls] = (classCounts[cls] || 0) + 1;
    });
    latencySum = Number(APP_STATE.singleResult.inference_time || 0);
    latencyCount = 1;
  }

  byId('dashTotalTasks').textContent = String(totalTasks);
  byId('dashTotalImages').textContent = String(totalImages);
  byId('dashTotalDetections').textContent = String(totalDetections);
  byId('dashHighRiskText').textContent = `高风险缺陷 ${highRisk} 处`;
  byId('dashAvgLatency').textContent = latencyCount ? `${(latencySum / latencyCount).toFixed(2)}s` : '-';

  renderClassBars('dashClassBars', classCounts, Math.max(totalDetections, 0));
}

function renderRecentTasks() {
  const tbody = byId('dashRecentTasksBody');
  tbody.innerHTML = '';
  if (!APP_STATE.taskSummaries.length) {
    tbody.innerHTML = '<tr><td colspan="4">暂无历史任务</td></tr>';
    return;
  }

  APP_STATE.taskSummaries.slice(0, 3).forEach(task => {
    const detail = APP_STATE.taskDetails.get(task.task_id);
    const detectCount = detail ? getTaskDetailStats(detail).detections : '-';
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${task.task_name}</td><td>${task.total_files}</td><td>${detectCount}</td><td>${statusTag(task.status)}</td>`;
    tbody.appendChild(tr);
  });
}

function renderHistoryTable() {
  const tbody = byId('historyTaskTableBody');
  tbody.innerHTML = '';
  if (!APP_STATE.taskSummaries.length) {
    tbody.innerHTML = '<tr><td colspan="7">暂无历史任务</td></tr>';
    return;
  }

  APP_STATE.taskSummaries.forEach(task => {
    const detail = APP_STATE.taskDetails.get(task.task_id);
    const detectionCount = detail ? getTaskDetailStats(detail).detections : '-';
    const createdAt = task.created_at ? String(task.created_at).replace('T', ' ').slice(0, 19) : '-';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${task.task_name}</td>
      <td>${createdAt}</td>
      <td>${task.total_files}</td>
      <td>${detectionCount}</td>
      <td>${task.model_name || '-'}</td>
      <td>${statusTag(task.status)}</td>
      <td><a class="text-link" href="#" data-open-task="${task.task_id}">查看</a></td>
    `;
    tbody.appendChild(tr);
  });
}

function renderResults(detail) {
  const task = detail?.task;
  const results = detail?.results || [];
  const stats = detail ? getTaskDetailStats(detail) : { detections: 0, highRisk: 0, classCounts: {} };

  byId('resultTaskName').textContent = task?.task_name || '暂无任务';
  byId('resultModelName').textContent = `模型 ${task?.model_name || '-'}`;
  byId('resultImageCount').textContent = String(task?.total_files || 0);
  byId('resultCompletedText').textContent = `已完成 ${task?.completed_files || 0} / ${task?.total_files || 0}`;
  byId('resultDetectionCount').textContent = String(stats.detections || 0);
  byId('resultHighRiskText').textContent = `高风险缺陷 ${stats.highRisk || 0} 处`;
  byId('resultStatusText').textContent = task ? (task.status === 'finished' ? '可导出' : '处理中') : '待生成';

  renderClassBars('resultClassBars', stats.classCounts, Math.max(stats.detections, 0));

  const thumbGrid = byId('resultThumbGrid');
  thumbGrid.innerHTML = '';
  if (!results.length) {
    thumbGrid.innerHTML = '<div class="thumb-card"><div class="thumb-image">暂无结果图</div><div class="thumb-meta">等待任务完成</div></div>';
  } else {
    results.slice(0, 4).forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'thumb-card';
      const imageUrl = item.result_image_url
        ? (item.result_image_url.startsWith('http') ? item.result_image_url : `${APP_CONFIG.API_BASE}${item.result_image_url}`)
        : '';
      const firstDet = (item.detections || [])[0];
      const major = firstDet ? labelDisplay(firstDet.class_name || firstDet.class) : '无缺陷';
      card.innerHTML = `
        <div class="thumb-image">${imageUrl ? `<img src="${imageUrl}" alt="result_${index + 1}" style="width:100%;height:100%;object-fit:cover;" />` : `检测结果 ${index + 1}`}</div>
        <div class="thumb-meta">${major} · ${item.num_detections || 0} 处</div>
      `;
      thumbGrid.appendChild(card);
    });
  }

  const resultTableBody = byId('resultTableBody');
  resultTableBody.innerHTML = '';
  if (!results.length) {
    resultTableBody.innerHTML = '<tr><td colspan="4">暂无任务结果</td></tr>';
  } else {
    results.forEach(item => {
      const dets = item.detections || [];
      const major = dets.length ? labelDisplay(dets[0].class_name || dets[0].class) : '无缺陷';
      const row = document.createElement('tr');
      row.innerHTML = `<td>${item.filename || '-'}</td><td>${item.num_detections || 0}</td><td>${major}</td><td>${statusTag(task?.status || 'queued')}</td>`;
      resultTableBody.appendChild(row);
    });
  }

  renderReview(detail);
}

function renderReview(detail) {
  const reviewImageBox = byId('reviewImageBox');
  const reviewBody = byId('reviewDetectionsBody');
  reviewBody.innerHTML = '';

  if (!detail || !(detail.results || []).length) {
    reviewBody.innerHTML = '<tr><td colspan="4">暂无可复核结果</td></tr>';
    return;
  }

  const target = detail.results.find(item => (item.detections || []).length) || detail.results[0];
  const detections = target.detections || [];

  if (target.result_image_url) {
    const imgUrl = target.result_image_url.startsWith('http')
      ? target.result_image_url
      : `${APP_CONFIG.API_BASE}${target.result_image_url}`;
    reviewImageBox.innerHTML = `<img src="${imgUrl}" alt="review_result" />`;
  }

  if (!detections.length) {
    reviewBody.innerHTML = '<tr><td colspan="4">该图片未检出缺陷</td></tr>';
    return;
  }

  detections.forEach((det, index) => {
    const severity = inferSeverity(det.severity, det.confidence, det.class_name || det.class);
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${index + 1}</td>
      <td>${labelDisplay(det.class_name || det.class)}</td>
      <td>${Number(det.confidence || 0).toFixed(2)}</td>
      <td><span class="tag ${tagClassFromSeverity(severity)}">${severity}</span></td>
    `;
    reviewBody.appendChild(row);
  });
}

async function fetchTaskDetail(taskId, force = false) {
  if (!force && APP_STATE.taskDetails.has(taskId)) {
    return APP_STATE.taskDetails.get(taskId);
  }

  try {
    const detail = await fetchJson(getTaskDetailUrl(taskId));
    APP_STATE.taskDetails.set(taskId, detail);
    return detail;
  } catch (error) {
    console.warn(`failed to fetch task detail: ${taskId}`, error);
    return null;
  }
}

async function refreshTasks() {
  try {
    const tasks = await fetchJson(getTaskListUrl());
    APP_STATE.taskSummaries = Array.isArray(tasks) ? tasks : [];
  } catch (error) {
    APP_STATE.taskSummaries = [];
    console.warn('failed to fetch tasks', error);
  }

  const topTasks = APP_STATE.taskSummaries.slice(0, 8);
  await Promise.all(topTasks.map(task => fetchTaskDetail(task.task_id)));

  renderRecentTasks();
  renderHistoryTable();
  renderDashboardFromState();

  if (!APP_STATE.currentTaskId && APP_STATE.taskSummaries.length) {
    APP_STATE.currentTaskId = APP_STATE.taskSummaries[0].task_id;
  }

  if (APP_STATE.currentTaskId) {
    const detail = await fetchTaskDetail(APP_STATE.currentTaskId);
    if (detail) {
      APP_STATE.currentTaskDetail = detail;
      renderResults(detail);
    }
  } else {
    renderResults(null);
  }
}

function extractErrorFilename(message) {
  const text = String(message || '');
  const idx = text.indexOf(':');
  return idx > 0 ? text.slice(0, idx).trim() : text.trim();
}

function updateBatchByTaskDetail(detail) {
  const task = detail.task;
  updateBatchProgress(Number(task.completed_files || 0), Number(task.total_files || APP_STATE.batchFiles.length));

  const statusMap = new Map();
  (detail.results || []).forEach(item => statusMap.set(item.filename, 'finished'));
  (detail.errors || []).forEach(msg => statusMap.set(extractErrorFilename(msg), 'failed'));

  APP_STATE.batchFiles.forEach(file => {
    if (!statusMap.has(file.name)) {
      statusMap.set(file.name, task.status === 'running' ? 'running' : 'queued');
    }
  });

  renderBatchFileTable(statusMap);
  addBatchLog(`任务 ${task.task_id} 状态：${task.status}，进度 ${task.progress}%`, `task_progress_${task.task_id}_${task.completed_files}_${task.status}`);

  if (task.status === 'finished' || task.status === 'failed') {
    clearInterval(APP_STATE.batchPollTimer);
    APP_STATE.batchPollTimer = null;
    addBatchLog(`任务结束：${task.status}`, `task_finished_${task.task_id}_${task.status}`);
    APP_STATE.currentTaskId = task.task_id;
    APP_STATE.currentTaskDetail = detail;
    renderResults(detail);
    refreshTasks();
  }
}

async function startBatchPolling(taskId) {
  if (APP_STATE.batchPollTimer) {
    clearInterval(APP_STATE.batchPollTimer);
    APP_STATE.batchPollTimer = null;
  }

  APP_STATE.batchPollTimer = setInterval(async () => {
    const detail = await fetchTaskDetail(taskId, true);
    if (!detail) return;
    APP_STATE.taskDetails.set(taskId, detail);
    updateBatchByTaskDetail(detail);
  }, 1200);
}

async function runBatchDetection() {
  if (!APP_STATE.batchFiles.length) {
    alert('请先添加图片文件');
    return;
  }

  runBatchBtn.disabled = true;
  runBatchBtn.textContent = '任务创建中...';

  try {
    clearBatchLog();
    addBatchLog(`准备调用 ${getBatchUrl()} 创建任务。`);

    const formData = new FormData();
    APP_STATE.batchFiles.forEach(file => formData.append('files', file));
    formData.append('task_name', byId('batchTaskNameInput').value || '统一4类批量任务');
    formData.append('conf', byId('batchConfInput').value || '0.25');
    formData.append('iou', '0.45');
    formData.append('model_name', byId('batchModelSelect').value || 'unified-b-4class-stratified');
    formData.append('mode', byId('batchModeSelect').value || 'standard');
    formData.append('provider', byId('batchProviderSelect')?.value || 'default');

    const summary = await fetchJson(getBatchUrl(), { method: 'POST', body: formData });
    APP_STATE.currentTaskId = summary.task_id;
    addBatchLog(`任务创建成功：${summary.task_id}`);
    updateServiceStatus('在线', `批量任务已创建：${summary.task_id}`, true);
    await startBatchPolling(summary.task_id);
  } catch (error) {
    console.warn('batch detection failed', error);
    addBatchLog(`任务创建失败：${error.message}`);
    updateServiceStatus('未连接', '批量接口调用失败，请检查后端服务与接口路径。', false);
  } finally {
    runBatchBtn.disabled = false;
    runBatchBtn.textContent = '开始批量检测';
  }
}

function setupEventHandlers() {
  navItems.forEach(btn => btn.addEventListener('click', () => activateView(btn.dataset.view)));
  document.querySelectorAll('.jump').forEach(btn => btn.addEventListener('click', () => activateView(btn.dataset.view)));
  document.querySelectorAll('[data-view-link]').forEach(link => link.addEventListener('click', e => {
    e.preventDefault();
    activateView(link.dataset.viewLink);
  }));

  byId('quickSingleBtn').addEventListener('click', () => activateView('single'));
  byId('runSingleBtn').addEventListener('click', runSingleDetection);
  byId('loadSampleBtn').addEventListener('click', renderDemoSingleResult);
  byId('resetSingleBtn').addEventListener('click', () => {
    byId('confThreshold').value = '0.25';
    byId('iouThreshold').value = '0.45';
    renderSingleResults([]);
    renderSingleEmptyState('等待检测结果...');
    singleInferenceTime.textContent = '-';
    if (singleBackendName) singleBackendName.textContent = '-';
    clearSingleApiFieldValues();
  });

  selectSingleBtn.addEventListener('click', () => singleFileInput.click());
  singleUploadBox.addEventListener('click', e => { if (e.target.tagName !== 'BUTTON') singleFileInput.click(); });
  singleUploadBox.addEventListener('dragover', e => { e.preventDefault(); singleUploadBox.style.borderColor = '#a01d38'; });
  singleUploadBox.addEventListener('dragleave', () => { singleUploadBox.style.borderColor = '#d9a9b5'; });
  singleUploadBox.addEventListener('drop', e => {
    e.preventDefault();
    singleUploadBox.style.borderColor = '#d9a9b5';
    const file = e.dataTransfer.files[0];
    if (file) previewSingle(file);
  });
  singleFileInput.addEventListener('change', () => {
    const file = singleFileInput.files[0];
    if (file) previewSingle(file);
  });

  batchAddFilesBtn.addEventListener('click', () => batchFileInput.click());
  batchFileInput.addEventListener('change', () => {
    const incoming = Array.from(batchFileInput.files || []);
    if (!incoming.length) return;

    incoming.forEach(file => {
      const key = `${file.name}_${file.size}_${file.lastModified}`;
      const exists = APP_STATE.batchFiles.some(item => `${item.name}_${item.size}_${item.lastModified}` === key);
      if (!exists) APP_STATE.batchFiles.push(file);
    });

    renderBatchFileTable();
    resetBatchProgress();
    addBatchLog(`新增 ${incoming.length} 张图片，当前待处理共 ${APP_STATE.batchFiles.length} 张。`);
    batchFileInput.value = '';
  });

  batchFileTable.addEventListener('click', e => {
    const removeIndex = e.target.getAttribute('data-remove-index');
    if (removeIndex !== null) {
      e.preventDefault();
      APP_STATE.batchFiles.splice(Number(removeIndex), 1);
      renderBatchFileTable();
      resetBatchProgress();
      return;
    }

    const previewIndex = e.target.getAttribute('data-preview-index');
    if (previewIndex !== null) {
      e.preventDefault();
      const file = APP_STATE.batchFiles[Number(previewIndex)];
      if (!file) return;
      const url = URL.createObjectURL(file);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
  });

  runBatchBtn.addEventListener('click', runBatchDetection);

  byId('saveApiConfigBtn').addEventListener('click', () => {
    APP_CONFIG = {
      API_BASE: normalizeApiBase(byId('apiBaseInput').value || DEFAULT_CONFIG.API_BASE),
      ENDPOINTS: {
        ...APP_CONFIG.ENDPOINTS,
        predict: byId('predictPathInput').value.trim() || DEFAULT_CONFIG.ENDPOINTS.predict,
        predictBatch: byId('batchPathInput').value.trim() || DEFAULT_CONFIG.ENDPOINTS.predictBatch,
        health: byId('healthPathInput').value.trim() || DEFAULT_CONFIG.ENDPOINTS.health
      }
    };
    localStorage.setItem('windDefectAppConfig', JSON.stringify(APP_CONFIG));
    applyConfigToUI();
    apiTestResult.textContent = '配置已保存，已切换到最新接口设置。';
  });

  byId('resetApiConfigBtn').addEventListener('click', () => {
    APP_CONFIG = structuredClone(DEFAULT_CONFIG);
    localStorage.setItem('windDefectAppConfig', JSON.stringify(APP_CONFIG));
    applyConfigToUI();
    apiTestResult.textContent = '已恢复默认配置。';
  });

  byId('testApiBtn').addEventListener('click', async () => {
    apiTestResult.textContent = '正在测试连接...';
    try {
      const health = await fetchJson(getHealthUrl());
      renderHealthInfo(health);
      apiTestResult.textContent = `连接成功：${health.message || health.status || 'ok'}`;
      updateServiceStatus('在线', `已连接 ${getHealthUrl()}，后端=${health.backend || '-'}`, true);
      await refreshTasks();
    } catch (error) {
      apiTestResult.textContent = '连接失败。请检查 API_BASE、接口路径、FastAPI 服务地址以及 CORS 设置。';
      updateServiceStatus('未连接', '请确认后端已启动，并允许跨域访问。', false);
    }
  });

  byId('historyTaskTableBody').addEventListener('click', async e => {
    const taskId = e.target.getAttribute('data-open-task');
    if (!taskId) return;
    e.preventDefault();
    const detail = await fetchTaskDetail(taskId, true);
    if (!detail) return;
    APP_STATE.currentTaskId = taskId;
    APP_STATE.currentTaskDetail = detail;
    renderResults(detail);
    activateView('results');
  });
}

async function bootstrap() {
  applyConfigToUI();
  renderLabelDrivenConfig();
  renderBatchFileTable();
  resetBatchProgress();
  renderSingleResults([]);
  renderSingleEmptyState('等待检测结果...');
  singleInferenceTime.textContent = '-';
  clearSingleApiFieldValues();
  setupEventHandlers();

  try {
    const health = await fetchJson(getHealthUrl());
    renderHealthInfo(health);
    updateServiceStatus('在线', `已连接 ${getHealthUrl()}，后端=${health.backend || '-'}`, true);
    apiTestResult.textContent = `连接成功：${health.message || health.status || 'ok'}`;
    await refreshTasks();
  } catch {
    updateServiceStatus('未连接', '当前展示为前端可用模式，请先启动 FastAPI 后端。', false);
    renderDashboardFromState();
    renderRecentTasks();
    renderHistoryTable();
    renderResults(null);
  }
}

bootstrap();
