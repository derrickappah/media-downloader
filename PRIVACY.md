# Privacy Policy for Media Downloader

**Last Updated: August 23, 2026**

Media Downloader ("we", "our", or "the extension") is committed to protecting your privacy. This Privacy Policy outlines our data handling practices for the Media Downloader Chrome Extension.

---

## 1. Zero Data Collection

Media Downloader does **not** collect, store, transmit, sell, or share any personal information, browsing history, user credentials, or usage analytics.

- **No Tracking**: We do not include any tracking pixels, telemetry, or analytics software.
- **No Remote Servers**: The extension communicates solely between your browser and the web pages you actively visit to download media files directly to your device.
- **No Third-Party Sharing**: We do not sell, rent, or transfer any user data to third parties.

---

## 2. Permissions & Data Handling

All permissions requested by Media Downloader are strictly used to fulfill its core functionality on your local device:

- **`activeTab` & `scripting`**: Used exclusively to inspect and detect media elements (images, videos, audio tracks, SVGs, canvas, and streams) on the currently active tab when you click the extension.
- **`downloads`**: Used to save the media files or generated ZIP archives directly to your local computer's download folder.
- **`storage`**: Used to store your local extension preferences (such as Dark/Light theme selection and minimum dimension filters) locally on your device via `chrome.storage.local`.
- **`tabs`**: Used to identify the domain of the active tab for creating organized subfolders (e.g. `Downloads/Media_domain.com/`).
- **Host Permissions (`<all_urls>`)**: Used solely to allow the media detection script to scan media assets across any standard webpage and its embedded media frames.

---

## 3. Remote Code Policy

Media Downloader contains **zero remote code**. All JavaScript, styles, and libraries are completely self-contained within the extension package installed on your computer.

---

## 4. Third-Party Websites

When downloading media, files are fetched directly from the respective third-party hosting server (e.g. image or video CDN) that provides the media content on the page you are viewing. We have no control over the privacy practices of external websites.

---

## 5. Contact & Support

If you have any questions, feedback, or concerns regarding this Privacy Policy, please open an issue on our GitHub repository:
- **Repository**: [https://github.com/derrickappah/media-downloader](https://github.com/derrickappah/media-downloader)
- **Support**: [https://github.com/derrickappah/media-downloader/issues](https://github.com/derrickappah/media-downloader/issues)
