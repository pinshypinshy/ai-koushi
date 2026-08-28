-- コンテキストキャッシュ（§5.4 / §8.2）の参照を保持する。
-- キャッシュはモデルごとに別物になるため、(course_id, model) を主キーとする。
-- 講義を削除したらキャッシュ参照も不要になるため連鎖削除する
-- （Google 側の実体は TTL で消える）。
CREATE TABLE course_caches (
  course_id  TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  model      TEXT NOT NULL,
  cache_name TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (course_id, model)
);
