-- §8.2.3 の月間上限を、特定の利用者だけ既定値から外すための列（Q-31）。
--
-- NULL は「種別（google / guest）の既定値に従う」を意味する。既定値そのものは
-- server/src/limits.ts に残し、ここには例外だけを置く。既定値まで DB へ移すと、
-- 上限の出どころが2箇所になり、どちらが効いているかを読めなくなる。
--
-- 件数と金額を別々の列にするのは、片方だけ緩めたい場合（例：ゲストに講義数だけ
-- 追加で許すが費用は据え置く）があるためである。
ALTER TABLE users ADD COLUMN course_limit INTEGER;
ALTER TABLE users ADD COLUMN cost_limit_usd REAL;
