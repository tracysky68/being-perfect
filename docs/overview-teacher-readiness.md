# 教師專班摘要接線候選（未部署）

沿用原教師後台 `admin.html`、Supabase 管理員登入與 `admin-dashboard`。中控只收到統計、核准梯次名稱與本次讀取時間；原後台繼續處理個別報名。沒有新增管理員、放寬既有完整名冊 API 的 CORS，亦不將姓名、聯絡方式、訂單編號、答案或金額傳送至中控。

新讀取模式是獨立的 `GET teacher-overview`，不再修改原 `admin-dashboard` 的 GET／POST 行為。原管理頁仍使用 `admin-dashboard` 讀寫名冊，只有中控連線模式會請求 `teacher-overview`。原後台連線須同時符合 `ADMIN_EMAILS`、原 `ALLOWED_ORIGIN`，以及下列三項明確設定，缺一即回 403：

2026-10-12 的中控單次登入隔離候選只在 `OVERVIEW_CENTRAL_ORIGIN` 精確設為 `https://being-perfect-core-workbench.onrender.com` 時，額外允許該來源向**同一** `teacher-overview` Function 提出 GET；管理員 token、原三項梯次／期限設定仍照常檢查，`admin-dashboard` 與原後台來源限制不變。此選項預設關閉，尚未部署。中控端也預設關閉，需獨立啟用 `OVERVIEW_TEACHER_SERVER_READ=enabled`。10/13 已唯讀核對正式 Supabase Auth 唯一使用者 UID 等於中控固定 subject，正式 `ADMIN_EMAILS` 摘要與該帳號電子郵件完全相符；原教師後台可載入 13 筆名冊。不得偽裝原後台 Origin 或共用密碼。

- `OVERVIEW_TEACHER_COURSE_ID`：教師專班 course UUID。
- `OVERVIEW_TEACHER_COHORT_IDS`：本次核准的 1–12 個 cohort UUID，以逗號分隔；每個必須屬於上述 course。
- `OVERVIEW_TEACHER_EXPIRES_AT`：UTC ISO 時間，最長距現在 7 天；到期立即拒絕摘要。

統計由資料庫精確計數，不受原後台名冊 500 筆上限影響。「已付款」含分期；「付款異常」為 `payment_failed/refunding`；「寄信失敗」限課前資料確認信，兩類可能重疊。來源未提供全表更新時間，因此回傳 `sourceUpdatedAt: null`；`readAt` 是本次成功讀取時間。

原後台只在中控以帶有隨機 nonce 的連結開啟時，向指定中控 origin 回傳這個最小摘要。來源分頁關閉、管理員登出、讀取失敗或授權到期時，中控清除數字。原後台仍會為自身頁面讀取完整名冊，這些資料不送入中控。

發布既有 `admin-dashboard` 的第一次候選 v28 後，原管理頁的完整名冊 GET 回 500；已以正式備份回復 v29，原後台立即恢復 13 筆。獨立 Function 將摘要讀取與原後台分離，避免摘要故障影響原管理功能。正式發布後仍須以原管理員登入，在相同核准梯次核對中控與原後台數字、來源時間、過期與登出清除行為。
