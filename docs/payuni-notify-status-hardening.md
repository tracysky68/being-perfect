# PAYUNi 通知狀態修正候選（2026-10-26）

這份隔離分支只修正原教師課程 `payuni-notify` 的付款狀態判讀，**未部署，也不會自動寫入帳務助手**。雙品牌首頁的 PAYUNi 商店全量交易、平台撥款與銀行入款仍是未知。

原程式用 `details.Status ?? details.TradeStatus` 任一欄判斷成功。PAYUNi 官方 WooCommerce 模組分開檢查回傳外層 `Status=SUCCESS` 和解密後 `TradeStatus=1`；`TradeStatus=0` 是待付款。現行寫法可能把待付款歸為失敗；若解密內容另有 `Status=SUCCESS`，還可能誤列為已付款。實際商店通知欄位尚待 sandbox 核對，不能宣稱這兩種誤判已在正式交易發生。[官方實作](https://github.com/payuni/PAYUNi_for_WooCommerce/blob/main/class-payuni.php)

候選行為：先驗 HashInfo，再比對商店、訂單與本次金額；只有外層成功且解密交易為已付款、有 UNi 交易號時才標已付款。待付款、付款失敗／取消、未知狀態分開處理；重送已付款通知不重設第一次驗證時間，後續矛盾通知不能降級既有已付款紀錄。原始資料同時保存外層狀態與解密狀態供稽核，並明記外層狀態不是 HashInfo 簽章內容。成功款只影響原教師課程報名狀態與原通知流程，不寫會計帳本，也不推算撥款。

本機 `node --test tests/payuni-notification.test.mjs` 五項通過（含模擬加密通知），`node --check` 與 `git diff --check` 通過。10/26 於來源資料庫只按已核准的 11 月班查詢彙總：1 筆既有 PAYUNi 通知的已存狀態為 `Status=SUCCESS`、`TradeStatus=1`、資料庫 `verified`；沒有讀出姓名、聯絡方式、訂單號或原始通知。這只核對到成功通知的解密欄位，舊資料沒有保存回傳外層 `Status`，且該梯次沒有待付款／失敗通知樣本。正式切換前仍需在 PAYUNi sandbox 確認此商店回呼的外層狀態、解密後 `MerID`、`TradeStatus` 與 `TradeNo`，再以未付款、已付款、失敗、重送、分期及寄信失敗做端到端驗證。未完成此驗證前，不能把候選部署到正式付款回呼。
