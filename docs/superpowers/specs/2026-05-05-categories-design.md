# 設計: カテゴリ（サブフォルダ）対応

- **日付**: 2026-05-05
- **対象**: cabinet
- **ステータス**: 設計合意済み

## 目的

現状アプリは単一の写真フォルダしか扱えない。動物以外（絵画・彫刻・食事など）も収蔵していくにあたって、ジャンルごとに分けて管理・閲覧できるようにする。

## スコープ

含む:

- 親フォルダ（library root）+ サブフォルダ（category）構造のサポート
- ヘッダーにカテゴリタブを追加し、クリックで切替
- カテゴリごとの `photos.json` / `species.json` を独立して読み書き
- ファイルウォッチャーをアクティブカテゴリだけに張る
- アクティブカテゴリの永続化（再起動で同じカテゴリが開く）

含まない（YAGNI）:

- カテゴリ追加・名前変更の GUI（ユーザが Finder でサブフォルダ作る）
- 複数カテゴリ横断のフィルター・検索
- カテゴリごとに異なる species.json スキーマの強制（自由フィールドで運用）
- 親フォルダ自体の追加検知（ユーザが新サブフォルダを作っても自動でタブには出ない。`Cmd+R` または再起動で拾う）

## 用語

- **parent_dir**: ライブラリのルート（例 `~/Pictures/album/`）。picker から選択
- **category**: parent_dir 直下のサブフォルダ名（例 `animals`, `arts`）。画像ファイルを 1 枚以上含むものをカテゴリとみなす
- **current_category**: 現在表示中の category。`tauri-plugin-store` に永続化

## アーキテクチャ

```
~/Pictures/album/             ← parent_dir (picker で選択)
├── animals/                  ← category
│   ├── photos.json
│   ├── species.json
│   └── *.jpg
├── arts/                     ← category
│   ├── photos.json (任意)
│   ├── species.json (任意)
│   └── *.jpg
└── food/                     ← category
    └── ...
```

## データモデル

`AppState` を拡張：

| フィールド | 型 | 用途 |
|---|---|---|
| `parent_dir` | `Mutex<Option<PathBuf>>` | 旧 `photos_dir` を rename |
| `current_category` | `Mutex<Option<String>>` | アクティブカテゴリ名 |
| `watcher` | `Arc<PhotoWatcher>` | 既存 |

## Tauri コマンド

| コマンド | 変更 |
|---|---|
| `get_photos_dir` | **rename → `get_parent_dir`** |
| `set_photos_dir` | **rename → `set_parent_dir`**。引数 path: String、設定後カテゴリ一覧を再評価 |
| `pick_folder` | 変更なし |
| `list_categories` | **新規**。`-> Vec<String>`。parent_dir 内のサブフォルダで画像ファイルを含むものを名前順で返す |
| `get_current_category` | **新規**。`-> Option<String>` |
| `set_current_category` | **新規**。引数 category: String。state を更新、watcher を該当サブフォルダで再起動 |
| `read_photos_json` | **引数追加**。category: String。`<parent_dir>/<category>/photos.json` を読む |
| `read_species_json` | **引数追加**。category: String |
| `rescan` | **引数追加**。category: String |

カテゴリ未指定（current_category が None）の場合、`read_*` / `rescan` は空のデフォルトを返すかエラーにする。設計上は **エラー（"no category set"）** を返して frontend にハンドルさせる方が明示的。

## scan モジュール

`scan_and_merge(dir: &Path)` の signature は変えない（dir は category サブフォルダのパス）。lib.rs から `parent.join(category)` を渡す。

## ファイルウォッチャー

- `set_current_category` でカテゴリ切替時に `watcher.watch(app, parent.join(category))` で再起動
- `set_parent_dir` でも同様に再起動（active category も再評価する必要があるため、`set_parent_dir` 後の挙動は下記参照）
- 監視範囲はアクティブカテゴリの直下のみ（再帰なし、現状維持）

## 起動シーケンス

```
1. store から parent_dir 復元（後方互換: 旧 "photos_dir" キーも読む）
2. parent_dir があれば:
   a. list_categories(parent_dir) を取得
   b. store の current_category が一覧にあればそれを active
   c. なければ先頭カテゴリを active（カテゴリ 0 個ならカテゴリ未設定状態）
   d. active があれば read_photos_json / read_species_json を並列ロード + watcher 起動
3. parent_dir が無ければ picker 画面（既存ロジック）
```

## UI 変更

`index.html` の `<header>` の直下、`<div class="filters">` の前にカテゴリタブを追加：

```html
<div class="category-tabs" id="category-tabs" hidden>
  <!-- 動的に <button class="cat-tab" data-cat="animals">animals</button> を追加 -->
</div>
```

スタイルは既存の `.tag` と同じ系統だが、フォントサイズ・配置だけ調整。アクティブタブは `.cat-tab.active` でアクセント色のボーダー + テキスト。

`gallery.js` に `renderCategoryTabs(categories, active)` 関数を追加。`set_current_category` を呼んだら `loadAll` を呼び直して再描画。

カテゴリが 0 件のときは picker と同じく「サブフォルダにカテゴリを作成してください」ガイドを表示（簡易版でいい）。

## エラーハンドリング

| ケース | 挙動 |
|---|---|
| parent_dir 未設定 | 既存 picker（変更なし） |
| parent_dir 設定済 + サブフォルダ 0 | 「カテゴリ用のサブフォルダを作ってください」ガイド表示 |
| current_category がフォルダから消えた | 先頭カテゴリにフォールバック、無ければカテゴリ未設定 |
| current_category 配下の photos.json なし | 既存どおり空配列でグリッド「no photos found」 |
| 画像のリネーム・削除 | watcher が拾って rescan、photos-updated イベント emit |

## 後方互換

- 既存ユーザ（=このプロジェクトのオーナー）は state.json に `photos_dir` キーを持つ。起動時に `parent_dir` キーが無ければ旧 `photos_dir` を読み込み、最初の `set_parent_dir` で `parent_dir` キーへ書き換え（`photos_dir` キーは削除）
- store のデータファイル位置（`~/Library/Application Support/com.naofumiikeda.album/state.json`）は変更しない

## XSS 対策

カテゴリ名は Finder のサブフォルダ名なので原則安全だが、念のため `gallery.js` 側で `textContent` を使い `<button>.textContent = name` の形で挿入する。`innerHTML` での組み立てはしない。

## テスト

Rust 側 unit test に追加：

- `list_categories`:
  - サブフォルダなし → 空
  - サブフォルダあるが画像 0 → 含まれない
  - サブフォルダに画像あり → 含まれる
  - 名前順にソートされる
- `state.rs`: `parent_dir` / `current_category` の get/set

frontend は手動：

- カテゴリタブが表示される
- タブクリックで切替
- 切替後にグリッドが新カテゴリの内容に更新
- watcher が新カテゴリを監視（新しい画像追加で自動更新）
- 再起動後に同じカテゴリが開く

## マイグレーション手順（実装時の流れ）

1. AppState に `parent_dir` / `current_category` を追加（旧 `photos_dir` も alias で残してビルド維持 or 即 rename）
2. `list_categories` 実装 + テスト
3. `set_current_category` 実装（watcher 再起動含む）
4. `read_photos_json` / `read_species_json` / `rescan` の引数 category 化
5. `set_parent_dir` で list_categories を呼んでアクティブを決定するロジック追加
6. setup() で起動時の復元順序を `parent_dir → categories → current_category → load` に
7. frontend に category-tabs DOM + style + JS
8. `gallery.js` の `loadAll` を category 引数化
9. CLAUDE.md / README 更新（推奨ディレクトリ構造）
