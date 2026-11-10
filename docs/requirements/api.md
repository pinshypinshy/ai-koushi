# 要件定義書：API仕様（§12）

[目次へ戻る](../REQUIREMENTS.md)

## 12. API仕様

### 12.1 方針

- **型の正は `shared/api.ts` に置く。** 本章はリクエストとレスポンスを型名で参照し、フィールドを書き写さない。
  書き写すと、型を変えたときに本章が古いまま残る（二重定義）。フィールドの意味は型定義のコメントに書く
- 本章が扱うのは、型では表せないことに限る。パス・認可・受け付ける状態・エラー・副作用（AI 呼び出し・上限・計上）である
- ルートを足したり挙動を変えたりしたら、本章も同じ変更で直す
- 実装の場所：`server/src/index.ts`（どのパスにどのルートを割り当てるか）、`server/src/auth/routes.ts`、`server/src/routes/*.ts`

### 12.2 共通事項

#### 12.2.1 パスの区分

| プレフィックス | 用途 | 認可 |
|---|---|---|
| `/auth` | サインイン・サインアウト | なし（サインインの入口であるため） |
| `/api` | 利用者向けの API | `requireUser` を各ルートに明示する（`/api/health` を除く） |
| `/api/admin` | 運営管理ページ（§4.7） | `requireAdmin` を各ルートに明示する |
| `/api/dev` | 開発時の確認用 | `APP_ORIGIN` が `http://localhost` で始まるときだけ到達できる。本番では 404 |
| 上記以外 | SPA の配信 | Workers のアセット配信が返す。無いパスは `index.html` |

`/api/*` と `/auth/*` は、アセットより先に Worker が受ける（`wrangler.jsonc` の `run_worker_first`）。
これが無いと、API のパスにも `index.html` が返る。

認可を `/api/*` にワイルドカードで当てないのは、後から別のプレフィックスで生やしたルートまで 401 になるためである（CLAUDE.md）。

#### 12.2.2 セッション

| 項目 | 仕様 |
|---|---|
| 表現 | 自前の署名付き Cookie `ak_session`（JWT、HS256）。Google のトークンは保持しない（§4.6） |
| 中身 | 利用者ID・メールアドレス・表示名・種別（`google` / `guest`）・期限 |
| 期限 | 30日 |
| 属性 | `HttpOnly`、`SameSite=Lax`、`Path=/`。`Secure` は配信元が `https://` のときだけ付ける（`http://localhost` では Secure 付きの Cookie が保存されないため） |
| 失効 | 署名が不正、または期限が切れていれば未ログインとして扱う。サーバー側に失効の一覧は持たないため、許可を取り消しても発行済みのセッションは期限まで残る |

`requireAdmin` は Cookie で本人を確かめた後、`users.is_admin` をリクエストのたびに引く（Q-27）。
上限の個別設定（Q-31）も同じ理由でセッションに載せない。

#### 12.2.3 エラー応答

失敗はすべて `ApiError`（`{ error, message }`）で返す。`error` は機械向けの識別子、`message` は画面にそのまま出せる日本語である。

| HTTP | `error` | 発生する場面 |
|---|---|---|
| 400 | `invalid_request` | 本文が JSON でない、または必須項目が無い・空 |
| 400 | `invalid_material` | 教材が 500〜80,000 文字の範囲外（§4.1.2） |
| 400 | `invalid_choice` | 選択肢がその設問のものではない |
| 401 | `unauthorized` | 未ログイン。ゲストのサインイン失敗もこれで返す |
| 403 | `forbidden` | 管理者ではない |
| 403 | `limit_exceeded` | 月間上限、または講義単位のトークン上限に達した（§8.2.3） |
| 404 | `not_found` | 対象が無い。**他の利用者の講義・設問も 404 にする**（SEC-2。403 を返すと、そのIDが存在することを教えてしまう） |
| 409 | 各種 | 講義の状態がその操作を受け付けない。識別子は §12.5〜§12.6 の各ルートに記す |
| 429 | `locked` | ゲストのサインインが連続失敗でロック中 |
| 500 | `internal` | 想定外の例外（`app.onError`）。ログに残す（§8.4） |
| 502 | `workflow_failed` | 講義作成ジョブ（Workflow）を起動できなかった |
| 503 | `not_configured` | Google OAuth の設定値が無い（ローカルで `.dev.vars` を入れていない場合） |

ライブラリが投げる `HTTPException`（OAuth の `state` 不一致など）は、そのステータスのまま `request_failed` として返す。
500 に塗り潰すと、原因が利用者側にあるのかサーバー側にあるのかが区別できなくなる。

#### 12.2.4 ストリーミング（NDJSON）

③講義本文・④質問応答・再生成の応答は、`application/x-ndjson` で1行に1件の JSON を流す。行の型は `LectureStreamLine` である。

| 行 | 意味 | 来る回数 |
|---|---|---|
| `{ delta }` | 生成された文字の断片 | 0回以上 |
| `{ done }` | 保存された発言（`ApiMessage`）。応答の正常終了 | 最後に1回 |
| `{ error }` | 途中で失敗した。`partialSaved` が真なら、途中までの発言が「途切れた発言」として保存されている（§5.7、Q-33） | 最後に1回 |

`done` と `error` は、どちらか一方だけが最後に来る。HTTP のステータスは、ストリームを始めた時点で 200 に確定する。
始まる前に分かる失敗（404・403・409）だけが、通常の `ApiError` で返る。

キャッシュを禁止する（`cache-control: no-store`）。途中結果を経路上で溜め込まれると、§8.1 の初回トークン到達時間を満たせないためである。
トークンの計上は、応答が成功したかどうかに関わらず行う（§8.2.4）。

### 12.3 認証（`/auth`）

| メソッド・パス | 内容 | リクエスト | 成功時 |
|---|---|---|---|
| `GET /auth/callback` | Google サインインの往路と復路を兼ねる。`code` が無ければ Google へ 302、有れば認可コードを交換する | — | 302（`APP_ORIGIN` へ） |
| `GET /auth/google` | 往路の別名。ミドルウェアが Google へ 302 するため、ハンドラ本体には到達しない | — | 302 |
| `POST /auth/guest` | ゲストサインイン（Q-26） | `{ loginId, password }`（型は未定義。§12.10） | 204 ＋ Cookie |
| `POST /auth/logout` | Cookie を消す。Google 側のトークンは失効させない（保持していないため） | — | 204 |

**Google の復路での失敗**は、JSON ではなくログイン画面へのリダイレクトで伝える（`/?auth_error=<理由>`）。
理由を分けるのは、利用者が取るべき行動が異なるためである。

| `auth_error` | 条件 |
|---|---|
| `failed` | Google からメールアドレスを得られなかった |
| `unverified` | Google 側でメールアドレスが未確認 |
| `not_allowed` | 許可リスト（`allowed_emails`）に無い |

**ゲストの総当たり対策**（§4.6）：

- 10回連続で失敗すると15分ロックし、429 を返す
- 「ID が無い」と「パスワードが違う」は同じ 401 を返す。ID が無いときもダミーの鍵導出を行い、応答時間からも区別できないようにする
- 成功・失敗・拒否・ロックをすべて `access_logs` に記録する（§4.7）

### 12.4 起動・利用状況

| メソッド・パス | 内容 | レスポンス |
|---|---|---|
| `GET /api/health` | 疎通確認。DB に触れない。認可なし | `{ ok: true }` |
| `GET /api/me` | ログイン状態の確認 | `ApiUser`（§12.10） |
| `GET /api/bootstrap?courseId=` | 初回ロード。講義一覧・選択中の講義・利用者・利用状況を1往復で返す（§6.4、§7.6） | `BootstrapResponse` |
| `GET /api/usage` | 今月の利用状況（A-5） | `UsageSummary` |

- `bootstrap` は、`courseId` を省くと一覧の先頭の講義を選ぶ。指定した講義が引けないときだけ 404 を返す
- `usage` を呼ぶのは、AI を消費した後（講義の生成完了時・受講の応答完了時）だけにする。起動時は `bootstrap` に同梱されているため呼ばない。定期的なポーリングもしない（§8.2.4）

### 12.5 講義

| メソッド・パス | 内容 | リクエスト | 成功時 | AI | 上限の判定 |
|---|---|---|---|---|---|
| `GET /api/courses/:id` | 講義の詳細。生成中のポーリングもこれで行う（§7.4） | — | 200 `CourseDetail` | — | — |
| `GET /api/courses/:id/material` | 教材原文（§4.4）。最大 240KB になるため詳細とは分ける | — | 200 `MaterialResponse` | — | — |
| `POST /api/courses` | 講義の作成（§4.1.4）。教材を保存して Workflow を起動し、完了を待たずに返す | `CreateCourseRequest` | 202 `CreateCourseResponse` | ①② | 月間コスト・月間作成数 |
| `POST /api/courses/:id/retry` | 骨子生成の失敗からの再試行。①からやり直す（§4.1.6） | — | 202 `CreateCourseResponse` | ①② | 月間コスト |
| `POST /api/courses/:id/quiz/retry` | 確認テスト生成の失敗からの再生成。②だけをやり直す（§4.1.6） | — | 202 `CreateCourseResponse` | ② | 月間コスト |
| `POST /api/courses/:id/duplicate` | 講義の複製（§4.5、Q-30） | — | 201 `DuplicateCourseResponse` | — | 月間コスト |
| `PATCH /api/courses/:id` | 名前の変更（§4.5） | `RenameCourseRequest` | 200 `{ courseId, title }`（§12.10） | — | — |
| `DELETE /api/courses/:id` | 削除（§4.5）。ステップ・対話・設問・解答記録も連鎖して消える。復元手段は無い | — | 204 | — | — |

**状態による拒否（409）**

| ルート | `error` | 条件 |
|---|---|---|
| `retry` | `already_generating` | `status=generating`（§7.4「生成中の講義には新しい Workflow を起動しない」） |
| `retry` | `not_failed` | `status` が `failed` ではない |
| `quiz/retry` | `already_generating` | `quizStatus=pending` |
| `quiz/retry` | `not_failed` | `quizStatus` が `failed` ではない |
| `duplicate` | `not_ready` | `status` が `ready` ではない（骨子が無い） |
| `duplicate` | `quiz_generating` | `quizStatus=pending`。そのまま引き写すと、対応する Workflow を持たない「生成中」の講義ができる |

**補足**

- 作成と再試行の進み具合は、`GET /api/courses/:id` の `status`・`phase`・`quizStatus` で見る（§7.4）
- 月間作成数を消費するのは `POST /api/courses` だけである。再試行は新しい講義ではなく、複製は AI を呼ばないため数えない（Q-30）
- 件数は `ai_usage_logs` の①から数えるため、`DELETE` しても当月の件数は戻らない（Q-30）
- `quiz/retry` が①を呼ばないのは、①をやり直すとステップIDが変わり、対話と解答記録との対応が壊れるためである
- Workflow の起動に失敗したら、講義を `failed`（`quiz/retry` では `quizStatus=failed`）にしてから 502 を返す。`generating` のまま残すと、永久に完了しない行になる
- タイトルを空で作成すると空文字で保存し、①が命名する（§5.2）。再試行でも同じ判定が成り立つ

### 12.6 受講

| メソッド・パス | 内容 | リクエスト | 成功時 | AI |
|---|---|---|---|---|
| `POST /api/courses/:id/lecture` | ③ 現在のステップの講義本文。ステップに到達した時点で呼ぶ（§4.2.2） | — | NDJSON（§12.2.4） | ③ |
| `POST /api/courses/:id/messages` | ④ 質問応答（§4.2.4）。理解の確認への返答もここを通る | `SendMessageRequest` | NDJSON | ④ |
| `POST /api/courses/:id/regenerate` | 途中で失敗した③④の再生成（§5.7、Q-33） | — | NDJSON | ③ または ④ |
| `POST /api/courses/:id/steps/:stepId/complete` | ステップの完了（§4.2.2）。要約を作ってから次のステップへ進める | — | 200 `CourseDetail` | ⑤ |

**共通の前提**（`complete` を除く3本）

- 受講できる状態の講義でなければ 404（`not_found`）を返す
- 講義単位の累積トークン（入力 2,000,000・出力 100,000）を超えていたら 403（`limit_exceeded`）を返す（§8.2.3）
- 月間コストの上限では止めない。§8.2.4 は、上限に達しても「既存講義の受講は継続できる」と定めている

**ルートごとの挙動**

- `messages`：質問は、生成を始める前に保存する。生成が失敗しても、利用者の発言が消えないようにするためである。本文が空なら 400
- `lecture`：全ステップの完了後は 409（`course_completed`）を返す。終えた解説がもう一度流れ、完了表示と食い違うためである（Q-32）。④は完了後も受け付ける
- `regenerate`：何をやり直すかは、クライアントではなくサーバーが決める（`regeneratePlan`）。現在のステップの発言を次のように見て判断する

  | 最後の発言 | やり直す内容 |
  |---|---|
  | 無い（③が1文字も届かずに失敗した） | ③をステップの冒頭から |
  | 回答の無い質問（④が1文字も届かずに失敗した） | その質問で④ |
  | 途切れた応答で、直前が質問 | その質問で④。成功したら途切れた発言を置き換える |
  | 途切れた応答で、直前が質問ではない | ③。成功したら途切れた発言を置き換える |
  | 最後まで届いた応答 | 409（`nothing_to_regenerate`） |

  クライアントに④を送り直させないのは、`messages` が質問を新しく保存するためである。同じ質問が二重に残り、履歴も失敗時と変わってしまう
- `complete`：`stepId` が現在のステップでなければ 409（`not_current_step`）を返す。⑤の要約に失敗しても、空の要約のまま完了させる。要約は後のステップの文脈を軽くするためのもので、それが作れないことを理由に進行を止める価値はない（§5.4）

### 12.7 確認テスト

| メソッド・パス | 内容 | リクエスト | 成功時 |
|---|---|---|---|
| `GET /api/courses/:id/quiz` | 出題（§4.3.1）。設問ごとの最新の解答も併せて返す | — | 200 `QuizResponse` |
| `POST /api/questions/:id/attempts` | 解答の採点と記録（§4.3.2、§4.3.3） | `AttemptRequest` | 200 `AttemptResult` |

- **出題には正解と解説を含めない。** 「回答する」を押す前に答えが分かると、§4.3.2 の判定が成り立たないためである。正誤・正解・解説は `attempts` の応答で初めて返す
- 出題は `order_index` の順に返す。受験のたびのシャッフルはクライアントで行う（Q-6）
- 最新の解答を返すのは、復習モード（§4.3.4）の対象（最新の解答が誤答である設問）を再訪時にも復元するためである
- 解答記録は上書きせず追記する（§4.3.3）
- 選択肢がその設問のものでなければ 400（`invalid_choice`）、選択肢が指定されていなければ 400（`invalid_request`）

### 12.8 運営管理（`/api/admin`）

すべて読み取りのみで、更新系のルートを持たない（§4.7 段階1）。全利用者を横断する SQL は `server/src/db/admin.ts` にだけ置く（SEC-2）。

| メソッド・パス | 内容 | クエリ | レスポンス |
|---|---|---|---|
| `GET /api/admin/summary` | 当月の集計 | — | `AdminSummary` |
| `GET /api/admin/users` | 利用者の一覧 | — | `AdminUsersResponse` |
| `GET /api/admin/users/:id` | 利用者1人の講義・AI呼び出し・ログイン（各50件）を1往復で返す | — | `AdminUserDetail` |
| `GET /api/admin/usage` | AI 呼び出しの記録 | `limit`・`purpose`・`errorsOnly=1`・`userId` | `AdminUsageResponse` |
| `GET /api/admin/access` | ログインの記録 | `limit`・`result`・`failuresOnly=1`・`userId` | `AdminAccessResponse` |
| `GET /api/admin/allowlist` | 許可リスト | — | `AdminAllowlistResponse` |
| `GET /api/admin/guests` | ゲストアカウント | — | `AdminGuestsResponse` |
| `GET /api/admin/config` | モデルID・上限の既定値・システムプロンプト | — | `AdminConfig` |

- `limit` は既定 100・最大 500。切り捨てたかどうかを `hasMore` で示す（黙って落とさない）
- `purpose` と `result` に未知の値を渡すと、絞り込みを行わない
- `config` のプロンプトは、ソースの写しではなく、サーバーが実際に組み立てた文字列を返す。秘密（APIキー・セッション鍵・OAuth のクライアント秘密）は返さない（SEC-1）

### 12.9 開発用（`/api/dev`）

ローカルでだけ到達できる（§12.2.1）。製品の機能ではないため、型を `shared/api.ts` に置かない。

| メソッド・パス | 内容 | 費用 |
|---|---|---|
| `GET /api/dev/ai/build` | SDK がバンドルされ、Workers で読み込めるかを見る（Q-22） | なし |
| `GET /api/dev/ai/models` | 利用できるモデルの一覧 | Gemini を呼ぶ |
| `GET /api/dev/ai/probe` | トークン計測・非ストリーミング・構造化出力・ストリーミングの疎通（Q-16、Q-22） | 数十トークン |
| `POST /api/dev/ai/generate` | Workflow を通さずに①②を実行し、出力とキャッシュの効き方を見る | 講義1件の作成と同程度 |

### 12.10 型と実装のずれ

`shared/api.ts` に型が無い、または型と実際の応答が一致していない箇所。本章を書いた時点（2026-11-09）で、実装を読んで確認したもの。

| ルート | ずれ |
|---|---|
| `POST /auth/guest` | リクエスト（`{ loginId, password }`）の型が無い。サーバーとクライアントで別々にインラインで書いている |
| `PATCH /api/courses/:id` | レスポンス（`{ courseId, title }`）の型が無い |
| `GET /api/me`、`GET /api/bootstrap` の `user` | セッションの中身をそのまま返すため、`ApiUser` に無い `kind` が含まれる |
