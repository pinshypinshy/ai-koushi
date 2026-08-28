-- REQUIREMENTS.md §6.3「テーブル定義」/ §6.5「インデックス」に対応する。
-- 型は §6.2 の方針に従い、識別子=TEXT、日時=INTEGER(Unixエポックミリ秒)、
-- 真偽値=INTEGER(0/1)、列挙=TEXT+CHECK、配列=TEXT(JSON) とする。

CREATE TABLE users (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE TABLE courses (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('generating', 'ready', 'failed')),
  -- 生成中の段階（§7.4「進捗の粒度」）。ready / failed では NULL
  phase         TEXT CHECK (phase IN ('outline', 'quiz')),
  -- 失敗時にユーザーへ提示する文言（§4.1.6）
  error_message TEXT,
  -- Workflow インスタンスID。状態照会に用いる（§7.4）
  workflow_id   TEXT,
  -- steps を参照するが、steps も courses を参照するため FK 制約は張らない。
  -- 制約を張ると講義行の INSERT 時点で参照先が存在せず、挿入順序に制約が生じる。
  current_step_id TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_courses_user_updated ON courses (user_id, updated_at DESC);

-- 教材原文は数万文字に達するため、講義一覧のクエリを軽く保つ目的で courses から分離する
CREATE TABLE materials (
  id           TEXT PRIMARY KEY,
  course_id    TEXT NOT NULL UNIQUE REFERENCES courses(id) ON DELETE CASCADE,
  raw_markdown TEXT NOT NULL,
  char_count   INTEGER NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE TABLE steps (
  id           TEXT PRIMARY KEY,
  course_id    TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  order_index  INTEGER NOT NULL,
  title        TEXT NOT NULL,
  objective    TEXT NOT NULL,
  -- 要点の配列（§5.2 key_points）を JSON 文字列として格納する
  key_points   TEXT NOT NULL DEFAULT '[]',
  source_ref   TEXT,
  status       TEXT NOT NULL DEFAULT 'not_started'
               CHECK (status IN ('not_started', 'in_progress', 'completed')),
  -- ⑤ステップ要約生成の結果（§5.1）。未完了では NULL
  summary      TEXT,
  completed_at INTEGER
);
-- 進捗パネルの取得順。UNIQUE 制約を兼ねる（§6.5）
CREATE UNIQUE INDEX idx_steps_course_order ON steps (course_id, order_index);

CREATE TABLE messages (
  id         TEXT PRIMARY KEY,
  step_id    TEXT NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_messages_step_created ON messages (step_id, created_at);

-- 設問はステップではなく講義に従属する（§4.3.1.1）
CREATE TABLE questions (
  id          TEXT PRIMARY KEY,
  course_id   TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL,
  stem        TEXT NOT NULL,
  explanation TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_questions_course ON questions (course_id);

-- 単一ステップ設問は1行、横断設問は複数行を持つ（§6.3）
CREATE TABLE question_steps (
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  step_id     TEXT NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
  PRIMARY KEY (question_id, step_id)
);
CREATE INDEX idx_question_steps_step ON question_steps (step_id);

CREATE TABLE choices (
  id          TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL CHECK (order_index BETWEEN 0 AND 3),
  body        TEXT NOT NULL,
  is_correct  INTEGER NOT NULL CHECK (is_correct IN (0, 1))
);
CREATE UNIQUE INDEX idx_choices_question_order ON choices (question_id, order_index);

-- 上書きではなく追記する（§4.3.3）。is_correct は復習モードの抽出を単純化するため非正規化
CREATE TABLE attempts (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id        TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  selected_choice_id TEXT NOT NULL REFERENCES choices(id) ON DELETE CASCADE,
  is_correct         INTEGER NOT NULL CHECK (is_correct IN (0, 1)),
  answered_at        INTEGER NOT NULL
);
CREATE INDEX idx_attempts_question_answered ON attempts (question_id, answered_at DESC);

-- §8.4 のログ要件と §8.2.4 のコスト保護に用いる。
-- user_id / course_id に FK を張らないのは、講義を削除しても当月の課金実績が
-- 消えてはならないため（削除で月間コストの集計が狂うと上限判定が誤る）。
CREATE TABLE ai_usage_logs (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL,
  course_id           TEXT,
  purpose             TEXT NOT NULL
                      CHECK (purpose IN ('outline', 'quiz', 'lecture', 'answer', 'summary')),
  model               TEXT NOT NULL,
  input_tokens        INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens       INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd  REAL    NOT NULL DEFAULT 0,
  duration_ms         INTEGER NOT NULL DEFAULT 0,
  error               TEXT,
  created_at          INTEGER NOT NULL
);
CREATE INDEX idx_ai_usage_user_created ON ai_usage_logs (user_id, created_at DESC);
CREATE INDEX idx_ai_usage_course ON ai_usage_logs (course_id);
