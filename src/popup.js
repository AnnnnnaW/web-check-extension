// State 1: CSP修正済み・見出し構造改善前

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0]) document.getElementById('currentUrl').textContent = tabs[0].url;
});

document.getElementById('btnScan').addEventListener('click', async () => {
  const btn = document.getElementById('btnScan');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;margin:0;display:inline-block;border-width:2px"></span> チェック中…';
  document.getElementById('resultArea').innerHTML = `<div class="loading"><div class="spinner"></div><div>ページを解析中...</div></div>`;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.url || !tab.url.startsWith('http')) throw new Error('unsupported_url');
    let results;
    try {
      results = await chrome.tabs.sendMessage(tab.id, { action: 'runChecks' });
    } catch (_) {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content.js'] });
      results = await chrome.tabs.sendMessage(tab.id, { action: 'runChecks' });
    }
    renderResults(results, tab.url);
  } catch (e) {
    document.getElementById('resultArea').innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">このページではチェックできません。<br>通常のWebページで試してください。</div></div>`;
  }
  btn.disabled = false;
  btn.innerHTML = '<span>🔄</span> 再チェック';
});

function renderResults(r, pageUrl) {
  let okCount = 0, warnCount = 0, errorCount = 0;
  const items = [];

  if (r.noindex.hasNoindex) { errorCount++; items.push({ section: 'SEO・メタ情報', status: 'error', name: 'noindex', detail: '⚠️ noindexが設定されています！本番環境では削除してください', detailClass: 'error-text' }); }
  else { okCount++; items.push({ section: 'SEO・メタ情報', status: 'ok', name: 'noindex', detail: '問題なし（インデックス許可）', detailClass: 'ok-text' }); }

  const titleStatus = r.meta.title.status === 'error' ? 'error' : r.meta.title.value === 'warn' ? 'warn' : 'ok';
  if (titleStatus === 'error') errorCount++; else if (titleStatus === 'warn') warnCount++; else okCount++;
  items.push({ section: 'SEO・メタ情報', status: titleStatus, name: 'titleタグ', detail: titleStatus === 'error' ? '未設定' : titleStatus === 'warn' ? `長すぎ（${r.meta.title.text.length}文字）` : r.meta.title.text, detailClass: titleStatus === 'error' ? 'error-text' : titleStatus === 'warn' ? 'warn-text' : '' });

  const descStatus = r.meta.description.status;
  if (descStatus === 'error') errorCount++; else if (descStatus === 'warn') warnCount++; else okCount++;
  items.push({ section: 'SEO・メタ情報', status: descStatus, name: 'meta description', detail: descStatus === 'error' ? '未設定' : descStatus === 'warn' ? `長すぎ（${r.meta.description.text.length}文字）` : `OK（${r.meta.description.text.length}文字）`, detailClass: descStatus === 'error' ? 'error-text' : descStatus === 'warn' ? 'warn-text' : '' });

  const faviconStatus = r.meta.favicon.status;
  if (faviconStatus === 'error') errorCount++; else okCount++;
  items.push({ section: 'SEO・メタ情報', status: faviconStatus, name: 'Favicon', detail: faviconStatus === 'error' ? '未設定' : '設定済み', detailClass: faviconStatus === 'error' ? 'error-text' : '' });

  const ogStatus = (r.meta.ogTitle.status === 'ok' && r.meta.ogImage.status === 'ok') ? 'ok' : 'warn';
  if (ogStatus === 'warn') warnCount++; else okCount++;
  items.push({ section: 'SEO・メタ情報', status: ogStatus, name: 'OGP（og:title / og:image）', detail: ogStatus === 'ok' ? '設定済み' : `og:title ${r.meta.ogTitle.status === 'ok' ? '✓' : '未設定'} / og:image ${r.meta.ogImage.status === 'ok' ? '✓' : '未設定'}`, detailClass: ogStatus === 'warn' ? 'warn-text' : '' });

  const h1Status = r.headings.status;
  if (h1Status === 'error') errorCount++; else if (h1Status === 'warn') warnCount++; else okCount++;
  items.push({ section: 'SEO・メタ情報', status: h1Status, name: 'h1タグ', detail: h1Status === 'error' ? '未設定' : h1Status === 'warn' ? `複数設定（${r.headings.h1Count}個）` : `「${r.headings.h1Text.substring(0, 30)}」`, detailClass: h1Status === 'error' ? 'error-text' : h1Status === 'warn' ? 'warn-text' : '' });

  const imgStatus = r.images.status;
  if (imgStatus === 'error') errorCount++; else if (imgStatus === 'warn') warnCount++; else okCount++;
  const altDetail = r.images.total === 0 ? '画像なし' : imgStatus === 'ok' ? `全${r.images.total}枚 ALT設定済み` : `${r.images.missing}枚にALTなし（全${r.images.total}枚）`;
  items.push({ section: 'アクセシビリティ', status: imgStatus, name: '画像 ALT属性', detail: altDetail, detailClass: imgStatus === 'error' ? 'error-text' : imgStatus === 'warn' ? 'warn-text' : '' });

  const linkStatus = r.links.status;
  if (linkStatus === 'warn') warnCount++; else okCount++;
  items.push({ section: 'アクセシビリティ', status: linkStatus, name: 'リンク確認', detail: linkStatus === 'warn' ? `空リンク ${r.links.empty}個あり（内部:${r.links.internal} 外部:${r.links.external}）` : `内部:${r.links.internal}本 外部:${r.links.external}本 問題なし`, detailClass: linkStatus === 'warn' ? 'warn-text' : '' });

  const ga4Status = r.analytics.ga4.status;
  if (ga4Status === 'warn') warnCount++; else okCount++;
  items.push({ section: 'アナリティクス・タグ', status: ga4Status, name: 'Google Analytics 4', detail: ga4Status === 'ok' ? 'タグ検出' : '未検出（不要な場合は無視してOK）', detailClass: ga4Status === 'warn' ? 'warn-text' : '' });

  const gtmStatus = r.analytics.gtm.status;
  if (gtmStatus === 'warn') warnCount++; else okCount++;
  items.push({ section: 'アナリティクス・タグ', status: gtmStatus, name: 'Google Tag Manager', detail: gtmStatus === 'ok' ? 'タグ検出' : '未検出（不要な場合は無視してOK）', detailClass: gtmStatus === 'warn' ? 'warn-text' : '' });

  items.push({ section: 'その他', status: 'info', name: 'コンソールエラー', detail: 'F12 DevTools → Consoleタブで確認', detailClass: '' });

  let html = `<div class="summary"><div class="score-pill ok"><div class="count">${okCount}</div><div class="label">OK</div></div><div class="score-pill warn"><div class="count">${warnCount}</div><div class="label">要確認</div></div><div class="score-pill error"><div class="count">${errorCount}</div><div class="label">要修正</div></div></div><div class="checks">`;
  const psiUrl = `https://pagespeed.web.dev/report?url=${encodeURIComponent(pageUrl)}`;
  html += `<div class="section-title">パフォーマンス</div><a class="psi-link" href="${psiUrl}" target="_blank"><span>⚡</span> PageSpeed Insights で確認 →</a><div class="divider"></div>`;
  const sections = {};
  items.forEach(item => { if (!sections[item.section]) sections[item.section] = []; sections[item.section].push(item); });
  Object.entries(sections).forEach(([section, sectionItems]) => {
    html += `<div class="section-title">${section}</div>`;
    sectionItems.forEach(item => { html += `<div class="check-item"><div class="status-dot ${item.status}"></div><div class="check-content"><div class="check-name">${item.name}</div><div class="check-detail ${item.detailClass}">${item.detail}</div></div></div>`; });
  });
  html += '</div>';
  document.getElementById('resultArea').innerHTML = html;
}
