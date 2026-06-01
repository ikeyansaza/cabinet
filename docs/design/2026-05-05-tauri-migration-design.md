# 設計: Tauri デスクトップアプリ化

- **日付**: 2026-05-05
- **対象**: album（旧 moko.album）
- **ステータス**: 設計合意済み

## 目的

純静的サイトとして動いている album を、macOS 個人用デスクトップアプリに移行する。動機：

- ローカル限定運用に振り切ったので、HTTP サーバ起動の手間を省きたい
- HTTP サーバ経由よりサクサクした体験にしたい
- 写真を Google Photos からダウンロードしてフォルダに置く運用に合わせて、photos/ の変更を自動で拾いたい
- macOS のシステムメニュー・ウィンドウ管理など、デスクトップアプリらしい使い心地にしたい

## 非ゴール（YAGNI）

- 写真編集機能（クロップ・色補正など）は載せない。Lightroom 等の外部ツール継続
- species.json の GUI エディタ。手動編集（Claude Code を含む）でいい
- macOS 以外への配布。個人の Mac でしか使わない
- コード署名 / notarization。Gatekeeper を許可するだけで動く
- Google Photos との直接連携。手動ダウンロード運用のまま
- 多言語対応。日本語のまま

## スコープ

含む:

- Tauri (Rust) によるデスクトップアプリ化
- 既存 frontend（index.html / gallery.js / style.css）の流用
- EXIF パースの Rust 移植（`gen_photos.py` 相当を Tauri command 化）
- フォトフォルダのファイルウォッチャーによる自動再スキャン
- macOS 標準のシステムメニュー（Cmd+O / Cmd+R / Cmd+W）
- ドラッグ＆ドロップによるフォトフォルダ選択
- アプリ状態（最後のフォルダ・ウィンドウサイズ）の永続化
- `gen_photos.py` の CLI スクリプトは継続（消さない）

## アーキテクチャ

macOS only、1 つの Tauri アプリ。

```
album.app
├── WebView (Frontend)   既存の index.html / gallery.js / style.css をほぼ流用
└── Rust (Backend)       Tauri commands + EXIF パース + ファイルウォッチャー
```

ユーザのフォトフォルダ（例: `~/Pictures/album/`）の中に `photos.json` と `species.json` を置く運用。アプリ自身の状態は `~/Library/Application Support/album/state.json` に保存（macOS 標準のやり方）。

## ファイル構成（移行後）

```
album/                          # リポジトリ
├── src-tauri/                  # Rust 側（新規）
│   ├── src/
│   │   ├── main.rs
│   │   ├── exif.rs             # EXIF パース
│   │   ├── scan.rs             # フォルダ走査 + photos.json マージ
│   │   └── watcher.rs          # ファイルウォッチャー
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── icons/                  # アプリアイコン
├── src/                        # Frontend（旧 root から移動）
│   ├── index.html
│   ├── gallery.js
│   └── style.css
├── scripts/
│   └── gen_photos.py           # CLI 用に維持
├── docs/
├── CLAUDE.md
└── README.md
```

`photos.json` / `species.json` / `photos/` はユーザのフォトフォルダ側。リポジトリには含めない。

## Rust 側の責務

### Tauri commands（frontend から呼ぶ API）

| command | 入力 | 出力 | 説明 |
|---|---|---|---|
| `get_photos_dir` | — | `Option<String>`（パス） | アプリ状態に保存された最後のフォトフォルダ |
| `set_photos_dir` | `path: String` | `()` | フォトフォルダを設定し、状態保存。ファイルウォッチャーを再起動 |
| `read_photos_json` | — | `Vec<PhotoEntry>` | フォトフォルダ内の `photos.json` を読み込む。無ければ空配列 |
| `read_species_json` | — | `HashMap<String, SpeciesEntry>` | `species.json` を読み込む。無ければ空辞書（warn のみ） |
| `rescan` | — | `Vec<PhotoEntry>` | フォルダを走査し EXIF を取得。既存 photos.json と merge して保存。新しい配列を返す |

写真バイナリはコマンドではなく **Tauri の asset protocol** で配信。`convertFileSrc(absPath)` で `asset://localhost/...` URL を生成して `<img src>` に渡す。fetch 経由より速い。

### EXIF パース

`kamadak-exif` crate を使用。現在の `gen_photos.py` と同じフィールドを抽出：

- `date`: `DateTimeOriginal` → `YYYY-MM-DD`
- `camera`: `Make` + `Model`（重複除去ロジックも維持）
- `lens`: `LensModel`
- `exif`: `f/X · 1/Ys · ISO Z` 形式

EXIF が無い場合は空文字。エラーにはしない。

### スキャン + マージ

`rescan` コマンドのロジック：

1. フォトフォルダの直下（再帰なし）を走査して `.jpg` / `.jpeg` / `.png` / `.webp` を列挙
2. 既存 `photos.json` を読み込む（無ければ空）
3. 各ファイルについて：
   - 既存エントリがあれば `species` / `title` / `tags` を持ち越し
   - EXIF 由来の `date` / `camera` / `lens` / `exif` は最新で上書き
4. ファイルが消えていたエントリは除外
5. `photos.json` を書き戻し、配列を返す

このロジックは現在の `gen_photos.py` と同一（merge モード）。

### ファイルウォッチャー

`notify` crate でフォトフォルダを監視。

- 監視範囲: 現在のフォトフォルダ **直下のみ**（サブフォルダは再帰しない）
- 監視対象拡張子: `.jpg` / `.jpeg` / `.png` / `.webp`（HEIC は表示できないので除外）
- 変更（追加・削除・リネーム）を検知 → **500ms デバウンス** → `rescan` 実行 → frontend に Tauri イベント `photos-updated` を emit
- フォルダ変更時（`set_photos_dir`）はウォッチャーを停止して新フォルダで再起動

### アプリ状態

`tauri-plugin-store` を使う。保存先 `~/Library/Application Support/album/state.json`（macOS 標準パスは Tauri が解決）。

| キー | 型 | 用途 |
|---|---|---|
| `photos_dir` | `String?` | 最後に開いたフォトフォルダ |
| `window` | `{ width, height, x, y }` | ウィンドウサイズ・位置 |

ウィンドウ位置は Tauri の `tauri-plugin-window-state` を使えば自動。手書きするより安全。

## Frontend 側の責務

既存の `index.html` / `style.css` はほぼそのまま流用。`gallery.js` だけ Tauri API に合わせて手を入れる。

### gallery.js の変更点

| 旧 | 新 |
|---|---|
| `fetch('photos.json').then(r => r.json())` | `await invoke('read_photos_json')` |
| `fetch('species.json').then(r => r.json())` | `await invoke('read_species_json')` |
| `<img src="photos/${file}">` | `<img src="${convertFileSrc(absPath)}">`（絶対パスを Rust から受け取る、または相対→絶対変換） |

`convertFileSrc` は `@tauri-apps/api/core` から import。

### 起動時シーケンス

1. `await invoke('get_photos_dir')` で最後のフォルダを取得
2. 値があれば `read_photos_json` + `read_species_json` を並列実行 → グリッド描画
3. 値が無ければ「フォルダをドラッグ＆ドロップしてください」画面を表示
4. ドラッグ＆ドロップ受付（HTML5 DnD API）→ `set_photos_dir` → 1 へ

### イベント受信

`listen('photos-updated', () => { invoke('read_photos_json').then(redraw) })` で自動再描画。

### システムメニュー

`tauri.conf.json` または `setup` で構築：

| ショートカット | 動作 |
|---|---|
| `Cmd+O` | フォルダ選択ダイアログ → `set_photos_dir` |
| `Cmd+R` | `rescan` を呼んで再描画 |
| `Cmd+W` | ウィンドウを閉じる（macOS 標準） |
| `Cmd+Q` | アプリ終了（macOS 標準） |

メニューバーは macOS 流の `album` メニュー + `File` メニュー + `View` メニュー。

## エラーハンドリング

| ケース | 挙動 |
|---|---|
| フォルダが存在しない | 「フォルダが見つかりません」表示 +「フォルダを選び直す」ボタン |
| フォルダにアクセス権がない | 同上、メッセージだけ変える |
| `photos.json` が無い | 初回 rescan で自動生成（空配列でも OK） |
| `species.json` が無い | console.warn のみ。図鑑情報は出ない（既存挙動と同じ） |
| EXIF 読み込み失敗 | そのファイルだけ EXIF フィールド空、scan は続行 |
| ファイルウォッチャー起動失敗 | warn、手動 rescan は使える |

致命的なエラーはダイアログ表示。recoverable なものは UI 上のメッセージ。

## XSS 対策

既存ルール継続。`renderSpecies` は `textContent` のみ。`gallery.js` の `esc()` も継続使用。Tauri の `invoke` 戻り値も信用しない（一応）。

## 検証

このプロジェクトには自動テストフレームワークが無い。Rust 側だけ最小限のユニットテストを書く：

| 対象 | テスト |
|---|---|
| `exif.rs` | サンプル JPEG 1〜2 枚で EXIF 抽出が正しいこと |
| `scan.rs` | merge 挙動: 既存 species/title/tags の保持、消えたファイルの除外、新規ファイルの追加 |

Frontend と E2E は手動確認：

1. アプリ起動 → 初回はドラッグ＆ドロップ画面
2. フォルダをドロップ → グリッド表示
3. 写真クリック → ライトボックス + 図鑑表示
4. フォルダに新しい写真を追加 → 自動でグリッドに反映
5. アプリ再起動 → 同じフォルダ・ウィンドウ位置で起動
6. `Cmd+R` で手動 rescan
7. `Cmd+O` で別フォルダに切替
8. species.json を直接編集 → 次回ライトボックス表示で反映

## 影響を受けるファイル

| ファイル | 変更 |
|---|---|
| `src-tauri/` 一式 | 新規作成 |
| `index.html` / `gallery.js` / `style.css` | `src/` 配下に移動。`gallery.js` のみ Tauri API 対応で書き換え |
| `photos.json` / `species.json` | リポジトリから削除（ユーザのフォトフォルダ側へ） |
| `photos/.gitkeep` | リポジトリから削除（フォトフォルダはリポジトリ外なので不要） |
| `scripts/gen_photos.py` | 維持（CLI 用） |
| `CLAUDE.md` | Tauri 化に伴う運用ルール更新 |
| `README.md` | ビルド手順・起動手順を Tauri に置き換え |
| `package.json` | 新規（Tauri は npm で管理） |
| `.gitignore` | `src-tauri/target/` 等を追加 |

## 配布

- 開発時: `pnpm tauri dev`（または npm/yarn）
- ビルド: `pnpm tauri build` → `src-tauri/target/release/bundle/macos/album.app`
- インストール: 生成された `.app` を `/Applications/` にコピー
- 初回起動時 Gatekeeper が出るが、右クリック→開く で通る（個人用なので署名なし）

## マイグレーション手順（実装時の流れ）

1. Tauri プロジェクト初期化（`pnpm create tauri-app`）し、既存 frontend を `src/` 配下に組み込む
2. Rust 側で `read_photos_json` / `read_species_json` / `set_photos_dir` / `get_photos_dir` を実装
3. `gallery.js` を Tauri API に書き換え、起動時シーケンスを実装
4. ドラッグ＆ドロップ画面実装
5. asset protocol で写真表示
6. EXIF パース + scan + merge を Rust 実装
7. `rescan` コマンド + システムメニュー
8. ファイルウォッチャー
9. ウィンドウ状態の永続化（plugin-window-state）
10. CLAUDE.md / README 更新
11. 既存 `photos.json` / `species.json` / `photos/.gitkeep` をリポから削除（ユーザがフォトフォルダに移動）
