# Tauri デスクトップアプリ化 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** album を macOS 個人用デスクトップアプリ（Tauri 2 ベース）に移行する。HTTP サーバ不要で起動できるようにし、写真フォルダの変更を自動で拾う体験にする。

**Architecture:** 既存の `index.html` / `gallery.js` / `style.css` を frontend として `src/` に移し、Rust バックエンド（`src-tauri/`）が EXIF 抽出・JSON 読み書き・ファイルウォッチを担当。`photos.json` / `species.json` はユーザのフォトフォルダ（リポジトリ外）に置き、アプリは `tauri-plugin-store` で「最後に開いたフォルダ」を覚える。

**Tech Stack:** Tauri 2.x (Rust + WebView), Node 20 (frontend deps のみ), `kamadak-exif`, `notify`, `tauri-plugin-store`, `tauri-plugin-window-state`, `tauri-plugin-dialog`, `tauri-plugin-fs`. macOS 専用、署名なし。

**設計ドキュメント:** `docs/superpowers/specs/2026-05-05-tauri-migration-design.md`

---

## 前提条件 — 開発環境の準備

実装を開始する前に下記が `which` で見つかる状態にしてください：

```bash
which node      # 既に /opt/homebrew/opt/node@20/bin/node にある想定
which npm       # 既に /opt/homebrew/opt/node@20/bin/npm にある想定
which cargo     # 未インストールなら下記でインストール
```

**Rust 未インストールの場合:**

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
rustc --version  # 1.80 以上を確認
```

**Tauri 用追加依存（macOS）:**

```bash
xcode-select --install || true   # Command Line Tools（既にあれば no-op）
```

これで cargo / rustc / node / npm が揃った状態。

---

## ブランチ準備

```bash
cd /Users/naofumiikeda/repositories/my-album
git checkout -b feat/tauri-migration
```

各タスクのコミットはこのブランチに積み、最後に main へマージする。

---

## File Structure

実装後の構造：

```
album/
├── package.json                 # 新規。frontend の npm 依存と tauri スクリプト
├── package-lock.json            # 新規（npm 自動生成）
├── src-tauri/                   # 新規。Rust バックエンド
│   ├── src/
│   │   ├── main.rs              # エントリ、コマンド登録、プラグイン setup
│   │   ├── state.rs             # AppState（現在のフォトフォルダなど）
│   │   ├── exif.rs              # EXIF 抽出
│   │   ├── scan.rs              # フォルダ走査 + photos.json マージ
│   │   └── watcher.rs           # ファイルウォッチャー
│   ├── Cargo.toml
│   ├── Cargo.lock
│   ├── tauri.conf.json
│   ├── build.rs
│   ├── capabilities/default.json
│   └── icons/                   # tauri init が生成
├── src/                         # 既存の frontend を移動
│   ├── index.html               # 旧 root から移動
│   ├── gallery.js               # 旧 root から移動 + Tauri API 対応で大幅改修
│   ├── style.css                # 旧 root から移動
│   └── tauri.js                 # 新規。Tauri 関連の thin wrapper
├── scripts/gen_photos.py        # CLI 用に維持
├── docs/
├── .gitignore                   # src-tauri/target/, node_modules/ などを追加
├── CLAUDE.md
└── README.md
```

旧 root の `index.html` / `gallery.js` / `style.css` / `photos.json` / `species.json` / `photos/` は移動または削除。

---

## TDD/検証ノート

- **Rust 側**: 各モジュールに `#[cfg(test)] mod tests` で unit test。`cargo test` で実行
- **Frontend**: 自動テストフレームワークは入れない（spec 通り）。各タスクで「ブラウザで確認するシナリオ」を先に明記し、実装後に `npm run tauri dev` で確認
- **段階的検証**: 各タスクの末尾で `npm run tauri dev` が起動し、現時点の機能が動くことを確認してからコミット

---

## Task 1: Tauri プロジェクトを初期化する

**Files:**

- Create: `package.json`
- Create: `src-tauri/`（`tauri init` が生成）
- Modify: `.gitignore`

検証シナリオ：

- `npm run tauri dev` が起動して空白ウィンドウが開く（既存 frontend はまだ移していないので "404" や空白で OK）
- `git status` で `src-tauri/target/` や `node_modules/` が追跡されないこと

- [ ] **Step 1: `package.json` を新規作成**

`package.json`:

```json
{
  "name": "album",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "tauri": "tauri"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.0.0"
  },
  "dependencies": {
    "@tauri-apps/api": "^2.0.0"
  }
}

```

ノート: バンドラ（Vite 等）を使わない方針なので、ダイアログ・FS・store などの機能は **すべて Rust コマンド経由** で frontend に公開する。npm 側は `@tauri-apps/api` だけ。`window.__TAURI__.core.invoke` と `.event.listen` と `.convertFileSrc` で frontend からアクセスする。`tauri.conf.json` で `app.withGlobalTauri: true` を有効にするのを忘れない（Step 4 で対応）。

- [ ] **Step 2: 依存をインストール**

```bash
npm install
```

- [ ] **Step 3: `tauri init` を実行**

```bash
npm run tauri init -- \
  --app-name album \
  --window-title album \
  --frontend-dist ../src \
  --dev-url '' \
  --before-dev-command '' \
  --before-build-command '' \
  --ci
```

`--ci` で対話を無効化、上記引数で全部指定。失敗したら対話モード（引数なしの `npm run tauri init`）で同じ値を入れる。

- [ ] **Step 4: `src-tauri/tauri.conf.json` を確認・修正**

生成された `src-tauri/tauri.conf.json` を開き、以下のキーを確認/修正する：

```json
{
  "productName": "album",
  "identifier": "com.naofumiikeda.album",
  "build": {
    "frontendDist": "../src"
  },
  "app": {
    "withGlobalTauri": true,
    "windows": [
      {
        "title": "album",
        "width": 1200,
        "height": 800,
        "minWidth": 600,
        "minHeight": 400
      }
    ],
    "security": {
      "csp": null,
      "assetProtocol": {
        "enable": true,
        "scope": [
          "**"
        ]
      }
    }
  }
}
```

ポイント:

- `withGlobalTauri: true` で `window.__TAURI__.{core,event}` が JS から見える（バンドラなしでも動く）
- DnD: Tauri 2 のデフォルト挙動（Tauri がインターセプトして `tauri://drag-drop` イベント emit）に任せる。`dragDropEnabled` キーは設定しない
- `assetProtocol.scope: ["**"]` で写真ファイルへの asset URL アクセスを許可（個人用なので緩めで OK）

- [ ] **Step 5: `.gitignore` を更新**

`.gitignore` の末尾に追加：

```
# Tauri build artifacts
src-tauri/target/

# Node
node_modules/
npm-debug.log
```

- [ ] **Step 6: 起動確認**

```bash
npm run tauri dev
```

期待値：Rust ビルドに数分かかったあとウィンドウが開く。中身は空白（frontendDist の `../src` が存在しないので "Failed to load" の類）。Ctrl+C で停止。

- [ ] **Step 7: コミット**

```bash
git add package.json package-lock.json src-tauri .gitignore
git commit -m "Tauri 2 プロジェクトを初期化

- npm に @tauri-apps/{cli,api,plugin-store,plugin-dialog,plugin-fs}
  を追加
- tauri init で src-tauri/ scaffolding を生成
- frontendDist は ../src を指す
- assetProtocol.scope は ['**'] で写真パスを許可
- .gitignore に src-tauri/target/ と node_modules/ を追加"
```

---

## Task 2: 既存 frontend を `src/` 配下に移動する

**Files:**

- Move: `index.html` → `src/index.html`
- Move: `gallery.js` → `src/gallery.js`
- Move: `style.css` → `src/style.css`

検証シナリオ：

- `npm run tauri dev` で album のグリッド画面まで描画される（ただし `fetch('photos.json')` は失敗するのでエラーメッセージが表示される）

- [ ] **Step 1: ファイルを移動**

```bash
mkdir -p src
git mv index.html src/index.html
git mv gallery.js src/gallery.js
git mv style.css src/style.css
```

- [ ] **Step 2: 起動確認**

```bash
npm run tauri dev
```

期待値：mokomoko のヘッダ・フィルタ部分が表示され、グリッド領域に `error: Failed to fetch` のような赤い文字が出る。これは正常で、次のタスクで修正する。

- [ ] **Step 3: コミット**

```bash
git add src/
git commit -m "frontend を src/ 配下に移動

Tauri の frontendDist 設定（../src）に合わせる。
ロジック変更なし、ファイルの場所のみ移動。"
```

---

## Task 3: Rust 側に型定義と AppState を作る

**Files:**

- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/main.rs`

検証シナリオ：

- `cargo test --manifest-path src-tauri/Cargo.toml` でテストが通る
- `cargo build --manifest-path src-tauri/Cargo.toml` がエラーなく完了

- [ ] **Step 1: Cargo.toml に依存を追加**

`src-tauri/Cargo.toml` の `[dependencies]` セクションに追記（既存の tauri と serde 系はそのまま）。dialog や fs プラグインはここではまだ追加せず、必要なタスク（Task 4.5, 13, 14）で都度追加する。

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-store = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "1"
parking_lot = "0.12"
```

`tauri-build` は既存の `[build-dependencies]` のままで OK。

- [ ] **Step 2: 失敗するテストを書く**

`src-tauri/src/state.rs`:

```rust
use parking_lot::Mutex;
use std::path::PathBuf;

#[derive(Default)]
pub struct AppState {
    photos_dir: Mutex<Option<PathBuf>>,
}

impl AppState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn photos_dir(&self) -> Option<PathBuf> {
        self.photos_dir.lock().clone()
    }

    pub fn set_photos_dir(&self, path: Option<PathBuf>) {
        *self.photos_dir.lock() = path;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_state_returns_none() {
        let state = AppState::new();
        assert_eq!(state.photos_dir(), None);
    }

    #[test]
    fn set_and_read_photos_dir() {
        let state = AppState::new();
        state.set_photos_dir(Some(PathBuf::from("/tmp/x")));
        assert_eq!(state.photos_dir(), Some(PathBuf::from("/tmp/x")));
        state.set_photos_dir(None);
        assert_eq!(state.photos_dir(), None);
    }
}
```

- [ ] **Step 3: main.rs に state モジュールを登録**

`src-tauri/src/main.rs` の先頭の use 群の後（または `fn main()` の上）に追加：

```rust
mod state;
```

これでクレート内から `crate::state::AppState` でアクセスできる。`fn main()` の中身はまだ変更しない。

- [ ] **Step 4: テストを実行**

```bash
cargo test --manifest-path src-tauri/Cargo.toml state::tests
```

期待値：2 件 PASS。

- [ ] **Step 5: ビルド確認**

```bash
cargo build --manifest-path src-tauri/Cargo.toml
```

期待値：警告のみで成功。

- [ ] **Step 6: コミット**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/state.rs src-tauri/src/main.rs
git commit -m "Rust: AppState と必要な crate 依存を追加

- parking_lot::Mutex でフォトフォルダパスを保持する AppState
- set/get のユニットテスト 2 件
- tauri-plugin-store / serde / thiserror / parking_lot を依存に追加"
```

---

## Task 4: フォトフォルダ取得・設定の Tauri command + 永続化

**Files:**

- Create: `src-tauri/capabilities/default.json` (確認・修正)
- Modify: `src-tauri/src/main.rs`

検証シナリオ：

- フロントエンドの DevTools で `await window.__TAURI__.core.invoke('set_photos_dir', { path: '/tmp' })` 実行 → エラーなし
- 続けて `await window.__TAURI__.core.invoke('get_photos_dir')` が `'/tmp'` を返す
- アプリ再起動後も `get_photos_dir` が `'/tmp'` を返す（store 永続化が効いている）

- [ ] **Step 1: 検証シナリオを確認**

- [ ] **Step 2: capabilities を更新**

`src-tauri/capabilities/default.json` を開き、以下に置き換え：

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default capabilities for the album app.",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "store:default"
  ]
}
```

ノート: dialog や fs プラグインは Rust 側からだけ使うので frontend permission は不要。store だけ追加。

- [ ] **Step 3: main.rs にコマンドとプラグインを実装**

`src-tauri/src/main.rs` の全体を以下に置き換える（既存の最小スケルトンを上書き）：

```rust
// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod state;

use std::path::PathBuf;
use tauri::{Manager, State};
use tauri_plugin_store::StoreExt;

use state::AppState;

const STORE_FILE: &str = "state.json";
const STORE_KEY_PHOTOS_DIR: &str = "photos_dir";

#[tauri::command]
fn get_photos_dir(state: State<'_, AppState>) -> Option<String> {
    state.photos_dir().map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn set_photos_dir(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    if !path_buf.is_dir() {
        return Err(format!("not a directory: {path}"));
    }
    state.set_photos_dir(Some(path_buf));

    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.set(STORE_KEY_PHOTOS_DIR, serde_json::Value::String(path));
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            app.manage(AppState::new());

            // 起動時に store から photos_dir を復元
            let store = app.store(STORE_FILE)?;
            if let Some(serde_json::Value::String(path)) = store.get(STORE_KEY_PHOTOS_DIR) {
                let path_buf = PathBuf::from(&path);
                if path_buf.is_dir() {
                    app.state::<AppState>().set_photos_dir(Some(path_buf));
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_photos_dir,
            set_photos_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

ノート: `tauri_plugin_dialog::init()` は Task 4.5 で追加する。`tauri_plugin_fs` は使わない（Rust 側は std::fs 直接利用）。

- [ ] **Step 4: ビルド確認**

```bash
cargo build --manifest-path src-tauri/Cargo.toml
```

期待値：警告のみで成功。

- [ ] **Step 5: 起動して DevTools で動作確認**

```bash
npm run tauri dev
```

ウィンドウが開いたら DevTools（macOS では右クリック → Inspect Element）を開いて Console で：

```js
await window.__TAURI__.core.invoke('set_photos_dir', { path: '/tmp' })
// 期待値: undefined（成功）

await window.__TAURI__.core.invoke('get_photos_dir')
// 期待値: '/tmp'

await window.__TAURI__.core.invoke('set_photos_dir', { path: '/nonexistent' })
// 期待値: 例外（"not a directory: /nonexistent"）
```

ウィンドウを閉じてもう一度 `npm run tauri dev` で起動 → Console で：

```js
await window.__TAURI__.core.invoke('get_photos_dir')
// 期待値: '/tmp'（前回設定した値が永続化されている）
```

- [ ] **Step 6: コミット**

```bash
git add src-tauri/src/main.rs src-tauri/capabilities/default.json
git commit -m "Tauri commands: get_photos_dir / set_photos_dir + 永続化

tauri-plugin-store でフォトフォルダパスを ~/Library/Application
Support/album/state.json に保存。起動時に復元する。
不正パス（存在しない/ディレクトリでない）は Err で返す。"
```

---

## Task 4.5: pick_folder Rust コマンドを追加

**Files:**

- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/main.rs`

検証シナリオ：

- DevTools で `await window.__TAURI__.core.invoke('pick_folder')` 実行 → ネイティブのフォルダ選択ダイアログが開き、選択したパスが返る
- キャンセルすると `null`

- [ ] **Step 1: `src-tauri/Cargo.toml` に dialog プラグインを追加**

`[dependencies]` に追記：

```toml
tauri-plugin-dialog = "2"
```

- [ ] **Step 2: main.rs に pick_folder コマンドを追加**

`src-tauri/src/main.rs` の `set_photos_dir` の下に追記：

```rust
#[tauri::command]
async fn pick_folder(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |folder| {
        let _ = tx.send(folder.map(|p| p.to_string()));
    });
    rx.await.ok().flatten()
}
```

`tokio` も追加するため `Cargo.toml` の `[dependencies]` に：

```toml
tokio = { version = "1", features = ["sync"] }
```

- [ ] **Step 3: プラグインを登録**

`main.rs` の `Builder::default()` チェーンに追加（既存の plugin の隣）:

```rust
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
```

- [ ] **Step 4: invoke_handler に追加**

```rust
.invoke_handler(tauri::generate_handler![
    get_photos_dir,
    set_photos_dir,
    pick_folder,
])
```

- [ ] **Step 5: 動作確認**

```bash
npm run tauri dev
```

DevTools で：

```js
await window.__TAURI__.core.invoke('pick_folder')
// 期待値: 選択したフォルダのパス（例 '/Users/naofumiikeda/Pictures/album'）
//         または null（キャンセル時）
```

- [ ] **Step 6: コミット**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/main.rs
git commit -m "Tauri command: pick_folder（ネイティブフォルダ選択）

tauri-plugin-dialog を Rust 側で使い、frontend には invoke('pick_folder')
で公開する。バンドラ無しでも動く。tokio::oneshot で非同期コールバック
を await 可能にする。"
```

---

## Task 5: photos.json / species.json 読み込みコマンド

**Files:**

- Modify: `src-tauri/src/main.rs`

検証シナリオ：

- 適当なテスト用フォルダに `photos.json` と `species.json` を置いて `set_photos_dir` でそのフォルダに切替 → `read_photos_json` / `read_species_json` がそれぞれの内容を返す
- ファイルが無い場合: `read_photos_json` は `[]`、`read_species_json` は `{}` を返す（エラーにしない）
- フォルダ未設定の場合: 両方とも `[]` / `{}`

- [ ] **Step 1: 検証シナリオを確認**

- [ ] **Step 2: コマンドを追加**

`src-tauri/src/main.rs` の `set_photos_dir` の下に追記：

```rust
fn read_json_file<T: for<'de> serde::Deserialize<'de> + Default>(
    dir: Option<PathBuf>,
    filename: &str,
) -> T {
    let Some(dir) = dir else { return T::default(); };
    let path = dir.join(filename);
    let Ok(text) = std::fs::read_to_string(&path) else { return T::default(); };
    serde_json::from_str(&text).unwrap_or_else(|e| {
        eprintln!("[album] {filename} JSON parse error: {e}");
        T::default()
    })
}

#[tauri::command]
fn read_photos_json(state: State<'_, AppState>) -> serde_json::Value {
    let photos: serde_json::Value = read_json_file(state.photos_dir(), "photos.json");
    if photos.is_array() {
        photos
    } else {
        serde_json::Value::Array(vec![])
    }
}

#[tauri::command]
fn read_species_json(state: State<'_, AppState>) -> serde_json::Value {
    let species: serde_json::Value = read_json_file(state.photos_dir(), "species.json");
    if species.is_object() {
        species
    } else {
        serde_json::Value::Object(serde_json::Map::new())
    }
}
```

- [ ] **Step 3: invoke_handler に登録**

`generate_handler!` の中身を以下に置き換え：

```rust
.invoke_handler(tauri::generate_handler![
    get_photos_dir,
    set_photos_dir,
    read_photos_json,
    read_species_json,
])
```

- [ ] **Step 4: ビルド確認**

```bash
cargo build --manifest-path src-tauri/Cargo.toml
```

- [ ] **Step 5: 動作確認用のテストフォルダを準備**

```bash
mkdir -p /tmp/album-test
cat > /tmp/album-test/photos.json <<'EOF'
[
  { "file": "x.jpg", "species": "kingfisher" }
]
EOF
cat > /tmp/album-test/species.json <<'EOF'
{ "kingfisher": { "name_ja": "カワセミ" } }
EOF
```

- [ ] **Step 6: 起動して DevTools で動作確認**

```bash
npm run tauri dev
```

DevTools Console で：

```js
await window.__TAURI__.core.invoke('set_photos_dir', { path: '/tmp/album-test' })
await window.__TAURI__.core.invoke('read_photos_json')
// 期待値: [{ file: 'x.jpg', species: 'kingfisher' }]

await window.__TAURI__.core.invoke('read_species_json')
// 期待値: { kingfisher: { name_ja: 'カワセミ' } }

// JSON が無い場合
await window.__TAURI__.core.invoke('set_photos_dir', { path: '/tmp' })
await window.__TAURI__.core.invoke('read_photos_json')
// 期待値: []

await window.__TAURI__.core.invoke('read_species_json')
// 期待値: {}
```

- [ ] **Step 7: コミット**

```bash
git add src-tauri/src/main.rs
git commit -m "Tauri commands: read_photos_json / read_species_json

設定済みフォトフォルダから JSON を読み込み返す。
ファイルが無い・パース失敗・型不一致は warn で空のデフォルト値
（[] / {}）を返して既存挙動を壊さない。"
```

---

## Task 6: gallery.js を Tauri API ベースに書き換え

**Files:**

- Create: `src/tauri.js`
- Modify: `src/gallery.js`
- Modify: `src/index.html`

検証シナリオ：

- `set_photos_dir` で /tmp/album-test を指定済みの状態でアプリを起動 → Rust から取得した photos.json と species.json を使ってグリッド・図鑑が描画される
- 写真ファイル（IMG_xxx.JPG）が無いのでサムネイルは error 表示でも OK（Task 8 で asset protocol 対応する）

- [ ] **Step 1: 検証シナリオを確認**

- [ ] **Step 2: src/tauri.js を新規作成**

`src/tauri.js`:

```js
// Tauri API への薄いラッパ。frontend の他ファイルからはここ経由で呼ぶ。
// プラグイン機能は Rust コマンド経由で公開しているので、ここでは
// window.__TAURI__.core / .event だけ使う。
const T = window.__TAURI__;

if (!T) {
  console.warn('[album] Tauri 環境外で起動されています。フォルダ選択はスキップされます。');
}

export const isTauri = !!T;

export async function invoke(cmd, args) {
  if (!T) return undefined;
  return T.core.invoke(cmd, args);
}

export async function listen(event, handler) {
  if (!T) return () => {};
  return T.event.listen(event, handler);
}

export function convertFileSrc(absPath) {
  if (!T) return absPath;
  return T.core.convertFileSrc(absPath);
}

export async function pickFolder() {
  // Rust 側の pick_folder コマンド（tauri-plugin-dialog を使用）に委譲
  return await invoke('pick_folder');
}
```

- [ ] **Step 3: index.html で gallery.js を ESM として読む**

`src/index.html` の `<script src="gallery.js"></script>` を以下に置き換える：

```html
<script type="module" src="gallery.js"></script>
```

- [ ] **Step 4: gallery.js のロード部分を Tauri 化**

`src/gallery.js` の先頭から「load photos.json + species.json (並列)」ブロックを以下に置き換える。具体的には、IIFE の冒頭から `Promise.all([...]).then(...).catch(...);` の終わりまでを差し替える。

**置き換え前**（現在の gallery.js 26〜50 行目あたり）：

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

**置き換え後**:

```js
  /* ── load photos.json + species.json via Tauri ── */
  import('./tauri.js').then(async ({ invoke }) => {
    try {
      const [photos, species] = await Promise.all([
        invoke('read_photos_json'),
        invoke('read_species_json'),
      ]);
      allPhotos  = photos || [];
      speciesMap = species || {};
      init();
    } catch (err) {
      grid.innerHTML = `<div class="loading">error: ${err.message}</div>`;
    }
  });
```

ただし IIFE の頭でトップレベル await が使えないので、`import()` の動的構文で読む。

- [ ] **Step 5: gallery.js の IIFE を `'use strict'` の維持に注意して書き換え**

`gallery.js` の冒頭が `(function () { 'use strict'; ...` になっているのはそのまま。動的 `import()` は IIFE 内で問題なく動く。

- [ ] **Step 6: 起動して DevTools で確認**

```bash
npm run tauri dev
```

DevTools Console で：

```js
await window.__TAURI__.core.invoke('set_photos_dir', { path: '/tmp/album-test' })
location.reload()
```

期待値：グリッドに 1 枚分のカードが描画される。`photos/x.jpg` のサムネイルは broken image アイコンになる（実ファイル無いので）。クリックするとライトボックスが開いて species 情報「カワセミ」が表示される。

- [ ] **Step 7: コミット**

```bash
git add src/tauri.js src/index.html src/gallery.js
git commit -m "gallery.js を Tauri invoke ベースに変更

- src/tauri.js を新設、Tauri API を IIFE 内で動的 import で使う
- fetch('photos.json') / fetch('species.json') を invoke に置換
- index.html の <script> を type='module' に変更
- 写真サムネイルはまだ photos/x.jpg 相対パスのまま（次タスクで
  asset protocol 化する）"
```

---

## Task 7: 初回起動のフォルダ選択 + ドラッグ＆ドロップ

**Files:**

- Modify: `src/index.html`
- Modify: `src/style.css`
- Modify: `src/gallery.js`

検証シナリオ：

- `~/Library/Application Support/album/state.json` を削除して未設定状態にしてから起動 → 「フォルダをドラッグ＆ドロップ、または選択ボタン」画面が出る
- ボタンクリック → ネイティブダイアログでフォルダを選ぶ → グリッドが描画される
- フォルダのパスを Finder からドラッグ → 同じくグリッドが描画される
- 次回起動時にはフォルダが記憶されており、選択画面はスキップされる

- [ ] **Step 1: 検証シナリオを確認**

- [ ] **Step 2: index.html に picker DOM を追加**

`src/index.html` の `<div class="grid" id="grid">` の直前（`<div class="status-bar">` の前）に追加：

```html
  <div class="picker" id="picker" hidden>
    <div class="picker-inner">
      <div class="picker-label">photos folder</div>
      <p class="picker-hint">写真フォルダを選択してください。<br>
        フォルダをドロップ、または下のボタンから。</p>
      <button class="picker-btn" id="picker-btn">[ select folder ]</button>
    </div>
  </div>
```

- [ ] **Step 3: style.css に picker のスタイルを追加**

`src/style.css` の末尾に追加：

```css
/* ── folder picker (初回起動・未設定時) ── */
.picker {
  border: 1px dashed var(--border);
  border-radius: 4px;
  padding: 80px 20px;
  text-align: center;
  margin-bottom: 20px;
  transition: border-color .15s, color .15s;
}

.picker.dragover {
  border-color: var(--accent);
  color: var(--accent);
}

.picker[hidden] { display: none; }

.picker-inner {
  display: flex;
  flex-direction: column;
  gap: 14px;
  align-items: center;
}

.picker-label {
  font-size: 10px;
  color: var(--dim);
  letter-spacing: .12em;
  text-transform: uppercase;
}

.picker-hint {
  font-size: 12px;
  color: var(--text);
  line-height: 1.7;
}

.picker-btn {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  padding: 6px 16px;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-hi);
  cursor: pointer;
  border-radius: 2px;
  letter-spacing: .06em;
  transition: border-color .15s, color .15s;
}

.picker-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
```

- [ ] **Step 4: gallery.js に picker ロジックを追加**

`src/gallery.js` の IIFE 冒頭（state ブロックの直前）に追加：

```js
  /* ── elements ── */
  const picker        = document.getElementById('picker');
  const pickerBtn     = document.getElementById('picker-btn');
```

そして「load photos.json + species.json via Tauri」ブロックを以下に置き換える：

```js
  /* ── boot: フォルダ未設定なら picker、設定済なら load ── */
  import('./tauri.js').then(async (T) => {
    const dir = await T.invoke('get_photos_dir');
    if (dir) {
      await loadAll(T);
    } else {
      showPicker(T);
    }
  });

  async function loadAll(T) {
    try {
      const [photos, species] = await Promise.all([
        T.invoke('read_photos_json'),
        T.invoke('read_species_json'),
      ]);
      allPhotos  = photos || [];
      speciesMap = species || {};
      picker.hidden = true;
      grid.hidden = false;
      init();
    } catch (err) {
      grid.innerHTML = `<div class="loading">error: ${err.message}</div>`;
    }
  }

  function showPicker(T) {
    picker.hidden = false;
    grid.hidden = true;

    pickerBtn.addEventListener('click', async () => {
      const path = await T.pickFolder();
      if (path) await chooseFolder(T, path);
    });

    // Tauri 2 のドラッグ&ドロップ:
    // 視覚フィードバック（dragover/dragleave のクラス切替）は HTML5 で、
    // 実パスは Tauri が emit する `tauri://drag-drop` から受け取る。
    picker.addEventListener('dragover', (e) => {
      e.preventDefault();
      picker.classList.add('dragover');
    });
    picker.addEventListener('dragleave', () => {
      picker.classList.remove('dragover');
    });

    T.listen('tauri://drag-drop', async (event) => {
      picker.classList.remove('dragover');
      // Tauri 2 の payload: { paths: string[], position: {...} }
      const paths = event.payload?.paths || [];
      const path = paths[0];
      if (path) await chooseFolder(T, path);
    });
  }

  async function chooseFolder(T, path) {
    try {
      await T.invoke('set_photos_dir', { path });
      await loadAll(T);
    } catch (err) {
      alert(`フォルダ設定エラー: ${err}`);
    }
  }
```

- [ ] **Step 5: 動作確認**

未設定状態を作るため、Tauri アプリを停止してから：

```bash
rm -f "$HOME/Library/Application Support/com.naofumiikeda.album/state.json" || true
npm run tauri dev
```

期待値：picker 画面が表示される。

`[ select folder ]` ボタンを押す → ネイティブダイアログでフォルダ選択 → グリッド描画。

アプリを終了 → 再度 `npm run tauri dev` → picker は表示されず、直接グリッドが出る。

- [ ] **Step 6: コミット**

```bash
git add src/index.html src/style.css src/gallery.js
git commit -m "初回起動のフォルダ選択 picker + ドラッグ&ドロップ

- get_photos_dir が null なら picker 画面を表示、それ以外は通常ロード
- ボタン → tauri-plugin-dialog でネイティブフォルダ選択
- DnD: Finder からのドラッグでもフォルダパスを受け取って設定
- mokomoko デザイン準拠の dashed border + accent color hover"
```

---

## Task 8: 写真表示を asset protocol に切り替え

**Files:**

- Modify: `src/gallery.js`

検証シナリオ：

- 実在の写真（例: `/tmp/album-test/x.jpg` を作っておく）でグリッドにサムネイルが正しく出る
- ライトボックスでも大きい画像が表示される

- [ ] **Step 1: 検証シナリオを確認**

- [ ] **Step 2: 検証用の写真と JSON を準備**

```bash
mkdir -p /tmp/album-test
# 既存写真フォルダから 1 枚コピー（パスは適宜変更）
cp ~/Pictures/album/IMG_5621.JPG /tmp/album-test/x.jpg 2>/dev/null || \
  curl -fsSL https://placehold.co/600x400.jpg -o /tmp/album-test/x.jpg
cat > /tmp/album-test/photos.json <<'EOF'
[
  { "file": "x.jpg", "species": "kingfisher" }
]
EOF
```

- [ ] **Step 3: gallery.js に photoUrl ヘルパを追加**

`src/gallery.js` の IIFE 内、`/* ── state ── */` ブロックの直後に追加：

```js
  /* ── tauri 連携 ── */
  let tauriApi = null;
  async function tauri() {
    if (!tauriApi) tauriApi = await import('./tauri.js');
    return tauriApi;
  }

  async function photoUrl(file) {
    const T = await tauri();
    const dir = await T.invoke('get_photos_dir');
    if (!dir) return `photos/${file}`; // フォールバック
    // Windows だとパス区切りが \ なので encode 前に \ を / に
    const abs = `${dir}/${file}`.replace(/\\/g, '/');
    return T.convertFileSrc(abs);
  }
```

- [ ] **Step 4: グリッドのサムネイル URL を asset protocol に**

`renderGrid` 内の以下の行を：

```js
      img.src = `photos/${photo.file}`;
```

以下に置き換える：

```js
      photoUrl(photo.file).then(url => { img.src = url; });
```

- [ ] **Step 5: ライトボックスの画像 URL も asset protocol に**

`openLB` 内の以下の行を：

```js
    lbImg.src = `photos/${p.file}`;
```

以下に置き換える：

```js
    photoUrl(p.file).then(url => { lbImg.src = url; });
```

- [ ] **Step 6: 動作確認**

```bash
npm run tauri dev
```

DevTools Console で：

```js
await window.__TAURI__.core.invoke('set_photos_dir', { path: '/tmp/album-test' })
location.reload()
```

期待値：グリッドにサムネイルが表示される。クリックするとライトボックスでも画像が出る。Network タブで URL が `asset://localhost/...` になっていることを確認。

- [ ] **Step 7: コミット**

```bash
git add src/gallery.js
git commit -m "写真 URL を Tauri asset protocol に切り替え

photoUrl(file) ヘルパで現在のフォトフォルダ + ファイル名を絶対
パス化し convertFileSrc で asset:// URL を生成。グリッドと
ライトボックスの両方で使う。
photos/ 相対パスは Tauri 環境外フォールバックとしてのみ残す。"
```

---

## Task 9: Rust EXIF 抽出モジュール

**Files:**

- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/exif.rs`
- Modify: `src-tauri/src/main.rs`

検証シナリオ：

- `cargo test --manifest-path src-tauri/Cargo.toml exif::tests` で 2 件のテストが PASS
  - 実在 JPEG から date / camera / lens / exif が抽出できる
  - EXIF 無しの JPEG では空文字を返す

- [ ] **Step 1: Cargo.toml に kamadak-exif を追加**

`src-tauri/Cargo.toml` の `[dependencies]` に追記：

```toml
kamadak-exif = "0.5"
```

- [ ] **Step 2: 失敗するテストを書く**

`src-tauri/src/exif.rs`:

```rust
use std::path::Path;

#[derive(Debug, Default, PartialEq, Eq, serde::Serialize)]
pub struct ExifData {
    pub date: String,
    pub camera: String,
    pub lens: String,
    pub exif: String,
}

pub fn extract<P: AsRef<Path>>(path: P) -> ExifData {
    let Ok(file) = std::fs::File::open(&path) else {
        return ExifData::default();
    };
    let mut reader = std::io::BufReader::new(file);
    let exifreader = exif::Reader::new();
    let Ok(meta) = exifreader.read_from_container(&mut reader) else {
        return ExifData::default();
    };

    ExifData {
        date:   format_date(&meta),
        camera: format_camera(&meta),
        lens:   format_lens(&meta),
        exif:   format_exposure(&meta),
    }
}

fn get_str(meta: &exif::Exif, tag: exif::Tag) -> Option<String> {
    let field = meta.get_field(tag, exif::In::PRIMARY)?;
    let value = field.display_value().with_unit(meta).to_string();
    let trimmed = value.trim().trim_matches('"').trim().to_string();
    if trimmed.is_empty() { None } else { Some(trimmed) }
}

fn format_date(meta: &exif::Exif) -> String {
    let raw = match get_str(meta, exif::Tag::DateTimeOriginal) {
        Some(s) => s,
        None => return String::new(),
    };
    // "2024:05:20 12:34:56" → "2024-05-20"
    let date_part = raw.split(' ').next().unwrap_or("");
    date_part.replace(':', "-")
}

fn format_camera(meta: &exif::Exif) -> String {
    let make  = get_str(meta, exif::Tag::Make).unwrap_or_default();
    let model = get_str(meta, exif::Tag::Model).unwrap_or_default();
    if model.is_empty() { return make; }
    if !make.is_empty() && model.to_uppercase().starts_with(&make.to_uppercase()) {
        return model[make.len()..].trim().to_string();
    }
    model
}

fn format_lens(meta: &exif::Exif) -> String {
    get_str(meta, exif::Tag::LensModel).unwrap_or_default()
}

fn format_exposure(meta: &exif::Exif) -> String {
    let mut parts = Vec::new();
    if let Some(f) = get_str(meta, exif::Tag::FNumber) {
        // "f/6.3" / "6.3" 両対応
        let n = f.trim_start_matches("f/").trim_end_matches('0').trim_end_matches('.');
        if !n.is_empty() { parts.push(format!("f/{n}")); }
    }
    if let Some(s) = get_str(meta, exif::Tag::ExposureTime) {
        parts.push(format!("{s}s").replace("ss", "s"));
    }
    if let Some(iso) = get_str(meta, exif::Tag::PhotographicSensitivity) {
        parts.push(format!("ISO {iso}"));
    }
    parts.join(" · ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_exif_returns_default() {
        // 存在しないファイルでも panic しない
        let data = extract("/nonexistent.jpg");
        assert_eq!(data, ExifData::default());
    }

    #[test]
    fn parse_real_jpeg_if_available() {
        // 環境依存テスト: ALBUM_TEST_JPEG が指定されていれば extract が空でないことだけ確認
        let Ok(path) = std::env::var("ALBUM_TEST_JPEG") else { return; };
        let data = extract(&path);
        assert!(!data.date.is_empty() || !data.camera.is_empty() || !data.exif.is_empty(),
                "EXIF empty for {path}: {data:?}");
    }
}
```

- [ ] **Step 3: main.rs に exif モジュールを登録**

`src-tauri/src/main.rs` 先頭の `mod state;` の下に追加：

```rust
mod exif;
```

- [ ] **Step 4: テストを実行**

```bash
cargo test --manifest-path src-tauri/Cargo.toml exif::tests
```

期待値：2 件 PASS。`parse_real_jpeg_if_available` は環境変数なしだとスキップされる。

実 JPEG でテストするなら：

```bash
ALBUM_TEST_JPEG=/tmp/album-test/x.jpg \
  cargo test --manifest-path src-tauri/Cargo.toml exif::tests::parse_real_jpeg
```

- [ ] **Step 5: コミット**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/exif.rs src-tauri/src/main.rs
git commit -m "Rust: kamadak-exif で EXIF 抽出モジュール

date/camera/lens/exif の 4 フィールドを抜き出す。gen_photos.py
の挙動と揃える（make が model に prefix で含まれていれば除去、
区切り文字 ' · ' など）。
ファイルが無い・EXIF 無しは空文字で返して呼び出し側を壊さない。"
```

---

## Task 10: Rust スキャン + マージ

**Files:**

- Create: `src-tauri/src/scan.rs`
- Modify: `src-tauri/src/main.rs`

検証シナリオ：

- `cargo test --manifest-path src-tauri/Cargo.toml scan::tests` で 3 件 PASS
  - 空フォルダ → 空配列を返す
  - 既存 photos.json の species/title/tags を保持する
  - photos.json に存在するが実ファイルが消えたエントリは除外

- [ ] **Step 1: 失敗するテストを書く**

`src-tauri/src/scan.rs`:

```rust
use crate::exif;
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};

const SUPPORTED_EXT: &[&str] = &["jpg", "jpeg", "png", "webp"];
const MANUAL_FIELDS: &[&str] = &["species", "title", "tags"];

pub fn scan_and_merge(dir: &Path) -> Vec<Value> {
    let existing = load_existing(dir);
    let files = list_image_files(dir);

    let mut entries = Vec::new();
    for file in files {
        let filename = file.file_name().unwrap().to_string_lossy().into_owned();
        let prev = existing.get(&filename).cloned();
        let exif_data = exif::extract(&file);

        let mut entry = Map::new();
        entry.insert("file".into(), Value::String(filename.clone()));

        // 手動フィールドは prev から持ち越し
        if let Some(Value::Object(prev_map)) = &prev {
            for k in MANUAL_FIELDS {
                if let Some(v) = prev_map.get(*k) {
                    entry.insert((*k).into(), v.clone());
                }
            }
        }

        // EXIF は最新で上書き
        if !exif_data.date.is_empty()   { entry.insert("date".into(),   Value::String(exif_data.date)); }
        if !exif_data.camera.is_empty() { entry.insert("camera".into(), Value::String(exif_data.camera)); }
        if !exif_data.lens.is_empty()   { entry.insert("lens".into(),   Value::String(exif_data.lens)); }
        if !exif_data.exif.is_empty()   { entry.insert("exif".into(),   Value::String(exif_data.exif)); }

        entries.push(Value::Object(entry));
    }

    // photos.json に書き戻し
    let path = dir.join("photos.json");
    let json = serde_json::to_string_pretty(&entries).unwrap_or_else(|_| "[]".into());
    let _ = std::fs::write(&path, json + "\n");

    entries
}

fn load_existing(dir: &Path) -> std::collections::HashMap<String, Value> {
    let path = dir.join("photos.json");
    let Ok(text) = std::fs::read_to_string(&path) else { return Default::default(); };
    let Ok(Value::Array(arr)) = serde_json::from_str::<Value>(&text) else { return Default::default(); };
    arr.into_iter()
        .filter_map(|v| {
            let file = v.get("file")?.as_str()?.to_string();
            Some((file, v))
        })
        .collect()
}

fn list_image_files(dir: &Path) -> Vec<PathBuf> {
    let Ok(read) = std::fs::read_dir(dir) else { return vec![]; };
    let mut files: Vec<PathBuf> = read
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.is_file())
        .filter(|p| {
            p.extension()
                .and_then(|e| e.to_str())
                .map(|e| SUPPORTED_EXT.iter().any(|s| s.eq_ignore_ascii_case(e)))
                .unwrap_or(false)
        })
        .collect();
    files.sort();
    files
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn empty_dir_returns_empty() {
        let tmp = TempDir::new().unwrap();
        let entries = scan_and_merge(tmp.path());
        assert!(entries.is_empty());
    }

    #[test]
    fn preserves_manual_fields() {
        let tmp = TempDir::new().unwrap();
        // ダミー画像ファイル（中身は空でも EXIF 抽出は失敗するだけで OK）
        fs::write(tmp.path().join("a.jpg"), b"").unwrap();
        // 既存 photos.json
        fs::write(
            tmp.path().join("photos.json"),
            r#"[{"file":"a.jpg","species":"kingfisher","title":"X","tags":["bird"]}]"#,
        )
        .unwrap();

        let entries = scan_and_merge(tmp.path());
        assert_eq!(entries.len(), 1);
        let e = entries[0].as_object().unwrap();
        assert_eq!(e.get("species").unwrap().as_str(), Some("kingfisher"));
        assert_eq!(e.get("title").unwrap().as_str(), Some("X"));
    }

    #[test]
    fn drops_missing_files() {
        let tmp = TempDir::new().unwrap();
        // 既存 photos.json には a.jpg と b.jpg。実ファイルは a.jpg だけ
        fs::write(tmp.path().join("a.jpg"), b"").unwrap();
        fs::write(
            tmp.path().join("photos.json"),
            r#"[{"file":"a.jpg"},{"file":"b.jpg"}]"#,
        )
        .unwrap();

        let entries = scan_and_merge(tmp.path());
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].get("file").unwrap().as_str(), Some("a.jpg"));
    }
}
```

- [ ] **Step 2: tempfile を dev-dependencies に追加**

`src-tauri/Cargo.toml` に追記：

```toml
[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 3: main.rs に scan モジュールを登録**

`src-tauri/src/main.rs` の `mod exif;` の下に追加：

```rust
mod scan;
```

- [ ] **Step 4: テストを実行**

```bash
cargo test --manifest-path src-tauri/Cargo.toml scan::tests
```

期待値：3 件 PASS。

- [ ] **Step 5: コミット**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/scan.rs src-tauri/src/main.rs
git commit -m "Rust: scan_and_merge を実装

- フォトフォルダ直下の jpg/jpeg/png/webp を列挙
- 既存 photos.json から species/title/tags を持ち越し
- EXIF (date/camera/lens/exif) は最新で上書き
- 実ファイルが消えたエントリは除外
- 結果を photos.json に書き戻し
- tempfile で 3 件のユニットテスト"
```

---

## Task 11: rescan コマンド + frontend からの手動 rescan

**Files:**

- Modify: `src-tauri/src/main.rs`
- Modify: `src/gallery.js`
- Modify: `src/index.html`

検証シナリオ：

- フォトフォルダに新しい画像（実 JPEG）を 1 枚置く → DevTools で `invoke('rescan')` 実行 → 戻り値の配列に新しい file が含まれる、photos.json も更新される
- 既存 species/title/tags は保持される（手動編集 → rescan しても消えない）

- [ ] **Step 1: 検証シナリオを確認**

- [ ] **Step 2: rescan コマンドを追加**

`src-tauri/src/main.rs` の `read_species_json` の下に追加：

```rust
#[tauri::command]
fn rescan(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let Some(dir) = state.photos_dir() else {
        return Err("photos_dir is not set".into());
    };
    let entries = scan::scan_and_merge(&dir);
    Ok(serde_json::Value::Array(entries))
}
```

- [ ] **Step 3: invoke_handler に登録**

`generate_handler!` を以下に更新：

```rust
.invoke_handler(tauri::generate_handler![
    get_photos_dir,
    set_photos_dir,
    read_photos_json,
    read_species_json,
    rescan,
])
```

- [ ] **Step 4: ビルド確認**

```bash
cargo build --manifest-path src-tauri/Cargo.toml
```

- [ ] **Step 5: 起動して DevTools で rescan 確認**

```bash
npm run tauri dev
```

```js
// 適当に新しい画像を /tmp/album-test に置いておく前提
await window.__TAURI__.core.invoke('rescan')
// 期待値: 新しい photos 配列が返る
```

実画像が手元にあれば `/tmp/album-test/y.jpg` などにコピーしておく。

- [ ] **Step 6: gallery.js に rescan 用のヘルパを足す（後の Task 12 / 13 で使う）**

`src/gallery.js` の `loadAll` 関数の下に追加：

```js
  async function rescan(T) {
    try {
      const photos = await T.invoke('rescan');
      allPhotos = photos || [];
      applyFilter(activeTag); // 再描画
    } catch (err) {
      console.warn(`[album] rescan 失敗: ${err}`);
    }
  }
```

- [ ] **Step 7: コミット**

```bash
git add src-tauri/src/main.rs src/gallery.js
git commit -m "rescan コマンドを追加 + frontend に rescan ヘルパ

invoke('rescan') でフォルダ走査 → photos.json 更新 → 配列を
返す。frontend の rescan() は呼び出して allPhotos を差し替え
applyFilter で再描画する。手動トリガーは Task 12 のメニューと
Task 13 のウォッチャーから呼ぶ。"
```

---

## Task 12: システムメニュー (Cmd+O / Cmd+R / Cmd+W)

**Files:**

- Modify: `src-tauri/src/main.rs`

検証シナリオ：

- `Cmd+O` で OS のフォルダ選択ダイアログが開く
- 選択するとアプリのグリッドがそのフォルダの内容に更新される
- `Cmd+R` で現在のフォルダを rescan して再描画
- `Cmd+W` でウィンドウを閉じる（macOS 標準）

- [ ] **Step 1: 検証シナリオを確認**

- [ ] **Step 2: main.rs にメニュー構築を追加**

`src-tauri/src/main.rs` の `setup` クロージャの中身を以下に書き換え（既存の store 復元ロジックの後ろに追加）：

```rust
        .setup(|app| {
            app.manage(AppState::new());

            // 起動時に store から photos_dir を復元
            let store = app.store(STORE_FILE)?;
            if let Some(serde_json::Value::String(path)) = store.get(STORE_KEY_PHOTOS_DIR) {
                let path_buf = PathBuf::from(&path);
                if path_buf.is_dir() {
                    app.state::<AppState>().set_photos_dir(Some(path_buf));
                }
            }

            // システムメニュー
            use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

            let app_name = "album";
            let app_menu = Submenu::with_items(
                app,
                app_name,
                true,
                &[
                    &PredefinedMenuItem::about(app, Some(app_name), None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::hide(app, None)?,
                    &PredefinedMenuItem::hide_others(app, None)?,
                    &PredefinedMenuItem::show_all(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::quit(app, None)?,
                ],
            )?;

            let open_folder = MenuItem::with_id(app, "open_folder", "Open Folder…", true, Some("CmdOrCtrl+O"))?;
            let rescan_item = MenuItem::with_id(app, "rescan", "Rescan", true, Some("CmdOrCtrl+R"))?;
            let close_window = PredefinedMenuItem::close_window(app, None)?;

            let file_menu = Submenu::with_items(
                app,
                "File",
                true,
                &[&open_folder, &rescan_item, &PredefinedMenuItem::separator(app)?, &close_window],
            )?;

            let menu = Menu::with_items(app, &[&app_menu, &file_menu])?;
            app.set_menu(menu)?;

            // メニューイベント
            app.on_menu_event(move |app, event| {
                let id = event.id().0.as_str();
                match id {
                    "open_folder" => {
                        let _ = app.emit("menu:open_folder", ());
                    }
                    "rescan" => {
                        let _ = app.emit("menu:rescan", ());
                    }
                    _ => {}
                }
            });

            Ok(())
        })
```

`tauri::Emitter` トレイトが必要なので、ファイル先頭の use を以下に更新：

```rust
use tauri::{Emitter, Manager, State};
```

- [ ] **Step 3: gallery.js でメニューイベントを listen する**

`src/gallery.js` の `loadAll` の下、`rescan` の下に追加（picker のあとも含めて初期化のタイミングで呼ぶ）：

```js
  async function setupMenuListeners(T) {
    await T.listen('menu:open_folder', async () => {
      const path = await T.pickFolder();
      if (path) await chooseFolder(T, path);
    });
    await T.listen('menu:rescan', async () => {
      await rescan(T);
    });
  }
```

そして boot 部の `import('./tauri.js').then(async (T) => { ... })` の中身に `setupMenuListeners(T)` を追加：

```js
  import('./tauri.js').then(async (T) => {
    await setupMenuListeners(T);
    const dir = await T.invoke('get_photos_dir');
    if (dir) {
      await loadAll(T);
    } else {
      showPicker(T);
    }
  });
```

- [ ] **Step 4: 起動して動作確認**

```bash
npm run tauri dev
```

期待値：

- macOS のメニューバーに `album` と `File` が表示される
- `Cmd+O` でフォルダ選択ダイアログ
- `Cmd+R` で grid 再描画（変化が無くてもエラーは出ない）
- `Cmd+W` でウィンドウクローズ

- [ ] **Step 5: コミット**

```bash
git add src-tauri/src/main.rs src/gallery.js
git commit -m "システムメニュー（album / File）

- Cmd+O: Open Folder…（フォルダ選択ダイアログ）
- Cmd+R: Rescan（手動再スキャン）
- Cmd+W: Close Window
- About / Hide / Quit など macOS 標準項目も整備
- メニュー → app.emit でイベント発火、frontend が listen して処理"
```

---

## Task 13: ファイルウォッチャー（500ms デバウンス）

**Files:**

- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/watcher.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src/gallery.js`

検証シナリオ：

- フォトフォルダに JPEG を新たに 1 枚追加 → 500ms 後にアプリのグリッドが自動更新される
- 連続して 5 枚追加 → 1 回だけ rescan が走る（デバウンス）
- フォルダを切り替える（Cmd+O）→ 古いウォッチャーは止まり、新しいフォルダを監視する

- [ ] **Step 1: 検証シナリオを確認**

- [ ] **Step 2: Cargo.toml に notify を追加**

`src-tauri/Cargo.toml` に追記：

```toml
notify = "6"
notify-debouncer-mini = "0.4"
```

- [ ] **Step 3: watcher.rs を新規作成**

`src-tauri/src/watcher.rs`:

```rust
use crate::scan;
use notify::{RecursiveMode, Watcher};
use notify_debouncer_mini::{new_debouncer, DebouncedEventKind, Debouncer};
use parking_lot::Mutex;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub struct PhotoWatcher {
    inner: Mutex<Option<Debouncer<notify::RecommendedWatcher>>>,
}

impl PhotoWatcher {
    pub fn new() -> Self {
        Self { inner: Mutex::new(None) }
    }

    pub fn watch(&self, app: AppHandle, dir: PathBuf) -> Result<(), String> {
        let mut guard = self.inner.lock();
        // 既存ウォッチャーを停止
        *guard = None;

        let app_clone = app.clone();
        let dir_clone = dir.clone();
        let mut debouncer = new_debouncer(Duration::from_millis(500), move |res: Result<Vec<notify_debouncer_mini::DebouncedEvent>, notify::Error>| {
            match res {
                Ok(events) => {
                    let any_relevant = events.iter().any(|e| matches!(e.kind, DebouncedEventKind::Any));
                    if any_relevant {
                        let _ = scan::scan_and_merge(&dir_clone);
                        let _ = app_clone.emit("photos-updated", ());
                    }
                }
                Err(e) => eprintln!("[album] watch error: {e:?}"),
            }
        }).map_err(|e| e.to_string())?;

        debouncer
            .watcher()
            .watch(&dir, RecursiveMode::NonRecursive)
            .map_err(|e| e.to_string())?;

        *guard = Some(debouncer);
        Ok(())
    }

    pub fn stop(&self) {
        *self.inner.lock() = None;
    }
}
```

- [ ] **Step 4: AppState に watcher を持たせる**

`src-tauri/src/state.rs` を更新：

```rust
use parking_lot::Mutex;
use std::path::PathBuf;
use std::sync::Arc;
use crate::watcher::PhotoWatcher;

pub struct AppState {
    photos_dir: Mutex<Option<PathBuf>>,
    pub watcher: Arc<PhotoWatcher>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            photos_dir: Mutex::new(None),
            watcher: Arc::new(PhotoWatcher::new()),
        }
    }

    pub fn photos_dir(&self) -> Option<PathBuf> {
        self.photos_dir.lock().clone()
    }

    pub fn set_photos_dir(&self, path: Option<PathBuf>) {
        *self.photos_dir.lock() = path;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_state_returns_none() {
        let state = AppState::new();
        assert_eq!(state.photos_dir(), None);
    }

    #[test]
    fn set_and_read_photos_dir() {
        let state = AppState::new();
        state.set_photos_dir(Some(PathBuf::from("/tmp/x")));
        assert_eq!(state.photos_dir(), Some(PathBuf::from("/tmp/x")));
        state.set_photos_dir(None);
        assert_eq!(state.photos_dir(), None);
    }
}
```

- [ ] **Step 5: main.rs で set_photos_dir 時にウォッチャー再起動**

`src-tauri/src/main.rs` の `mod` 宣言群に追加：

```rust
mod watcher;
```

`set_photos_dir` 関数を以下に更新：

```rust
#[tauri::command]
fn set_photos_dir(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    if !path_buf.is_dir() {
        return Err(format!("not a directory: {path}"));
    }
    state.set_photos_dir(Some(path_buf.clone()));

    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.set(STORE_KEY_PHOTOS_DIR, serde_json::Value::String(path));
    store.save().map_err(|e| e.to_string())?;

    state.watcher.watch(app, path_buf)?;
    Ok(())
}
```

`setup` クロージャ内、初期 photos_dir 復元の直後にウォッチャー起動を追加：

```rust
            // 起動時に store から photos_dir を復元
            let store = app.store(STORE_FILE)?;
            if let Some(serde_json::Value::String(path)) = store.get(STORE_KEY_PHOTOS_DIR) {
                let path_buf = PathBuf::from(&path);
                if path_buf.is_dir() {
                    app.state::<AppState>().set_photos_dir(Some(path_buf.clone()));
                    // 起動時もウォッチ開始
                    let _ = app.state::<AppState>().watcher.watch(app.handle().clone(), path_buf);
                }
            }
```

- [ ] **Step 6: gallery.js で `photos-updated` を listen**

`src/gallery.js` の `setupMenuListeners` 関数の中に追記：

```js
    await T.listen('photos-updated', async () => {
      const photos = await T.invoke('read_photos_json');
      allPhotos = photos || [];
      applyFilter(activeTag);
    });
```

- [ ] **Step 7: ビルド + 動作確認**

```bash
cargo build --manifest-path src-tauri/Cargo.toml
npm run tauri dev
```

フォトフォルダに新しい JPEG をコピー → 500ms 後にグリッドに反映されることを確認。

```bash
# 別ターミナル
cp ~/Pictures/album/IMG_5621.JPG /tmp/album-test/test1.jpg
sleep 0.6
cp ~/Pictures/album/IMG_5665.JPG /tmp/album-test/test2.jpg
```

- [ ] **Step 8: コミット**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/watcher.rs src-tauri/src/state.rs src-tauri/src/main.rs src/gallery.js
git commit -m "ファイルウォッチャー（notify, 500ms デバウンス）

photos_dir 設定時に watcher を起動。500ms デバウンスで
scan_and_merge → photos-updated イベント emit。
frontend は listen して allPhotos を差し替え再描画。
set_photos_dir のたびに古いウォッチャーは止めて新フォルダで再起動。"
```

---

## Task 14: ウィンドウ状態の永続化

**Files:**

- Modify: `package.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/capabilities/default.json`

検証シナリオ：

- ウィンドウを 800x600 にリサイズして閉じる → 再起動時に同じサイズ・位置で開く

- [ ] **Step 1: 検証シナリオを確認**

- [ ] **Step 2: Cargo に依存追加**

`src-tauri/Cargo.toml` の `[dependencies]` に追加：

```toml
tauri-plugin-window-state = "2"
```

frontend からは触らないので npm 依存は追加しない。

- [ ] **Step 3: capabilities に追加**

`src-tauri/capabilities/default.json` の `permissions` 配列に追加：

```
"window-state:default"
```

- [ ] **Step 4: main.rs にプラグインを登録**

`src-tauri/src/main.rs` の `Builder::default()` の最初に追加：

```rust
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        // ... 他は既存のまま
```

- [ ] **Step 5: 動作確認**

```bash
npm run tauri dev
```

ウィンドウサイズを変更して終了 → 再起動して同じサイズで開くことを確認。

- [ ] **Step 6: コミット**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/main.rs src-tauri/capabilities/default.json
git commit -m "ウィンドウ状態の永続化（tauri-plugin-window-state）

サイズ・位置・最大化状態を ~/Library/Application
Support/album/ に自動保存・復元する。プラグイン入れるだけで
配線は自動。frontend からは触らないので Rust 側だけ依存追加。"
```

---

## Task 15: 旧 root の photos.json / species.json / photos/ をリポから削除

**Files:**

- Delete: `photos.json`
- Delete: `species.json`
- Delete: `photos/.gitkeep`
- Delete: `photos/`（空になるので）

検証シナリオ：

- `git status` で削除された 3 ファイルが staged されている
- アプリは引き続き動く（データはユーザのフォトフォルダ側に移行済み）

- [ ] **Step 1: 検証シナリオを確認**

ユーザのフォトフォルダ（例 `~/Pictures/album/`）に photos.json と species.json が既にある状態が前提。無ければ手動でコピー：

```bash
mkdir -p ~/Pictures/album
cp photos.json ~/Pictures/album/photos.json 2>/dev/null || true
cp species.json ~/Pictures/album/species.json 2>/dev/null || true
# 写真ファイルもまだ photos/ にある場合は移動
ls photos/*.jpg photos/*.JPG 2>/dev/null && mv photos/*.{jpg,JPG} ~/Pictures/album/ 2>/dev/null || true
```

- [ ] **Step 2: ファイル削除**

```bash
git rm photos.json species.json photos/.gitkeep
rmdir photos 2>/dev/null || true
```

- [ ] **Step 3: .gitignore から photos 関連エントリを掃除**

`.gitignore` 内の以下のセクションを削除：

```
# 写真ファイルは git 管理外
photos/*
!photos/.gitkeep
```

`photos/` がリポから消えたので、これらの ignore ルールは不要。

- [ ] **Step 4: 起動確認**

```bash
npm run tauri dev
```

期待値：picker 画面が出るか、または既に設定されたフォルダ（`~/Pictures/album/` など）から正常に読み込まれる。

- [ ] **Step 5: コミット**

```bash
git add -A
git commit -m "旧ルートの photos.json / species.json / photos/ を削除

データはユーザのフォトフォルダ（例: ~/Pictures/album/）に移行済み。
リポジトリ側にはデータを置かない方針に振り切った（個人 PC 内
ローカル運用）。.gitignore の photos/* エントリも削除。"
```

---

## Task 16: CLAUDE.md / README を Tauri 仕様に更新

**Files:**

- Modify: `CLAUDE.md`
- Modify: `README.md`

検証シナリオ：

- README に開発・ビルド・配布手順が書かれている
- CLAUDE.md にファイル構成・データの置き場所・新しい運用ルールが反映されている

- [ ] **Step 1: 検証シナリオを確認**

- [ ] **Step 2: CLAUDE.md を更新**

`CLAUDE.md` の `## プロジェクト概要` を以下に置き換える：

```markdown
## プロジェクト概要

一眼レフで撮った動物写真の個人用デスクトップギャラリー（macOS / Tauri 2）。
WebView 内で従来の純静的 HTML/CSS/JS が動き、Rust 側がフォトフォルダの
EXIF 抽出・JSON 読み書き・ファイルウォッチャーを担当する。
公開はせず、個人 Mac でのみ動かす運用。
```

`## ファイル構成` のコードブロックを以下に置き換える：

```
album/
├── package.json                # frontend の npm 依存
├── src-tauri/                  # Rust バックエンド
│   ├── src/
│   │   ├── main.rs             # エントリ・コマンド・プラグイン
│   │   ├── state.rs            # AppState（photos_dir, watcher）
│   │   ├── exif.rs             # EXIF 抽出
│   │   ├── scan.rs             # フォルダ走査 + photos.json マージ
│   │   └── watcher.rs          # ファイルウォッチャー
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── capabilities/default.json
├── src/                        # frontend（WebView で読まれる）
│   ├── index.html
│   ├── gallery.js
│   ├── tauri.js                # Tauri API 薄ラッパ
│   └── style.css
├── scripts/gen_photos.py       # CLI 用に維持。Tauri 化後の primary は rescan コマンド
├── docs/
└── README.md
```

photos.json / species.json / 写真ファイルはユーザのフォトフォルダ（例 `~/Pictures/album/`）に置く、と明記する：

`## photos.json スキーマ` の前か後に新セクションを追加：

```markdown
---

## データの置き場所

| 種類 | 場所 |
|---|---|
| アプリのフロント・バックエンドのコード | このリポジトリ |
| 写真ファイル（JPEG 等） | ユーザが選んだ任意のフォルダ（例 `~/Pictures/album/`） |
| `photos.json` / `species.json` | 上記フォトフォルダの中 |
| アプリ状態（最後のフォルダ・ウィンドウ位置） | `~/Library/Application Support/album/` |

写真フォルダごと外付け HDD にコピーすればメタデータも一緒に持ち運べる。
```

`## やってはいけないこと` の末尾に追加：

```markdown
- 写真ファイルや photos.json をリポジトリに含めない（個人データなので）
- macOS 以外への配布を想定しない（YAGNI）
```

- [ ] **Step 3: README.md を更新**

`README.md` を以下に置き換える：

```markdown
# album

動物写真の個人用デスクトップギャラリー（macOS / Tauri 2）。
公開せず、自分の Mac でだけ動かす想定。

## 開発

### 必要なもの

- macOS
- Node 20+ / npm
- Rust（rustup 推奨）
- Xcode Command Line Tools

未インストールなら：

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
xcode-select --install
```

### 初回セットアップ

```bash
npm install
```

### 開発サーバ起動

```bash
npm run tauri dev
```

初回はアプリ内でフォトフォルダ（例 `~/Pictures/album/`）を選択する。
そこに写真と `photos.json` / `species.json` を置く。

## ビルド（リリース版）

```bash
npm run tauri build
# → src-tauri/target/release/bundle/macos/album.app
```

生成された `album.app` を `/Applications/` にコピー。
署名なしなので初回起動は右クリック → 開く で Gatekeeper を許可。

## CLI: gen_photos.py（任意）

Tauri アプリの rescan コマンドが photos.json を生成・更新するので、
通常は不要。CLI で生成したい場合のみ：

```bash
pip install piexif pillow
python scripts/gen_photos.py --photos-dir ~/Pictures/album/
```

詳細は `scripts/gen_photos.py --help`。

## 設計ドキュメント

- `docs/superpowers/specs/` に設計
- `docs/superpowers/plans/` に実装プラン
```

- [ ] **Step 4: 起動して全体を再確認**

```bash
npm run tauri dev
```

期待値：

- フォルダが既に設定されていれば、写真がグリッド表示される
- メニューバーから Cmd+O / Cmd+R が動く
- 写真をフォルダに追加すると自動で反映
- ライトボックスで写真クリック → 図鑑情報が右パネルに

- [ ] **Step 5: コミット**

```bash
git add CLAUDE.md README.md
git commit -m "ドキュメントを Tauri 化後の仕様に更新

- プロジェクト概要を Tauri 2 デスクトップアプリ前提に
- ファイル構成を src-tauri/ + src/ 構造で書き直し
- データの置き場所セクションを追加（コード／写真／メタ／状態）
- README にセットアップ・開発・ビルド・配布手順
- gen_photos.py は CLI 用の任意ツールという位置付けを明記"
```

---

## マージ手順（全タスク完了後）

```bash
# main に切り替え
git checkout main

# feature branch をマージ（merge コミット作成）
git merge --no-ff feat/tauri-migration -m "Merge branch 'feat/tauri-migration'

album を Tauri 2 デスクトップアプリ化。HTTP サーバ不要、
ファイルウォッチャーで photos/ の変更を自動反映、システムメニュー
（Cmd+O/R/W）対応。
photos.json / species.json はユーザのフォトフォルダ側へ移行。"

# ローカルブランチを削除
git branch -d feat/tauri-migration
```

---

## 実装後の状態

- `npm run tauri dev` で開発時起動
- `npm run tauri build` でリリースビルド → `.app` を `/Applications/` にインストール
- 写真追加: フォトフォルダに JPEG を放り込むだけで自動反映
- 写真削除: フォトフォルダから消すだけで自動反映
- species 追加・編集: `species.json` を直接編集（Claude Code 経由など）
- フォルダ切替: メニュー Cmd+O または picker

## 既知のリスク・後回しにする項目

- macOS 専用。Linux/Windows サポートなし
- 署名なし。Gatekeeper を初回手動で通す必要あり
- ファイルウォッチャーは「直下のみ」非再帰。サブフォルダの追加は無視
- 大量の写真（数千枚）でのパフォーマンスは未検証。EXIF 取得が遅い場合は将来 cache 化
- HEIC 等の Apple 形式は表示できない（Tauri webview の制約）。JPEG/PNG/WebP に変換して使う
