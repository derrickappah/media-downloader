/**
 * OmniMedia Downloader - Background Service Worker
 * Manages downloads, file naming, directory organization, batch queuing,
 * toolbar badge counters, and context menus.
 */

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

function sanitizeFolder(folder) {
  if (!folder) return '';
  let clean = folder.replace(/[/\\?%*:|"<>]/g, '_').trim();
  clean = clean.replace(/^\.+|\.+$/g, '').replace(/_+/g, '_');
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

async function triggerDownload(url, filename, subfolder) {
  let cleanName = sanitizeFilename(filename);
  let cleanUrl = normalizeDataUrl(url);
  let targetPath = cleanName;

  const cleanSub = sanitizeFolder(subfolder);
  if (cleanSub) {
    targetPath = `${cleanSub}/${cleanName}`;
  }

  return new Promise((resolve) => {
    chrome.downloads.download({
      url: cleanUrl,
      filename: targetPath,
      conflictAction: 'uniquify',
      saveAs: false
    }, (downloadId) => {
      if (!chrome.runtime.lastError && downloadId) {
        return resolve({ success: true, downloadId });
      }

      if (cleanSub) {
        chrome.downloads.download({
          url: cleanUrl,
          filename: cleanName,
          conflictAction: 'uniquify',
          saveAs: false
        }, (id2) => {
          if (!chrome.runtime.lastError && id2) {
            return resolve({ success: true, downloadId: id2 });
          }
          fetchAndDownloadBlob(cleanUrl, cleanName).then(resolve);
        });
      } else {
        fetchAndDownloadBlob(cleanUrl, cleanName).then(resolve);
      }
    });
  });
}

async function fetchAndDownloadBlob(url, filename) {
  try {
    const res = await fetch(url);
    if (!res.ok) return { success: false, error: `HTTP error ${res.status}` };
    const blob = await res.blob();
    const reader = new FileReader();
    
    return new Promise((resolve) => {
      reader.onloadend = () => {
        const base64data = reader.result;
        chrome.downloads.download({
          url: base64data,
          filename: filename,
          conflictAction: 'uniquify',
          saveAs: false
        }, (id) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve({ success: true, downloadId: id });
          }
        });
      };
      reader.onerror = () => {
        resolve({ success: false, error: 'Failed to read media blob' });
      };
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Badge styling
chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });

// Message dispatcher
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'SET_BADGE') {
    const count = message.count || 0;
    const tabId = (sender.tab && sender.tab.id) || message.tabId;
    if (tabId) {
      chrome.action.setBadgeText({
        text: count > 0 ? (count > 999 ? '999+' : count.toString()) : '',
        tabId: tabId
      });
    }
    sendResponse({ success: true });
    return false;
  }

  if (message.action === 'DOWNLOAD_SINGLE') {
    const { url, filename, subfolder } = message;
    triggerDownload(url, filename, subfolder).then(sendResponse);
    return true;
  }

  if (message.action === 'DOWNLOAD_BATCH') {
    const { items, subfolder } = message;
    if (!items || !items.length) {
      sendResponse({ success: false, error: 'No items provided for download.' });
      return true;
    }

    let completed = 0;
    let failed = 0;
    const errors = [];

    async function processBatch() {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const res = await triggerDownload(item.url, item.filename, subfolder);
        if (res.success) completed++;
        else {
          failed++;
          errors.push({ filename: item.filename, error: res.error });
        }
        await new Promise(r => setTimeout(r, 120));
      }

      sendResponse({
        success: true,
        total: items.length,
        completed,
        failed,
        errors
      });
    }

    processBatch();
    return true;
  }
});

// Setup Context Menus
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'omni-media-open-downloader',
    title: 'Media Downloader: Scan Page',
    contexts: ['page', 'image', 'video', 'audio', 'link']
  });

  if (chrome.sidePanel && typeof chrome.sidePanel.setPanelBehavior === 'function') {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'omni-media-open-downloader') {
    chrome.action.openPopup().catch(() => {});
  }
});
