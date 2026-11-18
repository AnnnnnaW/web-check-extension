// content.js - ページ内の情報を収集してpopupに返す

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'runChecks') {
    const results = runAllChecks();
    // 内部リンクの存在確認は非同期で行い、結果に追記して返す
    checkBrokenLinks()
      .then(broken => { results.links = mergeBrokenLinks(results.links, broken); })
      .catch(() => { results.links.brokenCheckFailed = true; })
      .finally(() => sendResponse(results));
    return true; // 非同期でsendResponseするため
  }
});

function runAllChecks() {
  return {
    meta: checkMeta(),
    images: checkImages(),
    links: checkLinks(),
    analytics: checkAnalytics(),
    noindex: checkNoindex(),
    headings: checkHeadings(),
    console: checkConsoleErrors(),
  };
}

// ===== SEO・メタ情報 =====
function checkMeta() {
  const title = document.title;
  const description = document.querySelector('meta[name="description"]')?.getAttribute('content');
  const favicon = document.querySelector('link[rel*="icon"]');
  const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
  const ogImageRaw = document.querySelector('meta[property="og:image"]')?.getAttribute('content');
  const ogDescription = document.querySelector('meta[property="og:description"]')?.getAttribute('content');
  const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href');

  // og:imageを絶対URLに解決
  let ogImageAbs = null;
  if (ogImageRaw) {
    try { ogImageAbs = new URL(ogImageRaw, window.location.href).href; } catch { ogImageAbs = ogImageRaw; }
  }

  return {
    title: title ? { status: 'ok', value: title.length > 60 ? 'warn' : 'ok', text: title } : { status: 'error', text: '未設定' },
    description: description ? { status: description.length > 160 ? 'warn' : 'ok', text: description } : { status: 'error', text: '未設定' },
    favicon: favicon ? { status: 'ok', text: favicon.href } : { status: 'error', text: '未設定' },
    ogTitle: ogTitle ? { status: 'ok', text: ogTitle } : { status: 'warn', text: '未設定' },
    ogImage: ogImageAbs ? { status: 'ok', text: ogImageAbs } : { status: 'warn', text: '未設定' },
    ogDescription: ogDescription ? { status: 'ok', text: ogDescription } : { status: 'warn', text: '未設定' },
    canonical: canonical ? { status: 'ok', text: canonical } : { status: 'warn', text: '未設定' },
  };
}

// ===== 画像ALT属性 =====
function checkImages() {
  const images = Array.from(document.querySelectorAll('img'));
  // alt属性そのものが無い画像（role="presentation"/"none" は装飾扱いで除外）
  const isPresentational = img => ['presentation', 'none'].includes((img.getAttribute('role') || '').toLowerCase());
  const missing = images.filter(img => !img.hasAttribute('alt') && !isPresentational(img));
  // alt="" を明示した装飾画像
  const decorative = images.filter(img => img.hasAttribute('alt') && img.getAttribute('alt').trim() === '');
  const withAlt = images.filter(img => img.hasAttribute('alt') && img.getAttribute('alt').trim() !== '');

  return {
    total: images.length,
    withAlt: withAlt.length,
    decorative: decorative.length,
    missing: missing.length,
    missingList: missing.slice(0, 5).map(img => img.src.split('/').pop() || img.src.substring(0, 50)),
    status: missing.length === 0 ? 'ok' : missing.length <= 2 ? 'warn' : 'error',
  };
}

// ===== リンク確認（同期チェック・外部リンクは非同期で別途） =====
function checkLinks() {
  const links = Array.from(document.querySelectorAll('a[href]'));
  const internal = links.filter(a => {
    try {
      const url = new URL(a.href);
      return url.hostname === window.location.hostname;
    } catch { return false; }
  });
  const external = links.filter(a => {
    try {
      const url = new URL(a.href);
      return url.hostname !== window.location.hostname && url.protocol.startsWith('http');
    } catch { return false; }
  });
  const empty = links.filter(a => !a.href || a.href === '#' || a.href === window.location.href + '#');

  return {
    total: links.length,
    internal: internal.length,
    external: external.length,
    empty: empty.length,
    status: empty.length > 0 ? 'warn' : 'ok',
  };
}

// ===== リンク切れ確認（同一オリジンのリンクのみ） =====
// host_permissions なしでも、ページと同じオリジンへの fetch は content script から可能。
// 外部リンクは CORS によりステータスが読めないため対象外。
const LINK_CHECK_MAX = 100;        // 1ページあたりの確認上限
const LINK_CHECK_CONCURRENCY = 5;  // 同時リクエスト数
const LINK_CHECK_TIMEOUT = 8000;   // 1リクエストのタイムアウト(ms)

async function checkBrokenLinks() {
  const targets = new Map(); // URL(ハッシュ除去) -> 表示用のhref
  for (const a of document.querySelectorAll('a[href]')) {
    const raw = a.getAttribute('href').trim();
    if (!raw || raw.startsWith('#') || /^(mailto|tel|javascript|data):/i.test(raw)) continue;
    let url;
    try { url = new URL(raw, document.baseURI); } catch { continue; }
    if (url.origin !== window.location.origin) continue;
    url.hash = '';
    if (!targets.has(url.href)) targets.set(url.href, raw);
  }

  const entries = Array.from(targets.entries());
  const checked = entries.slice(0, LINK_CHECK_MAX);
  const broken = [];

  let index = 0;
  async function worker() {
    while (index < checked.length) {
      const [url, raw] = checked[index++];
      const status = await fetchStatus(url);
      if (status === 0 || status >= 400) broken.push({ href: raw, status });
    }
  }
  await Promise.all(Array.from({ length: LINK_CHECK_CONCURRENCY }, worker));

  return { checked: checked.length, skipped: entries.length - checked.length, broken };
}

async function fetchStatus(url) {
  const tryFetch = async (method) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), LINK_CHECK_TIMEOUT);
    try {
      const res = await fetch(url, { method, redirect: 'follow', cache: 'no-store', credentials: 'same-origin', signal: ctrl.signal });
      return res.status;
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    let status = await tryFetch('HEAD');
    // HEAD非対応のサーバー向けにGETで再確認
    if (status === 405 || status === 501) status = await tryFetch('GET');
    return status;
  } catch {
    return 0; // ネットワークエラー・タイムアウト
  }
}

function mergeBrokenLinks(links, result) {
  const brokenCount = result.broken.length;
  let status = links.status;
  if (brokenCount > 0) status = 'error';
  return {
    ...links,
    checked: result.checked,
    skipped: result.skipped,
    brokenCount,
    brokenList: result.broken,
    status,
  };
}

// ===== アナリティクス・タグ =====
function checkAnalytics() {
  const scripts = Array.from(document.querySelectorAll('script'));
  const scriptSrcs = scripts.map(s => s.src || s.textContent);

  const hasGA4 = scriptSrcs.some(s => s.includes('gtag') || s.includes('G-') || s.includes('google-analytics'));
  const hasGTM = scriptSrcs.some(s => s.includes('googletagmanager') || s.includes('GTM-'));
  const hasGTMNoscript = !!document.querySelector('noscript iframe[src*="googletagmanager"]');

  // dataLayerの存在確認
  const hasDataLayer = typeof window.dataLayer !== 'undefined';

  return {
    ga4: hasGA4 ? { status: 'ok', text: '検出' } : { status: 'warn', text: '未検出' },
    gtm: (hasGTM || hasGTMNoscript) ? { status: 'ok', text: '検出' } : { status: 'warn', text: '未検出' },
    dataLayer: hasDataLayer ? { status: 'ok', text: '検出' } : { status: 'warn', text: '未検出' },
  };
}

// ===== noindex確認 =====
function checkNoindex() {
  const robots = document.querySelector('meta[name="robots"]')?.getAttribute('content') || '';
  const hasNoindex = robots.toLowerCase().includes('noindex');
  const hasNofollow = robots.toLowerCase().includes('nofollow');

  return {
    hasNoindex,
    hasNofollow,
    robotsContent: robots || '未設定',
    status: hasNoindex ? 'error' : 'ok',
  };
}

// ===== 見出し構造 =====
function checkHeadings() {
  const nodes = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
  const headings = nodes.map(el => ({
    level: parseInt(el.tagName[1]),
    text: el.textContent.trim().replace(/\s+/g, ' ').substring(0, 60),
  }));

  // レベルスキップ検出
  const issues = [];
  let prevLevel = 0;
  const annotated = headings.map(h => {
    let skip = false;
    if (prevLevel > 0 && h.level > prevLevel + 1) {
      issues.push(`h${prevLevel}→h${h.level} のスキップ`);
      skip = true;
    }
    prevLevel = h.level;
    return { ...h, skip };
  });

  const h1Count = headings.filter(h => h.level === 1).length;
  let status = 'ok';
  if (h1Count === 0 || issues.length > 0) status = 'error';
  else if (h1Count > 1) status = 'warn';

  return {
    headings: annotated,
    h1Count,
    issues,
    status,
  };
}

// ===== コンソールエラー（ページロード済みのものは取得不可のため案内のみ） =====
function checkConsoleErrors() {
  // コンソールエラーはcontent scriptからは直接取得不可
  // background scriptやdevtools APIが必要なため、案内を返す
  return {
    note: 'DevToolsで確認',
    status: 'info',
  };
}
