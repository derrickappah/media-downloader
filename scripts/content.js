/**
 * Media Downloader - Advanced In-Page Media Scanner
 */

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

    // 2. Meta Tags (og:image, og:video, twitter:image)
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

    // 3. Scan JSON-LD and structured data
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

window.__extractAllMediaFromPage = extractAllMediaFromPage;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'SCAN_MEDIA') {
    try {
      const mediaData = extractAllMediaFromPage();
      sendResponse({ success: true, data: mediaData });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
  }
  return true;
});
