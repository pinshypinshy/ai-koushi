-- §4.1.6「確認テスト生成失敗：骨子は保存済みのため講義自体は利用可能とし、
-- 確認テストタブに『テストの生成に失敗しました／再生成する』を表示する」。
--
-- courses.status（generating / ready / failed）だけではこの状態を表現できない。
-- failed にすると講義タブまで利用不可になり、ready にすると失敗した事実が消える。
-- テストの状態は講義の状態と独立に動くため、列を分ける。
--
-- pending は「まだ無い」（初回生成中と再生成中の両方を含む）。
-- 逆向きの組み合わせ（講義が failed でテストが ready）は、②が①の出力を入力に取る以上
-- 到達経路が存在しないため、CHECK では縛らずコード側の実行順序で保証する。
ALTER TABLE courses ADD COLUMN quiz_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (quiz_status IN ('pending', 'ready', 'failed'));
