# 教師專班摘要接線候選（未部署）

沿用原教師後台 `admin.html`、Supabase 管理員登入與 `admin-dashboard`。中控只收到統計、核准梯次名稱與本次讀取時間；原後台繼續處理個別報名。沒有新增管理員、放寬既有完整名冊 API 的 CORS，亦不將姓名、聯絡方式、訂單編號、答案或金額傳送至中控。

新讀取模式是 `GET admin-dashboard?view=teacher-overview`。須同時符合原 `ADMIN_EMAILS`、原 `ALLOWED_ORIGIN`，以及下列三項明確設定，缺一即回 403：

- `OVERVIEW_TEACHER_COURSE_ID`：教師專班 course UUID。
- `OVERVIEW_TEACHER_COHORT_IDS`：本次核准的 1–12 個 cohort UUID，以逗號分隔；每個必須屬於上述 course。
- `OVERVIEW_TEACHER_EXPIRES_AT`：UTC ISO 時間，最長距現在 7 天；到期立即拒絕摘要。

統計由資料庫精確計數，不受原後台名冊 500 筆上限影響。「已付款」含分期；「付款異常」為 `payment_failed/refunding`；「寄信失敗」限課前資料確認信，兩類可能重疊。來源未提供全表更新時間，因此回傳 `sourceUpdatedAt: null`；`readAt` 是本次成功讀取時間。

原後台只在中控以帶有隨機 nonce 的連結開啟時，向指定中控 origin 回傳這個最小摘要。來源分頁關閉、管理員登出、讀取失敗或授權到期時，中控清除數字。原後台仍會為自身頁面讀取完整名冊，這些資料不送入中控。

正式發布需先核定梯次及有效期限，再部署原後台靜態頁及 Edge Function，最後發布中控。發布後以原管理員登入，在相同核准梯次核對中控與原後台數字、來源時間、過期與登出清除行為。部署前本候選不產生正式資料。
