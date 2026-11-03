// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod state;
mod exif;
mod scan;
mod watcher;
mod edit;
mod visits;

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
fn read_artists_json(state: State<'_, AppState>) -> serde_json::Value {
    let Some(dir) = state.active_dir() else { return serde_json::Value::Object(serde_json::Map::new()); };
    let artists: serde_json::Value = read_json_file(dir, "artists.json");
    if artists.is_object() {
        artists
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

#[tauri::command]
fn get_active_dir(state: State<'_, AppState>) -> Option<String> {
    state.active_dir().map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn write_species_json(
    state: State<'_, AppState>,
    value: serde_json::Value,
) -> Result<(), String> {
    let dir = state.active_dir().ok_or("no active category")?;
    edit::write_species_json(&dir, &value)
}

#[tauri::command]
fn write_artists_json(
    state: State<'_, AppState>,
    value: serde_json::Value,
) -> Result<(), String> {
    let dir = state.active_dir().ok_or("no active category")?;
    edit::write_artists_json(&dir, &value)
}

#[tauri::command]
fn update_photo_species(
    state: State<'_, AppState>,
    file: String,
    species: Option<String>,
) -> Result<(), String> {
    let dir = state.active_dir().ok_or("no active category")?;
    edit::update_photo_species(&dir, &file, species.as_deref())
}

#[tauri::command]
fn read_visits_json(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    match state.parent_dir() {
        Some(parent) => visits::read_visits(&parent),
        None => Ok(serde_json::json!({ "visits": [], "wishlist": [] })),
    }
}

#[tauri::command]
fn write_visits_json(
    state: State<'_, AppState>,
    value: serde_json::Value,
) -> Result<(), String> {
    let parent = state.parent_dir().ok_or("parent_dir is not set")?;
    visits::write_visits(&parent, &value)
}

#[tauri::command]
fn read_all_photos(state: State<'_, AppState>) -> serde_json::Value {
    match state.parent_dir() {
        Some(parent) => serde_json::Value::Array(scan::read_all_photos(&parent)),
        None => serde_json::Value::Array(vec![]),
    }
}

/// 訪問の手動選択結果を、その写真が属するカテゴリの photos.json に書く（アクティブカテゴリに限定しない）。
#[tauri::command]
fn update_photo_visit(
    state: State<'_, AppState>,
    category: String,
    file: String,
    visit: Option<String>,
) -> Result<(), String> {
    let parent = state.parent_dir().ok_or("parent_dir is not set")?;
    let dir = scan::category_dir(&parent, &category)?;
    edit::update_photo_visit(&dir, &file, visit.as_deref())
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
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;

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
            read_artists_json,
            rescan,
            get_active_dir,
            write_species_json,
            write_artists_json,
            update_photo_species,
            read_visits_json,
            write_visits_json,
            read_all_photos,
            update_photo_visit,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

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
