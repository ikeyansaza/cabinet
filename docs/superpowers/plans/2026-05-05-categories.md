# カテゴリ（サブフォルダ）対応 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** cabinet アプリに「親フォルダ + サブフォルダ（カテゴリ）」構造のサポートを追加し、ヘッダーのタブで動物・絵画・食事などのジャンルを切り替えられるようにする。

**Architecture:** AppState に `parent_dir` と `current_category` を持たせる（旧 `photos_dir` を rename）。カテゴリは parent_dir 直下のサブフォルダ。各サブフォルダが独自の `photos.json` / `species.json` / 写真ファイルを持つ。Tauri commands は `read_photos_json(category)` のように category 引数を受ける形に変更。frontend はヘッダーにタブを表示し、クリックでカテゴリ切替。watcher はアクティブカテゴリのサブフォルダだけ監視。

**Tech Stack:** Tauri 2 (既存), parking_lot::Mutex, serde_json::Value, tauri-plugin-store。新規依存なし。

**設計ドキュメント:** `docs/superpowers/specs/2026-05-05-categories-design.md`

---

## ブランチ準備

```bash
cd /Users/naofumiikeda/repositories/my-album
git checkout -b feat/categories
```

各タスクのコミットはこのブランチに積み、最後に main へマージする。

---

## File Structure

実装後の主要ファイル（新規・変更）:

| ファイル | 役割 | 変更種別 |
|---|---|---|
| `src-tauri/src/state.rs` | AppState に `current_category` を追加。`photos_dir` → `parent_dir` rename | 変更 |
| `src-tauri/src/scan.rs` | category 用ヘルパ `list_categories(parent: &Path)` を追加 | 変更 |
| `src-tauri/src/lib.rs` | コマンド改名・新規追加・watcher 再起動・store 復元ロジック | 変更 |
| `src/index.html` | ヘッダー直下に `.category-tabs` を追加 | 変更 |
| `src/style.css` | `.category-tabs` / `.cat-tab` スタイル | 変更 |
| `src/gallery.js` | カテゴリ管理・タブクリック・ロード関数の category 引数化 | 変更 |
| `src/tauri.js` | 新コマンド薄ラッパは追加しない（invoke で十分） | 変更なし想定 |
| `CLAUDE.md` / `README.md` | 推奨ディレクトリ構造の説明追加 | 変更 |

---

## TDD ノート

- Rust 側は `state.rs` と `scan.rs` に unit test を追加
- frontend は手動確認（既存方針）

---

## Task 1: AppState を `parent_dir` + `current_category` に拡張

**Files:**

- Modify: `src-tauri/src/state.rs`

検証シナリオ：

- `cargo test --manifest-path src-tauri/Cargo.toml state` が 4 件 PASS（既存 2 + 新規 2）
- 既存の `photos_dir()` / `set_photos_dir()` は呼び出し側からは使わなくなるが、API 名は新名 `parent_dir()` / `set_parent_dir()` に変える

- [ ] **Step 1: state.rs を新 AppState に置き換え**

`src-tauri/src/state.rs` を以下の内容に置き換える:

```rust
use crate::watcher::PhotoWatcher;
use parking_lot::Mutex;
use std::path::PathBuf;
use std::sync::Arc;

pub struct AppState {
    parent_dir: Mutex<Option<PathBuf>>,
    current_category: Mutex<Option<String>>,
    pub watcher: Arc<PhotoWatcher>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            parent_dir: Mutex::new(None),
            current_category: Mutex::new(None),
            watcher: Arc::new(PhotoWatcher::new()),
        }
    }

    pub fn parent_dir(&self) -> Option<PathBuf> {
        self.parent_dir.lock().clone()
    }

    pub fn set_parent_dir(&self, path: Option<PathBuf>) {
        *self.parent_dir.lock() = path;
    }

    pub fn current_category(&self) -> Option<String> {
        self.current_category.lock().clone()
    }

    pub fn set_current_category(&self, category: Option<String>) {
        *self.current_category.lock() = category;
    }

    /// parent_dir + current_category から実フォルダパスを返す。どちらか欠けたら None。
    pub fn active_dir(&self) -> Option<PathBuf> {
        let parent = self.parent_dir.lock().clone()?;
        let category = self.current_category.lock().clone()?;
        Some(parent.join(category))
    }

    // ── 後方互換 alias（Task 3 で lib.rs を書き換えるまで維持。書き換え後 Task 3 で削除） ──
    pub fn photos_dir(&self) -> Option<PathBuf> {
        self.parent_dir()
    }

    pub fn set_photos_dir(&self, path: Option<PathBuf>) {
        self.set_parent_dir(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_state_returns_none() {
        let state = AppState::new();
        assert_eq!(state.parent_dir(), None);
        assert_eq!(state.current_category(), None);
        assert_eq!(state.active_dir(), None);
    }

    #[test]
    fn set_and_read_parent_dir() {
        let state = AppState::new();
        state.set_parent_dir(Some(PathBuf::from("/tmp/album")));
        assert_eq!(state.parent_dir(), Some(PathBuf::from("/tmp/album")));
        state.set_parent_dir(None);
        assert_eq!(state.parent_dir(), None);
    }

    #[test]
    fn set_and_read_current_category() {
        let state = AppState::new();
        state.set_current_category(Some("animals".into()));
        assert_eq!(state.current_category(), Some("animals".into()));
    }

    #[test]
    fn active_dir_joins_parent_and_category() {
        let state = AppState::new();
        state.set_parent_dir(Some(PathBuf::from("/tmp/album")));
        state.set_current_category(Some("animals".into()));
        assert_eq!(state.active_dir(), Some(PathBuf::from("/tmp/album/animals")));
    }
}
```

- [ ] **Step 2: テスト + ビルド**

```bash
source "$HOME/.cargo/env"
cargo test --manifest-path src-tauri/Cargo.toml state
cargo build --manifest-path src-tauri/Cargo.toml
```

Expected:
- state テスト 4 PASS（`empty_state_returns_none`, `set_and_read_parent_dir`, `set_and_read_current_category`, `active_dir_joins_parent_and_category`）
- 既存 state テスト（`set_and_read_photos_dir`）は削除されたが、後方互換 alias 経由で lib.rs は動き続ける
- `cargo build` は warnings のみで成功

注意: `photos_dir()` / `set_photos_dir()` は Task 3 で lib.rs が新 API に切り替わるまで残す。Task 3 末尾で削除する。

- [ ] **Step 3: コミット**

```bash
git add src-tauri/src/state.rs
git commit -m "AppState: photos_dir → parent_dir rename + current_category 追加

active_dir() ヘルパで parent + category を join して返す。
4 件のユニットテスト。lib.rs は次タスクで追従させる。"
```

---

## Task 2: scan.rs に `list_categories` を追加

**Files:**

- Modify: `src-tauri/src/scan.rs`

検証シナリオ：

- `cargo test --manifest-path src-tauri/Cargo.toml scan` が 6 件 PASS（既存 3 + 新規 3）

- [ ] **Step 1: scan.rs に `list_categories` を追加**

`src-tauri/src/scan.rs` の末尾の `#[cfg(test)] mod tests` の **直前** に以下を追加：

```rust
/// parent_dir 直下のサブフォルダで、画像ファイルを 1 枚以上含むものを名前順で返す。
pub fn list_categories(parent: &Path) -> Vec<String> {
    let Ok(read) = std::fs::read_dir(parent) else { return vec![]; };
    let mut categories: Vec<String> = read
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter(|e| has_images(&e.path()))
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|name| !name.starts_with('.'))   // .DS_Store 等の隠しフォルダは除外
        .collect();
    categories.sort();
    categories
}

fn has_images(dir: &Path) -> bool {
    let Ok(read) = std::fs::read_dir(dir) else { return false; };
    read.filter_map(|e| e.ok())
        .filter(|e| e.path().is_file())
        .any(|e| {
            e.path().extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| SUPPORTED_EXT.iter().any(|s| s.eq_ignore_ascii_case(ext)))
                .unwrap_or(false)
        })
}
```

- [ ] **Step 2: テストを追加**

`#[cfg(test)] mod tests` の中、既存テストの末尾に追加：

```rust
    #[test]
    fn list_categories_empty_dir_returns_empty() {
        let tmp = TempDir::new().unwrap();
        let cats = list_categories(tmp.path());
        assert!(cats.is_empty());
    }

    #[test]
    fn list_categories_excludes_subdirs_without_images() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir(tmp.path().join("animals")).unwrap();
        fs::write(tmp.path().join("animals/a.jpg"), b"").unwrap();
        fs::create_dir(tmp.path().join("notes")).unwrap();
        fs::write(tmp.path().join("notes/memo.txt"), b"").unwrap();
        let cats = list_categories(tmp.path());
        assert_eq!(cats, vec!["animals".to_string()]);
    }

    #[test]
    fn list_categories_sorts_and_skips_hidden() {
        let tmp = TempDir::new().unwrap();
        for name in &["food", "animals", ".trash"] {
            fs::create_dir(tmp.path().join(name)).unwrap();
            fs::write(tmp.path().join(name).join("x.jpg"), b"").unwrap();
        }
        let cats = list_categories(tmp.path());
        assert_eq!(cats, vec!["animals".to_string(), "food".to_string()]);
    }
```

- [ ] **Step 3: テスト実行**

```bash
source "$HOME/.cargo/env"
cargo test --manifest-path src-tauri/Cargo.toml scan
```

Expected: 6 PASS（既存 3 + 新規 3）。

ビルドは引き続き失敗するが、scan モジュール単独はパスする。

- [ ] **Step 4: コミット**

```bash
git add src-tauri/src/scan.rs
git commit -m "scan: list_categories(parent) を追加

サブフォルダで画像を含むものを名前順で返す。隠しフォルダ
（先頭ドット）は除外。3 件のユニットテスト追加。"
```

---

## Task 3: lib.rs を新 API に書き換え

**Files:**

- Modify: `src-tauri/src/lib.rs`

検証シナリオ：

- `cargo build` が成功（warnings 可）
- `cargo test` 全パス

- [ ] **Step 1: lib.rs の commands を全面更新**

`src-tauri/src/lib.rs` の全体を以下の内容に置き換える（既存のモジュール宣言と plugin chain は維持）:

```rust
// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod state;
mod exif;
mod scan;
mod watcher;

use std::path::PathBuf;
use tauri::{Emitter, Manager, State};
use tauri_plugin_store::StoreExt;

use state::AppState;

const STORE_FILE: &str = "state.json";
const STORE_KEY_PARENT_DIR: &str = "parent_dir";
const STORE_KEY_CURRENT_CATEGORY: &str = "current_category";
// 後方互換: 旧 "photos_dir" キー。初回起動時のみ参照、最初の set_parent_dir で消える
const STORE_KEY_LEGACY_PHOTOS_DIR: &str = "photos_dir";

#[tauri::command]
fn get_parent_dir(state: State<'_, AppState>) -> Option<String> {
    state.parent_dir().map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn set_parent_dir(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    if !path_buf.is_dir() {
        return Err(format!("not a directory: {path}"));
    }

    // 永続化を先に
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.set(STORE_KEY_PARENT_DIR, serde_json::Value::String(path));
    store.delete(STORE_KEY_LEGACY_PHOTOS_DIR);
    store.save().map_err(|e| e.to_string())?;

    state.set_parent_dir(Some(path_buf.clone()));

    // カテゴリの再評価
    let cats = scan::list_categories(&path_buf);
    let new_active = pick_active_category(&cats, state.current_category().as_deref());
    apply_active_category(app, &state, new_active)?;

    Ok(())
}

#[tauri::command]
fn list_categories(state: State<'_, AppState>) -> Vec<String> {
    let Some(parent) = state.parent_dir() else { return vec![]; };
    scan::list_categories(&parent)
}

#[tauri::command]
fn get_current_category(state: State<'_, AppState>) -> Option<String> {
    state.current_category()
}

#[tauri::command]
fn set_current_category(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    category: String,
) -> Result<(), String> {
    let parent = state.parent_dir().ok_or("parent_dir is not set")?;
    let category_dir = parent.join(&category);
    if !category_dir.is_dir() {
        return Err(format!("not a category: {category}"));
    }

    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.set(STORE_KEY_CURRENT_CATEGORY, serde_json::Value::String(category.clone()));
    store.save().map_err(|e| e.to_string())?;

    state.set_current_category(Some(category));
    state.watcher.watch(app, category_dir)?;
    Ok(())
}

#[tauri::command]
async fn pick_folder(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |folder| {
        let _ = tx.send(folder.map(|p| p.to_string()));
    });
    rx.await.ok().flatten()
}

fn read_json_file<T: for<'de> serde::Deserialize<'de> + Default>(
    dir: PathBuf,
    filename: &str,
) -> T {
    let path = dir.join(filename);
    let Ok(text) = std::fs::read_to_string(&path) else { return T::default(); };
    serde_json::from_str(&text).unwrap_or_else(|e| {
        eprintln!("[album] {filename} JSON parse error: {e}");
        T::default()
    })
}

#[tauri::command]
fn read_photos_json(state: State<'_, AppState>) -> serde_json::Value {
    let Some(dir) = state.active_dir() else { return serde_json::Value::Array(vec![]); };
    let photos: serde_json::Value = read_json_file(dir, "photos.json");
    if photos.is_array() {
        photos
    } else {
        serde_json::Value::Array(vec![])
    }
}

#[tauri::command]
fn read_species_json(state: State<'_, AppState>) -> serde_json::Value {
    let Some(dir) = state.active_dir() else { return serde_json::Value::Object(serde_json::Map::new()); };
    let species: serde_json::Value = read_json_file(dir, "species.json");
    if species.is_object() {
        species
    } else {
        serde_json::Value::Object(serde_json::Map::new())
    }
}

#[tauri::command]
fn rescan(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let dir = state.active_dir().ok_or("no active category")?;
    let entries = scan::scan_and_merge(&dir);
    Ok(serde_json::Value::Array(entries))
}

/// カテゴリ一覧と前回 active から、今回の active を決める。
/// - 前回 active が一覧に含まれていればそれを返す
/// - 含まれていなければ先頭を返す
/// - 一覧が空なら None
fn pick_active_category(cats: &[String], previous: Option<&str>) -> Option<String> {
    if let Some(prev) = previous {
        if cats.iter().any(|c| c == prev) {
            return Some(prev.to_string());
        }
    }
    cats.first().cloned()
}

/// active カテゴリを state に設定し、watcher を再起動して store にも保存する。
/// new_active が None ならカテゴリ未設定状態にし、watcher を停止。
fn apply_active_category(
    app: tauri::AppHandle,
    state: &State<'_, AppState>,
    new_active: Option<String>,
) -> Result<(), String> {
    state.set_current_category(new_active.clone());

    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    match &new_active {
        Some(cat) => {
            store.set(STORE_KEY_CURRENT_CATEGORY, serde_json::Value::String(cat.clone()));
        }
        None => {
            store.delete(STORE_KEY_CURRENT_CATEGORY);
        }
    }
    store.save().map_err(|e| e.to_string())?;

    if let (Some(parent), Some(cat)) = (state.parent_dir(), new_active) {
        let dir = parent.join(&cat);
        if dir.is_dir() {
            state.watcher.watch(app, dir)?;
        } else {
            state.watcher.stop();
        }
    } else {
        state.watcher.stop();
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            #[cfg(debug_assertions)]
            app.handle().plugin(tauri_plugin_log::Builder::default().build())?;

            app.manage(AppState::new());

            // 起動時に store から parent_dir / current_category を復元
            let store = app.store(STORE_FILE)?;

            // 後方互換: 新キー parent_dir が無ければ旧 photos_dir を読む
            let parent_path: Option<String> = match store.get(STORE_KEY_PARENT_DIR) {
                Some(serde_json::Value::String(s)) => Some(s),
                _ => match store.get(STORE_KEY_LEGACY_PHOTOS_DIR) {
                    Some(serde_json::Value::String(s)) => Some(s),
                    _ => None,
                },
            };

            let saved_category: Option<String> = match store.get(STORE_KEY_CURRENT_CATEGORY) {
                Some(serde_json::Value::String(s)) => Some(s),
                _ => None,
            };

            if let Some(path_str) = parent_path {
                let path_buf = PathBuf::from(&path_str);
                if path_buf.is_dir() {
                    app.state::<AppState>().set_parent_dir(Some(path_buf.clone()));
                    let cats = scan::list_categories(&path_buf);
                    let active = pick_active_category(&cats, saved_category.as_deref());
                    if let Some(cat) = active {
                        app.state::<AppState>().set_current_category(Some(cat.clone()));
                        let dir = path_buf.join(&cat);
                        if let Err(e) = app.state::<AppState>().watcher.watch(app.handle().clone(), dir) {
                            eprintln!("[album] failed to start watcher on launch: {e}");
                        }
                    }
                }
            }

            // システムメニュー
            use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

            let app_name = "cabinet";
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
        .invoke_handler(tauri::generate_handler![
            get_parent_dir,
            set_parent_dir,
            list_categories,
            get_current_category,
            set_current_category,
            pick_folder,
            read_photos_json,
            read_species_json,
            rescan,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

ノート：

- `tauri_plugin_log` の registration を `setup` クロージャ内に移動した（debug_assertions ガード）。Tauri 2 の慣例
- `read_json_file` は dir を必須化（`Option` を取らない）。caller 側で `active_dir()` を unwrap してから渡す
- `apply_active_category` ヘルパで「state 設定 + store 保存 + watcher 再起動」を一箇所に
- `pick_active_category` は state を持たないピュア関数（ユニットテスト容易）

- [ ] **Step 2: pick_active_category のユニットテストを lib.rs に追加**

ファイル末尾に追加：

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_previous_when_present() {
        let cats = vec!["animals".into(), "arts".into()];
        assert_eq!(pick_active_category(&cats, Some("arts")), Some("arts".into()));
    }

    #[test]
    fn falls_back_to_first_when_previous_missing() {
        let cats = vec!["animals".into(), "arts".into()];
        assert_eq!(pick_active_category(&cats, Some("food")), Some("animals".into()));
    }

    #[test]
    fn falls_back_to_first_when_no_previous() {
        let cats = vec!["animals".into()];
        assert_eq!(pick_active_category(&cats, None), Some("animals".into()));
    }

    #[test]
    fn returns_none_for_empty_list() {
        let cats: Vec<String> = vec![];
        assert_eq!(pick_active_category(&cats, Some("animals")), None);
        assert_eq!(pick_active_category(&cats, None), None);
    }
}
```

- [ ] **Step 3: state.rs から後方互換 alias を削除**

`src-tauri/src/state.rs` 内の以下のブロックを削除（Task 1 で入れた一時的な alias）:

```rust
    // ── 後方互換 alias（Task 3 で lib.rs を書き換えるまで維持。書き換え後 Task 3 で削除） ──
    pub fn photos_dir(&self) -> Option<PathBuf> {
        self.parent_dir()
    }

    pub fn set_photos_dir(&self, path: Option<PathBuf>) {
        self.set_parent_dir(path)
    }
```

lib.rs は新 API のみを使うので削除しても問題ないことを `cargo build` で確認する。

- [ ] **Step 4: PhotoWatcher::stop が無ければ追加**

`src-tauri/src/watcher.rs` を確認。`pub fn stop(&self)` メソッドが無ければ追加：

```rust
impl PhotoWatcher {
    // ... 既存の new / watch ...

    pub fn stop(&self) {
        *self.inner.lock() = None;
    }
}
```

すでに存在するならスキップ。

- [ ] **Step 5: ビルド + 全テスト**

```bash
source "$HOME/.cargo/env"
cargo test --manifest-path src-tauri/Cargo.toml
cargo build --manifest-path src-tauri/Cargo.toml
```

Expected: state 4 + scan 6 + exif 2 + lib 4 = 16 PASS、ビルド成功。

- [ ] **Step 6: コミット**

```bash
git add src-tauri/src/lib.rs src-tauri/src/watcher.rs src-tauri/src/state.rs
git commit -m "lib.rs: コマンドをカテゴリ対応に書き換え

- get_photos_dir → get_parent_dir、set_photos_dir → set_parent_dir
- list_categories / get_current_category / set_current_category 新規
- read_photos_json / read_species_json / rescan は active_dir() で
  parent + current_category を結合
- 起動時の store 復元: parent_dir → categories → current_category の順に
  解決し、Watcher を起動。後方互換で旧 photos_dir キーも参照
- pick_active_category / apply_active_category ヘルパで重複排除
- PhotoWatcher::stop を追加（active カテゴリが無い場合に呼ぶ）
- pick_active_category の unit test 4 件"
```

---

## Task 4: index.html にカテゴリタブの DOM を追加

**Files:**

- Modify: `src/index.html`

検証シナリオ：

- `#category-tabs` 要素が DOM に存在し、`hidden` 属性付きで初期化されている

- [ ] **Step 1: 要素を追加**

`src/index.html` の `<header>...</header>` の直後（`<div class="filters">` の前）に追加：

```html
  <div class="category-tabs" id="category-tabs" hidden>
    <!-- カテゴリボタンは gallery.js が動的生成 -->
  </div>
```

ファイル全体は変更なく、上記 1 ブロックを差し込むだけ。

- [ ] **Step 2: コミット**

```bash
git add src/index.html
git commit -m "index.html: カテゴリタブのコンテナを追加

#category-tabs を header と filters の間に配置。
中身は gallery.js が動的に生成するので空の状態で hidden 初期化。"
```

---

## Task 5: style.css にカテゴリタブのスタイルを追加

**Files:**

- Modify: `src/style.css`

検証シナリオ：

- mokomoko デザインシステム遵守（既存トークンのみ、塗りなし、IBM Plex Mono）
- アクティブタブはアクセント色のテキスト + アクセント色の下線

- [ ] **Step 1: スタイルを追加**

`src/style.css` の末尾に追加：

```css
/* ── category tabs（ヘッダー直下） ── */
.category-tabs {
  display: flex;
  gap: 0;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--border);
}

.category-tabs[hidden] { display: none; }

.cat-tab {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  padding: 8px 14px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text);
  cursor: pointer;
  letter-spacing: .08em;
  margin-bottom: -1px;       /* 親の border-bottom と被せる */
  transition: color .15s, border-color .15s;
}

.cat-tab:hover {
  color: var(--text-hi);
}

.cat-tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}
```

- [ ] **Step 2: コミット**

```bash
git add src/style.css
git commit -m "style.css: カテゴリタブのスタイル

mokomoko 準拠（既存トークン only、塗りなし）。
アクティブタブはアクセント色のテキスト + 下線で示す。
親要素の border-bottom と被せる margin-bottom: -1px の小技で
タブ-下線が連続して見えるようにする。"
```

---

## Task 6: gallery.js にカテゴリ管理を実装

**Files:**

- Modify: `src/gallery.js`

検証シナリオ：

- 起動時に `list_categories` を呼んでタブ描画
- アクティブタブは `current_category` の値
- 別タブクリックで `set_current_category` を呼び、photos.json と species.json を再ロードして再描画

- [ ] **Step 1: 起動・ロードロジックの category 対応**

`src/gallery.js` 内、現在の boot ブロック・`loadAll`・`setupMenuListeners` を以下に置き換える。

**置き換え前**（直近の Task 13 完了時の形）:

```js
  /* ── boot: フォルダ未設定なら picker、設定済なら load ── */
  import('./tauri.js').then(async (T) => {
    await setupMenuListeners(T);
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
```

**置き換え後**:

```js
  /* ── elements ── */
  const categoryTabs = document.getElementById('category-tabs');

  /* ── boot ── */
  import('./tauri.js').then(async (T) => {
    await setupMenuListeners(T);
    const parent = await T.invoke('get_parent_dir');
    if (parent) {
      await refreshCategories(T);
    } else {
      showPicker(T);
    }
  });

  async function refreshCategories(T) {
    const cats = await T.invoke('list_categories');
    const active = await T.invoke('get_current_category');
    renderCategoryTabs(cats, active);
    if (cats.length === 0) {
      // カテゴリ未作成
      grid.innerHTML = '<div class="empty">サブフォルダ（カテゴリ）を作成してください</div>';
      grid.hidden = false;
      picker.hidden = true;
      return;
    }
    if (active) {
      await loadAll(T);
    } else {
      // 一覧があるのに active が無いケース（通常起こらないが防御）
      const fallback = cats[0];
      await chooseCategory(T, fallback);
    }
  }

  function renderCategoryTabs(cats, active) {
    categoryTabs.innerHTML = '';
    if (cats.length === 0) {
      categoryTabs.hidden = true;
      return;
    }
    categoryTabs.hidden = false;
    cats.forEach(cat => {
      const btn = document.createElement('button');
      btn.className = 'cat-tab';
      if (cat === active) btn.classList.add('active');
      btn.dataset.cat = cat;
      btn.textContent = cat;
      btn.addEventListener('click', () => {
        // ESM 用に動的 import
        import('./tauri.js').then(T => chooseCategory(T, cat));
      });
      categoryTabs.appendChild(btn);
    });
  }

  async function chooseCategory(T, category) {
    try {
      await T.invoke('set_current_category', { category });
      // タブの active 切替
      categoryTabs.querySelectorAll('.cat-tab').forEach(b => {
        b.classList.toggle('active', b.dataset.cat === category);
      });
      await loadAll(T);
    } catch (err) {
      console.warn(`[album] カテゴリ切替失敗: ${err}`);
    }
  }

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
```

**置き換え後の `setupMenuListeners`** — `menu:open_folder` のあとに `refreshCategories` 呼び直しが必要、`menu:rescan` の後も同じく：

```js
  async function setupMenuListeners(T) {
    await T.listen('menu:open_folder', async () => {
      const path = await T.pickFolder();
      if (path) await chooseFolder(T, path);
    });
    await T.listen('menu:rescan', async () => {
      await rescan(T);
    });
    await T.listen('photos-updated', async () => {
      const photos = await T.invoke('read_photos_json');
      allPhotos = photos || [];
      applyFilter(activeTag);
    });
  }
```

（`setupMenuListeners` 自体は実質変わらないが、`pickFolder → chooseFolder` のフローはタスク内変更項目）

**`chooseFolder`** — set_parent_dir 後に refreshCategories を呼ぶ：

```js
  async function chooseFolder(T, path) {
    if (pickerInFlight) return;
    pickerInFlight = true;
    pickerBtn.disabled = true;
    try {
      await T.invoke('set_parent_dir', { path });
      await refreshCategories(T);
    } catch (err) {
      alert(`フォルダ設定エラー: ${err}`);
    } finally {
      pickerInFlight = false;
      pickerBtn.disabled = false;
    }
  }
```

旧 `set_photos_dir` を `set_parent_dir` に変えただけ + `loadAll` を `refreshCategories` に。

- [ ] **Step 2: 構文チェック**

```bash
node -e "new Function(require('fs').readFileSync('src/gallery.js', 'utf8'))"
```

エラーなしで終了。

- [ ] **Step 3: コミット**

```bash
git add src/gallery.js
git commit -m "gallery.js: カテゴリ管理（タブ描画・切替）を実装

- 起動時: get_parent_dir → refreshCategories → renderCategoryTabs
- chooseCategory: set_current_category 呼び出し → タブ active 切替
  → loadAll で写真と species を再読み込み
- chooseFolder（picker 用）は set_parent_dir に置き換え後
  refreshCategories を呼ぶ
- カテゴリ 0 件のときはガイド表示"
```

---

## Task 7: tauri.js は変更不要 — 動作確認のみ

**Files:**

- なし（src/tauri.js は invoke の薄ラッパなので追加コマンドも自動で通る）

検証シナリオ：

- DevTools で動作確認

- [ ] **Step 1: ローカル動作確認**

```bash
source "$HOME/.cargo/env"
npm run tauri dev
```

ウィンドウが開いたら DevTools → Console で：

```js
await window.__TAURI__.core.invoke('get_parent_dir')
// → '/Users/naofumiikeda/Pictures/album'

await window.__TAURI__.core.invoke('list_categories')
// → ['animals', 'arts']

await window.__TAURI__.core.invoke('get_current_category')
// → 'animals'

await window.__TAURI__.core.invoke('read_photos_json')
// → [{...}] (animals の photos.json)
```

ヘッダーに `animals arts` のタブが表示され、`animals` が active。`arts` をクリックすると active が切り替わるが、arts は空なので "no photos found" が出る。

`Cmd+R` で rescan、`Cmd+O` で別の親フォルダ選択も動くはず。

確認したら Ctrl+C で停止。

- [ ] **Step 2: コミットなし**

このタスクは動作確認のみ。コードは前タスクで commit 済み。

---

## Task 8: CLAUDE.md / README をカテゴリ対応に更新

**Files:**

- Modify: `CLAUDE.md`
- Modify: `README.md`

検証シナリオ：

- データの置き場所セクションに parent + categories 構造の説明
- README にディレクトリ構造例

- [ ] **Step 1: CLAUDE.md の「データの置き場所」セクションを更新**

`CLAUDE.md` の `## データの置き場所` セクションのテーブルと末尾文章を以下に置き換える：

```markdown
## データの置き場所

| 種類 | 場所 |
|---|---|
| アプリのフロント・バックエンドのコード | このリポジトリ |
| ライブラリ root（parent_dir） | ユーザが選んだ任意のフォルダ（例 `~/Pictures/album/`） |
| カテゴリ（サブフォルダ） | parent_dir 直下の `animals/` `arts/` `food/` など |
| 写真ファイル | カテゴリフォルダの中（例 `~/Pictures/album/animals/IMG_5621.JPG`） |
| `photos.json` / `species.json` | 各カテゴリフォルダの中 |
| アプリ状態（parent_dir / current_category / window 位置） | `~/Library/Application Support/com.naofumiikeda.album/` |

カテゴリは parent_dir 直下のサブフォルダで「画像ファイルを 1 枚以上含むもの」が自動列挙される。
ヘッダーのタブで切替。サブフォルダごとに独立した `species.json` を持つので、動物 / 絵画 / 食事
など扱う情報が違うジャンルを混ぜずに管理できる。
```

- [ ] **Step 2: README.md の開発セクションを更新**

`README.md` の `## 開発` セクション（`npm run tauri dev` の手順がある場所）の説明文を以下に差し替え：

```markdown
## 開発

\```bash
npm install            # 初回のみ
npm run tauri dev
\```

初回起動時にライブラリ root（例 `~/Pictures/album/`）を picker から選択する。
その下に `animals/`, `arts/`, `food/` などのサブフォルダを作り、
それぞれの中に写真と `photos.json` / `species.json` を置く。

```text
~/Pictures/album/
├── animals/
│   ├── photos.json
│   ├── species.json
│   └── IMG_*.jpg
└── arts/
    ├── photos.json
    ├── species.json
    └── IMG_*.jpg
```

ヘッダーのタブでカテゴリを切替。新しい写真をフォルダに追加すると 500ms デバウンスで自動再スキャン。
```

（実ファイル内では `\```` ではなく ` ``` ` の 3 文字 backtick を使う。プロンプト内のエスケープは見やすさのため）

- [ ] **Step 3: コミット**

```bash
git add CLAUDE.md README.md
git commit -m "ドキュメントをカテゴリ対応に更新

- CLAUDE.md データの置き場所: parent_dir + サブフォルダ（カテゴリ）
  + 各カテゴリに photos.json / species.json
- README 開発手順: ディレクトリ構造のサンプルツリーを掲載"
```

---

## Task 9: エンドツーエンド動作確認（手動）

検証シナリオ全項目を実機で確認。Rust 側のテストは Task 1〜3 で済んでいるので、ここは frontend と統合の確認。

- [ ] **Step 1: アプリ起動**

```bash
npm run tauri dev
```

確認：

- ヘッダーに `animals` `arts` の 2 タブ
- `animals` がアクセント色（active）
- グリッドに動物写真 27 枚

- [ ] **Step 2: タブ切替**

`arts` タブをクリック。確認：

- active 表示が `arts` に切り替わる
- グリッドが「no photos found」（arts/ に photos.json なし）

`animals` タブを再度クリック。確認：

- グリッドが復元される

- [ ] **Step 3: ファイルウォッチャーがカテゴリ単位**

`~/Pictures/album/arts/` に適当な JPEG を 1 枚入れる：

```bash
cp ~/Pictures/album/animals/IMG_5621.JPG ~/Pictures/album/arts/test.jpg
```

`arts` タブの状態で 1 秒程度待つと、グリッドに 1 枚追加される。

`animals` タブに切り替えて：

```bash
cp ~/Pictures/album/animals/IMG_5621.JPG /tmp/dummy_animal.jpg
mv /tmp/dummy_animal.jpg ~/Pictures/album/animals/dummy.jpg
```

これは active が animals なので拾われ、animals グリッドが 28 枚になるはず。

確認後、テストファイル削除：

```bash
rm ~/Pictures/album/arts/test.jpg ~/Pictures/album/animals/dummy.jpg
```

- [ ] **Step 4: 再起動で active 復元**

ウィンドウ閉じる → `npm run tauri dev` 再実行。確認：

- 最後に開いていたタブ（`animals` でも `arts` でも）が active で起動

- [ ] **Step 5: Cmd+O で別フォルダ選択**

メニューから `File > Open Folder…` または `Cmd+O`。`~/Pictures/album/animals/`（カテゴリ自体）を選択するとどうなる？

- 期待: animals/ には更にサブフォルダが無いので「カテゴリを作成してください」ガイド表示

`Cmd+O` でもう一度 `~/Pictures/album/` を選択 → タブが復元される。

- [ ] **Step 6: ローカルサーバを停止**

Ctrl+C。

- [ ] **Step 7: コミットなし**

動作確認のみ。問題が見つかれば該当タスクに戻って修正 → 新コミット。

---

## マージ手順

```bash
git checkout main
git merge --no-ff feat/categories -m "Merge branch 'feat/categories'

cabinet にカテゴリ（サブフォルダ）対応を追加。
parent_dir + 直下サブフォルダで animals / arts / food などを
ヘッダータブで切替。各カテゴリは独立した photos.json /
species.json を持つ。"
git branch -d feat/categories
```

---

## 実装後の状態

- ライブラリ root を picker で選ぶと、サブフォルダがカテゴリとして自動列挙
- ヘッダーのタブで切替、active カテゴリは再起動後も復元
- 各カテゴリに独立した photos.json / species.json
- ファイルウォッチャーは active カテゴリのサブフォルダだけ監視
- 旧 `photos_dir` キーの state.json は初回 `set_parent_dir` で `parent_dir` に移行（既存ユーザは何もせず動く）

## 既知のリスク・後回しにする項目

- 新サブフォルダの自動検知なし（ユーザが Finder でフォルダ追加しても、`Cmd+R` または再起動で拾う）
- カテゴリ追加・名前変更・削除の GUI なし（Finder で操作する）
- カテゴリ間で photos / species を移動する UI なし（ユーザが Finder でファイル移動）
- 横断検索・横断フィルター無し
