# FileSweep

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)
![Manifest](https://img.shields.io/badge/Manifest-V3-5F6368)
![JavaScript](https://img.shields.io/badge/JavaScript-Vanilla-F7DF1E?logo=javascript&logoColor=black)
![Moodle](https://img.shields.io/badge/Moodle-Supported-F98012?logo=moodle&logoColor=white)
![Downloads API](https://img.shields.io/badge/Chrome-Downloads_API-34A853)

> 一個專為一般網頁與 Moodle 課程頁設計的 Chrome 文件掃描與批次下載擴充功能。

FileSweep 會掃描目前頁面中的文件連結，辨識可下載的 PDF、PPTX、DOC 與 DOCX 檔案，並提供檔名搜尋、類型篩選、自訂命名規則與一鍵批次下載功能。

## 功能特色

- 掃描目前網頁中的文件連結
- 支援 Moodle 課程資源與資料夾頁面
- 支援 PDF、PPTX、DOC、DOCX
- 依文件類型快速篩選
- 依顯示名稱或推測檔名搜尋
- 預設勾選所有可下載項目
- 支援單一選取、全選與清除選取
- 自訂下載子資料夾
- 支援多種檔案命名規則
- 自動處理重新導向與檔案標頭
- 無法自動確認的連結會保留於清單中，供使用者手動開啟
- 頁面內容變更時可自動重新掃描

## 支援的檔案格式

| 類型 | 副檔名 |
| --- | --- |
| PDF 文件 | `.pdf` |
| PowerPoint 簡報 | `.pptx` |
| Word 文件 | `.doc` |
| Word 文件 | `.docx` |

目前版本不會自動下載影片、圖片、試算表、壓縮檔或其他未列出的格式。

## 安裝方式

目前尚未發布至 Chrome 線上應用程式商店，可使用 Chrome 開發人員模式手動安裝。

1. 下載或複製本專案：

   ```bash
   git clone https://github.com/hankliu0223-wq/File-Downloader.git
   ```

2. 開啟 Chrome，前往：

   ```text
   chrome://extensions/
   ```

3. 開啟右上角的「開發人員模式」。
4. 點擊「載入未封裝項目」。
5. 選擇本專案根目錄，也就是包含 `manifest.json` 的資料夾。
6. 安裝完成後，建議將 FileSweep 固定在瀏覽器工具列上。

## 使用方式

1. 開啟含有文件連結的網頁或 Moodle 課程頁面。
2. 點擊瀏覽器工具列中的 FileSweep 圖示。
3. 擴充功能會自動掃描目前頁面並解析可下載文件。
4. 使用「篩選」選擇需要的文件類型。
5. 在搜尋欄輸入關鍵字，依檔名縮小清單範圍。
6. 選擇命名規則與下載子資料夾。
7. 勾選需要的檔案後，點擊「下載已勾選」。

預設情況下，所有可下載項目都會自動勾選。若只想下載少數文件，可以先點擊「清除」，再個別勾選。

## 命名規則

FileSweep 目前提供以下命名方式：

| 命名規則 | 說明 |
| --- | --- |
| 原始檔名 | 保留伺服器提供或推測出的檔名 |
| 來源名稱 + 原始檔名 | 在檔名前加入目前頁面或課程名稱 |
| 流水號 + 顯示名稱 | 依下載順序編號，搭配頁面顯示名稱 |
| 來源名稱 / 流水號_顯示名稱 | 以來源名稱建立資料夾，並使用編號與顯示名稱命名 |

實際檔名會經過清理，避免包含作業系統不允許的字元。若同名檔案已存在，Chrome 會自動建立不重複的檔名。

## Moodle 支援

FileSweep 針對 Moodle 常見資源形式進行處理，包括：

- 一般課程資源連結
- `pluginfile.php` 文件連結
- 會重新導向至實際檔案的資源頁
- Moodle 資料夾資源中的多個文件
- 需要使用目前登入狀態才能存取的文件

擴充功能會使用瀏覽器目前的登入工作階段解析資源。使用者仍必須具備該課程或文件的合法存取權限。

## 權限說明

FileSweep 使用下列 Chrome 擴充功能權限：

| 權限 | 用途 |
| --- | --- |
| `activeTab` | 讀取並掃描目前使用中的分頁 |
| `downloads` | 建立文件下載工作 |
| `scripting` | 在需要時將掃描程式注入目前頁面 |
| `storage` | 保留擴充功能設定，供後續版本使用 |
| `tabs` | 取得目前分頁資訊並與內容腳本通訊 |
| `<all_urls>` | 掃描不同網站並解析文件連結與重新導向 |

## 隱私與安全

- FileSweep 不需要建立帳號。
- FileSweep 不會將掃描結果上傳至外部伺服器。
- 文件解析與下載操作皆在使用者的瀏覽器內執行。
- 擴充功能會使用目前瀏覽器的登入狀態存取使用者原本有權限開啟的資源。
- FileSweep 不會繞過網站權限、付費牆或存取控制。

請僅下載自己有權存取及使用的文件，並遵守網站規範、著作權及課程資料使用政策。

## 已知限制

- 部分網站會透過 JavaScript、一次性網址、特殊驗證或非標準下載流程提供文件，可能無法自動解析。
- 某些伺服器不支援 `HEAD` 或 Range Request，文件類型可能無法立即確認。
- 動態載入的頁面可能需要等待內容顯示後再重新掃描。
- Chrome 系統頁面、Chrome 線上應用程式商店及部分受保護頁面不允許擴充功能注入腳本。
- 目前僅支援 PDF、PPTX、DOC、DOCX。
- 無法自動確認的項目會標示為「需手動開啟確認」，不會被加入批次下載。

## 專案結構

```text
File-Downloader/
├─ background/
│  └─ service-worker.js      # 解析文件、處理重新導向與建立下載工作
├─ content/
│  └─ scanner.js             # 掃描目前頁面中的候選文件連結
├─ icons/                    # 擴充功能圖示
├─ popup/
│  ├─ popup.html             # 擴充功能操作介面
│  ├─ popup.css              # 介面樣式
│  └─ popup.js               # 掃描、篩選、選取與下載流程
├─ utils/
│  ├─ dedupe.js              # 候選連結與文件去重
│  ├─ filename.js            # 檔案類型判斷與命名處理
│  └─ moodle-detector.js     # Moodle 網址與資源類型辨識
├─ manifest.json             # Chrome Extension Manifest V3 設定
└─ README.md
```

## 技術架構

- Chrome Extension Manifest V3
- Vanilla JavaScript
- HTML / CSS
- Chrome Tabs API
- Chrome Scripting API
- Chrome Downloads API
- Service Worker
- Content Script

### 基本運作流程

```text
使用者開啟網頁
→ Content Script 掃描候選連結
→ Service Worker 去重並解析重新導向與 HTTP 標頭
→ 判斷文件格式與實際檔名
→ Popup 顯示、搜尋及篩選結果
→ 使用者選擇命名規則與檔案
→ Chrome Downloads API 建立下載工作
```

## 本機開發

修改程式後，不需要重新安裝擴充功能：

1. 前往 `chrome://extensions/`。
2. 找到 FileSweep。
3. 點擊重新載入圖示。
4. 重新整理要測試的網頁。
5. 再次開啟 FileSweep 進行掃描。

若修改的是 `manifest.json`、Service Worker 或 Content Script，務必重新載入擴充功能並重新整理測試頁面。

## 開發方向

後續可考慮加入：

- XLS、XLSX、PPT、ZIP 等更多格式
- 掃描進度與下載進度顯示
- 儲存使用者命名與資料夾偏好
- 重複檔案提示
- 檔案大小與排序功能
- 跨多個頁面或整個課程批次掃描
- 掃描結果匯出為 CSV 或 JSON
- Chrome Web Store 發布版本

## 回報問題

發現無法辨識的 Moodle 資源、下載失敗或檔名錯誤時，請建立 GitHub Issue，並提供：

- 發生問題的頁面類型
- 預期下載的檔案格式
- 操作步驟
- 錯誤訊息或畫面截圖
- 是否需要登入才能存取

請勿在 Issue 中公開帳號、密碼、Cookie、私人課程網址或其他敏感資訊。

## 授權

本專案目前尚未加入授權條款。若要開放他人使用、修改或散布，建議新增 `LICENSE` 文件，例如 MIT License。

---

Made for faster and more organized document downloading.