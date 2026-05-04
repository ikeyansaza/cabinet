# album

動物写真の個人用ギャラリー。mokomoko デザインシステムベースの静的サイトをローカルで動かす。公開はしない。

## 構成

```
album/
├── index.html          # メインページ
├── style.css           # mokomoko デザイン
├── gallery.js          # グリッド・フィルター・ライトボックス
├── photos.json         # 写真メタデータ
├── scripts/
│   └── gen_photos.py   # photos.json 自動生成スクリプト
└── photos/
    └── (写真ファイル — git 管理外)
```

## セットアップ

### 1. 写真を配置する

```
photos/
├── sika_deer_01.jpg
├── kingfisher_01.jpg
└── ...
```

ファイル名は `種名_連番.jpg` 形式を推奨。タグが自動推定されます。

### 2. photos.json を生成する

```bash
pip install piexif pillow
python scripts/gen_photos.py
```

EXIF（カメラ・レンズ・f値・ISO・撮影日）を自動取得します。

#### オプション

| オプション | 説明 | デフォルト |
|---|---|---|
| `--photos-dir` | 写真フォルダのパス | `./photos` |
| `--output` | 出力先 JSON | `./photos.json` |
| `--dry-run` | 書き込まずに標準出力へ | — |

例:

```bash
python scripts/gen_photos.py --photos-dir /Volumes/Photos/animals --dry-run
```

### 3. photos.json を手動で編集する（任意）

```json
[
  {
    "file":   "kingfisher_01.jpg",
    "title":  "KINGFISHER",
    "tags":   ["bird"],
    "date":   "2024-05-20",
    "camera": "α7IV",
    "lens":   "200-600mm f/5.6-6.3 G",
    "exif":   "f/6.3 · 1/2000s · ISO 3200"
  }
]
```

`tags` に使えるキーワードは自由。フィルターボタンが自動生成されます。

### 4. ローカル確認

```bash
# Python 3
python -m http.server 8000

# Node.js
npx serve .
```

→ <http://localhost:8000>

## 写真のタグ自動推定ルール

`gen_photos.py` はファイル名のキーワードからタグを推定します。

| タグ | キーワード例 |
|---|---|
| mammal | deer, monkey, fox, cat, dog, sheep ... |
| bird | heron, kingfisher, eagle, owl, duck ... |
| insect | beetle, butterfly, dragonfly, cicada ... |
| reptile | snake, lizard, gecko, turtle, frog ... |
| aquatic | fish, carp, salmon, octopus, crab ... |

対応しないキーワードには `other` が付与されます。
`scripts/gen_photos.py` の `TAG_RULES` に追記してください。
