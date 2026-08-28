# AI講師

参考書をアップロードすると、AIがその内容を学習に適したステップへ分解し、
チャット形式の講義として順に解説する Web アプリ。理解度は選択式の確認テストで測定し、
誤答した問題だけを後から復習できる。

「読む」だけで終わりがちな参考書を、「解説される → 質問できる → 測定される」という
能動的な学習サイクルに変換することを目的とする。

## 現在の状態

**フロントエンドとサーバーが、それぞれ独立して動く段階。** 画面はモックデータ上で
一通り操作でき、サーバー側は認証と AI 呼び出しまで実装済みだが、両者はまだ接続していない。
そのため、画面から見える挙動は現時点でもモックのままである。

| 領域 | 状態 |
|---|---|
| 画面（全20画面） | 実装済み（モックデータ） |
| 画面遷移・状態管理 | 実装済み（モックデータ） |
| Markdown・数式（KaTeX）描画 | 実装済み |
| Cloudflare D1 のスキーマ | 実装済み |
| Google サインイン | 実装済み |
| AI 呼び出し層（Gemini） | 実装済み。①骨子生成・②確認テスト生成・⑤ステップ要約を実通信で確認済み。③④は未検証 |
| 講義作成ジョブ（Cloudflare Workflows） | 未着手 |
| フロントエンドとサーバーの接続 | 未着手 |

## 主な機能

- **講義作成** — サイドバーの「⊕ 新規講義」から開くオーバーレイで、参考書の Markdown を貼り付け、プレビューを確認して講義を作成する
- **教材タブ** — 作成に使った教材の原文を読み取り専用で表示する。AIの解説と原典を突き合わせるためのもの
- **講義タブ** — チャット形式で講義が進行し、途中で質問できる。右上に進捗状況を常時表示
- **確認テストタブ** — 4択の設問に回答する。正誤を記録し、誤答した問題のみを再挑戦できる

タブは「教材 / 講義 / 確認テスト」の3つで、いずれも選択中の講義に対するビューである。
講義の新規作成はタブに含めず、一時的なオーバーレイとして扱う。

設問はステップと1対1に対応せず、複数ステップを組み合わせないと解けない横断設問を含む。
各ステップを個別に暗記しただけでは解けない設問を混ぜることで、測定力を高めている。

## 技術構成

| レイヤ | 採用 |
|---|---|
| 実行基盤 | Cloudflare Workers |
| サーバー | Hono（JSON API・ストリーミング） |
| フロントエンド | React SPA（CSR）＋ Vite ＋ TypeScript ＋ Tailwind CSS |
| 長時間ジョブ | Cloudflare Workflows |
| DB | Cloudflare D1（SQLite） |
| AI | Gemini API（3.1 Pro preview / 3.7 Flash）＋ APIキー |

Cloudflare を選んだ理由は、**HTTP リクエストの実行時間に上限がなく、AI の応答待ちが
制約にならない**ため。制限されるのは CPU 時間で、`fetch()` の待機時間はそこに算入されない。
詳細は [REQUIREMENTS.md](REQUIREMENTS.md) §7.2 を参照。

Gemini を選んだ理由は、**受講中のコストが「教材全文を毎ターン読む」部分に支配されており、
キャッシュの読み取り単価がそのまま総額を決める**ため。講義1件あたり約 $0.56 で、
Claude 構成に対しておよそ1/5に収まる。他社との比較は §11.3.1 を参照。

ただし**講義作成（①②）だけは入力ではなく出力に支配される**。実測では作成コストの約9割が
出力トークンで、その65%が思考トークンだった。詳細は §8.2.2 を参照。

Pro 系で実在するモデルは `gemini-3.1-pro-preview` のみである（2026-08-27 時点）。
preview は予告なく変わりうるため、モデルIDは設定値として `server/wrangler.jsonc` に外出ししている。

## 開発

Node.js は `.node-version` で固定している（22.20.0）。

### 初回のみ

依存をそれぞれインストールする。

```bash
cd app && npm install
```

```bash
cd server && npm install
```

ローカルの D1 にマイグレーションを適用する。

```bash
cd server && npm run db:migrate
```

サーバーのシークレットは `server/.dev.vars` に置く（git 管理外）。雛形が用意してあるので、
`GOOGLE_CLIENT_ID`・`GOOGLE_CLIENT_SECRET`・`SESSION_SECRET`・`GEMINI_API_KEY` を埋める。
`SESSION_SECRET` は `openssl rand -base64 32` の出力でよい。

Google OAuth のクライアントには、承認済みリダイレクト URI として
`http://localhost:5173/auth/callback` と `http://localhost:8787/auth/callback` を登録しておく。

### 起動

2プロセスを並行して動かす。

```bash
cd server && npm run dev
```

```bash
cd app && npm run dev
```

ブラウザからは `http://localhost:5173` だけを使う。`/api` と `/auth` は Vite の proxy が
`http://localhost:8787` のサーバーへ転送するため、フロントとサーバーが同一オリジンに揃う。

| コマンド | 場所 | 内容 |
|---|---|---|
| `npm run dev` | app / server | 開発サーバー |
| `npm run build` | app | 型チェックと本番ビルド |
| `npm run lint` | app | ESLint |
| `npm run typecheck` | server | 型チェック |
| `npm run db:migrate` | server | ローカル D1 へマイグレーション適用 |

リモートの D1 作成（`npm run db:create`）とデプロイには Cloudflare アカウントと
`wrangler login` が必要になる。ローカル開発だけなら不要。

### 画面の確認

通常の操作では到達しにくい画面（生成中、生成失敗、講義0件、復習モードの対象なし など）は、
画面右下の **「画面一覧」** から直接開ける。要件定義書の画面ID（SC-01〜SC-16）に対応している。
このパネルは開発用で、製品には含めない。

モバイル版はブラウザの幅を 767px 以下にすると確認できる。

## ディレクトリ構成

```
ai-koushi/
├── REQUIREMENTS.md      要件定義書（全11章）
├── .node-version        Node のバージョン固定
├── .claude/
│   └── launch.json      開発サーバーの起動設定
├── shared/
│   └── api.ts           app と server で共有する API の型
├── app/
│   └── src/
│       ├── types.ts         画面が使うデータモデルの型定義
│       ├── store.ts         状態とロジック（reducer）
│       ├── StoreProvider.tsx
│       ├── mock/            モック教材・講義台本・設問
│       ├── hooks/           useMediaQuery / useKeyboardOpen
│       ├── components/      Sidebar, TabBar, ProgressPanel, PromptInput,
│       │                    Modal, Markdown, DevPanel, Icons
│       └── screens/         Login, EmptyState, CreateOverlay, Generating,
│                            GenerateFailed, MaterialTab, LectureTab, QuizTab
└── server/
    ├── wrangler.jsonc       D1 バインディング・モデルID・環境変数
    ├── .dev.vars            ローカル用シークレット（git 管理外）
    ├── migrations/          D1 のマイグレーション
    └── src/
        ├── index.ts         Hono のエントリとルーティング
        ├── env.ts           バインディングと環境変数の型
        ├── auth/            セッション、Google OAuth、許可リスト
        ├── db/              クエリ、ユーザー、キャッシュ参照
        ├── ai/              AI 呼び出し層（インターフェースと Gemini 実装）
        └── routes/          講義・教材のエンドポイント、開発用の確認
```

## 要件定義書

設計上の判断はすべて [REQUIREMENTS.md](REQUIREMENTS.md) に記録している。
決定事項とその根拠は §10 に集約されており、未決事項も同じ章にある。

実装前に読むべき箇所：

| 章 | 内容 |
|---|---|
| §3 | 全20画面のワイヤーフレームと表示条件 |
| §5 | Gemini API の呼び出し設計（5種類）と出力スキーマ |
| §6 | データモデル（D1 向けの型読み替えを含む） |
| §7 | 技術選定とその根拠 |
| §8.2 | コスト設計。コンテキストキャッシュは実装必須事項 |
| §8.3 | セキュリティ。教材は外部から持ち込まれるテキストとして扱う |

## 注意

個人利用を前提とした MVP であり、不特定多数への公開は想定していない。
公開に移行する場合に必要な事項は §11.3 に列挙してある。
