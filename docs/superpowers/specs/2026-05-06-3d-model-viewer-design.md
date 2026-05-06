# 設計: 3D モデルビューア（species 単位）

- **日付**: 2026-05-06
- **対象**: cabinet
- **ステータス**: 設計合意済み

## 目的

動物などの個体をより立体的に理解するため、species ごとに 3D モデル（`.glb`）を任意で紐付け、ライトボックス内で写真と並べて閲覧できるようにする。

## スコープ

含む:

- `species.json` への `model` フィールド追加（任意）
- ライトボックスへの 3D ビューア（インライン展開、`<model-viewer>` 使用）
- `<model-viewer>` ライブラリの vendor 同梱（`src/lib/`）

含まない:

- photo 単位の 3D 紐付け（species 単位のみ）
- AR 表示（`ar` 属性）
- 複数モデルの切替 UI（オス／メス別など）
- カメラプリセット（front / side / top）切替 UI
- 3D モデルの自動取得・Sketchfab 連携
- `.glb` 以外のフォーマット対応（USDZ 等）
- バンドラ（vite 等）の導入

## データ構造

### `species.json`（既存スキーマに 1 フィールド追加）

```json
{
  "kingfisher": {
    "name_ja": "カワセミ",
    "name_en": "Common Kingfisher",
    "habitat": "河川・湖沼の岸辺",
    "size":    "全長 17cm",
    "features": ["..."],
    "description": "...",
    "model":   "models/kingfisher.glb"
  }
}
```

| フィールド | 型 | 用途 |
|---|---|---|
| `model` | string（任意） | カテゴリフォルダからの相対パス。指定があれば 3D ビューア導線を表示 |

- `model` 未指定なら 3D 関連 UI は完全に非表示（既存写真は完全に影響なし）
- 推奨配置: `<category>/models/<species_id>.glb`（例 `animals/models/kingfisher.glb`）。フォルダ名は規約だがアプリ側で強制しない（パスは `species.json` の値をそのまま使う）

### Rust 側（`scan.rs`）の扱い

- `SUPPORTED_EXT`（写真スキャン対象）には変更なし。`models/` サブフォルダ内の `.glb` は写真リストに混入しない（拡張子で除外される）
- `model` パスの実在チェックはバックエンドではしない。フロント側で `<model-viewer>` の `error` イベントを使ってハンドル

## アーキテクチャ

### ファイル構成

```
src/
├── index.html                 # 既存 + 3D 関連の DOM とスクリプトタグ追加
├── lib/
│   └── model-viewer.min.js    # ★新規: vendor（~300KB）
├── gallery.js                 # 既存 + 3D トグル / ビューア生成・破棄
└── style.css                  # 既存 + 3D ボタンとビューア領域
```

### 描画フロー

```
photo クリック
  → openLB(i)
  → renderSpecies(speciesId)
      ├─ 既存: 図鑑情報を描画
      └─ 新規: species.model が存在する場合のみ
                 [ view in 3D ] ボタンを描画（折りたたみ状態）
                 押下 → ビューア領域を expand、<model-viewer> 要素生成、src 設定
                 もう一度押下 → collapse、<model-viewer> 要素を破棄（メモリ解放）
  → ライトボックス close 時にも <model-viewer> を破棄
```

### モデル URL 解決

写真と同じ仕組み（Tauri の `convertFileSrc`）で解決する。

```js
async function modelUrl(relPath) {
  const T = await tauri();
  const dir = await T.invoke('get_active_dir');
  if (!dir) return relPath;
  const abs = `${dir}/${relPath}`.replace(/\\/g, '/');
  return T.convertFileSrc(abs);
}
```

### `<model-viewer>` の読み込み

`src/lib/model-viewer.min.js` を vendor 同梱。`index.html` で `<script type="module">` として読み込む。npm 依存ゼロ、オフライン動作可、ビルドステップ不要。

## UI 設計（mokomoko 準拠）

### ライトボックスのレイアウト

**折りたたみ時（既定）**: 既存と同じ。図鑑ブロックの末尾に `[ view in 3D ]` ボタンが 1 行追加されるだけ。

**展開時**: 図鑑ブロックと写真メタ情報の **下** に 3D ビューア領域（高さ `min(60vh, 500px)`）が現れる。ライトボックス全体は内部スクロール。

### 3D ビューア要素

```html
<model-viewer
  src="..."
  camera-controls
  auto-rotate
  auto-rotate-delay="3000"
  interaction-prompt="none"
  shadow-intensity="0"
  exposure="1.0">
</model-viewer>
```

- 既定で自動回転（3 秒静止後）
- マウスドラッグで自由回転
- 背景は `--bg` で WebView 背景に溶け込む
- `interaction-prompt="none"` で「触ってください」のオーバーレイを抑止

### スタイル方針

- 既存トークン（`--bg`, `--border`, `--text`, `--text-hi`, `--accent`）のみ使用
- 新しい色トークンは追加しない
- ボタン（`.lb-3d-toggle`）は既存の透明背景＋ボーダーのみ。`.lb-close` と同系統のスタイル
- ローディング中は中央に `loading 3D ...`（既存 `.loading` の系統）
- エラー時は `[ 3D model unavailable ]` を中央に表示
- フォントは `IBM Plex Mono`、weight は既存範囲（300/400/500）

## 読み込みとエラーハンドリング

| ケース | 挙動 |
|---|---|
| `species.model` 未指定 | 3D 関連 UI を一切描画しない |
| `species.model` ありで `.glb` 存在 | ボタン表示 → 押下で展開、ビューアが正常表示 |
| `species.model` ありで `.glb` ファイル不在 | `<model-viewer>` の `error` イベントで検知 → ビューア領域に「3D model unavailable」を表示 |
| `<model-viewer>` ライブラリ自体の読み込み失敗 | `console.warn` を出し、ボタンは表示するが押下時にエラー表示 |
| `model` の値が絶対 URL（`http://` 等） | サポートしない（YAGNI）。値はそのまま `convertFileSrc` に渡るため結果的に動かない |
| ライトボックスを閉じる / 別写真へ遷移 | `<model-viewer>` 要素を DOM から除去（GPU リソース解放） |

## XSS 対策

- `species.json` の `model` 値は `convertFileSrc` 経由でしか使わない（`textContent` も `innerHTML` も介さない）
- ボタン文言は静的（`[ view in 3D ]`）
- エラーメッセージも静的文字列のみ

## 検証（自動テストなし、手動確認）

1. **互換性**: `model` 無し species で従来どおり表示、ボタン非表示
2. **正常系**: `model` あり + `.glb` 存在で、ボタン押下 → 展開 → 自動回転 → ドラッグで回転
3. **不在ファイル**: `model` あるが `.glb` 不在で、エラー表示が出る
4. **トグル**: 折りたたみ ⇄ 展開を繰り返して状態が壊れない
5. **メモリ解放**: ライトボックスを閉じたとき DevTools の Memory タブで `<model-viewer>` が GC されること（軽くで OK）
6. **カテゴリ切替**: 別カテゴリへ切替 → 元カテゴリの 3D 状態が次に持ち越されない
7. **オフライン**: Wi-Fi を切っても 3D モデルが表示される（vendor 同梱の証明）

## 影響を受けるファイル

| ファイル | 変更 |
|---|---|
| `src/lib/model-viewer.min.js` | **新規**: vendor 同梱（`@google/model-viewer` の dist から取得） |
| `src/index.html` | `<script type="module" src="lib/model-viewer.min.js">` 追加、`#lb-species` 配下に 3D 用 DOM 追加 |
| `src/gallery.js` | 3D ボタン描画 / トグル / `<model-viewer>` の生成・破棄 |
| `src/style.css` | `.lb-3d-toggle`、`.lb-3d-viewer`、エラー / ローディング表示のスタイル |
| `CLAUDE.md` | `species.json` の `model` フィールド、`src/lib/` の役割を追記 |
| `docs/superpowers/specs/2026-05-06-3d-model-viewer-design.md` | 本設計書（新規） |

## やらないこと（YAGNI）

- photo 単位の 3D 紐付け
- AR モード（`<model-viewer>` の `ar` 属性）
- 複数モデルの切替（オス／メス、季節別など）
- カメラプリセット切替 UI（front / side / top）
- モデル一覧 / モデル管理画面
- `.glb` 以外のフォーマット対応（`.usdz`、`.gltf` 別ファイル分割など）
- Sketchfab 等の外部サービス連携・自動取得
- バンドラ（vite, esbuild 等）の導入
- `<model-viewer>` のすべての属性をスキーマ化（`exposure`、`shadow-intensity` 等は固定値）
