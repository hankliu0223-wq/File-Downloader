(function attachMoodleDetector(global) {
  "use strict";

  const root = global.PdfAutoDownloader || (global.PdfAutoDownloader = {});
  const Filename = root.filename || {};

  function getUrlObject(urlString, baseUrl) {
    try {
      return new URL(urlString, baseUrl);
    } catch (error) {
      return null;
    }
  }

  function isHttpUrl(urlString) {
    const url = getUrlObject(urlString);
    return Boolean(url && (url.protocol === "http:" || url.protocol === "https:"));
  }

  function extractId(urlString, expectedPath) {
    const url = getUrlObject(urlString);
    if (!url) return "";

    if (expectedPath && !url.pathname.toLowerCase().includes(expectedPath)) return "";
    return url.searchParams.get("id") || "";
  }

  function extractResourceId(urlString) {
    return extractId(urlString, "/mod/resource/view.php");
  }

  function extractFolderId(urlString) {
    return extractId(urlString, "/mod/folder/view.php");
  }

  function isPluginfileUrl(urlString) {
    const url = getUrlObject(urlString);
    return Boolean(url && url.pathname.toLowerCase().includes("/pluginfile.php/"));
  }

  function classifyUrl(urlString) {
    const url = getUrlObject(urlString);
    if (!url || !isHttpUrl(url.href)) {
      return {
        kind: "ignored",
        fileType: "",
        isSupported: false,
        resourceId: "",
        folderId: ""
      };
    }

    const pathname = url.pathname.toLowerCase();
    const fileType = Filename.getFileTypeFromUrl ? Filename.getFileTypeFromUrl(url.href) : "";

    // Moodle resource pages often hide the actual pluginfile URL behind a
    // view.php?id=... page, so they are marked for background resolution.
    if (pathname.includes("/mod/resource/view.php")) {
      return {
        kind: "resource",
        fileType,
        isSupported: true,
        resourceId: extractResourceId(url.href),
        folderId: ""
      };
    }

    // Folder pages need HTML parsing because they can contain many files.
    if (pathname.includes("/mod/folder/view.php")) {
      return {
        kind: "folder",
        fileType,
        isSupported: true,
        resourceId: "",
        folderId: extractFolderId(url.href)
      };
    }

    // pluginfile.php is Moodle's normal authenticated file delivery endpoint.
    if (pathname.includes("/pluginfile.php/")) {
      return {
        kind: "pluginfile",
        fileType,
        isSupported: true,
        resourceId: "",
        folderId: ""
      };
    }

    if (fileType) {
      return {
        kind: "direct",
        fileType,
        isSupported: true,
        resourceId: "",
        folderId: ""
      };
    }

    return {
      kind: "unknown",
      fileType: "",
      isSupported: false,
      resourceId: "",
      folderId: ""
    };
  }

  function looksLikeMoodleUrl(urlString) {
    const url = getUrlObject(urlString);
    if (!url) return false;

    return /\/(course|mod|pluginfile\.php)\//i.test(url.pathname) ||
      /moodle/i.test(url.hostname);
  }

  function isMoodleDocument(documentRef) {
    if (!documentRef) return false;

    const bodyClass = documentRef.body ? documentRef.body.className : "";
    const generator = documentRef.querySelector ? documentRef.querySelector("meta[name='generator']") : null;
    const htmlText = [
      bodyClass,
      generator ? generator.getAttribute("content") : "",
      documentRef.location ? documentRef.location.href : "",
      documentRef.title || ""
    ].join(" ");

    return /moodle|path-course-view|format-/i.test(htmlText);
  }

  function cleanCourseTitle(value) {
    const normalize = Filename.normalizeText || function fallback(text) {
      return String(text || "").replace(/\s+/g, " ").trim();
    };

    return normalize(value || "Course", 80)
      .replace(/\s*-\s*Moodle\s*$/i, "")
      .replace(/\s*\|\s*Moodle\s*$/i, "")
      .replace(/^Course:\s*/i, "")
      .trim() || "Course";
  }

  function getCourseTitle(documentRef) {
    if (!documentRef || !documentRef.querySelector) return "Course";

    const selectors = [
      ".page-header-headings h1",
      "header h1",
      "h1",
      ".course-title",
      "[data-region='courseindex'] h2"
    ];

    for (const selector of selectors) {
      const node = documentRef.querySelector(selector);
      if (node && node.textContent && node.textContent.trim()) {
        return cleanCourseTitle(node.textContent);
      }
    }

    return cleanCourseTitle(documentRef.title || "Course");
  }

  root.moodle = {
    classifyUrl,
    cleanCourseTitle,
    extractFolderId,
    extractResourceId,
    getCourseTitle,
    getUrlObject,
    isHttpUrl,
    isMoodleDocument,
    isPluginfileUrl,
    looksLikeMoodleUrl
  };
})(globalThis);
