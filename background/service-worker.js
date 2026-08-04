importScripts("../utils/filename.js", "../utils/moodle-detector.js", "../utils/dedupe.js");

(function attachServiceWorker(global) {
  "use strict";

  const root = global.PdfAutoDownloader;
  const Filename = root.filename;
  const Moodle = root.moodle;
  const Dedupe = root.dedupe;
  const MAX_RESOLVE_CONCURRENCY = 4;

  chrome.runtime.onMessage.addListener(function handleMessage(message, sender, sendResponse) {
    if (!message || !message.type) return false;

    if (message.type === "PAD_RESOLVE_CANDIDATES") {
      resolveCandidates(message.candidates || [], message.context || {})
        .then(function sendSuccess(files) {
          sendResponse({ ok: true, files });
        })
        .catch(function sendFailure(error) {
          sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
        });
      return true;
    }

    if (message.type === "PAD_DOWNLOAD_FILES") {
      downloadFiles(message.files || [])
        .then(function sendDownloadSuccess(result) {
          sendResponse({ ok: true, result });
        })
        .catch(function sendDownloadFailure(error) {
          sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
        });
      return true;
    }

    return false;
  });

  async function mapWithConcurrency(items, limit, worker) {
    const results = new Array(items.length);
    let nextIndex = 0;

    async function runWorker() {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await worker(items[currentIndex], currentIndex);
      }
    }

    const workers = Array.from({ length: Math.min(limit, items.length) }, runWorker);
    await Promise.all(workers);
    return results;
  }

  async function resolveCandidates(candidates, context) {
    const uniqueCandidates = Dedupe.dedupeItems(candidates);
    const resolvedGroups = await mapWithConcurrency(uniqueCandidates, MAX_RESOLVE_CONCURRENCY, function resolveOne(candidate) {
      return resolveCandidate(candidate, context);
    });

    const files = Dedupe.dedupeItems(resolvedGroups.flat()).map(function addStableId(file, index) {
      return Object.assign({}, file, {
        id: file.id || Dedupe.simpleHash([file.downloadUrl, file.sourceUrl, index].join("|")),
        order: index + 1
      });
    });

    return files;
  }

  async function resolveCandidate(candidate, context) {
    try {
      const classification = Moodle.classifyUrl(candidate.sourceUrl);

      if (classification.kind === "folder") {
        return resolveFolder(candidate, context);
      }

      if (classification.kind === "resource") {
        return resolveResource(candidate, context);
      }

      if (classification.kind === "direct" || classification.kind === "pluginfile") {
        const file = await resolveFileLike(candidate, context, { preferGet: false });
        return file ? [file] : [manualItem(candidate, context, "File type could not be confirmed.")];
      }

      return [manualItem(candidate, context, "This link is not a supported file or Moodle resource.")];
    } catch (error) {
      return [manualItem(candidate, context, error && error.message ? error.message : String(error))];
    }
  }

  async function resolveResource(candidate, context) {
    // A Moodle resource can redirect directly to the file, return the file from
    // view.php, or render an HTML page with pluginfile links. Try all paths.
    const meta = await fetchMetadata(candidate.sourceUrl, { preferGet: true });
    const fileType = Filename.detectFileType({
      url: meta.finalUrl || candidate.sourceUrl,
      sourceUrl: candidate.sourceUrl,
      contentType: meta.contentType,
      contentDisposition: meta.contentDisposition,
      fallbackFilename: candidate.guessedFilename || candidate.displayName
    });

    if (Filename.SUPPORTED_TYPES.includes(fileType)) {
      return [fileFromMetadata(candidate, context, meta, fileType)];
    }

    if (isHtmlMeta(meta)) {
      const links = await extractFileLinksFromPage(candidate.sourceUrl);
      if (links.length) {
        const linkedFiles = await mapWithConcurrency(links, MAX_RESOLVE_CONCURRENCY, function resolveLinked(link) {
          return resolveFileLike(linkToCandidate(link, candidate), context, { preferGet: false });
        });
        return linkedFiles.filter(Boolean);
      }
    }

    return [manualItem(candidate, context, "Resource did not expose a supported final file.")];
  }

  async function resolveFolder(candidate, context) {
    // Folder support parses the authenticated folder page and resolves each
    // listed pluginfile/direct link independently.
    const links = await extractFileLinksFromPage(candidate.sourceUrl);
    if (!links.length) {
      return [manualItem(candidate, context, "Folder page did not list supported downloadable files.")];
    }

    const linkedFiles = await mapWithConcurrency(links, MAX_RESOLVE_CONCURRENCY, function resolveLinked(link, index) {
      const folderCandidate = linkToCandidate(link, candidate);
      folderCandidate.displayName = link.displayName || candidate.displayName + " " + (index + 1);
      return resolveFileLike(folderCandidate, context, { preferGet: false });
    });

    return linkedFiles.filter(Boolean);
  }

  async function resolveFileLike(candidate, context, options) {
    const meta = await fetchMetadata(candidate.sourceUrl, options || {});
    const fileType = Filename.detectFileType({
      url: meta.finalUrl || candidate.sourceUrl,
      sourceUrl: candidate.sourceUrl,
      contentType: meta.contentType,
      contentDisposition: meta.contentDisposition,
      fallbackFilename: candidate.guessedFilename || candidate.displayName
    }) || candidate.fileType;

    if (!Filename.SUPPORTED_TYPES.includes(fileType)) return null;
    return fileFromMetadata(candidate, context, meta, fileType);
  }

  async function fetchMetadata(url, options) {
    // Prefer HEAD when possible, then fall back to GET with Range. This follows
    // redirects and exposes headers without intentionally downloading the file.
    const settings = options || {};
    const attempts = settings.preferGet ? ["GET_RANGE", "HEAD"] : ["HEAD", "GET_RANGE"];
    let lastError = null;

    for (let index = 0; index < attempts.length; index += 1) {
      const attempt = attempts[index];
      try {
        const meta = await requestMetadata(url, attempt);
        const isLastAttempt = index === attempts.length - 1;
        const fileType = Filename.detectFileType({
          url: meta.finalUrl || url,
          contentType: meta.contentType,
          contentDisposition: meta.contentDisposition
        });
        const hasUsefulMetadata = Boolean(fileType || isHtmlMeta(meta) || meta.contentDisposition || meta.finalUrl !== url);

        if (meta.status === 405 || meta.status === 501) continue;
        if (!meta.ok && !isLastAttempt) continue;
        if (hasUsefulMetadata || isLastAttempt) return meta;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("Unable to fetch metadata.");
  }

  async function requestMetadata(url, attempt) {
    const controller = new AbortController();
    const isGetRange = attempt === "GET_RANGE";
    const response = await fetch(url, {
      method: isGetRange ? "GET" : "HEAD",
      redirect: "follow",
      credentials: "include",
      cache: "no-store",
      headers: isGetRange ? { Range: "bytes=0-0" } : {},
      signal: controller.signal
    });

    const meta = {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      finalUrl: response.url || url,
      contentType: response.headers.get("content-type") || "",
      contentDisposition: response.headers.get("content-disposition") || "",
      contentLength: response.headers.get("content-length") || ""
    };

    if (isGetRange && response.body) {
      try {
        await response.body.cancel();
      } catch (error) {
        // Some servers close the stream first; metadata is already available.
      }
      controller.abort();
    }

    return meta;
  }

  async function fetchTextPage(url) {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      credentials: "include",
      cache: "no-store"
    });

    const contentType = response.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      return { html: "", finalUrl: response.url || url, contentType };
    }

    return {
      html: await response.text(),
      finalUrl: response.url || url,
      contentType
    };
  }

  async function extractFileLinksFromPage(url) {
    // This parser is deliberately small: it only extracts href/src URLs from the
    // Moodle HTML that the logged-in user is already allowed to load.
    const page = await fetchTextPage(url);
    if (!page.html) return [];

    const rawLinks = [];
    const anchorPattern = /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
    let anchorMatch;

    while ((anchorMatch = anchorPattern.exec(page.html))) {
      pushExtractedLink(rawLinks, anchorMatch[2], page.finalUrl || url, stripHtml(anchorMatch[3]));
    }

    const attributePattern = /\b(?:href|src)\s*=\s*(["'])(.*?)\1/gi;
    let match;

    while ((match = attributePattern.exec(page.html))) {
      pushExtractedLink(rawLinks, match[2], page.finalUrl || url, "");
    }

    return Dedupe.dedupeItems(rawLinks);
  }

  function pushExtractedLink(target, rawHref, baseUrl, label) {
    const raw = Filename.decodeHtmlEntities(rawHref || "");
    if (!raw || raw.startsWith("#") || /^javascript:/i.test(raw) || /^mailto:/i.test(raw)) return;

    let absoluteUrl;
    try {
      absoluteUrl = new URL(raw, baseUrl).href;
    } catch (error) {
      return;
    }

    const classification = Moodle.classifyUrl(absoluteUrl);
    if (classification.kind === "pluginfile" || classification.kind === "direct") {
      const urlName = Filename.getFilenameFromUrl(absoluteUrl).replace(/\.[^.]+$/, "");
      target.push({
        sourceUrl: absoluteUrl,
        kind: classification.kind,
        fileType: classification.fileType,
        displayName: Filename.normalizeText(label || urlName, 90) || urlName
      });
    }
  }

  function stripHtml(value) {
    return Filename.decodeHtmlEntities(String(value || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "));
  }

  function fileFromMetadata(candidate, context, meta, fileType) {
    const finalUrl = meta.finalUrl || candidate.sourceUrl;
    const originalFilename = Filename.chooseFilename({
      url: finalUrl,
      sourceUrl: candidate.sourceUrl,
      contentType: meta.contentType,
      contentDisposition: meta.contentDisposition,
      displayName: candidate.displayName,
      fallbackFilename: candidate.guessedFilename,
      fileType
    });

    return {
      id: Dedupe.simpleHash(Dedupe.candidateKey(Object.assign({}, candidate, { finalUrl }))),
      status: "ready",
      isDownloadable: true,
      kind: candidate.kind,
      fileType,
      displayName: candidate.displayName || originalFilename.replace(/\.[^.]+$/, ""),
      guessedFilename: originalFilename,
      sourceUrl: candidate.sourceUrl,
      finalUrl,
      downloadUrl: finalUrl,
      resourceId: candidate.resourceId || Moodle.extractResourceId(candidate.sourceUrl),
      folderId: candidate.folderId || Moodle.extractFolderId(candidate.sourceUrl),
      contentType: meta.contentType,
      contentDisposition: meta.contentDisposition,
      courseTitle: context.courseTitle || "未命名頁面"
    };
  }

  function manualItem(candidate, context, reason) {
    // Unresolvable resources stay visible in the popup instead of breaking the
    // whole batch. Users can open the source URL and confirm manually.
    return {
      id: Dedupe.simpleHash("manual|" + Dedupe.candidateKey(candidate)),
      status: "manual",
      isDownloadable: false,
      kind: candidate.kind || "unknown",
      fileType: candidate.fileType || "",
      displayName: candidate.displayName || "Needs manual confirmation",
      guessedFilename: candidate.guessedFilename || "",
      sourceUrl: candidate.sourceUrl,
      finalUrl: "",
      downloadUrl: "",
      resourceId: candidate.resourceId || Moodle.extractResourceId(candidate.sourceUrl || ""),
      folderId: candidate.folderId || Moodle.extractFolderId(candidate.sourceUrl || ""),
      errorReason: reason || "Needs manual confirmation.",
      courseTitle: context.courseTitle || "未命名頁面"
    };
  }

  function linkToCandidate(link, parentCandidate) {
    const classification = Moodle.classifyUrl(link.sourceUrl);
    const displayName = link.displayName || parentCandidate.displayName || Filename.getFilenameFromUrl(link.sourceUrl);

    return {
      id: Dedupe.simpleHash([parentCandidate.sourceUrl, link.sourceUrl].join("|")),
      sourceUrl: link.sourceUrl,
      kind: classification.kind,
      resourceId: parentCandidate.resourceId,
      folderId: parentCandidate.folderId,
      fileType: link.fileType || classification.fileType,
      displayName,
      guessedFilename: Filename.chooseFilename({
        url: link.sourceUrl,
        displayName,
        fileType: link.fileType || classification.fileType
      })
    };
  }

  function isHtmlMeta(meta) {
    return /text\/html|application\/xhtml\+xml/i.test(meta.contentType || "");
  }

  async function downloadFiles(files) {
    // Downloads are sent one by one so a single failed item does not cancel the
    // rest of the batch.
    const results = [];

    for (const file of files) {
      if (!file.downloadUrl || !file.filename) {
        results.push({
          ok: false,
          file,
          error: "Missing download URL or filename."
        });
        continue;
      }

      try {
        const downloadId = await chromeDownload({
          url: file.downloadUrl,
          filename: Filename.normalizeDownloadPath(String(file.filename).split("/")),
          conflictAction: "uniquify",
          saveAs: false
        });
        results.push({ ok: true, file, downloadId });
      } catch (error) {
        results.push({
          ok: false,
          file,
          error: error && error.message ? error.message : String(error)
        });
      }
    }

    return results;
  }

  function chromeDownload(options) {
    return new Promise(function downloadPromise(resolve, reject) {
      chrome.downloads.download(options, function handleDownload(downloadId) {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        resolve(downloadId);
      });
    });
  }
})(globalThis);
