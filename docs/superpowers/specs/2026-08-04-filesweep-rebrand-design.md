# FileSweep 大眾化改版設計

日期：2026-08-04

## 背景與目標

目前的擴充功能「PDF Auto Downloader」在功能與介面用字上高度綁定「政大 Moodle」情境（預設下載子資料夾為 `NCCU Moodle`、命名規則以「課程名稱」為核心用語、摘要列標籤是「課程：」）。底層邏輯其實已經支援一般網頁上的直接 PDF/PPTX/DOC/DOCX 連結，只是介面沒有反映出這個通用性，且完全沒有圖示（顯示 Chrome 預設拼圖圖案），觀感不夠專業、不利於推廣給政大 Moodle 學生以外的一般使用者。

本次改版目標：在**不改變任何掃描、解析、下載核心邏輯**的前提下，讓擴充功能在品牌、預設值、介面用字、圖示上變得更通用、更親民，適合作為一個獨立公開的「頁面檔案批次下載工具」推廣，而不是某校專屬工具。

## 範圍界定

**會做：**
1. 品牌重新命名：PDF Auto Downloader → FileSweep
2. 產生並加入擴充功能圖示（16/32/48/128px）
3. 移除 Moodle/政大專屬的預設值與介面用字，換成通用措辭
4. 表格欄位輕整（縮小來源 URL 欄、讓檔名欄更好讀）
5. 內部程式碼識別字重新命名以符合新品牌（`PdfAutoDownloader` → `FileSweep`、`PAD_` 訊息前綴 → `FS_`）

**不會做：**
- 不新增/移除支援的檔案類型
- 不修改 Moodle resource/folder 解析、redirect/header 解析、去重邏輯
- 不新增 i18n（多語言）架構，維持純繁體中文介面
- 不做卡片式版面大改版，維持現有表格版面骨架
- 不新增 options 頁面或其他新功能面

## 1. 品牌與識別

| 項目 | 舊 | 新 |
|---|---|---|
| `manifest.json` `name` | `PDF Auto Downloader` | `FileSweep` |
| `manifest.json` `description` | 提及「Moodle course pages」為主場景 | 通用敘述，Moodle 列為「額外支援」而非主場景，例如：「掃描目前頁面（含 Moodle 課程頁）中的 PDF、PPTX、DOC、DOCX 檔案，一鍵批次下載。」 |
| `action.default_title` | `PDF Auto Downloader` | `FileSweep` |
| popup `<title>` / `<h1>` | `PDF Auto Downloader` | `FileSweep` |

版本號不變（由使用者自行決定何時 bump）。

## 2. 圖示

- 使用純 Node.js（內建 `zlib` 模組手刻 PNG encoder，不引入任何 npm 套件）產生 16 / 32 / 48 / 128 px 四種尺寸的 PNG。
- 視覺設計：藍色圓角方塊底（沿用 `popup.css` 現有 `--accent: #0b6bcb`），中間放白色文件圖形，搭配一道弧形「掃過」線條或勾勾，呼應 FileSweep「掃描並清空頁面上的檔案」的意象。純幾何形狀，不含文字，確保小尺寸（16px）仍可辨識。
- 產生的檔案放在新增的 `icons/` 目錄（`icons/icon16.png`、`icon32.png`、`icon48.png`、`icon128.png`）。
- `manifest.json` 新增：
  ```json
  "icons": {
    "16": "icons/icon16.png",
    "32": "icons/icon32.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "action": {
    "default_icon": {
      "16": "icons/icon16.png",
      "32": "icons/icon32.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    },
    ...
  }
  ```
- 產生圖示用的腳本會保留在 repo 中（例如 `scripts/generate-icons.js`），方便未來調整重新產生，不需要額外安裝套件即可執行（`node scripts/generate-icons.js`）。

## 3. 去 Moodle/政大綁定的預設值與用字

| 位置 | 舊值/用字 | 新值/用字 |
|---|---|---|
| `popup.html` `#baseFolder` 預設 `value` | `NCCU Moodle` | `FileSweep` |
| `popup.html` `#baseFolder` `placeholder` | `例如 NCCU Moodle` | `例如 課堂講義` |
| `popup.html` / `popup.js` 摘要列標籤 | `課程：` | `來源：` |
| `popup.js` / `service-worker.js` 找不到頁面標題時的 fallback 字串 | `Course` | `未命名頁面` |
| `popup.html` 命名規則選單 - `course-original` | `課程名稱 + 原始檔名` | `來源名稱 + 原始檔名` |
| `popup.html` 命名規則選單 - `course-sequence-display` | `課程名稱 / 流水號_顯示名稱` | `來源名稱 / 流水號_顯示名稱` |

行為說明：`courseTitle` 這個資料欄位在程式碼內部維持原樣（沿用 Moodle 課程標題偵測邏輯 `Moodle.getCourseTitle()`），只有**顯示給使用者的文字**通用化。在 Moodle 課程頁上，「來源」實際顯示的內容仍然是課程標題；在一般網頁上則是分頁標題，這與現況行為一致，只是標籤用字更通用。

## 4. 表格輕整

- 「來源 URL」欄：不再顯示完整網址文字，改為一個小連結圖示（`🔗`），`title` 屬性放完整網址供 hover 查看，`href`/`target="_blank"` 行為不變。欄寬從 240px 縮到約 48px。
- 欄位標題文字從「來源 URL」簡化為「連結」。
- 釋出的欄寬分配給「顯示名稱」與「推測檔名」兩欄（各增加約 80-100px），讓長檔名更容易看完整，減少 truncate 情形。
- 其餘欄位（勾選、類型、狀態）版面與互動邏輯不變。

## 5. 內部程式碼一致性重新命名

- 全域命名空間物件：`global.PdfAutoDownloader` → `global.FileSweep`（於 `utils/filename.js`、`utils/moodle-detector.js`、`utils/dedupe.js`、`content/scanner.js`、`background/service-worker.js`、`popup/popup.js` 中同步修改）
- Runtime 訊息型別前綴：`PAD_SCAN_NOW`、`PAD_RESOLVE_CANDIDATES`、`PAD_DOWNLOAD_FILES`、`PAD_PAGE_CHANGED` → `FS_SCAN_NOW`、`FS_RESOLVE_CANDIDATES`、`FS_DOWNLOAD_FILES`、`FS_PAGE_CHANGED`
- content script 掛在 `window` 上的旗標：`global.__pdfAutoDownloaderScanner` → `global.__fileSweepScanner`
- 純機械式重新命名，不改變任何函式行為、參數或呼叫順序。

## 測試計畫

由於這是 Chrome 擴充功能，沒有自動化測試框架，驗證方式為手動載入：

1. 於 `chrome://extensions` 以「載入未封裝項目」載入本資料夾，確認：
   - 擴充功能名稱顯示為 FileSweep
   - 圖示正確顯示（非預設拼圖圖案），在工具列小尺寸下仍可辨識
2. 開一個一般網頁（含公開 PDF 連結的頁面）與一個 Moodle 課程頁面，分別點擊擴充功能圖示：
   - 掃描結果、勾選狀態、下載行為與改版前一致
   - 摘要列顯示「來源：」+ 對應標題
   - 命名規則下拉選單四個選項文字皆已更新且功能正常（實際產生的路徑格式不變）
   - 表格「連結」欄以小圖示顯示，hover 可看到完整網址，點擊可在新分頁開啟
   - 預設下載子資料夾欄位顯示 `FileSweep`
3. 實際下載至少一個 Moodle resource 檔案與一個一般網頁直接連結檔案，確認檔名與路徑產生邏輯與改版前一致（除了 fallback 標題文字從 `Course`/`未命名課程` 變成 `未命名頁面` 之外，不應有其他差異）
4. 檢查 console 沒有因重新命名（`PdfAutoDownloader`/`PAD_` → `FileSweep`/`FS_`）產生的殘留參照錯誤（全域搜尋確認舊字串已無殘留）
