(function attachDedupeUtils(global) {
  "use strict";

  const root = global.FileSweep || (global.FileSweep = {});
  const Moodle = root.moodle || {};
  const Filename = root.filename || {};

  const REMOVABLE_QUERY_PARAMS = new Set([
    "forcedownload",
    "download",
    "redirect",
    "sesskey"
  ]);

  function simpleHash(value) {
    const text = String(value || "");
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function normalizeUrlForDedupe(urlString) {
    let url;
    try {
      url = new URL(urlString);
    } catch (error) {
      return String(urlString || "").trim();
    }

    url.hash = "";

    // These parameters change navigation behavior or carry session state, but
    // they do not identify a distinct course file for our purposes.
    for (const key of Array.from(url.searchParams.keys())) {
      if (REMOVABLE_QUERY_PARAMS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }

    const sortedParams = Array.from(url.searchParams.entries()).sort(function sortParam(a, b) {
      return a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0]);
    });
    url.search = "";
    for (const [key, value] of sortedParams) {
      url.searchParams.append(key, value);
    }

    return url.href;
  }

  function candidateKey(candidate) {
    const item = candidate || {};
    const sourceUrl = item.sourceUrl || item.url || "";
    const finalUrl = item.finalUrl || item.downloadUrl || "";

    if (finalUrl && Moodle.isPluginfileUrl && Moodle.isPluginfileUrl(finalUrl)) {
      return "pluginfile:" + normalizeUrlForDedupe(finalUrl);
    }

    if (sourceUrl && Moodle.isPluginfileUrl && Moodle.isPluginfileUrl(sourceUrl)) {
      return "pluginfile:" + normalizeUrlForDedupe(sourceUrl);
    }

    const resourceId = item.resourceId || (Moodle.extractResourceId ? Moodle.extractResourceId(sourceUrl) : "");
    if (resourceId) return "resource:" + resourceId;

    const folderId = item.folderId || (Moodle.extractFolderId ? Moodle.extractFolderId(sourceUrl) : "");
    if (folderId && !finalUrl) return "folder:" + folderId;

    return "url:" + normalizeUrlForDedupe(finalUrl || sourceUrl);
  }

  function scoreDisplayName(value) {
    const text = Filename.normalizeText ? Filename.normalizeText(value || "") : String(value || "").trim();
    if (!text) return 0;
    return Math.min(text.length, 80) + (/\s/.test(text) ? 10 : 0);
  }

  function mergeItem(existing, incoming) {
    const merged = Object.assign({}, existing, incoming);

    if (scoreDisplayName(existing.displayName) >= scoreDisplayName(incoming.displayName)) {
      merged.displayName = existing.displayName;
    }

    merged.sourceUrls = Array.from(new Set([
      ...(existing.sourceUrls || [existing.sourceUrl].filter(Boolean)),
      ...(incoming.sourceUrls || [incoming.sourceUrl].filter(Boolean))
    ]));

    merged.sourceUrl = existing.sourceUrl || incoming.sourceUrl;
    merged.downloadUrl = incoming.downloadUrl || existing.downloadUrl;
    merged.finalUrl = incoming.finalUrl || existing.finalUrl;
    merged.status = existing.status === "ready" ? existing.status : incoming.status;
    merged.isDownloadable = Boolean(existing.isDownloadable || incoming.isDownloadable);
    merged.fileType = existing.fileType || incoming.fileType;
    merged.guessedFilename = existing.guessedFilename || incoming.guessedFilename;

    return merged;
  }

  function dedupeItems(items) {
    const byKey = new Map();

    for (const item of items || []) {
      if (!item) continue;
      const key = candidateKey(item);
      const enriched = Object.assign({}, item, {
        dedupeKey: key,
        id: item.id || simpleHash(key)
      });

      if (byKey.has(key)) {
        byKey.set(key, mergeItem(byKey.get(key), enriched));
      } else {
        byKey.set(key, enriched);
      }
    }

    return Array.from(byKey.values());
  }

  root.dedupe = {
    REMOVABLE_QUERY_PARAMS,
    candidateKey,
    dedupeItems,
    normalizeUrlForDedupe,
    simpleHash
  };
})(globalThis);
