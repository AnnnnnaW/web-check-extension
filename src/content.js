// content.js - ページ内の情報を収集してpopupに返す

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'runChecks') {
    const results = runAllChecks();
    sendResponse(results);
  }
  return true;
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
  const missing = images.filter(img => !img.alt && !img.getAttribute('role') === 'presentation');
  const decorative = images.filter(img => img.alt === '');
  const withAlt = images.filter(img => img.alt && img.alt !== '');

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
