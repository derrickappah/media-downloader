/**
 * Media Downloader - Popup Controller
 */

// Self-contained in-page scanner function injected directly across frames
function extractAllMediaFromPage() {
  const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|avif|bmp|ico|tiff|heic)(\?.*)?$/i;
  const VIDEO_EXTENSIONS = /\.(mp4|webm|ogv|mov|mkv|avi|wmv|m4v|flv|3gp|ts)(\?.*)?$/i;
  const AUDIO_EXTENSIONS = /\.(mp3|wav|ogg|m4a|flac|aac|wma|opus|aiff|m4b)(\?.*)?$/i;
  const SVG_EXTENSIONS = /\.(svg)(\?.*)?$/i;
  const STREAM_EXTENSIONS = /\.(m3u8|mpd|f4m|ism)(\?.*)?$/i;

  function toAbsoluteUrl(url, baseDoc) {
    if (!url) return '';
    url = url.trim().replace(/^["']|["']$/g, '');
    if (url.startsWith('data:') || url.startsWith('blob:')) return url;
    if (url.startsWith('//')) return `${window.location.protocol}${url}`;
    try {
      return new URL(url, (baseDoc && baseDoc.baseURI) || document.baseURI).href;
    } catch (e) {
      return '';
    }
  }

  function getFilenameFromUrl(url, defaultName = 'media', fallbackExt = 'jpg') {
    if (!url) return `${defaultName}.${fallbackExt}`;
    if (url.startsWith('data:')) {
      const mime = url.substring(url.indexOf(':') + 1, url.indexOf(';'));
      const ext = (mime.split('/')[1] || fallbackExt).replace('+xml', '');
      return `${defaultName}.${ext}`;
    }
    try {
      const parsed = new URL(url);
      const pathname = parsed.pathname;
      const basename = pathname.substring(pathname.lastIndexOf('/') + 1);
      if (basename) {
        let clean = decodeURIComponent(basename.split(/[?#]/)[0]);
        if (clean.includes('.')) return clean;
        if (clean.length > 0 && clean.length < 50) return `${clean}.${fallbackExt}`;
      }
    } catch (e) {}
    return `${defaultName}.${fallbackExt}`;
  }

  function parseSrcset(srcsetStr) {
    if (!srcsetStr) return [];
    const urls = [];
    const candidates = srcsetStr.split(/,\s+/);
    for (const cand of candidates) {
      const parts = cand.trim().split(/\s+/);
      if (parts[0]) urls.push(parts[0]);
    }
    return urls;
  }

  const mediaMap = new Map();

  function addMedia(item) {
    if (!item || !item.url) return;
    const absUrl = toAbsoluteUrl(item.url);
    if (!absUrl) return;
    if (absUrl.startsWith('data:') && absUrl.length < 60) return;

    let type = item.type || 'image';
    if (STREAM_EXTENSIONS.test(absUrl)) {
      type = 'stream';
    } else if (VIDEO_EXTENSIONS.test(absUrl)) {
      type = 'video';
    } else if (AUDIO_EXTENSIONS.test(absUrl)) {
      type = 'audio';
    } else if (SVG_EXTENSIONS.test(absUrl) || absUrl.startsWith('data:image/svg')) {
      type = 'svg';
    }

    if (!mediaMap.has(absUrl)) {
      mediaMap.set(absUrl, {
        id: `media_${mediaMap.size + 1}`,
        url: absUrl,
        type: type,
        title: item.title || '',
        alt: item.alt || '',
        width: item.width || 0,
        height: item.height || 0,
        filename: item.filename || getFilenameFromUrl(absUrl, `media_${mediaMap.size + 1}`, type === 'video' ? 'mp4' : type === 'audio' ? 'mp3' : type === 'stream' ? 'm3u8' : 'jpg'),
        source: item.source || 'DOM'
      });
    } else {
      const existing = mediaMap.get(absUrl);
      if ((!existing.width || existing.width === 0) && item.width) {
        existing.width = item.width;
        existing.height = item.height;
      }
      if (!existing.title && item.title) {
        existing.title = item.title;
      }
    }
  }

  // 1. Scan Network Resource Timing Entries
  try {
    if (window.performance && typeof window.performance.getEntriesByType === 'function') {
      const resources = window.performance.getEntriesByType('resource');
      for (const res of resources) {
        if (!res.name) continue;
        const name = res.name;
        if (STREAM_EXTENSIONS.test(name)) {
          addMedia({ url: name, type: 'stream', source: 'Network Stream' });
        } else if (IMAGE_EXTENSIONS.test(name) || res.initiatorType === 'img' || name.includes('vimeocdn.com') || name.includes('ytimg.com')) {
          addMedia({ url: name, type: 'image', source: 'Network Resource' });
        } else if (VIDEO_EXTENSIONS.test(name) || res.initiatorType === 'video') {
          addMedia({ url: name, type: 'video', source: 'Network Resource' });
        } else if (AUDIO_EXTENSIONS.test(name) || res.initiatorType === 'audio') {
          addMedia({ url: name, type: 'audio', source: 'Network Resource' });
        }
      }
    }
  } catch (e) {}

  function scanNode(doc, depth = 0) {
    if (!doc || depth > 4) return;

    // 2. Meta tags
    try {
      doc.querySelectorAll('meta[property^="og:"], meta[name^="twitter:"], meta[name="thumbnail"], meta[name="image"]').forEach(meta => {
        const prop = meta.getAttribute('property') || meta.getAttribute('name') || '';
        const content = meta.getAttribute('content');
        if (!content) return;
        if (prop.includes('video')) addMedia({ url: content, type: 'video', source: `<meta ${prop}>` });
        else if (prop.includes('audio')) addMedia({ url: content, type: 'audio', source: `<meta ${prop}>` });
        else if (prop.includes('image') || prop.includes('thumbnail')) addMedia({ url: content, type: 'image', source: `<meta ${prop}>` });
      });
    } catch (e) {}

    // 3. JSON-LD scripts
    try {
      doc.querySelectorAll('script[type="application/ld+json"], script[type="application/json"]').forEach(script => {
        try {
          const jsonText = script.textContent.trim();
          if (!jsonText) return;
          const data = JSON.parse(jsonText);
          function findUrls(obj) {
            if (!obj) return;
            if (typeof obj === 'string') {
              if (obj.startsWith('http://') || obj.startsWith('https://')) {
                if (STREAM_EXTENSIONS.test(obj)) addMedia({ url: obj, type: 'stream', source: 'JSON-LD' });
                else if (IMAGE_EXTENSIONS.test(obj) || obj.includes('vimeocdn.com') || obj.includes('ytimg.com')) addMedia({ url: obj, type: 'image', source: 'JSON-LD' });
                else if (VIDEO_EXTENSIONS.test(obj)) addMedia({ url: obj, type: 'video', source: 'JSON-LD' });
                else if (AUDIO_EXTENSIONS.test(obj)) addMedia({ url: obj, type: 'audio', source: 'JSON-LD' });
              }
              return;
            }
            if (typeof obj === 'object') {
              if (obj.thumbnailUrl) addMedia({ url: obj.thumbnailUrl, type: 'image', source: 'JSON-LD' });
              if (obj.contentUrl) addMedia({ url: obj.contentUrl, type: 'video', source: 'JSON-LD' });
              if (obj.embedUrl) addMedia({ url: obj.embedUrl, type: 'video', source: 'JSON-LD' });
              if (obj.image) {
                const img = typeof obj.image === 'string' ? obj.image : (obj.image.url || obj.image['@id']);
                if (img) addMedia({ url: img, type: 'image', source: 'JSON-LD' });
              }
              for (const k of Object.keys(obj)) findUrls(obj[k]);
            }
          }
          findUrls(data);
        } catch (e) {}
      });
    } catch (e) {}

    // 4. Scan <img> elements
    try {
      doc.querySelectorAll('img').forEach((img) => {
        const rect = img.getBoundingClientRect();
        const width = img.naturalWidth || Math.round(rect.width) || parseInt(img.getAttribute('width')) || 0;
        const height = img.naturalHeight || Math.round(rect.height) || parseInt(img.getAttribute('height')) || 0;
        const alt = img.getAttribute('alt') || img.getAttribute('title') || '';

        const rawSrc = img.getAttribute('src');
        const currentSrc = img.currentSrc;
        const propSrc = img.src;

        if (rawSrc) addMedia({ url: rawSrc, type: 'image', width, height, alt, source: '<img>' });
        if (currentSrc && currentSrc !== rawSrc) addMedia({ url: currentSrc, type: 'image', width, height, alt, source: '<img>' });
        if (propSrc && propSrc !== rawSrc && propSrc !== currentSrc) addMedia({ url: propSrc, type: 'image', width, height, alt, source: '<img>' });

        const srcset = img.getAttribute('srcset');
        if (srcset) {
          parseSrcset(srcset).forEach(url => addMedia({ url, type: 'image', width, height, alt, source: '<img> srcset' }));
        }

        for (let i = 0; i < img.attributes.length; i++) {
          const attr = img.attributes[i];
          if ((attr.name.startsWith('data-') || attr.name.includes('src') || attr.name.includes('url')) && attr.value) {
            const val = attr.value.trim();
            if (val.startsWith('http') || val.startsWith('//') || val.startsWith('/') || val.startsWith('data:image')) {
              if (attr.name.includes('srcset')) {
                parseSrcset(val).forEach(url => addMedia({ url, type: 'image', width, height, alt, source: `<img> ${attr.name}` }));
              } else {
                addMedia({ url: val, type: 'image', width, height, alt, source: `<img> ${attr.name}` });
              }
            }
          }
        }
      });
    } catch (e) {}

    // 5. SVG <image> elements
    try {
      doc.querySelectorAll('svg image, image').forEach(svgImg => {
        const href = svgImg.getAttribute('href') || svgImg.getAttribute('xlink:href') || svgImg.getAttribute('src');
        if (href) addMedia({ url: href, type: 'image', source: '<svg image>' });
      });
    } catch (e) {}

    // 6. <picture> and <source>
    try {
      doc.querySelectorAll('picture source').forEach((source) => {
        const srcset = source.getAttribute('srcset') || source.getAttribute('data-srcset');
        if (srcset) parseSrcset(srcset).forEach(url => addMedia({ url, type: 'image', source: '<picture>' }));
        const src = source.getAttribute('src') || source.getAttribute('data-src');
        if (src) addMedia({ url: src, type: 'image', source: '<picture source>' });
      });
    } catch (e) {}

    // 7. <video> elements
    try {
      doc.querySelectorAll('video').forEach((video) => {
        const rect = video.getBoundingClientRect();
        const width = video.videoWidth || Math.round(rect.width) || 0;
        const height = video.videoHeight || Math.round(rect.height) || 0;

        const rawSrc = video.getAttribute('src');
        const currentSrc = video.currentSrc;
        const propSrc = video.src;

        if (rawSrc) addMedia({ url: rawSrc, type: 'video', width, height, source: '<video>' });
        if (currentSrc && currentSrc !== rawSrc) addMedia({ url: currentSrc, type: 'video', width, height, source: '<video>' });
        if (propSrc && propSrc !== rawSrc && propSrc !== currentSrc) addMedia({ url: propSrc, type: 'video', width, height, source: '<video>' });

        if (video.poster) addMedia({ url: video.poster, type: 'image', source: '<video poster>' });
        const dataPoster = video.getAttribute('data-poster') || video.getAttribute('data-thumb') || video.getAttribute('data-thumbnail');
        if (dataPoster) addMedia({ url: dataPoster, type: 'image', source: '<video data-poster>' });

        video.querySelectorAll('source').forEach((source) => {
          const src = source.getAttribute('src') || source.getAttribute('data-src');
          if (src) addMedia({ url: src, type: 'video', width, height, source: '<video source>' });
        });
      });
    } catch (e) {}

    // 8. <audio> elements
    try {
      doc.querySelectorAll('audio').forEach((audio) => {
        const rawSrc = audio.getAttribute('src');
        const currentSrc = audio.currentSrc;
        const propSrc = audio.src;

        if (rawSrc) addMedia({ url: rawSrc, type: 'audio', source: '<audio>' });
        if (currentSrc && currentSrc !== rawSrc) addMedia({ url: currentSrc, type: 'audio', source: '<audio>' });
        if (propSrc && propSrc !== rawSrc && propSrc !== currentSrc) addMedia({ url: propSrc, type: 'audio', source: '<audio>' });

        audio.querySelectorAll('source').forEach((source) => {
          const src = source.getAttribute('src') || source.getAttribute('data-src');
          if (src) addMedia({ url: src, type: 'audio', source: '<audio source>' });
        });
      });
    } catch (e) {}

    // 9. Inline SVGs
    try {
      doc.querySelectorAll('svg').forEach((svg, index) => {
        try {
          const rect = svg.getBoundingClientRect();
          const width = Math.round(rect.width) || parseInt(svg.getAttribute('width')) || 100;
          const height = Math.round(rect.height) || parseInt(svg.getAttribute('height')) || 100;

          const serializer = new XMLSerializer();
          let svgString = serializer.serializeToString(svg);
          if (!svgString.match(/^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)) {
            svgString = svgString.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
          }
          const base64 = btoa(unescape(encodeURIComponent(svgString)));
          const dataUrl = `data:image/svg+xml;base64,${base64}`;

          addMedia({
            url: dataUrl,
            type: 'svg',
            width,
            height,
            filename: `vector_${index + 1}.svg`,
            source: 'Inline <svg>'
          });
        } catch (e) {}
      });
    } catch (e) {}

    // 10. <canvas> elements
    try {
      doc.querySelectorAll('canvas').forEach((canvas, index) => {
        try {
          const dataUrl = canvas.toDataURL('image/png');
          if (dataUrl && dataUrl.length > 50) {
            addMedia({
              url: dataUrl,
              type: 'image',
              width: canvas.width,
              height: canvas.height,
              filename: `canvas_${index + 1}.png`,
              source: '<canvas>'
            });
          }
        } catch (e) {}
      });
    } catch (e) {}

    // 11. <a> links
    try {
      doc.querySelectorAll('a[href]').forEach((a) => {
        const href = a.getAttribute('href');
        if (!href) return;
        const abs = toAbsoluteUrl(href, doc);
        if (!abs) return;

        if (STREAM_EXTENSIONS.test(abs)) {
          addMedia({ url: abs, type: 'stream', title: a.textContent.trim(), source: '<a> stream link' });
        } else if (IMAGE_EXTENSIONS.test(abs) || abs.includes('vimeocdn.com') || abs.includes('ytimg.com')) {
          addMedia({ url: abs, type: 'image', title: a.textContent.trim(), source: '<a> link' });
        } else if (VIDEO_EXTENSIONS.test(abs)) {
          addMedia({ url: abs, type: 'video', title: a.textContent.trim(), source: '<a> link' });
        } else if (AUDIO_EXTENSIONS.test(abs)) {
          addMedia({ url: abs, type: 'audio', title: a.textContent.trim(), source: '<a> link' });
        } else if (SVG_EXTENSIONS.test(abs)) {
          addMedia({ url: abs, type: 'svg', title: a.textContent.trim(), source: '<a> link' });
        }
      });
    } catch (e) {}

    // 12. CSS Background Images
    try {
      const allEls = doc.querySelectorAll('*');
      for (let i = 0; i < Math.min(allEls.length, 1500); i++) {
        const el = allEls[i];
        if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;

        function checkBgString(bg) {
          if (!bg || bg === 'none' || !bg.includes('url(')) return;
          const matches = bg.match(/url\((['"]?)(.*?)\1\)/g);
          if (matches) {
            matches.forEach(m => {
              const cleanUrl = m.replace(/^url\((['"]?)/, '').replace(/(['"]?)\)$/, '').trim();
              if (cleanUrl) {
                const rect = el.getBoundingClientRect();
                addMedia({
                  url: cleanUrl,
                  type: 'image',
                  width: Math.round(rect.width) || 0,
                  height: Math.round(rect.height) || 0,
                  source: 'CSS background'
                });
              }
            });
          }
        }

        const inlineStyle = el.getAttribute('style');
        if (inlineStyle) checkBgString(inlineStyle);

        try {
          const style = (doc.defaultView || window).getComputedStyle(el);
          if (style && style.backgroundImage) checkBgString(style.backgroundImage);
        } catch (e) {}

        if (el.shadowRoot) scanNode(el.shadowRoot, depth + 1);
      }
    } catch (e) {}

    // 13. <template> elements
    try {
      doc.querySelectorAll('template').forEach(tpl => {
        if (tpl.content) scanNode(tpl.content, depth + 1);
      });
    } catch (e) {}

    // 14. <noscript> elements
    try {
      doc.querySelectorAll('noscript').forEach(ns => {
        const txt = ns.textContent || '';
        const imgMatches = txt.match(/<img[^>]+src=["']([^"']+)["']/gi);
        if (imgMatches) {
          imgMatches.forEach(m => {
            const srcMatch = m.match(/src=["']([^"']+)["']/i);
            if (srcMatch && srcMatch[1]) addMedia({ url: srcMatch[1], type: 'image', source: '<noscript>' });
          });
        }
      });
    } catch (e) {}

    // 15. IFrames
    try {
      doc.querySelectorAll('iframe').forEach(iframe => {
        try {
          const iframeDoc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
          if (iframeDoc) scanNode(iframeDoc, depth + 1);
        } catch (e) {}
      });
    } catch (e) {}
  }

  scanNode(document, 0);

  // 16. Global HTML String regex scan
  try {
    const htmlText = document.documentElement ? document.documentElement.innerHTML : '';
    const cdnRegex = /https?:\/\/[^"'\s<>\)\(]+\.(jpg|jpeg|png|webp|gif|svg|avif|mp4|webm|mp3|ogg|m3u8)(\?[^"'\s<>\)\(]*)?/gi;
    const vimeoRegex = /https?:\/\/i\.vimeocdn\.com\/video\/[^"'\s<>\)\(]+/gi;
    const ytRegex = /https?:\/\/i\.ytimg\.com\/vi\/[^"'\s<>\)\(]+/gi;

    [cdnRegex, vimeoRegex, ytRegex].forEach(regex => {
      const matches = htmlText.match(regex);
      if (matches) {
        matches.forEach(url => {
          const cleanUrl = url.replace(/&amp;/g, '&');
          if (STREAM_EXTENSIONS.test(cleanUrl)) {
            addMedia({ url: cleanUrl, type: 'stream', source: 'Page HTML' });
          } else if (cleanUrl.includes('vimeocdn.com') || cleanUrl.includes('ytimg.com') || IMAGE_EXTENSIONS.test(cleanUrl)) {
            addMedia({ url: cleanUrl, type: 'image', source: 'Page HTML' });
          } else if (VIDEO_EXTENSIONS.test(cleanUrl)) {
            addMedia({ url: cleanUrl, type: 'video', source: 'Page HTML' });
          } else if (AUDIO_EXTENSIONS.test(cleanUrl)) {
            addMedia({ url: cleanUrl, type: 'audio', source: 'Page HTML' });
          }
        });
      }
    });
  } catch (e) {}

  const results = Array.from(mediaMap.values()).map((item, idx) => {
    let ext = 'jpg';
    let type = item.type;

    if (item.type === 'stream' || STREAM_EXTENSIONS.test(item.url)) {
      type = 'stream';
      ext = 'm3u8';
    } else if (item.url.startsWith('data:image/svg') || SVG_EXTENSIONS.test(item.url)) {
      type = 'svg';
      ext = 'svg';
    } else if (VIDEO_EXTENSIONS.test(item.url)) {
      type = 'video';
      ext = 'mp4';
    } else if (AUDIO_EXTENSIONS.test(item.url)) {
      type = 'audio';
      ext = 'mp3';
    } else {
      type = 'image';
      ext = 'jpg';
    }

    if (!item.filename || item.filename.startsWith('media_')) {
      item.filename = getFilenameFromUrl(item.url, `media_${idx + 1}`, ext);
    }
    item.type = type;
    return item;
  });

  return {
    title: document.title || 'webpage',
    domain: window.location.hostname || 'website',
    url: window.location.href,
    media: results
  };
}

// In-page auto-scroll function for Deep Scan
async function autoScrollPageForLazyMedia() {
  const scrollHeight = document.body.scrollHeight || document.documentElement.scrollHeight;
  const step = Math.max(window.innerHeight * 0.8, 400);
  let currentPos = 0;

  while (currentPos < scrollHeight) {
    currentPos += step;
    window.scrollTo({ top: currentPos, behavior: 'smooth' });
    await new Promise(r => setTimeout(r, 250));
  }

  // Scroll back to top
  window.scrollTo({ top: 0, behavior: 'smooth' });
  await new Promise(r => setTimeout(r, 400));

  return true;
}

document.addEventListener('DOMContentLoaded', () => {
  let allMedia = [];
  let filteredMedia = [];
  let selectedIds = new Set();
  let currentTabFilter = 'all';
  let searchQuery = '';
  let minDimension = 0;
  let pageDomain = 'website';
  let pageTitle = 'webpage';

  // Modal Zoom state
  let currentZoom = 1;
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let scrollLeft = 0;
  let scrollTop = 0;

  // DOM Elements
  const siteDomainEl = document.getElementById('siteDomain');
  const deepScanBtn = document.getElementById('deepScanBtn');
  const rescanBtn = document.getElementById('rescanBtn');
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsDrawer = document.getElementById('settingsDrawer');
  const subfolderToggle = document.getElementById('subfolderToggle');
  const minDimFilter = document.getElementById('minDimFilter');

  const searchInput = document.getElementById('searchInput');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  const categoryTabs = document.getElementById('categoryTabs');

  const countAll = document.getElementById('countAll');
  const countImages = document.getElementById('countImages');
  const countVideos = document.getElementById('countVideos');
  const countAudio = document.getElementById('countAudio');
  const countSvg = document.getElementById('countSvg');
  const countStream = document.getElementById('countStream');

  const selectAllCheckbox = document.getElementById('selectAllCheckbox');
  const selectionStatus = document.getElementById('selectionStatus');
  const selectedCount = document.getElementById('selectedCount');
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const copyLinksBtn = document.getElementById('copyLinksBtn');
  const downloadZipBtn = document.getElementById('downloadZipBtn');
  const downloadSelectedBtn = document.getElementById('downloadSelectedBtn');

  const mediaContainer = document.getElementById('mediaContainer');
  const loadingState = document.getElementById('loadingState');
  const loadingText = document.getElementById('loadingText');
  const emptyState = document.getElementById('emptyState');
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toastMsg');

  const previewModal = document.getElementById('previewModal');
  const modalBackdrop = document.getElementById('modalBackdrop');
  const modalCloseBtn = document.getElementById('modalCloseBtn');
  const modalBody = document.getElementById('modalBody');
  const modalFilename = document.getElementById('modalFilename');
  const modalMeta = document.getElementById('modalMeta');
  const modalCopyUrlBtn = document.getElementById('modalCopyUrlBtn');
  const modalDownloadBtn = document.getElementById('modalDownloadBtn');
  const zoomControls = document.getElementById('zoomControls');
  const zoomInBtn = document.getElementById('zoomInBtn');
  const zoomOutBtn = document.getElementById('zoomOutBtn');
  const zoomResetBtn = document.getElementById('zoomResetBtn');
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  const themeIconSun = document.getElementById('themeIconSun');
  const themeIconMoon = document.getElementById('themeIconMoon');
  const themeSelect = document.getElementById('themeSelect');

  let currentPreviewItem = null;
  let activeTheme = 'dark'; // 'dark' | 'light' | 'system'

  init();

  async function init() {
    await initTheme();
    setupEventListeners();
    await scanActiveTab();
  }

  function setupEventListeners() {
    // Deep Scan & Auto-Scroll
    deepScanBtn.addEventListener('click', async () => {
      await runDeepScan();
    });

    rescanBtn.addEventListener('click', () => {
      scanActiveTab();
    });

    settingsBtn.addEventListener('click', () => {
      settingsDrawer.classList.toggle('hidden');
    });

    minDimFilter.addEventListener('change', (e) => {
      minDimension = parseInt(e.target.value, 10) || 0;
      applyFilters();
    });

    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.trim().toLowerCase();
      clearSearchBtn.classList.toggle('hidden', searchQuery.length === 0);
      applyFilters();
    });

    clearSearchBtn.addEventListener('click', () => {
      searchInput.value = '';
      searchQuery = '';
      clearSearchBtn.classList.add('hidden');
      applyFilters();
    });

    categoryTabs.addEventListener('click', (e) => {
      const tabBtn = e.target.closest('.tab');
      if (!tabBtn) return;
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tabBtn.classList.add('active');
      currentTabFilter = tabBtn.dataset.type;
      applyFilters();
    });

    selectAllCheckbox.addEventListener('change', (e) => {
      if (e.target.checked) {
        filteredMedia.forEach(item => selectedIds.add(item.id));
      } else {
        selectedIds.clear();
      }
      updateSelectionUI();
      renderMediaCards();
    });

    exportCsvBtn.addEventListener('click', exportToCsv);

    copyLinksBtn.addEventListener('click', () => {
      const urls = getSelectedItems().map(item => item.url);
      if (!urls.length) {
        showToast('No items selected', 2000);
        return;
      }
      navigator.clipboard.writeText(urls.join('\n')).then(() => {
        showToast(`Copied ${urls.length} link(s) to clipboard!`);
      });
    });

    downloadZipBtn.addEventListener('click', downloadAsZip);

    // Theme Toggling
    themeToggleBtn.addEventListener('click', () => {
      const currentEffective = getEffectiveTheme();
      const nextTheme = currentEffective === 'dark' ? 'light' : 'dark';
      setTheme(nextTheme, true);
    });

    themeSelect.addEventListener('change', (e) => {
      setTheme(e.target.value, true);
    });

    // Zoom Controls
    zoomInBtn.addEventListener('click', () => setZoom(currentZoom + 0.35));
    zoomOutBtn.addEventListener('click', () => setZoom(Math.max(0.5, currentZoom - 0.35)));
    zoomResetBtn.addEventListener('click', () => setZoom(1));

    modalCloseBtn.addEventListener('click', closeModal);
    modalBackdrop.addEventListener('click', closeModal);
    modalCopyUrlBtn.addEventListener('click', () => {
      if (currentPreviewItem) {
        navigator.clipboard.writeText(currentPreviewItem.url).then(() => {
          showToast('Link copied to clipboard!');
        });
      }
    });
    modalDownloadBtn.addEventListener('click', () => {
      if (currentPreviewItem) {
        downloadSingle(currentPreviewItem);
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !previewModal.classList.contains('hidden')) {
        closeModal();
      }
    });
  }

  // Theme Management
  async function initTheme() {
    try {
      const stored = await new Promise(resolve => {
        chrome.storage.local.get(['omni_theme'], (res) => {
          resolve((res && res.omni_theme) || 'dark');
        });
      });
      activeTheme = stored || 'dark';
    } catch (e) {
      activeTheme = 'dark';
    }

    applyTheme(activeTheme);

    // Listen for OS system theme changes if set to system
    try {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (activeTheme === 'system') {
          applyTheme('system');
        }
      });
    } catch (e) {}
  }

  function getEffectiveTheme() {
    if (activeTheme === 'system') {
      return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    }
    return activeTheme;
  }

  function applyTheme(theme) {
    activeTheme = theme;
    let effective = theme;
    if (theme === 'system') {
      effective = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    }

    document.documentElement.setAttribute('data-theme', effective);
    if (themeSelect) themeSelect.value = theme;

    if (effective === 'dark') {
      themeIconSun.classList.remove('hidden');
      themeIconMoon.classList.add('hidden');
      themeToggleBtn.title = 'Switch to Light Theme';
    } else {
      themeIconSun.classList.add('hidden');
      themeIconMoon.classList.remove('hidden');
      themeToggleBtn.title = 'Switch to Dark Theme';
    }
  }

  function setTheme(theme, save = true) {
    applyTheme(theme);
    if (save && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ omni_theme: theme }).catch(() => {});
    }
  }

  // Deep Scan (auto-scrolls active page and rescans)
  async function runDeepScan() {
    showLoading(true, 'Auto-scrolling page to trigger lazy media...');
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.id) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: autoScrollPageForLazyMedia
        });
      }
    } catch (e) {
      console.warn('Deep scan scroll notice:', e);
    }
    showLoading(true, 'Analyzing newly captured media...');
    await scanActiveTab();
    showToast('Deep Scan complete!');
  }

  // Scan current active tab
  async function scanActiveTab() {
    showLoading(true, 'Scanning page for media...');
    mediaContainer.querySelectorAll('.media-card').forEach(c => c.remove());
    selectedIds.clear();
    updateSelectionUI();

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) {
        showError('No active browser tab found.');
        return;
      }

      const tabUrl = tab.url || '';
      if (
        tabUrl.startsWith('chrome://') ||
        tabUrl.startsWith('chrome-extension://') ||
        tabUrl.startsWith('edge://') ||
        tabUrl.startsWith('about:') ||
        tabUrl.startsWith('view-source:') ||
        tabUrl.includes('chromewebstore.google.com')
      ) {
        showError('Cannot scan internal browser pages or the Chrome Web Store.');
        return;
      }

      try {
        if (tabUrl.startsWith('http') || tabUrl.startsWith('https')) {
          pageDomain = new URL(tabUrl).hostname;
        } else if (tabUrl.startsWith('file://')) {
          pageDomain = 'Local File';
        } else {
          pageDomain = 'webpage';
        }
        siteDomainEl.textContent = pageDomain;
        siteDomainEl.title = tab.title || pageDomain;
      } catch (e) {
        siteDomainEl.textContent = 'Active Webpage';
      }

      let frameResults = [];

      try {
        frameResults = await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          func: extractAllMediaFromPage
        });
      } catch (allFramesErr) {
        try {
          frameResults = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: extractAllMediaFromPage
          });
        } catch (topFrameErr) {
          console.error('Top frame execution error:', topFrameErr);
        }
      }

      const mergedMap = new Map();
      let detectedDomain = pageDomain;
      let detectedTitle = pageTitle;

      if (frameResults && frameResults.length > 0) {
        for (const res of frameResults) {
          if (res && res.result && res.result.media) {
            if (res.result.domain && (!detectedDomain || detectedDomain === 'website')) {
              detectedDomain = res.result.domain;
            }
            if (res.result.title && (!detectedTitle || detectedTitle === 'webpage')) {
              detectedTitle = res.result.title;
            }
            for (const item of res.result.media) {
              if (item && item.url && !mergedMap.has(item.url)) {
                mergedMap.set(item.url, item);
              }
            }
          }
        }
      }

      if (mergedMap.size > 0) {
        handleScanResults({
          media: Array.from(mergedMap.values()),
          domain: detectedDomain,
          title: detectedTitle
        });

        // Update background badge counter
        chrome.runtime.sendMessage({
          action: 'SET_BADGE',
          count: mergedMap.size,
          tabId: tab.id
        }).catch(() => {});

        return;
      }

      showError('No media found on this page.');
    } catch (err) {
      console.error('Scan error:', err);
      showError('Failed to scan page. Please refresh the page and try again.');
    }
  }

  function handleScanResults(data) {
    showLoading(false);
    allMedia = data.media || [];
    if (data.domain) pageDomain = data.domain;
    if (data.title) pageTitle = data.title;

    updateTabCounts();
    applyFilters();
  }

  function updateTabCounts() {
    const counts = { all: allMedia.length, image: 0, video: 0, audio: 0, svg: 0, stream: 0 };
    allMedia.forEach(item => {
      if (counts[item.type] !== undefined) {
        counts[item.type]++;
      }
    });

    countAll.textContent = counts.all;
    countImages.textContent = counts.image;
    countVideos.textContent = counts.video;
    countAudio.textContent = counts.audio;
    countSvg.textContent = counts.svg;
    countStream.textContent = counts.stream;
  }

  function applyFilters() {
    filteredMedia = allMedia.filter(item => {
      if (currentTabFilter !== 'all' && item.type !== currentTabFilter) {
        return false;
      }

      if (minDimension > 0 && (item.type === 'image' || item.type === 'video')) {
        if (item.width > 0 && item.height > 0) {
          if (item.width < minDimension && item.height < minDimension) {
            return false;
          }
        }
      }

      if (searchQuery) {
        const nameMatch = item.filename && item.filename.toLowerCase().includes(searchQuery);
        const urlMatch = item.url && item.url.toLowerCase().includes(searchQuery);
        const titleMatch = item.title && item.title.toLowerCase().includes(searchQuery);
        if (!nameMatch && !urlMatch && !titleMatch) {
          return false;
        }
      }

      return true;
    });

    renderMediaCards();
    updateSelectionUI();
  }

  function renderMediaCards() {
    mediaContainer.querySelectorAll('.media-card').forEach(c => c.remove());

    if (filteredMedia.length === 0) {
      emptyState.classList.remove('hidden');
      return;
    }
    emptyState.classList.add('hidden');

    const fragment = document.createDocumentFragment();

    filteredMedia.forEach(item => {
      const isSelected = selectedIds.has(item.id);

      const card = document.createElement('div');
      card.className = `media-card ${isSelected ? 'selected' : ''}`;
      card.dataset.id = item.id;

      const selectOverlay = document.createElement('label');
      selectOverlay.className = 'card-select-overlay';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = isSelected;
      checkbox.addEventListener('change', (e) => {
        e.stopPropagation();
        toggleSelectItem(item.id, checkbox.checked);
      });
      selectOverlay.appendChild(checkbox);
      card.appendChild(selectOverlay);

      const badgeType = document.createElement('span');
      badgeType.className = `card-badge-type type-${item.type}`;
      badgeType.textContent = item.type;
      card.appendChild(badgeType);

      const thumbWrap = document.createElement('div');
      thumbWrap.className = 'card-thumb-wrap';
      thumbWrap.addEventListener('click', () => openPreview(item));

      if (item.type === 'image' || item.type === 'svg') {
        const img = document.createElement('img');
        img.className = 'card-thumb';
        img.src = item.url;
        img.loading = 'lazy';
        img.alt = item.title || item.filename;
        img.onerror = () => {
          img.replaceWith(createFallbackIcon(item.type));
        };
        thumbWrap.appendChild(img);
      } else if (item.type === 'video') {
        const video = document.createElement('video');
        video.className = 'card-thumb';
        video.src = item.url;
        video.muted = true;
        video.preload = 'metadata';
        video.onerror = () => {
          video.replaceWith(createFallbackIcon('video'));
        };
        thumbWrap.appendChild(video);
      } else if (item.type === 'stream') {
        thumbWrap.appendChild(createFallbackIcon('stream'));
      } else {
        thumbWrap.appendChild(createFallbackIcon('audio'));
      }

      if (item.width && item.height) {
        const dimBadge = document.createElement('span');
        dimBadge.className = 'card-badge-dim';
        dimBadge.textContent = `${item.width}×${item.height}`;
        thumbWrap.appendChild(dimBadge);
      }

      card.appendChild(thumbWrap);

      const footer = document.createElement('div');
      footer.className = 'card-footer';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'card-name';
      nameSpan.textContent = item.filename;
      nameSpan.title = `${item.filename}\n${item.url}`;
      footer.appendChild(nameSpan);

      const actions = document.createElement('div');
      actions.className = 'card-actions';

      const previewBtn = document.createElement('button');
      previewBtn.className = 'card-action-btn';
      previewBtn.title = 'Preview';
      previewBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
          <circle cx="12" cy="12" r="3"></circle>
        </svg>`;
      previewBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openPreview(item);
      });
      actions.appendChild(previewBtn);

      const downloadBtn = document.createElement('button');
      downloadBtn.className = 'card-action-btn';
      downloadBtn.title = 'Download';
      downloadBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>`;
      downloadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        downloadSingle(item);
      });
      actions.appendChild(downloadBtn);

      footer.appendChild(actions);
      card.appendChild(footer);

      fragment.appendChild(card);
    });

    mediaContainer.appendChild(fragment);
  }

  function createFallbackIcon(type) {
    const icon = document.createElement('div');
    icon.className = 'card-media-icon';
    if (type === 'video') {
      icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
    } else if (type === 'audio') {
      icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>`;
    } else if (type === 'stream') {
      icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="2"></circle><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"></path></svg>`;
    } else {
      icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>`;
    }
    return icon;
  }

  function toggleSelectItem(id, isSelected) {
    if (isSelected) {
      selectedIds.add(id);
    } else {
      selectedIds.delete(id);
    }
    updateSelectionUI();
    const card = mediaContainer.querySelector(`.media-card[data-id="${id}"]`);
    if (card) {
      card.classList.toggle('selected', isSelected);
      const cb = card.querySelector('.card-select-overlay input');
      if (cb) cb.checked = isSelected;
    }
  }

  function updateSelectionUI() {
    const totalVisible = filteredMedia.length;
    const selectedVisibleCount = filteredMedia.filter(m => selectedIds.has(m.id)).length;

    selectedCount.textContent = selectedVisibleCount;
    downloadSelectedBtn.disabled = selectedVisibleCount === 0;
    downloadZipBtn.disabled = selectedVisibleCount === 0;

    if (totalVisible === 0) {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = false;
      selectionStatus.textContent = 'Select All';
    } else if (selectedVisibleCount === totalVisible) {
      selectAllCheckbox.checked = true;
      selectAllCheckbox.indeterminate = false;
      selectionStatus.textContent = 'Deselect All';
    } else if (selectedVisibleCount > 0) {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = true;
      selectionStatus.textContent = `${selectedVisibleCount} Selected`;
    } else {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = false;
      selectionStatus.textContent = 'Select All';
    }
  }

  function getSelectedItems() {
    return filteredMedia.filter(item => selectedIds.has(item.id));
  }

  function getSubfolder() {
    if (subfolderToggle.checked) {
      let clean = pageDomain.replace(/[/\\?%*:|"<>]/g, '_').trim();
      clean = clean.replace(/^\.+|\.+$/g, '').replace(/_+/g, '_');
      return `Media_${clean}`;
    }
    return '';
  }

  function sanitizeFilename(name, defaultExt = 'jpg') {
    if (!name) return `media_${Date.now()}.${defaultExt}`;
    let clean = name.split(/[?#]/)[0];
    if (clean.includes('/')) clean = clean.substring(clean.lastIndexOf('/') + 1);
    if (clean.includes('\\')) clean = clean.substring(clean.lastIndexOf('\\') + 1);
    clean = clean.replace(/[/\\?%*:|"<>]/g, '_').trim();
    clean = clean.replace(/^\.+|\.+$/g, '');
    if (!clean) clean = `media_${Date.now()}.${defaultExt}`;
    if (!clean.includes('.')) clean = `${clean}.${defaultExt}`;
    return clean;
  }

  function normalizeDataUrl(url) {
    if (!url || !url.startsWith('data:')) return url;
    if (url.startsWith('data:image/svg+xml') && !url.includes(';base64,')) {
      try {
        const parts = url.split(',');
        if (parts.length >= 2) {
          const rawContent = decodeURIComponent(parts.slice(1).join(','));
          const base64 = btoa(unescape(encodeURIComponent(rawContent)));
          return `data:image/svg+xml;base64,${base64}`;
        }
      } catch (e) {}
    }
    return url;
  }

  function downloadViaAnchor(url, filename) {
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => a.remove(), 1000);
      return true;
    } catch (e) {
      return false;
    }
  }

  async function downloadItem(item) {
    const cleanName = sanitizeFilename(item.filename, item.type === 'video' ? 'mp4' : item.type === 'audio' ? 'mp3' : 'jpg');
    const cleanUrl = normalizeDataUrl(item.url);
    const subfolder = getSubfolder();
    const fullPath = subfolder ? `${subfolder}/${cleanName}` : cleanName;

    // Strategy 1: chrome.downloads
    if (chrome.downloads && typeof chrome.downloads.download === 'function') {
      try {
        const downloadId = await new Promise((resolve, reject) => {
          chrome.downloads.download({
            url: cleanUrl,
            filename: fullPath,
            conflictAction: 'uniquify',
            saveAs: false
          }, (id) => {
            if (chrome.runtime.lastError || !id) {
              reject(chrome.runtime.lastError || new Error('Direct download failed'));
            } else {
              resolve(id);
            }
          });
        });
        if (downloadId) return { success: true };
      } catch (err1) {
        try {
          const downloadId2 = await new Promise((resolve, reject) => {
            chrome.downloads.download({
              url: cleanUrl,
              filename: cleanName,
              conflictAction: 'uniquify',
              saveAs: false
            }, (id) => {
              if (chrome.runtime.lastError || !id) {
                reject(chrome.runtime.lastError || new Error('Direct download without folder failed'));
              } else {
                resolve(id);
              }
            });
          });
          if (downloadId2) return { success: true };
        } catch (err2) {}
      }
    }

    // Strategy 2: Background service worker
    try {
      const bgResponse = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          action: 'DOWNLOAD_SINGLE',
          url: cleanUrl,
          filename: cleanName,
          subfolder: subfolder
        }, (res) => {
          if (chrome.runtime.lastError) {
            resolve(null);
          } else {
            resolve(res);
          }
        });
      });
      if (bgResponse && bgResponse.success) return { success: true };
    } catch (err3) {}

    // Strategy 3: Anchor fallback
    const anchorSuccess = downloadViaAnchor(cleanUrl, cleanName);
    if (anchorSuccess) return { success: true };

    return { success: false, error: 'Could not download file.' };
  }

  async function downloadSingle(item) {
    showToast(`Downloading ${item.filename}...`);
    const res = await downloadItem(item);
    if (res.success) {
      showToast(`Downloaded: ${item.filename}`);
    } else {
      showToast(`Failed to download: ${res.error || 'Error'}`);
    }
  }

  async function downloadBatch(items) {
    if (!items.length) return;

    showToast(`Downloading ${items.length} file(s)...`, 5000);
    downloadSelectedBtn.disabled = true;

    let completed = 0;
    let failed = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const res = await downloadItem(item);
      if (res.success) completed++;
      else failed++;
      showToast(`Downloaded ${completed}/${items.length}...`, 2000);
      await new Promise(r => setTimeout(r, 120));
    }

    downloadSelectedBtn.disabled = false;
    showToast(`Completed! ${completed} downloaded, ${failed} failed.`, 4000);
  }

  // Feature: Download Selected as .ZIP archive
  async function downloadAsZip() {
    const items = getSelectedItems();
    if (!items.length) return;

    showToast(`Preparing ZIP archive for ${items.length} file(s)...`, 10000);
    downloadZipBtn.disabled = true;

    try {
      const zip = new window.ZipBuilder();
      let fetchedCount = 0;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const filename = sanitizeFilename(item.filename, item.type === 'video' ? 'mp4' : item.type === 'audio' ? 'mp3' : 'jpg');
        
        try {
          if (item.url.startsWith('data:')) {
            await zip.addFile(filename, item.url);
            fetchedCount++;
          } else {
            const res = await fetch(item.url);
            if (res.ok) {
              const blob = await res.blob();
              await zip.addFile(filename, blob);
              fetchedCount++;
            }
          }
        } catch (fetchErr) {
          console.warn(`Could not add ${filename} to ZIP:`, fetchErr);
        }

        showToast(`Packaging ZIP: ${i + 1}/${items.length} files...`, 3000);
      }

      if (fetchedCount === 0) {
        showToast('Could not bundle files into ZIP.');
        downloadZipBtn.disabled = false;
        return;
      }

      showToast('Compressing archive...', 5000);
      const zipBlob = await zip.generateAsync((pct) => {
        showToast(`Compressing: ${pct}%...`, 2000);
      });

      const zipUrl = URL.createObjectURL(zipBlob);
      const dateStr = new Date().toISOString().slice(0, 10);
      const zipFilename = `Media_${pageDomain}_${dateStr}.zip`;

      const downloadSuccess = downloadViaAnchor(zipUrl, zipFilename);
      if (downloadSuccess) {
        showToast(`ZIP created: ${zipFilename} (${(zipBlob.size / (1024 * 1024)).toFixed(1)} MB)!`, 4000);
      } else {
        showToast('ZIP download initiated.');
      }
      setTimeout(() => URL.revokeObjectURL(zipUrl), 30000);
    } catch (zipErr) {
      console.error('ZIP generation error:', zipErr);
      showToast('Failed to create ZIP archive.');
    } finally {
      downloadZipBtn.disabled = false;
    }
  }

  // Feature: Export detected media list to CSV spreadsheet
  function exportToCsv() {
    if (!allMedia.length) {
      showToast('No media items to export.');
      return;
    }

    const headers = ['ID', 'Type', 'Filename', 'Width', 'Height', 'Source', 'URL'];
    const rows = allMedia.map(m => [
      m.id,
      m.type,
      `"${(m.filename || '').replace(/"/g, '""')}"`,
      m.width || 0,
      m.height || 0,
      `"${(m.source || '').replace(/"/g, '""')}"`,
      `"${(m.url || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `media_list_${pageDomain}_${dateStr}.csv`;

    downloadViaAnchor(url, filename);
    showToast(`Exported ${allMedia.length} items to CSV!`);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // Feature: Interactive Zoom & Pan in Modal
  function setZoom(level) {
    currentZoom = level;
    const zoomLevelText = document.getElementById('zoomLevelText');
    if (zoomLevelText) zoomLevelText.textContent = `${Math.round(currentZoom * 100)}%`;
    const img = modalBody.querySelector('img');
    if (img) {
      img.style.transform = `scale(${currentZoom})`;
      img.classList.toggle('zoomed', currentZoom > 1);
    }
  }

  function openPreview(item) {
    currentPreviewItem = item;
    modalBody.innerHTML = '';
    modalFilename.textContent = item.filename;
    modalMeta.textContent = `${item.type.toUpperCase()} • ${item.width && item.height ? `${item.width}×${item.height}px` : 'Dynamic size'} • Source: ${item.source}`;

    currentZoom = 1;
    const zoomLevelText = document.getElementById('zoomLevelText');
    if (zoomLevelText) zoomLevelText.textContent = '100%';

    if (item.type === 'video') {
      zoomControls.classList.add('hidden');
      const video = document.createElement('video');
      video.src = item.url;
      video.controls = true;
      video.autoplay = true;
      modalBody.appendChild(video);
    } else if (item.type === 'audio') {
      zoomControls.classList.add('hidden');
      const audio = document.createElement('audio');
      audio.src = item.url;
      audio.controls = true;
      audio.autoplay = true;
      modalBody.appendChild(audio);
    } else if (item.type === 'stream') {
      zoomControls.classList.add('hidden');
      const streamBox = document.createElement('div');
      streamBox.style.cssText = 'padding: 20px; text-align: center; color: var(--text-primary);';
      streamBox.innerHTML = `
        <svg style="width: 48px; height: 48px; color: #7c3aed;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="2"></circle><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"></path></svg>
        <h4 style="margin: 10px 0 6px; font-size: 14px;">HLS / Adaptive Stream Detected</h4>
        <p style="font-size: 11px; color: var(--text-muted); word-break: break-all; max-width: 320px;">${item.url}</p>
      `;
      modalBody.appendChild(streamBox);
    } else {
      // Image or SVG
      zoomControls.classList.remove('hidden');
      const img = document.createElement('img');
      img.src = item.url;
      img.alt = item.filename;

      // Mouse drag to pan zoomed image
      modalBody.addEventListener('mousedown', (e) => {
        if (currentZoom > 1) {
          isDragging = true;
          startX = e.pageX - modalBody.offsetLeft;
          startY = e.pageY - modalBody.offsetTop;
          scrollLeft = modalBody.scrollLeft;
          scrollTop = modalBody.scrollTop;
          img.style.cursor = 'grabbing';
        }
      });
      modalBody.addEventListener('mouseleave', () => { isDragging = false; });
      modalBody.addEventListener('mouseup', () => {
        isDragging = false;
        if (img) img.style.cursor = currentZoom > 1 ? 'grab' : 'default';
      });
      modalBody.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        e.preventDefault();
        const x = e.pageX - modalBody.offsetLeft;
        const y = e.pageY - modalBody.offsetTop;
        const walkX = (x - startX) * 1.5;
        const walkY = (y - startY) * 1.5;
        modalBody.scrollLeft = scrollLeft - walkX;
        modalBody.scrollTop = scrollTop - walkY;
      });

      modalBody.appendChild(img);
    }

    previewModal.classList.remove('hidden');
  }

  function closeModal() {
    previewModal.classList.add('hidden');
    modalBody.querySelectorAll('video, audio').forEach(media => {
      media.pause();
      media.src = '';
    });
    modalBody.innerHTML = '';
    currentPreviewItem = null;
  }

  function showLoading(isLoading, customText) {
    loadingState.classList.toggle('hidden', !isLoading);
    if (customText) {
      loadingText.textContent = customText;
    } else {
      loadingText.textContent = 'Scanning page for media...';
    }
    if (isLoading) {
      emptyState.classList.add('hidden');
    }
  }

  function showError(message) {
    showLoading(false);
    emptyState.classList.remove('hidden');
    emptyState.querySelector('h3').textContent = 'Cannot scan media';
    emptyState.querySelector('p').textContent = message;
  }

  function showToast(msg, duration = 3000) {
    toastMsg.textContent = msg;
    toast.classList.remove('hidden');
    setTimeout(() => {
      toast.classList.add('hidden');
    }, duration);
  }
});
