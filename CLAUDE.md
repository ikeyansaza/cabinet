# CLAUDE.md — moko.album

## プロジェクト概要

一眼レフで撮った動物写真のギャラリーサイト。
純静的（HTML / CSS / JS のみ）。Cloudflare Pages にデプロイ。

---

## ファイル構成

```
album/
├── index.html        # エントリーポイント。構造のみ、ロジックは gallery.js へ
├── style.css         # デザイントークンと全スタイル。mokomoko デザインシステム準拠
├── gallery.js        # 写真読み込み・フィルター・ライトボックス。IIFE でスコープ隔離
├── photos.json       # 写真メタデータ。手動編集 or gen_photos.py で生成
├── species.json      # 種別の図鑑情報。手動編集
├── scripts/
│   └── gen_photos.py # photos/ を走査して EXIF から photos.json を生成
├── photos/           # 実写真ファイル置き場（git 管理外 / .gitignore 済み）
│   └── .gitkeep
├── .gitignore
└── README.md
```

---

## デザインシステム（mokomoko）

**絶対に変えないこと：**

- フォント: `IBM Plex Mono` のみ。weight 300 / 400 / 500 のみ
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
    "title":   "KINGFISHER",          // 大文字表記（必須）
    "tags":    ["bird"],              // フィルター用タグ（必須・配列）
    "species": "kingfisher",          // species.json のキー（任意）
    "date":    "2024-05-20",          // 撮影日 YYYY-MM-DD（任意）
    "camera":  "α7IV",               // カメラ名（任意）
    "lens":    "200-600mm f/5.6-6.3 G", // レンズ名（任意）
    "exif":    "f/6.3 · 1/2000s · ISO 3200" // 露出情報（任意）
  }
]
```

- `file` と `title` と `tags` は必須
- `tags` の値は自由。gallery.js がフィルターボタンを自動生成する
- `species` は任意。値は `species.json` のキーと一致させる。一致するとライトボックスに図鑑情報が出る
- 区切り文字は ` · `（スペース + 中点 + スペース）で統一

---

## species.json スキーマ

種 ID をキーとした辞書。`photos.json` の `species` フィールドの値と一致させる。

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
    "description": "「渓流の宝石」と呼ばれる..." // 自由文（任意・複数行可）
  }
}
```

- 全フィールド任意。書かなければライトボックスで該当パートが省略される
- `features` は配列。1 項目あたり 1 行で表示される
- `description` は `white-space: pre-wrap` で改行が保持される
- `species.json` 自体が無くてもギャラリーは動作する（warn のみ）

---

## gallery.js の設計方針

- IIFE `(function(){ 'use strict'; ... })()` でグローバル汚染なし
- `fetch('photos.json')` で非同期ロード。エラー時はグリッドにメッセージ表示
- タグボタンは `photos.json` の内容から動的生成（ハードコードしない）
- 画像は `loading="lazy"` + `img.loading / img.loaded` クラスで遅延ロード
- XSS 対策: DOM に挿入するすべての文字列は `esc()` を通す

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
- 既存の `photos.json` は上書きされる。手動編集した内容を保持したい場合は `--dry-run` で確認してからマージする

---

## ローカル開発

```bash
python -m http.server 8000
# → http://localhost:8000
```

`file://` で直接開くと `fetch('photos.json')` が CORS エラーになるので必ずサーバー経由で。

---

## Cloudflare Pages デプロイ設定

| 項目 | 値 |
|---|---|
| Build command | *(空欄)* |
| Build output directory | `/` |
| Root directory | *(空欄)* |

`photos/` は `.gitignore` 済みなので git には含まれない。
写真ファイルの配信方法は別途検討（Cloudflare R2 / 外部 CDN など）。

---

## やってはいけないこと

- `style.css` の CSS カスタムプロパティを削除・リネームしない
- `IBM Plex Mono` 以外のフォントを追加しない
- ボタンに `background` 色（塗り）を追加しない
- `photos/` を git 管理に含めない
- `gallery.js` にグローバル変数を追加しない（IIFE 内に収める）
- `index.html` にインラインスタイルや `<script>` ブロックを追加しない
- `species.json` の値で塗り（背景色）や新色を導入しない（mokomoko デザインシステム遵守）
