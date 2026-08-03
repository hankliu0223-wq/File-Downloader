(function attachContentScanner(global) {
  "use strict";

  if (global.__pdfAutoDownloaderScanner) {
    global.__pdfAutoDownloaderScanner.rescanSoon();
    return;
  }

  const root = global.PdfAutoDownloader || (global.PdfAutoDownloader = {});
  const Filename = root.filename;
  const Moodle = root.moodle;
  const Dedupe = root.dedupe;

  const MAX_ANCHORS_PER_SCAN = 1600;
  const SCAN_DEBOUNCE_MS = 650;
  const ACTIVITY_SELECTOR = [
    ".activity",
    ".activity-item",
    ".modtype_resource",
    ".modtype_folder",
    "li.activity",
    "[data-activityname]",
    "[data-region='activity-card']",
    "[data-for='section']"
  ].join(",");

  let cachedResult = null;
  let scanTimer = null;
  let observer = null;
  let lastSignature = "";

  function collectCandidateText(anchor) {
    const parts = [];
    const activity = anchor.closest(ACTIVITY_SELECTOR);

    for (const attribute of ["aria-label", "title", "data-activityname"]) {
      const value = anchor.getAttribute(attribute) || (activity && activity.getAttribute(attribute));
      if (value) parts.push(value);
    }

    if (anchor.textContent) parts.push(anchor.textContent);

    if (activity && activity.textContent) {
      parts.push(activity.textContent);
    } else if (anchor.parentElement && anchor.parentElement.textContent) {
      parts.push(anchor.parentElement.textContent);
    }

    return Filename.normalizeText(parts.join(" "), 180);
  }

  function pickDisplayName(anchor, classification) {
    const activity = anchor.closest(ACTIVITY_SELECTOR);
    const values = [
      anchor.getAttribute("aria-label"),
      anchor.getAttribute("title"),
      activity ? activity.getAttribute("data-activityname") : "",
      anchor.textContent,
      activity ? activity.textContent : "",
      anchor.parentElement ? anchor.parentElement.textContent : ""
    ];

    for (const value of values) {
      const cleaned = Filename.normalizeText(value || "", 90)
        .replace(/\b(File|Resource|Folder)\b\s*/gi, "")
        .replace(/\bPDF|PPTX|DOCX|DOC\b$/i, "")
        .trim();

      if (cleaned && cleaned.length >= 2) return cleaned;
    }

    const fromUrl = Filename.getFilenameFromUrl(anchor.href);
    if (fromUrl) return fromUrl.replace(/\.[^.]+$/, "");

    if (classification.kind === "folder") return "Moodle folder";
    if (classification.kind === "resource") return "Moodle resource";
    return "download";
  }

  function shouldIncludeAnchor(anchor, classification, nearbyText) {
    if (!classification || !classification.isSupported) {
      const textType = Filename.getFileTypeFromName(nearbyText);
      return Boolean(textType);
    }

    return ["direct", "pluginfile", "resource", "folder"].includes(classification.kind);
  }

  function buildCandidate(anchor) {
    const rawHref = anchor.getAttribute("href");
    if (!rawHref) return null;

    let sourceUrl;
    try {
      sourceUrl = new URL(rawHref, document.baseURI).href;
    } catch (error) {
      return null;
    }

    if (!Moodle.isHttpUrl(sourceUrl)) return null;

    // The content script only collects candidates and readable labels. Final
    // MIME/header checks happen in the background service worker.
    const classification = Moodle.classifyUrl(sourceUrl);
    const nearbyText = collectCandidateText(anchor);
    if (!shouldIncludeAnchor(anchor, classification, nearbyText)) return null;

    const fileType = classification.fileType || Filename.getFileTypeFromName(nearbyText);
    const displayName = pickDisplayName(anchor, classification);
    const guessedFilename = Filename.chooseFilename({
      url: sourceUrl,
      displayName,
      fileType
    });

    return {
      id: Dedupe.simpleHash([classification.kind, sourceUrl, displayName].join("|")),
      sourceUrl,
      kind: classification.kind,
      resourceId: classification.resourceId,
      folderId: classification.folderId,
      fileType,
      displayName,
      guessedFilename,
      contextText: nearbyText,
      pageUrl: location.href,
      needsResolution: classification.kind !== "direct" || Moodle.looksLikeMoodleUrl(sourceUrl)
    };
  }

  function scanDom() {
    // Keep scans bounded so large Moodle pages do not freeze while users expand
    // or collapse course sections.
    const anchors = Array.from(document.querySelectorAll("a[href]")).slice(0, MAX_ANCHORS_PER_SCAN);
    const candidates = [];

    for (const anchor of anchors) {
      const candidate = buildCandidate(anchor);
      if (candidate) candidates.push(candidate);
    }

    const uniqueCandidates = Dedupe.dedupeItems(candidates);
    const courseTitle = Moodle.getCourseTitle(document);

    cachedResult = {
      ok: true,
      pageUrl: location.href,
      pageTitle: document.title || "",
      courseTitle,
      isMoodle: Moodle.isMoodleDocument(document) || Moodle.looksLikeMoodleUrl(location.href),
      candidates: uniqueCandidates
    };

    const signature = uniqueCandidates.map(function getKey(item) {
      return Dedupe.candidateKey(item);
    }).sort().join("|");

    if (signature && signature !== lastSignature) {
      lastSignature = signature;
      notifyPageChanged();
    }

    return cachedResult;
  }

  function notifyPageChanged() {
    if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) return;

    chrome.runtime.sendMessage({
      type: "PAD_PAGE_CHANGED",
      pageUrl: location.href,
      candidateCount: cachedResult ? cachedResult.candidates.length : 0
    }, function ignoreMissingPopup() {
      void chrome.runtime.lastError;
    });
  }

  function rescanSoon() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(function runDebouncedScan() {
      if ("requestIdleCallback" in global) {
        global.requestIdleCallback(scanDom, { timeout: 1200 });
      } else {
        scanDom();
      }
    }, SCAN_DEBOUNCE_MS);
  }

  function handleMessage(message, _sender, sendResponse) {
    if (!message || message.type !== "PAD_SCAN_NOW") return false;

    try {
      sendResponse(scanDom());
    } catch (error) {
      sendResponse({
        ok: false,
        error: error && error.message ? error.message : String(error)
      });
    }

    return true;
  }

  function startObserver() {
    // Moodle can lazy-load or reveal section content after the first page load.
    // The observer only schedules a debounced scan; it does not fetch files.
    observer = new MutationObserver(function handleMutations(mutations) {
      for (const mutation of mutations) {
        if (mutation.type === "childList" && (mutation.addedNodes.length || mutation.removedNodes.length)) {
          rescanSoon();
          return;
        }

        if (mutation.type === "attributes") {
          rescanSoon();
          return;
        }
      }
    });

    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["href", "aria-expanded", "class", "style"]
    });
  }

  chrome.runtime.onMessage.addListener(handleMessage);
  startObserver();
  rescanSoon();

  global.__pdfAutoDownloaderScanner = {
    getCachedResult: function getCachedResult() {
      return cachedResult || scanDom();
    },
    rescanSoon,
    stop: function stop() {
      clearTimeout(scanTimer);
      if (observer) observer.disconnect();
    }
  };
})(globalThis);
