# CLAUDE.md — cabinet

## プロジェクト概要

個人用デスクトップギャラリー兼コレクション（macOS / Tauri 2）。「世界を知るための、私的な図鑑」。
アプリ名は `cabinet`（"cabinet of curiosities" 由来。語源は陳列棚＝集めて並べる場所）。
動物・絵画・彫刻・食事など、自分が眺めたいものを写真と説明（species.json）で並べ、眺めて・名づけて世界に近づく。
WebView 内で従来の純静的 HTML/CSS/JS が動き、Rust 側がフォトフォルダの
EXIF 抽出・JSON 読み書き・ファイルウォッチャーを担当する。
公開はせず、個人 Mac でのみ動かす運用。

ノート: bundle identifier は歴史的経緯から `com.naofumiikeda.album` のまま（state を引き継ぐため変更しない）。アプリ表示名のみ `cabinet`。

---

## ファイル構成

```
album/
├── package.json                # frontend の npm 依存
├── src-tauri/                  # Rust バックエンド
│   ├── src/
│   │   ├── lib.rs              # エントリ・コマンド・プラグイン setup
│   │   ├── state.rs            # AppState（photos_dir, watcher）
│   │   ├── exif.rs             # EXIF 抽出（kamadak-exif）
│   │   ├── scan.rs             # フォルダ走査 + photos.json マージ + カテゴリ横断読み込み
│   │   ├── edit.rs             # species.json / artists.json / photos.json の atomic 書き込み
│   │   ├── visits.rs           # visits.json の読み込み（正規化）と atomic 書き込み
│   │   └── watcher.rs          # ファイルウォッチャー（notify, 500ms デバウンス）
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── capabilities/default.json
├── src/                        # frontend（WebView で読まれる）
│   ├── index.html
│   ├── gallery.js
│   ├── visits.js               # visits ビュー（ES module。gallery.js とは body[data-mode] と CustomEvent で連携）
│   ├── visits-logic.js         # visits の純粋ロジック（年集計・写真紐付け・ID 採番。node --test でテスト）
│   ├── tauri.js                # Tauri API 薄ラッパ
│   ├── style.css
│   └── lib/                    # vendor ライブラリ（バンドラ無しの素同梱）
│       └── model-viewer.min.js # @google/model-viewer の dist（3D 表示用）
├── scripts/gen_photos.py       # CLI 用に維持。Tauri 化後の primary は rescan コマンド
├── scripts/notion-convert.mjs  # Notion の貼り付け表 → visits.json 変換（1 回限りの移行用。migrate_notion.mjs が CLI）
├── docs/
└── README.md
```

---

## データの置き場所

| 種類 | 場所 |
|---|---|
| アプリのフロント・バックエンドのコード | このリポジトリ |
| ライブラリ root（parent_dir） | ユーザが選んだ任意のフォルダ（例 `~/Pictures/album/`） |
| カテゴリ（サブフォルダ） | parent_dir 直下の `animals/` `arts/` `food/` など |
| 写真ファイル | カテゴリフォルダの中（例 `~/Pictures/album/animals/IMG_5621.JPG`） |
| `photos.json` / `species.json` | 各カテゴリフォルダの中 |
| `artists.json` | arts カテゴリのみ。フォルダ内に置く |
| `visits.json` | parent_dir 直下（カテゴリ内ではない）。訪問記録と行きたい場所 |
| アプリ状態（parent_dir / current_category / window 位置） | `~/Library/Application Support/com.naofumiikeda.album/` |

カテゴリは parent_dir 直下のサブフォルダで「画像ファイルを 1 枚以上含むもの」が自動列挙される。
ヘッダーのタブで切替。サブフォルダごとに独立した `species.json` を持つので、動物 / 絵画 / 食事
など扱う情報が違うジャンルを混ぜずに管理できる。

---

## デザインシステム（mokomoko）

**絶対に変えないこと：**

- フォント: 全体は `IBM Plex Mono` のみ。weight 300 / 400 / 500 のみ。
  例外: 図鑑ブロックの本文（`.lb-species-features`, `.lb-species-description`）は、日本語の長文可読性を優先して system sans-serif（`--font-body-jp`）に切り替える。これ以外で別フォントを使わない
- 背景: `#0a0a0a`（`--bg`）
- アクセント: `#44aaff`（`--accent`）1色のみ
- ボタン: 透明背景 + ボーダーのみ。塗りは使わない
- ボーダー半径: `2px`（カード）/ `3px`（インプット）/ `4px`（ライトボックス）

**CSS カスタムプロパティ（style.css の `:root` で定義）：**

```css
--bg:      #0a0a0a
--panel:   #111
--border:  #222
--text:    #888
--text-hi: #ccc
--accent:  #44aaff
--ok:      #44aa44
--err:     #aa4444
--dim:     #444
```

新しい色を追加しない。既存トークンで表現できないなら設計を見直す。

---

## photos.json スキーマ

```json
[
  {
    "file":    "kingfisher_01.jpg",   // photos/ 以下のファイル名（必須）
    "species": "kingfisher",          // species.json のキー（任意）
    "date":    "2024-05-20",          // 撮影日 YYYY-MM-DD（任意）
    "camera":  "α7IV",               // カメラ名（任意）
    "lens":    "200-600mm f/5.6-6.3 G", // レンズ名（任意）
    "exif":    "f/6.3 · 1/2000s · ISO 3200", // 露出情報（任意）
    "tags":    ["bird"],              // フィルター用タグ（任意・配列）
    "title":   "KINGFISHER",          // カスタムタイトル（任意・大文字表記）
    "visit":   "2025-10-12-1"         // visits.json の訪問 ID（任意・手動で選んだときだけ保存）
  }
]
```

- `file` のみ必須。他はすべて任意
- `species` は `species.json` のキーと一致させる。一致するとライトボックスに図鑑情報が出る
- `tags` は自由文字列の配列。値があれば gallery.js がフィルターボタンを自動生成する。空または未指定ならフィルター対象外
- `title` は手動でセットしたい場合のみ。未指定ならカードでは `species.name_ja` →（無ければ）ファイル名にフォールバックし、ライトボックスでは非表示
- 区切り文字は ` · `（スペース + 中点 + スペース）で統一
- `gen_photos.py` は `IMG_*` / `PXL_*` のような機械的なファイル名のときは title/tags を空にする

---

## species.json スキーマ

`species.json` のスキーマはカテゴリで分かれる。`photos.json` の `species` フィールドはこのキーを参照する。
ライトボックスは `current_category` を見てどちらのスキーマで描画するかを判定する。`animals` 以外で
`arts` 以外のカテゴリ（例: `food`）は当面 animals スキーマと同じレイアウトで描画される。

### animals カテゴリ

種 ID をキーとした辞書。

```json
{
  "kingfisher": {
    "name_ja": "カワセミ",                     // 和名（任意）
    "name_en": "Common Kingfisher",          // 英名（任意）
    "habitat": "河川・湖沼の岸辺",              // 生息環境（任意）
    "size":    "全長 17cm",                  // サイズ（任意・自由記述）
    "features": [                            // 識別ポイント（任意・配列・推奨 3〜7 項目）
      "光沢のある青緑の背面と橙色の腹",
      "水面上をホバリングしてから飛び込む独特の捕食"
    ],
    "description": "「渓流の宝石」と呼ばれる...", // 自由文（任意・複数行可）
    "model":   "models/kingfisher.glb"        // 3D モデルへの相対パス（任意）
  }
}
```

### arts カテゴリ

作品 ID をキーとした辞書。**作品個別の情報のみ**を持ち、作家紹介は `artists.json` 側で管理する。

```json
{
  "img_6208": {
    "title":     "作品タイトル",                    // 作品名（任意）
    "artist":    "yoshitomo_nara",              // artists.json のキー（任意）
    "co_artist": "hiroshi_sugito",              // 共作の相手。artists.json のキー（任意）
    "year":      "2002",                        // 制作年（任意・自由記述）
    "medium":    "アクリル・キャンバス",            // 技法・素材（任意）
    "description": "(この作品個別の解説)"            // 自由文（任意・複数行可）
  }
}
```

arts では `features`（箇条書き）はライトボックスに描画しないので使わない。情報は `description`
に集約する。animals 側の `features` のみ UI に出る。

`co_artist` を指定すると、ライトボックスに作家ブロックが 2 つ並んで表示される。
作家マスタ（名前・bio 等）の編集は UI からは行わない方針。`artists.json` を直接編集する
（watcher が変更を検知して自動でリロードする）。`species.json` 側の `artist` / `co_artist` ID
の付け替えだけはライトボックスの鉛筆ボタンの編集パネルから行える。

### 共通ルール

- 全フィールド任意。書かなければライトボックスで該当パートが省略される
- `features` は配列。1 項目あたり 1 行で表示される
- `description` は `white-space: pre-wrap` で改行が保持される
- `species.json` 自体が無くてもギャラリーは動作する（warn のみ）
- `model` は animals 用。指定があるとライトボックスに `[ view in 3D ]` ボタンが出る。推奨配置は `<category>/models/<species_id>.glb`

---

## artists.json スキーマ（arts カテゴリ専用）

作家 ID をキーとした辞書。`arts/species.json` の `artist` フィールドはこのキーを参照する。
作家紹介を作品エントリに重複させないために分離している。

```json
{
  "yoshitomo_nara": {
    "name":    "奈良美智",                 // 表示名（任意・通常は和名）
    "name_en": "Yoshitomo Nara",         // 英名（任意）
    "born":    "1959",                   // 生年（任意・文字列）
    "died":    "1996",                   // 没年（任意・文字列、存命なら省略）
    "bio":     "青森県弘前市出身の現代美術家..."  // 自由文（任意・複数行可）
  }
}
```

作家の `features`（箇条書き）はライトボックスに描画しないので使わない。情報は `bio` に集約する。

- 全フィールド任意。書かなければライトボックスの作家ブロックの該当パートが省略される
- 作品エントリに紐づく `artist` ID が `artists.json` に未登録でもエラーにはならない（ID だけ表示される）
- arts カテゴリ以外には不要

---

## visits.json スキーマ（訪問記録）

`<parent_dir>/visits.json` に訪問記録（`visits`）と行きたい場所（`wishlist`）を持つ。カテゴリ（写真フォルダ）とは別の軸で、
ヘッダーの `gallery | visits` でモードを切り替える。visits の中は `log`（年別一覧）と `next`（行きたい場所。メモ・追加・「行った」で訪問へ昇格）のサブタブに分かれ、開いたときは常に `log` から始まる。ファイルが無くても gallery は動作する。

```json
{
  "visits": [
    {
      "id":    "2025-10-12-1",        // 必須・一意・不変（photos.json の visit から参照される）。日付-連番
      "date":  "2025-10-12",          // 必須 YYYY-MM-DD
      "place": "アーティゾン美術館",     // 必須
      "event": "葛飾北斎展",            // 任意（特別展など）
      "kind":  "美術館",                // 必須（自由文字列。フィルタボタンはデータから動的生成）
      "note":  "北斎が良かった"          // 任意・短い自由記述
    }
  ],
  "wishlist": [
    { "id": "w1", "place": "伊香保グリーン牧場", "kind": "牧場", "note": "" }  // 日付なし。「行った」で visits に昇格
  ]
}
```

- 年ごとにまとまり、各年にサマリー（訪問数・種類別内訳・ユニークな場所数・リピート数）が出る。ユニークな場所は `place` の完全一致で数える（正規化しない）。サマリーは種類フィルタの影響を受けない
- 写真との紐付け: ① `photos.json` の `visit` が実在する訪問を指していればそれが優先 ② なければ写真の撮影日 `date` が訪問日と一致する訪問へ自動紐付け（実行時計算・ファイルには書かない）③ 同日に訪問が 2 件以上ある日の写真は「未割り当て」になり、visits 画面かライトボックスの編集パネルで写真ごとに選ぶ
- 存在しない訪問 ID を指す `visit` は無視される（訪問を削除しても写真側は書き換えない）
- 手動選択の結果は、その写真が属するカテゴリの `photos.json` に書く（`update_photo_visit(category, file, visit)`）
- `scan.rs` の `MANUAL_FIELDS` に `visit` が入っているので、rescan しても消えない
- `visits.js` / `visits-logic.js` は ES module（`index.html` から `type="module"`）。テストは `npm test`（`node --test`）、Rust は `cargo test`

---

## gallery.js の設計方針

- IIFE `(function(){ 'use strict'; ... })()` でグローバル汚染なし
- `read_photos_json` / `read_species_json` / `read_artists_json` / `get_current_category` を `Promise.all` で並列取得。エラー時はグリッドにメッセージ表示（json 群は欠落でも続行）
- `currentCategory` を保持し、`renderSpecies` は `'arts'` で `renderArtwork`、それ以外で `renderAnimal` に分岐する
- arts は作品エントリ + 参照する `artists.json` エントリを併記する。作家マスタの編集 UI は持たず、`artists.json` を直接編集する想定
- タグボタンは `photos.json` の内容から動的生成（ハードコードしない）
- 画像は `loading="lazy"` + `img.loading / img.loaded` クラスで遅延ロード
- XSS 対策: DOM に挿入する文字列は `esc()` または `textContent` を使う。図鑑ブロック（renderAnimal / renderArtwork / renderArtist）は `textContent` のみ使用

**変更時の注意：**

- `openLB(i)` は `visible[]` の index を受け取る（`allPhotos[]` ではない）
- フィルター後に `visible` が更新されるので、ナビゲーションは `visible.length` 基準

---

## gen_photos.py の使い方

```bash
pip install piexif pillow
python scripts/gen_photos.py

# オプション
python scripts/gen_photos.py --photos-dir /path/to/photos --dry-run
```

- `TAG_RULES` リストにキーワードを追加するとタグ自動推定が拡張できる
- EXIF が取れない場合は空文字列になる（エラーにはならない）
- 既存の `photos.json` は上書きされる。手動編集した内容（`species` / `title` / `tags`）を保持したい場合は `--dry-run` で確認してからマージする
- カメラ採番ファイル名（`IMG_*`, `PXL_*`, `DSC_*`, `DSCN_*`, `DSCF_*`, `Pxxx_*`, `MVI_*`）は title が空文字、tags は `[]` で生成される。意図的に値を付けたいときは手動編集

---

## ローカル開発

開発サーバ起動：

```bash
npm install         # 初回のみ
npm run tauri dev
```

初回起動時はフォトフォルダ（例 `~/Pictures/album/`）を picker から選択する。

リリースビルド：

```bash
npm run tauri build
# → src-tauri/target/release/bundle/macos/album.app
```

生成された `.app` を `/Applications/` にコピー。署名なしなので初回起動は右クリック → 開く で Gatekeeper を許可。

---

## やってはいけないこと

- `style.css` の CSS カスタムプロパティを削除・リネームしない
- `IBM Plex Mono` 以外のフォントを追加しない
- ボタンに `background` 色（塗り）を追加しない
- `photos/` を git 管理に含めない
- `gallery.js` にグローバル変数を追加しない（IIFE 内に収める）
- `index.html` にインラインスタイルや `<script>` ブロックを追加しない
- `species.json` の値で塗り（背景色）や新色を導入しない（mokomoko デザインシステム遵守）
- 写真ファイルや photos.json をリポジトリに含めない（個人データなので）
- macOS 以外への配布を想定しない（YAGNI）
- `visits.json` や Notion からの移行元データ（訪問記録）をリポジトリに含めない（個人データ）
- `.glb` などの 3D モデルファイルをリポジトリに含めない（個人データ。`src/lib/model-viewer.min.js` のみ vendor として例外的に管理）
