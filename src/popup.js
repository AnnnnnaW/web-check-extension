// 現在のURLを表示
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0]) {
    const url = tabs[0].url;
    document.getElementById('currentUrl').textContent = url;
  }
});

document.getElementById('btnScan').addEventListener('click', async () => {
  const btn = document.getElementById('btnScan');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;margin:0;display:inline-block;border-width:2px"></span> チェック中…';

  document.getElementById('resultArea').innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <div>ページを解析中...</div>
    </div>
  `;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // chrome:// や edge:// などの特殊ページは対象外
    if (!tab.url || !tab.url.startsWith('http')) {
      throw new Error('unsupported_url');
    }

    // まずメッセージを試み、失敗したらscriptを注入してリトライ
    let results;
    try {
      results = await chrome.tabs.sendMessage(tab.id, { action: 'runChecks' });
    } catch (_) {
      // content scriptが未注入（タブをリロードせず拡張機能を入れた場合など）
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['src/content.js'],
      });
      results = await chrome.tabs.sendMessage(tab.id, { action: 'runChecks' });
    }

    renderResults(results, tab.url);
  } catch (e) {
    document.getElementById('resultArea').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <div class="empty-text">このページではチェックできません。<br>通常のWebページで試してください。</div>
      </div>
    `;
  }

  btn.disabled = false;
  btn.innerHTML = '<span>🔄</span> 再チェック';
});

function renderResults(r, pageUrl) {
  let okCount = 0, warnCount = 0, errorCount = 0;
  const items = [];

  // noindex
  if (r.noindex.hasNoindex) {
    errorCount++;
    items.push({ section: 'SEO・メタ情報', status: 'error', name: 'noindex', detail: '⚠️ noindexが設定されています！本番環境では削除してください', detailClass: 'error-text' });
  } else {
    okCount++;
    items.push({ section: 'SEO・メタ情報', status: 'ok', name: 'noindex', detail: '問題なし（インデックス許可）', detailClass: 'ok-text' });
  }

  // title
  const titleStatus = r.meta.title.status === 'error' ? 'error' : r.meta.title.value === 'warn' ? 'warn' : 'ok';
  if (titleStatus === 'error') errorCount++;
  else if (titleStatus === 'warn') warnCount++;
  else okCount++;
  items.push({ section: 'SEO・メタ情報', status: titleStatus, name: 'titleタグ',
    detail: titleStatus === 'error' ? '未設定' : titleStatus === 'warn' ? `長すぎ（${r.meta.title.text.length}文字）: ${r.meta.title.text}` : r.meta.title.text,
    detailClass: titleStatus === 'error' ? 'error-text' : titleStatus === 'warn' ? 'warn-text' : '' });

  // description
  const descStatus = r.meta.description.status;
  if (descStatus === 'error') errorCount++;
  else if (descStatus === 'warn') warnCount++;
  else okCount++;
  items.push({ section: 'SEO・メタ情報', status: descStatus, name: 'meta description',
    detail: descStatus === 'error' ? '未設定' : descStatus === 'warn' ? `長すぎ（${r.meta.description.text.length}文字）` : `OK（${r.meta.description.text.length}文字）`,
    detailClass: descStatus === 'error' ? 'error-text' : descStatus === 'warn' ? 'warn-text' : '' });

  // favicon
  const faviconStatus = r.meta.favicon.status;
  if (faviconStatus === 'error') errorCount++;
  else okCount++;
  items.push({ section: 'SEO・メタ情報', status: faviconStatus, name: 'Favicon',
    detail: faviconStatus === 'error' ? '未設定' : '設定済み',
    detailClass: faviconStatus === 'error' ? 'error-text' : '' });

  // OGP（カードで表示するためitemsには入れない）
  const ogStatus = (r.meta.ogTitle.status === 'ok' && r.meta.ogImage.status === 'ok') ? 'ok' : 'warn';
  if (ogStatus === 'warn') warnCount++;
  else okCount++;

  // 見出し構造（別途ツリーで描画するためitemsには入れない）
  const headingStatus = r.headings.status;
  if (headingStatus === 'error') errorCount++;
  else if (headingStatus === 'warn') warnCount++;
  else okCount++;

  // 画像ALT
  const imgStatus = r.images.status;
  if (imgStatus === 'error') errorCount++;
  else if (imgStatus === 'warn') warnCount++;
  else okCount++;
  const altDetail = r.images.total === 0 ? '画像なし' :
    imgStatus === 'ok' ? `全${r.images.total}枚 ALT設定済み` :
    `${r.images.missing}枚にALTなし（全${r.images.total}枚）`;
  items.push({ section: 'アクセシビリティ', status: imgStatus, name: '画像 ALT属性',
    detail: altDetail, detailClass: imgStatus === 'error' ? 'error-text' : imgStatus === 'warn' ? 'warn-text' : '' });

  // リンク
  const linkStatus = r.links.status;
  if (linkStatus === 'warn') warnCount++;
  else okCount++;
  items.push({ section: 'アクセシビリティ', status: linkStatus, name: 'リンク確認',
    detail: linkStatus === 'warn' ? `空リンク ${r.links.empty}個あり（内部:${r.links.internal} 外部:${r.links.external}）` : `内部:${r.links.internal}本 外部:${r.links.external}本 問題なし`,
    detailClass: linkStatus === 'warn' ? 'warn-text' : '' });

  // GA4
  const ga4Status = r.analytics.ga4.status;
  if (ga4Status === 'warn') warnCount++;
  else okCount++;
  items.push({ section: 'アナリティクス・タグ', status: ga4Status, name: 'Google Analytics 4',
    detail: ga4Status === 'ok' ? 'タグ検出' : '未検出（不要な場合は無視してOK）',
    detailClass: ga4Status === 'warn' ? 'warn-text' : '' });

  // GTM
  const gtmStatus = r.analytics.gtm.status;
  if (gtmStatus === 'warn') warnCount++;
  else okCount++;
  items.push({ section: 'アナリティクス・タグ', status: gtmStatus, name: 'Google Tag Manager',
    detail: gtmStatus === 'ok' ? 'タグ検出' : '未検出（不要な場合は無視してOK）',
    detailClass: gtmStatus === 'warn' ? 'warn-text' : '' });

  // コンソール
  items.push({ section: 'その他', status: 'info', name: 'コンソールエラー',
    detail: 'F12 DevTools → Consoleタブで確認', detailClass: '' });

  // HTML生成
  let html = `
    <div class="summary">
      <div class="score-pill ok"><div class="count">${okCount}</div><div class="label">OK</div></div>
      <div class="score-pill warn"><div class="count">${warnCount}</div><div class="label">要確認</div></div>
      <div class="score-pill error"><div class="count">${errorCount}</div><div class="label">要修正</div></div>
    </div>
    <div class="checks">
  `;

  // 見出し構造アコーディオン
  const hSkipCount = r.headings.headings.filter(h => h.skip).length;
  const hHasIssues = r.headings.status !== 'ok';
  const hOpen = hHasIssues;
  let hBadge = '';
  if (r.headings.h1Count === 0) hBadge += `<span class="badge error">h1なし</span>`;
  else if (r.headings.h1Count > 1) hBadge += `<span class="badge warn">h1が${r.headings.h1Count}個</span>`;
  if (hSkipCount > 0) hBadge += `<span class="badge error">スキップ${hSkipCount}件</span>`;

  html += `
    <div class="section-title accordion-title" id="headingToggle">
      見出し構造 ${hBadge}
      <span class="accordion-chevron">${hOpen ? '▼' : '▶'}</span>
    </div>
    <div id="headingBody" style="display:${hOpen ? 'block' : 'none'}">`;

  if (r.headings.headings.length === 0) {
    html += `<div class="check-item"><div class="status-dot error"></div><div class="check-content"><div class="check-name">見出しなし</div></div></div>`;
  } else {
    r.headings.headings.forEach(h => {
      const indent = (h.level - 1) * 12;
      const dotClass = h.skip ? 'error' : 'ok';
      const textClass = h.skip ? 'error-text' : '';
      const skipLabel = h.skip ? ` <span style="color:var(--error);font-size:10px">← スキップ!</span>` : '';
      html += `
        <div class="check-item" style="padding-left:${16 + indent}px">
          <div class="status-dot ${dotClass}" style="margin-top:5px;flex-shrink:0"></div>
          <div class="check-content">
            <div class="check-detail ${textClass}" style="font-size:11px">
              <span style="color:var(--muted);margin-right:4px">h${h.level}</span>${h.text || '（テキストなし）'}${skipLabel}
            </div>
          </div>
        </div>`;
    });
  }
  html += `</div>`;
  html += `<div class="divider" style="margin-top:4px"></div>`;

  // PageSpeedリンク
  const psiUrl = `https://pagespeed.web.dev/report?url=${encodeURIComponent(pageUrl)}`;
  html += `
    <div class="section-title">パフォーマンス</div>
    <a class="psi-link" href="${psiUrl}" target="_blank">
      <span>⚡</span> PageSpeed Insights で確認 →
    </a>
    <div class="divider"></div>
  `;

  // セクションごとにグループ化
  const sections = {};
  items.forEach(item => {
    if (!sections[item.section]) sections[item.section] = [];
    sections[item.section].push(item);
  });

  Object.entries(sections).forEach(([section, sectionItems]) => {
    html += `<div class="section-title">${section}</div>`;
    if (section === 'SEO・メタ情報') html += buildOgpCard(r.meta, pageUrl);
    sectionItems.forEach(item => {
      html += `
        <div class="check-item">
          <div class="status-dot ${item.status}"></div>
          <div class="check-content">
            <div class="check-name">${item.name}</div>
            <div class="check-detail ${item.detailClass}">${item.detail}</div>
          </div>
        </div>
      `;
    });
  });

  html += '</div>';
  document.getElementById('resultArea').innerHTML = html;

  // 見出しアコーディオン
  const hToggle = document.getElementById('headingToggle');
  const hBody = document.getElementById('headingBody');
  if (hToggle && hBody) {
    hToggle.addEventListener('click', () => {
      const open = hBody.style.display !== 'none';
      hBody.style.display = open ? 'none' : 'block';
      hToggle.querySelector('.accordion-chevron').textContent = open ? '▶' : '▼';
    });
  }

  // OGP画像エラー時はプレースホルダーに差し替え
  const ogpImg = document.querySelector('.ogp-preview-img');
  if (ogpImg) {
    ogpImg.addEventListener('error', () => {
      ogpImg.outerHTML = '<div class="ogp-preview-img-placeholder">画像を読み込めませんでした</div>';
    });
  }
}

function buildOgpCard(meta, pageUrl) {
  let domain = '';
  try { domain = new URL(pageUrl).hostname; } catch {}

  const imgSrc = meta.ogImage?.text;
  const title = meta.ogTitle?.text;
  const desc = meta.ogDescription?.text;

  const imgHtml = imgSrc
    ? `<img class="ogp-preview-img" src="${imgSrc}" alt="">`
    : `<div class="ogp-preview-img-placeholder">og:image 未設定</div>`;

  return `
    <div class="ogp-preview">
      ${imgHtml}
      <div class="ogp-preview-body">
        <div class="ogp-preview-domain">${domain}</div>
        <div class="ogp-preview-title${title ? '' : ' ogp-missing'}">${title || 'og:title 未設定'}</div>
        <div class="ogp-preview-desc${desc ? '' : ' ogp-missing'}">${desc || 'og:description 未設定'}</div>
      </div>
    </div>`;
}
