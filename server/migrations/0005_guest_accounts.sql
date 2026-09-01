-- ゲストサインイン（Q-26）。Google アカウントを持たない相手に、運営が発行した
-- ID とパスワードで利用してもらうための仕組み。
--
-- 種別を users に持たせるのは、AI の利用上限をゲストだけ絞るため（§8.2.3 の上限は
-- 利用者ごとに数えるため、ゲストが増えるとその人数分だけ費用が積み上がる）。
ALTER TABLE users ADD COLUMN kind TEXT NOT NULL DEFAULT 'google'
  CHECK (kind IN ('google', 'guest'));

CREATE TABLE guest_accounts (
  -- ログインに使う ID。運営が発行する
  login_id      TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- パスワードは平文で保存しない。PBKDF2-SHA256 の導出鍵と、その材料を持つ
  password_hash TEXT NOT NULL,
  salt          TEXT NOT NULL,
  iterations    INTEGER NOT NULL,
  -- 総当たりへの備え（§8.3）。一定回数の失敗で一時的に締める
  failed_count  INTEGER NOT NULL DEFAULT 0,
  locked_until  INTEGER,
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER
);
CREATE INDEX idx_guest_accounts_user ON guest_accounts (user_id);
