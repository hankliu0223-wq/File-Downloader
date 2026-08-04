(function attachPopup(global) {
  "use strict";

  const root = global.FileSweep;
  const Filename = root.filename;

  const state = {
    tabId: null,
    pageUrl: "",
    courseTitle: "未命名頁面",
    files: [],
    selectedIds: new Set(),
    autoScanTimer: null
  };

  const elements = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    elements.pageStatus = document.getElementById("pageStatus");
    elements.rescanButton = document.getElementById("rescanButton");
    elements.typeFilter = document.getElementById("typeFilter");
    elements.namingRule = document.getElementById("namingRule");
    elements.baseFolder = document.getElementById("baseFolder");
    elements.selectAllButton = document.getElementById("selectAllButton");
    elements.clearSelectionButton = document.getElementById("clearSelectionButton");
    elements.downloadButton = document.getElementById("downloadButton");
    elements.courseTitle = document.getElementById("courseTitle");
    elements.fileCount = document.getElementById("fileCount");
    elements.fileList = document.getElementById("fileList");

    elements.rescanButton.addEventListener("click", scanCurrentTab);
    elements.typeFilter.addEventListener("change", render);
    elements.namingRule.addEventListener("change", render);
    elements.baseFolder.addEventListener("input", render);
    elements.selectAllButton.addEventListener("click", selectAllDownloadable);
    elements.clearSelectionButton.addEventListener("click", clearSelection);
    elements.downloadButton.addEventListener("click", downloadSelected);
    elements.fileList.addEventListener("change", handleCheckboxChange);

    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
    scanCurrentTab();
  }

  async function scanCurrentTab() {
    // Popup workflow: ask the content script for candidates, then let the
    // service worker resolve redirects and headers with the user's cookies.
    setBusy(true);
    setStatus("正在掃描目前頁面...");

    try {
      const [tab] = await chromeQuery({ active: true, currentWindow: true });
      if (!tab || !tab.id) throw new Error("找不到目前分頁。");

      state.tabId = tab.id;
      state.pageUrl = tab.url || "";

      const scanResult = await scanTabWithFallback(tab.id);
      if (!scanResult || !scanResult.ok) {
        throw new Error(scanResult && scanResult.error ? scanResult.error : "content script 無法回應。");
      }

      state.courseTitle = scanResult.courseTitle || tab.title || "未命名頁面";
      setStatus("找到候選連結，正在解析檔案標頭...");

      const resolveResult = await chromeSendMessage({
        type: "FS_RESOLVE_CANDIDATES",
        candidates: scanResult.candidates || [],
        context: {
          pageUrl: scanResult.pageUrl || tab.url,
          courseTitle: state.courseTitle
        }
      });

      if (!resolveResult || !resolveResult.ok) {
        throw new Error(resolveResult && resolveResult.error ? resolveResult.error : "解析失敗。");
      }

      state.files = resolveResult.files || [];
      state.selectedIds = new Set(state.files.filter(function canDownload(file) {
        return file.isDownloadable;
      }).map(function getId(file) {
        return file.id;
      }));

      render();
      setStatus("掃描完成。可下載項目已預先勾選。");
    } catch (error) {
      state.files = [];
      state.selectedIds.clear();
      render();
      setStatus(error && error.message ? error.message : String(error), "error");
    } finally {
      setBusy(false);
    }
  }

  async function scanTabWithFallback(tabId) {
    try {
      return await chromeSendTabMessage(tabId, { type: "FS_SCAN_NOW" });
    } catch (firstError) {
      await injectContentScripts(tabId);
      return chromeSendTabMessage(tabId, { type: "FS_SCAN_NOW" });
    }
  }

  async function injectContentScripts(tabId) {
    const files = [
      "utils/filename.js",
      "utils/moodle-detector.js",
      "utils/dedupe.js",
      "content/scanner.js"
    ];

    for (const file of files) {
      await chromeExecuteScript({
        target: { tabId },
        files: [file]
      });
    }
  }

  function getFilteredFiles() {
    const filter = elements.typeFilter.value;
    if (filter === "all") return state.files;
    return state.files.filter(function matchType(file) {
      return file.fileType === filter;
    });
  }

  function render() {
    const files = getFilteredFiles();
    elements.courseTitle.textContent = "來源：" + (state.courseTitle || "未命名頁面");
    elements.fileCount.textContent = files.length + " 個項目";

    if (!files.length) {
      elements.fileList.innerHTML = "<tr><td colspan=\"5\" class=\"empty\">沒有符合篩選條件的檔案</td></tr>";
      return;
    }

    elements.fileList.innerHTML = "";
    files.forEach(function renderFile(file, index) {
      const row = document.createElement("tr");
      const filenamePreview = buildFilenamePreview(file, index + 1);
      const checkboxCell = document.createElement("td");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.fileId = file.id;
      checkbox.checked = state.selectedIds.has(file.id);
      checkbox.disabled = !file.isDownloadable;
      checkboxCell.appendChild(checkbox);

      row.appendChild(checkboxCell);
      row.appendChild(textCell(file.displayName || "未命名"));
      row.appendChild(typeCell(file));
      row.appendChild(urlCell(file.sourceUrl || file.finalUrl || ""));
      row.appendChild(filenameCell(file, filenamePreview));
      elements.fileList.appendChild(row);
    });
  }

  function textCell(value) {
    const cell = document.createElement("td");
    const span = document.createElement("span");
    span.className = "truncate";
    span.title = value || "";
    span.textContent = value || "";
    cell.appendChild(span);
    return cell;
  }

  function typeCell(file) {
    const cell = document.createElement("td");
    const pill = document.createElement("span");
    pill.className = "type-pill";
    pill.textContent = file.fileType || "待確認";
    cell.appendChild(pill);

    const status = document.createElement("div");
    status.className = file.status === "ready" ? "status-ready" : "status-manual";
    status.textContent = file.status === "ready" ? "可下載" : "需手動開啟確認";
    if (file.errorReason) status.title = file.errorReason;
    cell.appendChild(status);

    return cell;
  }

  function urlCell(url) {
    const cell = document.createElement("td");
    if (!url) return cell;

    const link = document.createElement("a");
    link.className = "link-icon";
    link.href = url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.title = url;
    link.textContent = "🔗";
    link.setAttribute("aria-label", url);
    cell.appendChild(link);
    return cell;
  }

  function filenameCell(file, preview) {
    const cell = document.createElement("td");
    const span = document.createElement("span");
    span.className = "truncate";
    span.title = preview;
    span.textContent = file.isDownloadable ? preview : (file.errorReason || "需手動開啟確認");
    cell.appendChild(span);
    return cell;
  }

  function buildFilenamePreview(file, index) {
    return Filename.buildDownloadPath({
      file,
      index,
      rule: elements.namingRule.value,
      baseFolder: elements.baseFolder.value,
      courseTitle: state.courseTitle
    });
  }

  function handleCheckboxChange(event) {
    const target = event.target;
    if (!target || target.type !== "checkbox") return;

    if (target.checked) {
      state.selectedIds.add(target.dataset.fileId);
    } else {
      state.selectedIds.delete(target.dataset.fileId);
    }
  }

  function selectAllDownloadable() {
    for (const file of getFilteredFiles()) {
      if (file.isDownloadable) state.selectedIds.add(file.id);
    }
    render();
  }

  function clearSelection() {
    state.selectedIds.clear();
    render();
  }

  async function downloadSelected() {
    // Build Chrome downloads API relative filenames immediately before
    // downloading so the latest naming rule and folder field are honored.
    const selected = state.files.filter(function isSelected(file) {
      return state.selectedIds.has(file.id) && file.isDownloadable;
    });

    if (!selected.length) {
      setStatus("沒有可下載的勾選項目。", "error");
      return;
    }

    const filesToDownload = selected.map(function prepareDownload(file, index) {
      return Object.assign({}, file, {
        filename: Filename.buildDownloadPath({
          file,
          index: index + 1,
          rule: elements.namingRule.value,
          baseFolder: elements.baseFolder.value,
          courseTitle: state.courseTitle
        })
      });
    });

    setBusy(true);
    setStatus("正在建立下載工作...");

    try {
      const response = await chromeSendMessage({
        type: "FS_DOWNLOAD_FILES",
        files: filesToDownload
      });

      if (!response || !response.ok) {
        throw new Error(response && response.error ? response.error : "下載失敗。");
      }

      const result = response.result || [];
      const successCount = result.filter(function ok(item) {
        return item.ok;
      }).length;
      const failureCount = result.length - successCount;
      setStatus("已送出 " + successCount + " 個下載工作" + (failureCount ? "，" + failureCount + " 個失敗。" : "。"), failureCount ? "error" : "");
    } catch (error) {
      setStatus(error && error.message ? error.message : String(error), "error");
    } finally {
      setBusy(false);
    }
  }

  function handleRuntimeMessage(message, sender) {
    if (!message || message.type !== "FS_PAGE_CHANGED") return false;
    if (!sender.tab || sender.tab.id !== state.tabId) return false;

    setStatus("頁面內容已更新，正在重新掃描...");
    clearTimeout(state.autoScanTimer);
    state.autoScanTimer = setTimeout(scanCurrentTab, 900);
    return false;
  }

  function setStatus(text, tone) {
    elements.pageStatus.textContent = text;
    elements.pageStatus.className = tone === "error" ? "status status-error" : "status";
  }

  function setBusy(isBusy) {
    elements.rescanButton.disabled = isBusy;
    elements.downloadButton.disabled = isBusy;
  }

  function chromeQuery(queryInfo) {
    return new Promise(function queryPromise(resolve, reject) {
      chrome.tabs.query(queryInfo, function handleTabs(tabs) {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        resolve(tabs);
      });
    });
  }

  function chromeSendMessage(message) {
    return new Promise(function messagePromise(resolve, reject) {
      chrome.runtime.sendMessage(message, function handleResponse(response) {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        resolve(response);
      });
    });
  }

  function chromeSendTabMessage(tabId, message) {
    return new Promise(function tabMessagePromise(resolve, reject) {
      chrome.tabs.sendMessage(tabId, message, function handleResponse(response) {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        resolve(response);
      });
    });
  }

  function chromeExecuteScript(options) {
    return new Promise(function executePromise(resolve, reject) {
      chrome.scripting.executeScript(options, function handleResult(result) {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        resolve(result);
      });
    });
  }
})(globalThis);
