// State 2: 見出し構造ツリー追加済み・ogDescription追加前

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'runChecks') { sendResponse(runAllChecks()); }
  return true;
});

function runAllChecks() {
  return { meta: checkMeta(), images: checkImages(), links: checkLinks(), analytics: checkAnalytics(), noindex: checkNoindex(), headings: checkHeadings(), console: checkConsoleErrors() };
}

function checkMeta() {
  const title = document.title;
  const description = document.querySelector('meta[name="description"]')?.getAttribute('content');
  const favicon = document.querySelector('link[rel*="icon"]');
  const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
  const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content');
  const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href');
  return {
    title: title ? { status: 'ok', value: title.length > 60 ? 'warn' : 'ok', text: title } : { status: 'error', text: '未設定' },
    description: description ? { status: description.length > 160 ? 'warn' : 'ok', text: description } : { status: 'error', text: '未設定' },
    favicon: favicon ? { status: 'ok', text: favicon.href } : { status: 'error', text: '未設定' },
    ogTitle: ogTitle ? { status: 'ok', text: ogTitle } : { status: 'warn', text: '未設定' },
    ogImage: ogImage ? { status: 'ok', text: ogImage } : { status: 'warn', text: '未設定' },
    canonical: canonical ? { status: 'ok', text: canonical } : { status: 'warn', text: '未設定' },
  };
}

function checkImages() {
  const images = Array.from(document.querySelectorAll('img'));
  const missing = images.filter(img => !img.alt && !img.getAttribute('role') === 'presentation');
  return { total: images.length, withAlt: images.filter(img => img.alt && img.alt !== '').length, decorative: images.filter(img => img.alt === '').length, missing: missing.length, missingList: missing.slice(0,5).map(img => img.src.split('/').pop() || img.src.substring(0,50)), status: missing.length === 0 ? 'ok' : missing.length <= 2 ? 'warn' : 'error' };
}

function checkLinks() {
  const links = Array.from(document.querySelectorAll('a[href]'));
  const internal = links.filter(a => { try { return new URL(a.href).hostname === window.location.hostname; } catch { return false; } });
  const external = links.filter(a => { try { const u = new URL(a.href); return u.hostname !== window.location.hostname && u.protocol.startsWith('http'); } catch { return false; } });
  const empty = links.filter(a => !a.href || a.href === '#' || a.href === window.location.href + '#');
  return { total: links.length, internal: internal.length, external: external.length, empty: empty.length, status: empty.length > 0 ? 'warn' : 'ok' };
}

function checkAnalytics() {
  const scriptSrcs = Array.from(document.querySelectorAll('script')).map(s => s.src || s.textContent);
  const hasGA4 = scriptSrcs.some(s => s.includes('gtag') || s.includes('G-') || s.includes('google-analytics'));
  const hasGTM = scriptSrcs.some(s => s.includes('googletagmanager') || s.includes('GTM-')) || !!document.querySelector('noscript iframe[src*="googletagmanager"]');
  return { ga4: hasGA4 ? { status: 'ok', text: '検出' } : { status: 'warn', text: '未検出' }, gtm: hasGTM ? { status: 'ok', text: '検出' } : { status: 'warn', text: '未検出' }, dataLayer: typeof window.dataLayer !== 'undefined' ? { status: 'ok' } : { status: 'warn' } };
}

function checkNoindex() {
  const robots = document.querySelector('meta[name="robots"]')?.getAttribute('content') || '';
  return { hasNoindex: robots.toLowerCase().includes('noindex'), hasNofollow: robots.toLowerCase().includes('nofollow'), robotsContent: robots || '未設定', status: robots.toLowerCase().includes('noindex') ? 'error' : 'ok' };
}

function checkHeadings() {
  const nodes = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
  const headings = nodes.map(el => ({ level: parseInt(el.tagName[1]), text: el.textContent.trim().replace(/\s+/g, ' ').substring(0, 60) }));
  const issues = [];
  let prevLevel = 0;
  const annotated = headings.map(h => {
    let skip = false;
    if (prevLevel > 0 && h.level > prevLevel + 1) { issues.push(`h${prevLevel}→h${h.level} のスキップ`); skip = true; }
    prevLevel = h.level;
    return { ...h, skip };
  });
  const h1Count = headings.filter(h => h.level === 1).length;
  let status = 'ok';
  if (h1Count === 0 || issues.length > 0) status = 'error';
  else if (h1Count > 1) status = 'warn';
  return { headings: annotated, h1Count, issues, status };
}

function checkConsoleErrors() {
  return { note: 'DevToolsで確認', status: 'info' };
}
