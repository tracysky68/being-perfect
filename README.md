# 玩美學 Being Perfect 網站

玩美學 Being Perfect 是教育共生平台網站，採靜態 HTML / CSS / JavaScript 建置。

目前已加入教師專班報名與 PAYUNi 串接骨架：公開頁面繼續部署於 GitHub Pages，安全後端與資料庫使用 Supabase Edge Functions / Postgres。

## 頁面

- `index.html`：首頁
- `about.html`：關於我們
- `courses.html`：課程介紹
- `talks.html`：共學講堂
- `workshops.html`：家長工作坊
- `partners.html`：教育夥伴
- `blog.html`：部落格
- `contact.html`：聯絡我們
- `register.html`：教師專班報名與付款入口
- `payment-result.html`：PAYUNi 返回頁
- `supabase/`：資料庫 migration、付款建立與付款通知函式

## 金流開發設定

1. 建立 Supabase 專案並安裝 Supabase CLI。
2. 依 `supabase/.env.example` 建立本機 secrets；切勿提交正式金鑰。
3. 執行 migration，並在 `cohorts` 建立至少一個正式梯次。
4. 部署 `list-cohorts`、`create-payment`、`payuni-notify` 與 `payuni-return` Edge Functions。
5. 將 `config.js` 的 `cohortsEndpoint`、`paymentEndpoint` 設為部署後的函式網址。
6. 先以 PAYUNi sandbox 驗證 NotifyURL 回傳欄位，再切換 `PAYUNI_ENV=production`。

## 彈性選課結構

課程以「月份梯次」販售；每個月份梯次在 `course_sessions` 建立 day 1、day 2 的平日與假日場。學員付款後透過 `enrollment_sessions` 各選一個 day 1 與 day 2，因此可以平日／假日混搭。一般選課限同月份，跨月補課由行政後台指派。

2026 首梯價格：一般學員 NT$13,800（NT$4,600 × 3）；家長班舊生 NT$10,800（NT$3,600 × 3）。三期皆為等額、零手續費，透過 `payment_installments` 追蹤且只建立一筆報名。

正式上線前必須以 PAYUNi 商店後台最新版 API 文件核對成功狀態欄位，並完成成功、失敗、重複通知、金額不符四項測試。

## 本機預覽

可直接開啟 `index.html`，或使用本機伺服器：

```bash
python3 -m http.server 4173
```

然後開啟 `http://127.0.0.1:4173/index.html`。
