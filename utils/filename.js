(function attachFilenameUtils(global) {
  "use strict";

  const root = global.PdfAutoDownloader || (global.PdfAutoDownloader = {});

  const TYPE_INFO = {
    PDF: {
      extension: "pdf",
      mime: ["application/pdf"]
    },
    PPTX: {
      extension: "pptx",
      mime: [
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/vnd.ms-powerpoint.presentation.macroenabled.12"
      ]
    },
    DOC: {
      extension: "doc",
      mime: ["application/msword"]
    },
    DOCX: {
      extension: "docx",
      mime: [
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-word.document.macroenabled.12"
      ]
    }
  };

  const EXTENSION_TO_TYPE = Object.entries(TYPE_INFO).reduce((acc, [type, info]) => {
    acc[info.extension] = type;
    return acc;
  }, {});

  const SUPPORTED_TYPES = Object.keys(TYPE_INFO);
  const UNSAFE_SEGMENT_CHARS = /[<>:"\\|?*\x00-\x1f]/g;
  const CONTROL_CHARS = /[\x00-\x1f\x7f]/g;

  // Shared helpers are intentionally dependency-free so they can run in the
  // service worker, popup, and content script contexts.
  function safeDecodeURIComponent(value) {
    if (!value) return "";
    try {
      return decodeURIComponent(value);
    } catch (error) {
      return value;
    }
  }

  function decodeHtmlEntities(value) {
    if (!value) return "";

    return String(value)
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, "\"")
      .replace(/&#39;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&#x([0-9a-f]+);/gi, function decodeHex(_match, hex) {
        return String.fromCodePoint(parseInt(hex, 16));
      })
      .replace(/&#([0-9]+);/g, function decodeDecimal(_match, number) {
        return String.fromCodePoint(parseInt(number, 10));
      });
  }

  function normalizeText(value, maxLength) {
    const cleaned = decodeHtmlEntities(value || "")
      .replace(CONTROL_CHARS, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!maxLength || cleaned.length <= maxLength) return cleaned;
    return cleaned.slice(0, maxLength).replace(/\s+\S*$/, "").trim() || cleaned.slice(0, maxLength);
  }

  function getExtensionFromFilename(filename) {
    const match = String(filename || "").toLowerCase().match(/\.([a-z0-9]{1,8})(?:$|[?#])/);
    return match ? match[1] : "";
  }

  function getFileTypeFromExtension(extension) {
    return EXTENSION_TO_TYPE[String(extension || "").toLowerCase()] || "";
  }

  function getFileTypeFromName(name) {
    const extension = getExtensionFromFilename(name);
    const fromExtension = getFileTypeFromExtension(extension);
    if (fromExtension) return fromExtension;

    const inlineMatch = String(name || "").toLowerCase().match(/\.(pdf|pptx|docx|doc)\b/);
    return inlineMatch ? getFileTypeFromExtension(inlineMatch[1]) : "";
  }

  function getUrlObject(urlString) {
    try {
      return new URL(urlString);
    } catch (error) {
      return null;
    }
  }

  function getFilenameFromUrl(urlString) {
    const url = getUrlObject(urlString);
    if (!url) return "";

    const queryNames = ["filename", "file", "download"];
    for (const name of queryNames) {
      const value = url.searchParams.get(name);
      if (value && getFileTypeFromName(value)) {
        return sanitizeFilename(safeDecodeURIComponent(value));
      }
    }

    const pathParts = url.pathname.split("/").filter(Boolean);
    const lastPart = pathParts.length ? pathParts[pathParts.length - 1] : "";
    const decoded = safeDecodeURIComponent(lastPart);

    if (!decoded || decoded.toLowerCase() === "view.php" || decoded.toLowerCase() === "pluginfile.php") {
      return "";
    }

    return sanitizeFilename(decoded);
  }

  function getFileTypeFromUrl(urlString) {
    const filename = getFilenameFromUrl(urlString);
    const fromFilename = getFileTypeFromName(filename);
    if (fromFilename) return fromFilename;

    const url = getUrlObject(urlString);
    if (!url) return "";

    const pathType = getFileTypeFromName(safeDecodeURIComponent(url.pathname));
    if (pathType) return pathType;

    for (const value of url.searchParams.values()) {
      const queryType = getFileTypeFromName(safeDecodeURIComponent(value));
      if (queryType) return queryType;
    }

    return "";
  }

  function getFileTypeFromContentType(contentType) {
    const normalized = String(contentType || "").split(";")[0].trim().toLowerCase();
    if (!normalized) return "";

    for (const [type, info] of Object.entries(TYPE_INFO)) {
      if (info.mime.includes(normalized)) return type;
    }

    return "";
  }

  function stripQuotes(value) {
    const trimmed = String(value || "").trim();
    if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  }

  function parseContentDispositionFilename(contentDisposition) {
    const header = String(contentDisposition || "");
    if (!header) return "";

    const filenameStarMatch = header.match(/filename\*\s*=\s*([^;]+)/i);
    if (filenameStarMatch) {
      const raw = stripQuotes(filenameStarMatch[1]);
      const rfc5987Match = raw.match(/^[^']*'[^']*'(.*)$/);
      const encodedPart = rfc5987Match ? rfc5987Match[1] : raw;
      const decoded = safeDecodeURIComponent(encodedPart);
      if (decoded) return sanitizeFilename(decoded);
    }

    const filenameMatch = header.match(/filename\s*=\s*([^;]+)/i);
    if (filenameMatch) {
      const decoded = safeDecodeURIComponent(stripQuotes(filenameMatch[1]));
      if (decoded) return sanitizeFilename(decoded);
    }

    return "";
  }

  function detectFileType(input) {
    const data = input || {};
    const contentDispositionFilename = parseContentDispositionFilename(data.contentDisposition);
    const fromDisposition = getFileTypeFromName(contentDispositionFilename);
    if (fromDisposition) return fromDisposition;

    const fromContentType = getFileTypeFromContentType(data.contentType);
    if (fromContentType) return fromContentType;

    const fromUrl = getFileTypeFromUrl(data.url || data.finalUrl || data.sourceUrl || "");
    if (fromUrl) return fromUrl;

    const fromFallback = getFileTypeFromName(data.fallbackFilename || data.displayName || "");
    if (fromFallback) return fromFallback;

    return "";
  }

  function sanitizeSegment(value, fallback) {
    const cleaned = normalizeText(value || fallback || "download", 120)
      .replace(/[\/]+/g, "_")
      .replace(UNSAFE_SEGMENT_CHARS, "_")
      .replace(/\.+$/g, "")
      .replace(/^\.+/g, "")
      .replace(/\s+/g, " ")
      .trim();

    return cleaned || fallback || "download";
  }

  function sanitizeFilename(value, fallback) {
    const cleaned = sanitizeSegment(value, fallback || "download");
    const extension = getExtensionFromFilename(cleaned);
    if (!extension) return cleaned;

    const namePart = cleaned.slice(0, -(extension.length + 1)).trim();
    return (namePart || "download") + "." + extension;
  }

  function ensureExtension(filename, fileType) {
    const type = String(fileType || "").toUpperCase();
    const targetExtension = TYPE_INFO[type] ? TYPE_INFO[type].extension : "";
    const cleaned = sanitizeFilename(filename || "download");

    if (!targetExtension) return cleaned;
    if (getFileTypeFromName(cleaned) === type) return cleaned;

    const withoutKnownExtension = cleaned.replace(/\.(pdf|pptx|docx|doc)$/i, "");
    return sanitizeFilename(withoutKnownExtension + "." + targetExtension);
  }

  function chooseFilename(input) {
    const data = input || {};
    const fileType = String(data.fileType || detectFileType(data) || "").toUpperCase();
    const fromDisposition = parseContentDispositionFilename(data.contentDisposition);
    const fromUrl = getFilenameFromUrl(data.url || data.finalUrl || data.sourceUrl || "");
    const fallback = data.fallbackFilename || data.displayName || "download";
    const chosen = fromDisposition || fromUrl || fallback;

    return ensureExtension(chosen, fileType);
  }

  function padIndex(index) {
    const number = Number(index || 1);
    return String(number).padStart(3, "0");
  }

  function normalizeDownloadPath(parts) {
    return parts
      .filter(Boolean)
      .flatMap(function splitPathPart(part) {
        return String(part).split(/[\\/]+/);
      })
      .map(function cleanPart(part, index, list) {
        const isLast = index === list.length - 1;
        return isLast ? sanitizeFilename(part, "download") : sanitizeSegment(part, "downloads");
      })
      .filter(Boolean)
      .join("/")
      .replace(/^\/+/, "")
      .replace(/\/{2,}/g, "/");
  }

  function buildDownloadPath(input) {
    const data = input || {};
    const file = data.file || {};
    const rule = data.rule || "original";
    const baseFolder = data.baseFolder ? sanitizeSegment(data.baseFolder, "") : "";
    const courseTitle = sanitizeSegment(data.courseTitle || file.courseTitle || "未命名頁面", "未命名頁面");
    const fileType = String(file.fileType || "").toUpperCase();
    const originalFilename = chooseFilename({
      url: file.downloadUrl || file.finalUrl || file.sourceUrl,
      contentDisposition: file.contentDisposition,
      displayName: file.guessedFilename || file.displayName,
      fileType: fileType
    });
    const displayName = sanitizeSegment(file.displayName || originalFilename.replace(/\.[^.]+$/, ""), "download");
    const numberedName = ensureExtension(padIndex(data.index) + "_" + displayName, fileType);

    // Chrome downloads API accepts a relative path here, not an arbitrary
    // system path. Each segment is sanitized before joining with "/".
    let pathParts;
    if (rule === "course-original") {
      pathParts = [baseFolder, courseTitle + "_" + originalFilename];
    } else if (rule === "sequence-display") {
      pathParts = [baseFolder, numberedName];
    } else if (rule === "course-sequence-display") {
      pathParts = [baseFolder, courseTitle, numberedName];
    } else {
      pathParts = [baseFolder, originalFilename];
    }

    return normalizeDownloadPath(pathParts);
  }

  root.filename = {
    TYPE_INFO,
    SUPPORTED_TYPES,
    buildDownloadPath,
    chooseFilename,
    decodeHtmlEntities,
    detectFileType,
    ensureExtension,
    getExtensionFromFilename,
    getFilenameFromUrl,
    getFileTypeFromContentType,
    getFileTypeFromExtension,
    getFileTypeFromName,
    getFileTypeFromUrl,
    normalizeDownloadPath,
    normalizeText,
    parseContentDispositionFilename,
    safeDecodeURIComponent,
    sanitizeFilename,
    sanitizeSegment
  };
})(globalThis);
