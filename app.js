const els = {
  btnToggleFilters: document.getElementById('btnToggleFilters'),
  filters: document.getElementById('filters'),
  overlay: document.getElementById('overlay'),

  accessToken: document.getElementById('accessToken'),
  proxyBase: document.getElementById('proxyBase'),

  keywords: document.getElementById('keywords'),
  regionCode: document.getElementById('regionCode'),
  days: document.getElementById('days'),
  depthPages: document.getElementById('depthPages'),
  resultLimit: document.getElementById('resultLimit'),
  pageSize: document.getElementById('pageSize'),

  minViews: document.getElementById('minViews'),
  maxDurationSec: document.getElementById('maxDurationSec'),
  mustHaveShortsTag: document.getElementById('mustHaveShortsTag'),

  sortBy: document.getElementById('sortBy'),

  btnSearch: document.getElementById('btnSearch'),
  btnStop: document.getElementById('btnStop'),
  btnClear: document.getElementById('btnClear'),
  btnExport: document.getElementById('btnExport'),
  btnReload: document.getElementById('btnReload'),

  statusText: document.getElementById('statusText'),
  foundText: document.getElementById('foundText'),
  results: document.getElementById('results'),

  quotaEstimate: document.getElementById('quotaEstimate'),

  progressWrap: document.getElementById('progressWrap'),
  progressBarInner: document.getElementById('progressBarInner'),
  progressText: document.getElementById('progressText'),
};

let abortCtrl = null;
let currentResults = [];
let lastQueryKey = null;

const LS_KEY = 'yt_shorts_radar_settings_proxy_v1';
const LS_CACHE = 'yt_shorts_radar_cache_v1';

init();

function init(){
  const saved = safeJsonParse(localStorage.getItem(LS_KEY)) || {};
  if (saved.accessToken) els.accessToken.value = saved.accessToken;
  if (saved.proxyBase) els.proxyBase.value = saved.proxyBase;

  if (saved.keywords) els.keywords.value = saved.keywords;
  if (saved.regionCode) els.regionCode.value = saved.regionCode;
  if (saved.days) els.days.value = saved.days;
  if (saved.depthPages) els.depthPages.value = saved.depthPages;
  if (saved.resultLimit) els.resultLimit.value = saved.resultLimit;
  if (saved.pageSize) els.pageSize.value = saved.pageSize;
  if (saved.minViews) els.minViews.value = saved.minViews;
  if (saved.maxDurationSec) els.maxDurationSec.value = saved.maxDurationSec;
  if (typeof saved.mustHaveShortsTag === 'boolean') els.mustHaveShortsTag.checked = saved.mustHaveShortsTag;
  if (saved.sortBy) els.sortBy.value = saved.sortBy;

  wireEvents();
  updateQuotaEstimate();
  setStatus('待命');
  renderResults([]);
}

function wireEvents(){
  els.btnToggleFilters.addEventListener('click', () => toggleFilters(true));
  els.overlay.addEventListener('click', () => toggleFilters(false));

  [els.depthPages, els.pageSize, els.keywords, els.days, els.resultLimit].forEach(el =>
    el.addEventListener('input', updateQuotaEstimate)
  );

  document.querySelectorAll('input, select').forEach(el => {
    el.addEventListener('change', saveSettings);
  });

  els.btnSearch.addEventListener('click', startSearch);
  els.btnStop.addEventListener('click', stopSearch);

  els.btnClear.addEventListener('click', () => {
    stopSearch();
    currentResults = [];
    lastQueryKey = null;
    renderResults([]);
    els.foundText.textContent = '已清空';
    els.btnExport.disabled = true;
    els.btnReload.disabled = true;
    setStatus('待命');
  });

  els.btnExport.addEventListener('click', exportCSV);
  els.btnReload.addEventListener('click', () => {
    if (!lastQueryKey || !currentResults.length) return;
    const cache = safeJsonParse(localStorage.getItem(LS_CACHE)) || {};
    cache[lastQueryKey] = { ts: Date.now(), results: currentResults };
    localStorage.setItem(LS_CACHE, JSON.stringify(cache));
    setStatus('已保存結果到快取');
  });

  els.sortBy.addEventListener('change', () => {
    saveSettings();
    sortAndRender();
  });
}

function toggleFilters(open){
  const isMobile = window.matchMedia('(max-width: 900px)').matches;
  if (!isMobile) return;
  if (open){
    els.filters.classList.add('open');
    els.overlay.classList.remove('hidden');
  } else {
    els.filters.classList.remove('open');
    els.overlay.classList.add('hidden');
  }
}

function saveSettings(){
  const payload = {
    accessToken: els.accessToken.value.trim(),
    proxyBase: els.proxyBase.value.trim().replace(/\/+$/,''),
    keywords: els.keywords.value.trim(),
    regionCode: els.regionCode.value,
    days: Number(els.days.value || 10),
    depthPages: Number(els.depthPages.value || 3),
    resultLimit: Number(els.resultLimit.value || 40),
    pageSize: Number(els.pageSize.value || 50),
    minViews: Number(els.minViews.value || 0),
    maxDurationSec: Number(els.maxDurationSec.value || 60),
    mustHaveShortsTag: els.mustHaveShortsTag.checked,
    sortBy: els.sortBy.value,
  };
  localStorage.setItem(LS_KEY, JSON.stringify(payload));
  updateQuotaEstimate();
}

function updateQuotaEstimate(){
  const depth = clampInt(els.depthPages.value, 1, 10);
  const pageSize = clampInt(els.pageSize.value, 5, 50);
  const limit = clampInt(els.resultLimit.value, 1, 200);

  const candidates = Math.min(depth * pageSize, 500);
  const videoBatches = Math.ceil(candidates / 50);
  const est = depth * 100 + videoBatches * 1;
  els.quotaEstimate.textContent = `${est}（search: ${depth}×100 + videos: ${videoBatches}×1） / 約顯示前 ${limit}`;
}

function stopSearch(){
  if (abortCtrl){
    abortCtrl.abort();
    abortCtrl = null;
  }
  els.btnStop.disabled = true;
  els.btnSearch.disabled = false;
  hideProgress();
  setStatus('已停止');
}

async function startSearch(){
  const token = els.accessToken.value.trim();
  const base = els.proxyBase.value.trim().replace(/\/+$/,'');
  if (!token) { alert('請先輸入 Access Token（Worker 的 ACCESS_TOKEN）。'); return; }
  if (!base || !base.startsWith('https://')) { alert('請輸入正確的 Worker Proxy Base（https://...）。'); return; }

  const cfg = getConfig();
  saveSettings();
  toggleFilters(false);

  lastQueryKey = makeQueryKey(cfg, base);
  const cache = safeJsonParse(localStorage.getItem(LS_CACHE)) || {};
  if (cache[lastQueryKey]?.results?.length){
    currentResults = cache[lastQueryKey].results;
    setStatus('已載入快取結果');
    sortAndRender();
    els.btnExport.disabled = currentResults.length === 0;
    els.btnReload.disabled = currentResults.length === 0;
    return;
  }

  abortCtrl = new AbortController();
  els.btnStop.disabled = false;
  els.btnSearch.disabled = true;
  currentResults = [];
  renderResults([]);

  try{
    setStatus('搜尋中…');
    showProgress(0, '準備查詢…');

    const publishedAfter = new Date(Date.now() - cfg.days * 24 * 3600 * 1000).toISOString();
    const queries = splitKeywords(cfg.keywords);

    const idSet = new Set();
    const totalSearchCalls = queries.length * cfg.depthPages;
    let doneCalls = 0;

    for (const q of queries){
      let pageToken = '';
      for (let p=1; p<=cfg.depthPages; p++){
        const url = makeSearchUrl({ base, q, regionCode: cfg.regionCode, publishedAfter, maxResults: cfg.pageSize, pageToken });
        const json = await fetchJson(url, abortCtrl.signal);
        const items = json.items || [];
        items.forEach(it => { if (it.id?.videoId) idSet.add(it.id.videoId); });

        pageToken = json.nextPageToken || '';
        doneCalls++;
        const pct = Math.round((doneCalls / totalSearchCalls) * 45);
        showProgress(pct, `搜尋候選：${q}（第 ${p}/${cfg.depthPages} 頁），累積 ${idSet.size} 支`);
        if (!pageToken) break;
      }
    }

    const allIds = Array.from(idSet);
    if (!allIds.length){
      setStatus('找不到資料（條件太嚴格或 Key/配額限制）');
      els.btnSearch.disabled = false;
      els.btnStop.disabled = true;
      hideProgress();
      return;
    }

    const batches = chunk(allIds, 50);
    let collected = [];
    for (let i=0; i<batches.length; i++){
      const ids = batches[i];
      const url = makeVideosUrl({ base, ids });
      const json = await fetchJson(url, abortCtrl.signal);

      const items = (json.items || []).map(v => normalizeVideo(v));
      collected.push(...items);

      const pct = 45 + Math.round(((i+1)/batches.length) * 45);
      showProgress(pct, `拉取統計：${i+1}/${batches.length} 批，已取得 ${collected.length} 支`);
    }

    const now = Date.now();
    const filtered = collected
      .map(v => ({
        ...v,
        daysSince: Math.max(1, Math.floor((now - v.publishedAtMs) / (24*3600*1000))),
        viewsPerDay: v.viewCount / Math.max(1, Math.floor((now - v.publishedAtMs) / (24*3600*1000))),
      }))
      .filter(v => v.durationSec <= cfg.maxDurationSec)
      .filter(v => v.viewCount >= cfg.minViews)
      .filter(v => !cfg.mustHaveShortsTag || v.textBlob.includes('#shorts'));

    const uniq = [];
    const seen = new Set();
    for (const v of filtered){
      if (seen.has(v.videoId)) continue;
      seen.add(v.videoId);
      uniq.push(v);
      if (uniq.length >= cfg.resultLimit) break;
    }

    currentResults = uniq;
    setStatus(`完成：${currentResults.length} 支`);
    sortAndRender();

    els.btnExport.disabled = currentResults.length === 0;
    els.btnReload.disabled = currentResults.length === 0;

    cache[lastQueryKey] = { ts: Date.now(), results: currentResults };
    localStorage.setItem(LS_CACHE, JSON.stringify(cache));

    showProgress(100, `完成：${currentResults.length} 支（已快取）`);
    setTimeout(hideProgress, 600);

  } catch (err){
    if (String(err?.name) === 'AbortError'){
      setStatus('已停止');
    } else {
      console.error(err);
      setStatus(`錯誤：${readableError(err)}`);
      alert(`發生錯誤：${readableError(err)}\n\n常見原因：\n- ACCESS_TOKEN 不正確（會 401）\n- ALLOWED_ORIGINS 未設定正確（會 403）\n- YouTube API 未啟用或配額用盡（會 403）`);
    }
  } finally {
    els.btnSearch.disabled = false;
    els.btnStop.disabled = true;
    abortCtrl = null;
  }
}

function sortAndRender(){
  const sortBy = els.sortBy.value;
  const arr = [...currentResults];
  if (sortBy === 'views_desc') arr.sort((a,b) => b.viewCount - a.viewCount);
  else if (sortBy === 'vpd_desc') arr.sort((a,b) => b.viewsPerDay - a.viewsPerDay);
  else if (sortBy === 'recent_desc') arr.sort((a,b) => b.publishedAtMs - a.publishedAtMs);
  renderResults(arr);
}

function renderResults(list){
  els.results.innerHTML = '';
  if (!list.length){
    els.foundText.textContent = '尚未搜尋或沒有符合條件的結果';
    return;
  }
  els.foundText.textContent = `找到 ${list.length} 部爆款影片`;

  for (const v of list){
    const card = document.createElement('article');
    card.className = 'card';

    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    const img = document.createElement('img');
    img.alt = v.title;
    img.loading = 'lazy';
    img.src = v.thumbUrl || '';
    thumb.appendChild(img);

    const body = document.createElement('div');

    const title = document.createElement('div');
    title.className = 'cardTitle';
    title.textContent = v.title;

    const meta = document.createElement('div');
    meta.className = 'metaLine';
    meta.innerHTML = `
      <span>頻道：${escapeHtml(v.channelTitle)}</span>
      <span>觀看：${fmtInt(v.viewCount)}</span>
      <span>片長：${fmtDuration(v.durationSec)}</span>
      <span>日均：${fmtInt(Math.floor(v.viewsPerDay))}/天</span>
    `;

    const btns = document.createElement('div');
    btns.className = 'cardBtns';
    const url = `https://www.youtube.com/watch?v=${v.videoId}`;
    btns.appendChild(makeBtn('開啟影片', () => window.open(url, '_blank', 'noopener,noreferrer')));
    btns.appendChild(makeBtn('複製連結', () => copyText(url)));
    btns.appendChild(makeBtn('複製標題', () => copyText(v.title)));
    btns.appendChild(makeBtn('複製Prompt（中英）', () => copyText(makePrompt(v, url))));

    body.appendChild(title);
    body.appendChild(meta);
    body.appendChild(btns);

    card.appendChild(thumb);
    card.appendChild(body);
    els.results.appendChild(card);
  }
}

function makeBtn(text, onClick){
  const b = document.createElement('button');
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

function makeSearchUrl({ base, q, regionCode, publishedAfter, maxResults, pageToken }){
  const params = new URLSearchParams({
    q, regionCode, publishedAfter, maxResults: String(maxResults)
  });
  if (pageToken) params.set('pageToken', pageToken);
  return `${base}/v1/search?${params.toString()}`;
}

function makeVideosUrl({ base, ids }){
  const params = new URLSearchParams({ id: ids.join(',') });
  return `${base}/v1/videos?${params.toString()}`;
}

async function fetchJson(url, signal){
  const token = els.accessToken.value.trim();
  const res = await fetch(url, {
    signal,
    headers: {
      "Accept": "application/json",
      "Authorization": `Bearer ${token}`,
    },
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!res.ok){
    const msg = json?.error?.message || json?.error || text || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

function normalizeVideo(v){
  const snippet = v.snippet || {};
  const stats = v.statistics || {};
  const cd = v.contentDetails || {};

  const title = snippet.title || '';
  const desc = snippet.description || '';
  const textBlob = (title + '\n' + desc).toLowerCase();

  const thumbUrl =
    snippet.thumbnails?.medium?.url ||
    snippet.thumbnails?.high?.url ||
    snippet.thumbnails?.default?.url ||
    '';

  const durationSec = parseISODuration(cd.duration || 'PT0S');
  const publishedAtMs = Date.parse(snippet.publishedAt || new Date().toISOString());

  return {
    videoId: v.id,
    title,
    channelTitle: snippet.channelTitle || '',
    publishedAt: snippet.publishedAt || '',
    publishedAtMs,
    viewCount: Number(stats.viewCount || 0),
    durationSec,
    thumbUrl,
    textBlob,
  };
}

function getConfig(){
  return {
    keywords: els.keywords.value.trim(),
    regionCode: els.regionCode.value,
    days: clampInt(els.days.value, 1, 365),
    depthPages: clampInt(els.depthPages.value, 1, 10),
    resultLimit: clampInt(els.resultLimit.value, 1, 200),
    pageSize: clampInt(els.pageSize.value, 5, 50),
    minViews: clampInt(els.minViews.value, 0, 10_000_000_000),
    maxDurationSec: clampInt(els.maxDurationSec.value, 1, 240),
    mustHaveShortsTag: !!els.mustHaveShortsTag.checked,
  };
}

function makeQueryKey(cfg, base){
  const keyObj = { base, ...cfg, keywords: splitKeywords(cfg.keywords) };
  return 'q:' + btoa(unescape(encodeURIComponent(JSON.stringify(keyObj))));
}

function splitKeywords(raw){
  return (raw || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 8);
}

function chunk(arr, size){
  const out = [];
  for (let i=0; i<arr.length; i+=size) out.push(arr.slice(i, i+size));
  return out;
}

function clampInt(v, min, max, def = min){
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function parseISODuration(iso){
  const m = String(iso).match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  const h = Number(m[1] || 0);
  const min = Number(m[2] || 0);
  const s = Number(m[3] || 0);
  return h*3600 + min*60 + s;
}

function fmtInt(n){ try { return Number(n).toLocaleString('en-US'); } catch { return String(n); } }
function fmtDuration(sec){
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m <= 0) return `00:${String(r).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(r).padStart(2,'0')}`;
}

function escapeHtml(str){
  return String(str).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'","&#039;");
}

async function copyText(text){
  try{
    await navigator.clipboard.writeText(text);
    setStatus('已複製到剪貼簿');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    setStatus('已複製到剪貼簿');
  }
}

function makePrompt(v, url){
  const en = [
    `Reference video: ${url}`,
    `Create a similar Shorts concept inspired by: "${v.title}".`,
    `Constraints: vertical 9:16, duration <= ${Math.min(60, v.durationSec)}s, hook within 1s, fast pacing.`,
    `Deliver: shot list + captions + sound cues, advertiser-friendly.`,
  ].join('\n');

  const zh = [
    `參考影片：${url}`,
    `請基於「${v.title}」改寫成類似概念（避免照抄）。`,
    `限制：9:16 直式、<=${Math.min(60, v.durationSec)} 秒、前 1 秒強 Hook、節奏快。`,
    `輸出：分鏡 + 字幕 + 音效提示（安全可廣告）。`,
  ].join('\n');

  return `[EN]\n${en}\n\n[ZH]\n${zh}`;
}

function setStatus(text){ els.statusText.textContent = text; }
function showProgress(pct, text){
  els.progressWrap.classList.remove('hidden');
  els.progressBarInner.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  els.progressText.textContent = text;
}
function hideProgress(){
  els.progressWrap.classList.add('hidden');
  els.progressBarInner.style.width = '0%';
  els.progressText.textContent = '—';
}
function readableError(err){
  const msg = String(err?.message || err || 'unknown');
  return msg.length > 220 ? msg.slice(0, 220) + '…' : msg;
}
function safeJsonParse(s){ try { return JSON.parse(s); } catch { return null; } }

function exportCSV(){
  if (!currentResults.length) return;
  const rows = [
    ['videoId','title','channelTitle','publishedAt','viewCount','durationSec','viewsPerDay','url'],
    ...currentResults.map(v => [
      v.videoId, v.title, v.channelTitle, v.publishedAt,
      String(v.viewCount), String(v.durationSec),
      String(Math.floor(v.viewsPerDay || 0)),
      `https://www.youtube.com/watch?v=${v.videoId}`,
    ])
  ];
  const csv = rows.map(r => r.map(csvCell).join(',')).join('\n');
  const blob = new Blob([csv], { type:'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `yt_shorts_radar_${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setStatus('已匯出 CSV');
}

function csvCell(v){
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replaceAll('"','""')}"`;
  return s;
}
