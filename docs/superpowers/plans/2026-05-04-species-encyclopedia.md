# 種別図鑑情報 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** moko.album のライトボックスに、写真の被写体（種）の図鑑情報を表示する。`species.json` を新設し、`photos.json` の各エントリは `species` キーで紐づける。

**Architecture:** 純静的サイト（HTML/CSS/JS のみ）。`gallery.js` の起動時に `photos.json` と `species.json` を並列 fetch し、ライトボックス表示時に該当する種があれば図鑑ブロックを描画する。`species` フィールド・`species.json` ともにオプトインで、無くても既存挙動は変わらない。

**Tech Stack:** Vanilla JS (IIFE)、CSS Grid/Flexbox、`fetch` API、IBM Plex Mono。テストフレームワーク無し（このプロジェクトには元々無い）。検証は `python -m http.server` 経由でブラウザ手動確認。

**設計ドキュメント:** `docs/superpowers/specs/2026-05-04-species-encyclopedia-design.md`

---

## File Structure

| ファイル | 状態 | 責務 |
|---|---|---|
| `species.json` | 新規 | 種 ID をキーとした図鑑データの辞書 |
| `index.html` | 変更 | ライトボックス DOM に図鑑ブロックの空コンテナを追加 |
| `style.css` | 変更 | ライトボックスの横並びレイアウト（≥768px）と図鑑ブロックのタイポグラフィ |
| `gallery.js` | 変更 | `species.json` の並列読み込み、図鑑ブロック描画、エラーハンドリング |
| `CLAUDE.md` | 変更 | `species` フィールドと `species.json` のスキーマを追記 |
| `photos.json` | **変更しない** | 既存写真は `species` 無しで動き続ける。新規写真で `species` を任意で付与 |

`gallery.js` は IIFE で 1 ファイルに収まる方針を維持（既存の制約に従う）。新しいグローバル変数は追加しない。

---

## TDD ノート

このプロジェクトには自動テストフレームワークが無い。ユーザの CLAUDE.md は TDD を推奨しているが、テスト基盤を新設するのは YAGNI（写真ギャラリーに分不相応）。代替として、各タスクでは **「検証シナリオを先に決め、実装後にそれを満たすか確認する」** という TDD の精神を保つ。

各タスクは以下の構造：
1. 検証シナリオを書き出す（成功条件）
2. 実装する
3. ローカル http サーバ + ブラウザで検証
4. コミット

---

## ローカル検証環境（全タスク共通）

各タスクの検証で使用する：

```bash
cd /Users/naofumiikeda/repositories/my-album
python -m http.server 8000
```

別ターミナルで開いてブラウザで `http://localhost:8000` にアクセス。検証中は DevTools を開いて Console を表示。

---

## Task 1: species.json 雛形を作成

**Files:**
- Create: `species.json`

検証シナリオ：
- `http://localhost:8000/species.json` にアクセスして JSON が返る
- 中身に `kingfisher` キーがあり、すべての規定フィールドを持つ

- [ ] **Step 1: 検証シナリオを確認** — 上記2点が成功条件

- [ ] **Step 2: species.json を作成**

`species.json`:

```json
{
  "kingfisher": {
    "name_ja": "カワセミ",
    "name_en": "Common Kingfisher",
    "habitat": "河川・湖沼の岸辺",
    "size": "全長 17cm",
    "features": [
      "光沢のある青緑の背面と橙色の腹",
      "水面上をホバリングしてから飛び込む独特の捕食",
      "オスは下嘴が黒、メスは下嘴がオレンジ"
    ],
    "description": "「渓流の宝石」と呼ばれる青い羽の鳥。日本では北海道から九州まで広く分布する留鳥で、清流から都市部の河川まで適応力が高い。早朝や夕方の薄明時に活発に採餌する。"
  }
}
```

- [ ] **Step 3: ローカルサーバで検証**

ローカルサーバが既に立ち上がっていなければ起動：

```bash
python -m http.server 8000
```

ブラウザで `http://localhost:8000/species.json` を開く。

期待値: 上記 JSON がそのまま返る。

- [ ] **Step 4: コミット**

```bash
git add species.json
git commit -m "種別図鑑データの雛形 species.json を追加

最初のエントリとしてカワセミ（kingfisher）を登録。
key は photos.json の species フィールドと一致させる。"
```

---

## Task 2: index.html に図鑑ブロック用の DOM コンテナを追加

**Files:**
- Modify: `index.html` （ライトボックス内）

検証シナリオ：
- ブラウザの DevTools で `#lb-species` 要素が DOM に存在する
- 既存写真（`species` 無し）でライトボックスを開いても、ビジュアル上の変化は無い（中身が空のままの想定）

- [ ] **Step 1: 検証シナリオを確認**

- [ ] **Step 2: index.html を編集**

`.lb-body` 配下、既存の `#lb-exif` の直後に図鑑ブロックを追加。`.lb-body` の構造を以下に置き換える。

`index.html` の 48-52 行目（lb-body セクション）を：

```html
    <div class="lb-body">
      <div class="lb-title" id="lb-title"></div>
      <div class="lb-tags" id="lb-tags"></div>
      <div class="lb-exif" id="lb-exif"></div>
    </div>
```

から、こう変更：

```html
    <div class="lb-body">
      <div class="lb-photo-info">
        <div class="lb-title" id="lb-title"></div>
        <div class="lb-tags" id="lb-tags"></div>
        <div class="lb-exif" id="lb-exif"></div>
      </div>
      <div class="lb-species" id="lb-species" hidden>
        <div class="lb-species-header">
          <div class="lb-species-name-ja" id="lb-species-name-ja"></div>
          <div class="lb-species-name-en" id="lb-species-name-en"></div>
        </div>
        <div class="lb-species-meta" id="lb-species-meta"></div>
        <ul class="lb-species-features" id="lb-species-features"></ul>
        <div class="lb-species-description" id="lb-species-description"></div>
      </div>
    </div>
```

ポイント：
- `#lb-species` は `hidden` 属性付きで初期化（CSS の `display: none` と同等。JS で外す）
- 既存の `lb-title` / `lb-tags` / `lb-exif` の id はそのまま（gallery.js が参照しているため）

- [ ] **Step 3: ブラウザで検証**

`http://localhost:8000/` を再読み込み（または開く）。DevTools の Elements タブで、`<div class="lb-species" id="lb-species" hidden>` 要素が存在することを確認。

既存写真をクリックしてライトボックスを開く。図鑑ブロックは hidden で見えない。表示は従来どおり。

- [ ] **Step 4: コミット**

```bash
git add index.html
git commit -m "ライトボックスに図鑑ブロックの空コンテナを追加

#lb-species 配下に name_ja/name_en/meta/features/description の
プレースホルダ要素を配置。初期状態は hidden で既存挙動を保つ。"
```

---

## Task 3: style.css にライトボックスの横並びレイアウトを追加（デスクトップ）

**Files:**
- Modify: `style.css` （ライトボックス関連セクション）

検証シナリオ：
- デスクトップ幅（≥768px）でライトボックスを開くと、画像と情報パネルが **左右に並ぶ**
- モバイル幅（<768px）では、画像の **下に情報パネルがスタック**
- 既存の lb-body 内コンテンツは縦に積まれる（`#lb-photo-info` と `#lb-species` が縦に並ぶ）
- `#lb-species` が hidden の場合、情報パネルの幅・配置は変わらない

- [ ] **Step 1: 検証シナリオを確認**

- [ ] **Step 2: index.html — `.lb-content` ラッパを追加して lb-img-wrap と lb-body をまとめる**

Task 2 で編集済みの `index.html` の `.lb-box` 配下を以下のように変更する。

**置き換え前**（Task 2 完了後の状態）:

```html
  <div class="lb-box">
    <div class="lb-img-wrap" id="lb-img-wrap">
      <img id="lb-img" src="" alt="" draggable="false">
    </div>
    <div class="lb-body">
      <div class="lb-photo-info">
        <div class="lb-title" id="lb-title"></div>
        <div class="lb-tags" id="lb-tags"></div>
        <div class="lb-exif" id="lb-exif"></div>
      </div>
      <div class="lb-species" id="lb-species" hidden>
        <div class="lb-species-header">
          <div class="lb-species-name-ja" id="lb-species-name-ja"></div>
          <div class="lb-species-name-en" id="lb-species-name-en"></div>
        </div>
        <div class="lb-species-meta" id="lb-species-meta"></div>
        <ul class="lb-species-features" id="lb-species-features"></ul>
        <div class="lb-species-description" id="lb-species-description"></div>
      </div>
    </div>
    <div class="lb-nav">
      <span class="lb-close" id="lb-close" tabindex="0">[ esc / close ]</span>
      <div class="lb-arrows">
        <button id="lb-prev" aria-label="previous photo">← prev</button>
        <button id="lb-next" aria-label="next photo">next →</button>
      </div>
    </div>
  </div>
```

**置き換え後**:

```html
  <div class="lb-box">
    <div class="lb-content">
      <div class="lb-img-wrap" id="lb-img-wrap">
        <img id="lb-img" src="" alt="" draggable="false">
      </div>
      <div class="lb-body">
        <div class="lb-photo-info">
          <div class="lb-title" id="lb-title"></div>
          <div class="lb-tags" id="lb-tags"></div>
          <div class="lb-exif" id="lb-exif"></div>
        </div>
        <div class="lb-species" id="lb-species" hidden>
          <div class="lb-species-header">
            <div class="lb-species-name-ja" id="lb-species-name-ja"></div>
            <div class="lb-species-name-en" id="lb-species-name-en"></div>
          </div>
          <div class="lb-species-meta" id="lb-species-meta"></div>
          <ul class="lb-species-features" id="lb-species-features"></ul>
          <div class="lb-species-description" id="lb-species-description"></div>
        </div>
      </div>
    </div>
    <div class="lb-nav">
      <span class="lb-close" id="lb-close" tabindex="0">[ esc / close ]</span>
      <div class="lb-arrows">
        <button id="lb-prev" aria-label="previous photo">← prev</button>
        <button id="lb-next" aria-label="next photo">next →</button>
      </div>
    </div>
  </div>
```

差分は `.lb-content` ラッパで `.lb-img-wrap` と `.lb-body` を囲んだだけ。`.lb-nav` は `.lb-box` の直下のまま。これで縦/横どちらの flex でも nav が常に最下段に固定される。

- [ ] **Step 3: style.css のライトボックス関連を一括置き換え**

style.css 内の **`.lb-overlay` から `.lb-counter` まで**（既存ファイルの「lightbox overlay」「lightbox image」「lightbox body」「lightbox nav」セクション）の以下の既存定義を置き換える。

snippet 単位で個別に置き換えるのが安全。`.lb-overlay` は触らない（変更なし）。`.lb-box` 以降の各ブロックを順に置き換える。

**置き換え 1: `.lb-box`**

置き換え前：

```css
.lb-box {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 4px;
  width: 100%;
  max-width: 760px;
  max-height: 90vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
```

置き換え後：

```css
.lb-box {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 4px;
  width: 100%;
  max-width: 1100px;
  max-height: 90vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.lb-content {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
  min-height: 0;
}

@media (min-width: 768px) {
  .lb-content {
    flex-direction: row;
  }
}
```

**置き換え 2: `.lb-img-wrap`**

置き換え前：

```css
.lb-img-wrap {
  background: #020608;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 240px;
  max-height: 60vh;
  overflow: hidden;
}
```

置き換え後：

```css
.lb-img-wrap {
  background: #020608;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 240px;
  max-height: 60vh;
  overflow: hidden;
}

@media (min-width: 768px) {
  .lb-img-wrap {
    flex: 0 0 60%;
    max-height: none;
    border-bottom: none;
    border-right: 1px solid var(--border);
  }
}
```

**置き換え 3: `#lb-img`**

置き換え前：

```css
#lb-img {
  max-width: 100%;
  max-height: 60vh;
  object-fit: contain;
  display: block;
}
```

置き換え後：

```css
#lb-img {
  max-width: 100%;
  max-height: 60vh;
  object-fit: contain;
  display: block;
}

@media (min-width: 768px) {
  #lb-img {
    max-height: 90vh;
  }
}
```

**置き換え 4: `.lb-body`**

置き換え前：

```css
.lb-body {
  padding: 14px 16px 12px;
  border-bottom: 1px solid var(--border);
}
```

置き換え後：

```css
.lb-body {
  padding: 14px 16px 12px;
  border-bottom: 1px solid var(--border);
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

@media (min-width: 768px) {
  .lb-body {
    flex: 1 1 40%;
    border-bottom: none;
  }
}

.lb-photo-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
```

**置き換え 5: `.lb-nav`**

置き換え前：

```css
.lb-nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px;
}
```

置き換え後：

```css
.lb-nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}
```

変更点まとめ：
- `.lb-box` を 1100px に拡大、内部スクロールは下位パネルで処理
- `.lb-content` を新設し、≥768px で flex-row に
- `.lb-img-wrap` は ≥768px で 60% 幅、区切り線が右側に
- `.lb-body` は flex で残り幅、独自スクロール、子要素 gap 14px
- `.lb-photo-info` は内部の縦並び制御
- `.lb-nav` は常に最下段、上方向のボーダーで区切る

- [ ] **Step 4: ブラウザで検証**

`http://localhost:8000/` を再読み込み。

1. デスクトップ幅で写真をクリック → ライトボックスが横長で開き、画像が左、情報が右
2. ウィンドウを 768px 未満に狭める → 画像の下に情報がスタック、nav が最下段
3. 768px 境界で切り替わる
4. nav ボタン（prev/next/close）が常にライトボックス最下段にある

- [ ] **Step 5: コミット**

```bash
git add index.html style.css
git commit -m "ライトボックスを横並びレイアウト対応に変更

768px 以上で画像と情報パネルが左右に並ぶ。lb-nav は新たに
lb-content ラッパの外に出して常に最下段に固定。
モバイル（<768px）の縦スタック挙動は従来どおり。"
```

---

## Task 4: style.css に図鑑ブロックのスタイルを追加

**Files:**
- Modify: `style.css` （末尾に追加）

検証シナリオ：
- 図鑑ブロックを `hidden` 属性を一時的に外して開発確認すると、既存トークン（`--text-hi`, `--text`, `--border`, `--accent`, `--dim`）のみで構成されたミニマルなレイアウトが表示される
- 塗り（`background`）は使われていない
- フォントは IBM Plex Mono のまま
- 区切り線は `--border` 1px

- [ ] **Step 1: 検証シナリオを確認**

- [ ] **Step 2: style.css の末尾に図鑑ブロックのスタイルを追加**

`style.css` の末尾（`.lb-counter` の定義の後）に追加：

```css
/* ── lightbox: species encyclopedia ── */
.lb-species {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}

.lb-species[hidden] { display: none; }

.lb-species-header {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.lb-species-name-ja {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-hi);
  letter-spacing: .04em;
}

.lb-species-name-en {
  font-size: 10px;
  color: var(--accent);
  letter-spacing: .08em;
}

.lb-species-meta {
  font-size: 10px;
  color: var(--dim);
  line-height: 1.7;
  letter-spacing: .04em;
}

.lb-species-features {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}

.lb-species-features li {
  font-size: 11px;
  color: var(--text);
  line-height: 1.6;
  padding-left: 12px;
  position: relative;
}

.lb-species-features li::before {
  content: '·';
  position: absolute;
  left: 2px;
  color: var(--accent);
}

.lb-species-description {
  font-size: 11px;
  color: var(--text);
  line-height: 1.8;
  padding-top: 8px;
  border-top: 1px solid var(--border);
  white-space: pre-wrap;
}
```

ポイント：
- 全て既存トークンのみ。新色なし。
- 塗りなし、ボーダーと余白のみで構造化（mokomoko 哲学）
- 箇条書きの `·` をアクセント色で（既存トークンの再利用）
- `white-space: pre-wrap` で `description` の改行を保持

- [ ] **Step 3: 検証用に hidden を一時的に外して見た目を確認**

DevTools の Elements で `#lb-species` の `hidden` 属性を一時的に削除。さらに DevTools の Console で以下を実行して中身を埋める：

```js
document.getElementById('lb-species-name-ja').textContent = 'カワセミ';
document.getElementById('lb-species-name-en').textContent = 'Common Kingfisher';
document.getElementById('lb-species-meta').textContent = '河川・湖沼の岸辺 · 全長 17cm';
const ul = document.getElementById('lb-species-features');
['光沢のある青緑の背面と橙色の腹', 'ホバリング後に飛び込む独特の捕食', 'オスは下嘴が黒、メスは下嘴がオレンジ'].forEach(t => {
  const li = document.createElement('li');
  li.textContent = t;
  ul.appendChild(li);
});
document.getElementById('lb-species-description').textContent = '「渓流の宝石」と呼ばれる青い羽の鳥。';
```

期待値：右パネルに既存の写真情報の下に図鑑ブロックが表示され、上記検証シナリオを満たす。確認後、リロードして元に戻す。

- [ ] **Step 4: コミット**

```bash
git add style.css
git commit -m "図鑑ブロックのスタイルを追加

既存 CSS カスタムプロパティのみ使用。塗りなし、ボーダーと余白で
構造を表現。features の箇条書きは中点 · をアクセント色で表示。
description は white-space: pre-wrap で改行を保持。"
```

---

## Task 5: gallery.js — species.json の並列読み込みとエラーハンドリング

**Files:**
- Modify: `gallery.js`

検証シナリオ：
- 起動時に Console で `photos.json` と `species.json` の両方が並列に取得される（Network タブで確認）
- `species.json` の中身がモジュールスコープの変数 `speciesMap` に保持される（ブレイクポイントで確認）
- `species.json` を一時リネームして 404 にすると、`console.warn` が出るが、ギャラリーは正常に表示される

- [ ] **Step 1: 検証シナリオを確認**

- [ ] **Step 2: gallery.js の state に speciesMap を追加**

`gallery.js` の 7-10 行目の state ブロックを以下に変更：

```js
  /* ── state ── */
  let allPhotos  = [];
  let speciesMap = {};
  let visible    = [];
  let current    = 0;
  let activeTag  = 'all';
```

- [ ] **Step 3: photos.json の fetch を Promise.all で並列化**

26-38 行目の fetch ブロックを以下に置き換える：

```js
  /* ── load photos.json + species.json (並列) ── */
  Promise.all([
    fetch('photos.json').then(r => {
      if (!r.ok) throw new Error(`photos.json: HTTP ${r.status}`);
      return r.json();
    }),
    fetch('species.json')
      .then(r => {
        if (!r.ok) throw new Error(`species.json: HTTP ${r.status}`);
        return r.json();
      })
      .catch(err => {
        console.warn(`[gallery] species.json を読み込めませんでした: ${err.message}。図鑑情報なしで起動します。`);
        return {};
      })
  ])
    .then(([photos, species]) => {
      allPhotos  = photos;
      speciesMap = species;
      init();
    })
    .catch(err => {
      grid.innerHTML = `<div class="loading">error: ${err.message}</div>`;
    });
```

ポイント：
- 内側の `species.json` 用 `.catch` は species のエラーだけを握り潰す（photos のエラーは外側でハンドル）
- species エラー時は空オブジェクトで続行
- photos エラー時は従来どおり grid にエラー表示

- [ ] **Step 4: ブラウザで正常系を検証**

`http://localhost:8000/` を再読み込み。DevTools の Network タブで `photos.json` と `species.json` が両方 200 で取得されていることを確認。

Console タブで以下を実行（IIFE 内なので外からは触れないが、エラーが無いことを確認）：

期待値：エラーなし、ギャラリーが表示される。

- [ ] **Step 5: ブラウザで species.json 欠落時を検証**

ターミナルで一時的に rename：

```bash
mv species.json species.json.bak
```

ブラウザを再読み込み。

期待値：
- Network タブで `species.json` が 404
- Console に `[gallery] species.json を読み込めませんでした: species.json: HTTP 404。...` という警告
- ギャラリーは正常に表示される（既存写真 2 枚）

確認後、戻す：

```bash
mv species.json.bak species.json
```

- [ ] **Step 6: コミット**

```bash
git add gallery.js
git commit -m "gallery.js: species.json を並列 fetch して speciesMap に保持

photos.json と species.json を Promise.all で同時取得。
species.json が 404 やパースエラーでも握り潰して空辞書で続行し、
既存挙動を壊さない。photos.json のエラーは従来どおり致命的。"
```

---

## Task 6: gallery.js — 図鑑ブロックの描画ロジックと openLB 連携

**Files:**
- Modify: `gallery.js`

検証シナリオ：
- 写真の `species` フィールドに `species.json` のキーと一致する値（例: `"kingfisher"`）を一時的に設定すると、ライトボックスを開いた時に図鑑ブロックが表示される
- 表示内容は species.json の `name_ja` / `name_en` / `habitat` / `size` / `features` / `description` を反映している
- `species` フィールドが無い写真ではブロックは hidden のまま（既存挙動と同じ）
- `species` が species.json に存在しないキー（例: `"unknown"`）の場合、`console.warn` が出てブロックは hidden
- description に `<script>` タグを含めても挿入されない（XSS 対策）

- [ ] **Step 1: 検証シナリオを確認**

- [ ] **Step 2: 図鑑ブロックの DOM 要素参照を追加**

`gallery.js` の 12-24 行目の elements ブロックの末尾（`lbNext` の後）に追加：

```js
  const lbSpecies      = document.getElementById('lb-species');
  const lbSpNameJa     = document.getElementById('lb-species-name-ja');
  const lbSpNameEn     = document.getElementById('lb-species-name-en');
  const lbSpMeta       = document.getElementById('lb-species-meta');
  const lbSpFeatures   = document.getElementById('lb-species-features');
  const lbSpDescription= document.getElementById('lb-species-description');
```

- [ ] **Step 3: renderSpecies 関数を追加**

`gallery.js` の `closeLB` 関数の直前（148 行目あたり）に新しい関数を追加：

```js
  /* ── species (encyclopedia) block ── */
  function renderSpecies(speciesId) {
    if (!speciesId) {
      lbSpecies.hidden = true;
      return;
    }
    const sp = speciesMap[speciesId];
    if (!sp) {
      console.warn(`[gallery] species "${speciesId}" は species.json に未定義です。`);
      lbSpecies.hidden = true;
      return;
    }

    lbSpNameJa.textContent  = sp.name_ja || '';
    lbSpNameEn.textContent  = sp.name_en || '';

    const metaParts = [];
    if (sp.habitat) metaParts.push(sp.habitat);
    if (sp.size)    metaParts.push(sp.size);
    lbSpMeta.textContent = metaParts.join(' · ');
    lbSpMeta.hidden = metaParts.length === 0;

    lbSpFeatures.innerHTML = '';
    if (Array.isArray(sp.features) && sp.features.length > 0) {
      sp.features.forEach(f => {
        const li = document.createElement('li');
        li.textContent = f;          // textContent で XSS 対策（esc 不要）
        lbSpFeatures.appendChild(li);
      });
      lbSpFeatures.hidden = false;
    } else {
      lbSpFeatures.hidden = true;
    }

    lbSpDescription.textContent = sp.description || '';
    lbSpDescription.hidden = !sp.description;

    lbSpecies.hidden = false;
  }
```

ポイント：
- `textContent` を使うので XSS 対策は自動（esc を別途呼ぶ必要なし）
- 各サブ要素も値が無ければ hidden（区切り線が連続するのを防ぐ）

- [ ] **Step 4: openLB から renderSpecies を呼ぶ**

124-146 行目の `openLB` 関数の末尾、`updateCounter()` の直前に1行追加：

```js
    if (p.exif)   lines.push(p.exif);
    if (p.date)   lines.push(p.date);
    lbExif.textContent = lines.join('\n');

    renderSpecies(p.species);   // ← 追加

    updateCounter();
    lb.classList.add('open');
    lbClose.focus();
```

- [ ] **Step 5: 既存写真の互換性を検証（species 無し）**

`http://localhost:8000/` を再読み込み。既存の 2 枚（`species` 無し）をクリックしてライトボックスを開く。

期待値：図鑑ブロックは表示されず、従来どおりの見た目。Console にエラーなし。

- [ ] **Step 6: 正常系を検証（species 有り）**

`photos.json` の最初のエントリに `"species": "kingfisher"` を **一時的に** 追加。

`photos.json`:

```json
[
  {
    "file": "PXL_20250309_050556215.jpg",
    "title": "PXL 20250309",
    "tags": ["other"],
    "species": "kingfisher",
    "date": "2025-03-09",
    "camera": "Pixel 8a",
    "lens": "Pixel 8a back camera 5.43mm f/1.89",
    "exif": "f/1.9 · 1/100s · ISO 105"
  },
  ...
]
```

ブラウザを再読み込みし、最初の写真をクリック。

期待値：
- ライトボックス右パネル下部にカワセミの図鑑ブロックが表示
- name_ja: カワセミ / name_en: Common Kingfisher
- meta: 河川・湖沼の岸辺 · 全長 17cm
- features: 3 項目の箇条書き
- description: 説明文

確認後、`photos.json` から `"species": "kingfisher"` を削除して元に戻す（`git checkout photos.json`）。

- [ ] **Step 7: 不整合キーを検証**

`photos.json` の最初のエントリに `"species": "nonexistent_xyz"` を **一時的に** 追加。

ブラウザリロード → 最初の写真をクリック。

期待値：
- 図鑑ブロックは hidden（表示されない）
- Console に `[gallery] species "nonexistent_xyz" は species.json に未定義です。` という警告

確認後、`git checkout photos.json` で戻す。

- [ ] **Step 8: XSS 検証**

`species.json` の kingfisher.description を **一時的に** 以下に書き換え：

```json
"description": "テスト<script>alert('XSS')</script>挿入"
```

`photos.json` に再度 `"species": "kingfisher"` を一時追加して写真を開く。

期待値：
- 説明文がそのまま文字列として表示される（`<script>` を含む）
- `alert` は実行されない
- DOM Inspector で見ると、`<script>` タグはテキストノードとして扱われている

確認後、`species.json` と `photos.json` を `git checkout` で戻す。

- [ ] **Step 9: コミット**

```bash
git add gallery.js
git commit -m "ライトボックスに図鑑ブロックの描画を実装

写真の species フィールドが species.json のキーと一致したら
ライトボックス右パネルに図鑑情報を表示。textContent で挿入する
ため XSS 安全。species 無し・不整合キーはどちらもブロック非表示
（不整合の場合は console.warn を出す）。"
```

---

## Task 7: CLAUDE.md にスキーマを追記

**Files:**
- Modify: `CLAUDE.md`

検証シナリオ：
- `photos.json` のスキーマ表に `species` フィールドが追記されている
- 新しい節 `species.json スキーマ` が追加され、フィールド一覧と例が載っている
- 「やってはいけないこと」と既存ルールに矛盾しない

- [ ] **Step 1: 検証シナリオを確認**

- [ ] **Step 2: ファイル構成セクションに species.json を追加**

`CLAUDE.md` の 12-24 行目（ファイル構成のコードブロック）を以下に置き換える：

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

- [ ] **Step 3: photos.json スキーマに species を追記**

`CLAUDE.md` の `photos.json スキーマ` セクション（56-76 行目あたり）の JSON 例に `species` を追加：

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

そして説明書きを以下のように更新：

```
- `file` と `title` と `tags` は必須
- `tags` の値は自由。gallery.js がフィルターボタンを自動生成する
- `species` は任意。値は `species.json` のキーと一致させる。一致するとライトボックスに図鑑情報が出る
- 区切り文字は ` · `（スペース + 中点 + スペース）で統一
```

- [ ] **Step 4: species.json スキーマセクションを新規追加**

`photos.json スキーマ` セクション（`---` で次のセクションに切り替わる直前）の直後に、新しいセクションを挿入する。

**追加する内容**（以下の 4 バッククォートのフェンス内をそのまま CLAUDE.md に貼り付ける。中の 3 バッククォートは実際のコードフェンスとして CLAUDE.md に保存される）：

````markdown
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
````

- [ ] **Step 5: 「やってはいけないこと」に1項目追加**

`CLAUDE.md` の最終セクション「やってはいけないこと」の箇条書きの末尾（`- index.html にインラインスタイルや...` の直後）に以下を追加：

```
- `species.json` の値で塗り（背景色）や新色を導入しない（mokomoko デザインシステム遵守）
```

- [ ] **Step 6: 検証**

`CLAUDE.md` を読み返し、上記 3 シナリオすべてが反映されていること、既存記述と矛盾しないことを目視確認。

- [ ] **Step 7: コミット**

```bash
git add CLAUDE.md
git commit -m "CLAUDE.md に species.json と species フィールドを追記

ファイル構成・photos.json スキーマ・species.json スキーマの
3箇所を更新。塗り禁止ルールを species.json にも適用。"
```

---

## Task 8: エンドツーエンド手動検証

**Files:** なし（ファイル変更なし）

このタスクでは、設計ドキュメントの「検証」セクションに記載された全シナリオをまとめて確認する。各項目で **PASS / FAIL** を記録する。

検証中に問題が見つかったら、該当タスクに戻って修正してから再開する。

- [ ] **Step 1: 全シナリオのチェックリストを準備**

以下を順に確認：

| # | シナリオ | 期待値 |
|---|---|---|
| 1 | 既存写真（`species` 無し）のライトボックス | 従来どおり、図鑑ブロック非表示 |
| 2 | `species.json` 欠落時 | console.warn のみ、ギャラリー動作 |
| 3 | 写真に `species` 追加 → 該当キー有り | 図鑑ブロック表示、全フィールド反映 |
| 4 | 写真に `species` 追加 → 該当キー無し | console.warn、ブロック非表示 |
| 5 | レスポンシブ 768px 境界 | 横並び ↔ 縦スタックの切り替え |
| 6 | XSS: description に `<script>` | テキストとして表示、実行されない |
| 7 | features 1 項目だけ / 0 項目 | 区切り線・ulが適切に出ない |
| 8 | description のみ / features のみ | 片方だけでも違和感なく表示 |

- [ ] **Step 2: シナリオ 1（既存互換性）**

ローカルサーバ起動 → 既存 2 枚をクリック → 図鑑ブロック非表示・他は従来どおり。

PASS / FAIL：________

- [ ] **Step 3: シナリオ 2（species.json 欠落）**

```bash
mv species.json species.json.bak
```

ブラウザリロード → ギャラリー動作確認 → console.warn 確認。

```bash
mv species.json.bak species.json
```

PASS / FAIL：________

- [ ] **Step 4: シナリオ 3（正常系・全フィールド）**

`photos.json` の 1 件目に `"species": "kingfisher"` を一時追加 → リロード → クリック → 図鑑ブロック全項目表示確認 → `git checkout photos.json` で戻す。

PASS / FAIL：________

- [ ] **Step 5: シナリオ 4（不整合キー）**

`photos.json` の 1 件目に `"species": "nonexistent_xyz"` を一時追加 → リロード → クリック → console.warn 確認・ブロック非表示確認 → `git checkout photos.json`。

PASS / FAIL：________

- [ ] **Step 6: シナリオ 5（レスポンシブ）**

シナリオ 3 の状態で再度 species 追加 → ウィンドウ幅を 1200px → 700px → 400px と段階的に変えて挙動確認 → 元に戻す。

PASS / FAIL：________

- [ ] **Step 7: シナリオ 6（XSS）**

`species.json` の description を一時的に `テスト<img src=x onerror="alert('XSS')">挿入` に書き換え → photos.json に species 追加 → リロード → 開く → alert が出ない・タグがテキスト表示されることを確認 → 両ファイル `git checkout`。

PASS / FAIL：________

- [ ] **Step 8: シナリオ 7（features 0/1 項目）**

`species.json` の `kingfisher.features` を `[]` に一時変更 → 表示確認（features セクションと前の区切り線が出ない）→ 1 項目だけにして再確認 → `git checkout`。

PASS / FAIL：________

- [ ] **Step 9: シナリオ 8（部分フィールド）**

`species.json` に新しいテストエントリを一時追加：

```json
"test_only_desc": {
  "name_ja": "テスト",
  "description": "説明だけ"
}
```

photos.json に `"species": "test_only_desc"` 追加 → 表示確認（meta・features セクションが出ず、ヘッダーと description だけ表示）→ 両ファイル `git checkout`。

PASS / FAIL：________

- [ ] **Step 10: 全 PASS を確認**

すべて PASS なら次のタスクへ。FAIL があれば該当タスクに戻って修正。

- [ ] **Step 11: ローカルサーバを停止**

ターミナルで `Ctrl+C`。

- [ ] **Step 12: 最終コミット（検証中に作った一時ファイルが無いことを確認）**

```bash
git status
```

期待値: `nothing to commit, working tree clean`（一時変更がすべて戻されている）。

もし変更が残っていれば内容を確認して `git checkout <file>` で戻す。

---

## 実装後の状態

- 既存 2 枚の写真は従来どおり動く
- `species.json` に 1 種（kingfisher）のサンプルが入っている
- 新しい動物写真を追加する際の手順：
  1. `photos/` に画像配置
  2. `python scripts/gen_photos.py` で `photos.json` を生成（または手動編集）
  3. `photos.json` の該当エントリに `"species": "<種ID>"` を追記
  4. `species.json` に `"<種ID>": { ... }` を追記（既存ならスキップ）
  5. ローカル確認後コミット

## ロールバック手順

このプランの実装に問題が見つかった場合、以下のコミットを `git revert` する：

- Task 7 のコミット（CLAUDE.md）
- Task 6 のコミット（renderSpecies）
- Task 5 のコミット（並列 fetch）
- Task 4 のコミット（CSS スタイル）
- Task 3 のコミット（横並びレイアウト）
- Task 2 のコミット（DOM）
- Task 1 のコミット（species.json）

各コミットは独立しているため、部分ロールバックも可能。
