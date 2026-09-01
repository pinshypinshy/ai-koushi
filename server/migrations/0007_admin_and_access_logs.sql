-- 運営管理ページ（§4.7）のために追加する2つ。

-- 管理者かどうか。判定はセッションではなくこの列を毎回参照する。
-- セッション（JWT）に載せると、剥奪しても発行済みのトークンが期限まで管理者のまま残る。
-- 許可リストと同じく「認証できること」と「操作を許すこと」を分ける（§4.6）。
ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0
  CHECK (is_admin IN (0, 1));

-- ログインの記録（§4.7）。成功だけでなく拒否・失敗も残す。
--
-- user_id に FK を張らないのは、利用者を削除しても監査の記録は残す必要があるため
-- （ai_usage_logs と同じ理由。連鎖削除されると「誰が弾かれたか」の履歴が消える）。
-- 失敗時は利用者が特定できないため NULL になる。
--
-- IP を残すのは、上限が利用者ごとに数える設計であり（§8.2.3、Q-26）、発行した
-- ゲストIDを複数人で使い回されると費用が想定の人数分だけ超えるため。離れた回線からの
-- 同一IDのログインは、これが無いと検知する手段が無い。
-- User-Agent は残さない。自己申告で偽装でき、身内利用では得られるものが無いのに
-- 個人に紐づく情報だけが増える。
CREATE TABLE access_logs (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  kind       TEXT NOT NULL CHECK (kind IN ('google', 'guest')),
  -- 試行に使われた識別子（Google はメールアドレス、ゲストはログインID）。
  -- 失敗した試行には対応する利用者が存在しないため、user_id とは別に持つ
  identifier TEXT NOT NULL,
  -- success=通過、denied=許可リストに無い、failed=認証そのものの失敗、locked=ロック中の試行
  result     TEXT NOT NULL CHECK (result IN ('success', 'denied', 'failed', 'locked')),
  ip         TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_access_logs_created ON access_logs (created_at DESC);
CREATE INDEX idx_access_logs_user ON access_logs (user_id, created_at DESC);
