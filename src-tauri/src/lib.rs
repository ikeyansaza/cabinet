mod state;
mod exif;
mod scan;
mod watcher;

use std::path::PathBuf;
use tauri::{Emitter, Manager, State};
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

    // 永続化を先に。失敗したら state はまだ古いまま、再起動しても最後の有効値が残る。
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.set(STORE_KEY_PHOTOS_DIR, serde_json::Value::String(path));
    store.save().map_err(|e| e.to_string())?;

    state.set_photos_dir(Some(path_buf.clone()));
    state.watcher.watch(app, path_buf)?;
    Ok(())
}

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

#[tauri::command]
async fn pick_folder(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |folder| {
        let _ = tx.send(folder.map(|p| p.to_string()));
    });
    rx.await.ok().flatten()
}

#[tauri::command]
fn rescan(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let Some(dir) = state.photos_dir() else {
        return Err("photos_dir is not set".into());
    };
    let entries = scan::scan_and_merge(&dir);
    Ok(serde_json::Value::Array(entries))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            app.manage(AppState::new());

            // 起動時に store から photos_dir を復元
            let store = app.store(STORE_FILE)?;
            if let Some(serde_json::Value::String(path)) = store.get(STORE_KEY_PHOTOS_DIR) {
                let path_buf = PathBuf::from(&path);
                if path_buf.is_dir() {
                    app.state::<AppState>().set_photos_dir(Some(path_buf.clone()));
                    if let Err(e) = app.state::<AppState>().watcher.watch(app.handle().clone(), path_buf) {
                        eprintln!("[album] failed to start watcher on launch: {e}");
                    }
                }
            }

            // システムメニュー
            use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

            let app_name = "mokozukan";
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
        .invoke_handler(tauri::generate_handler![
            get_photos_dir,
            set_photos_dir,
            pick_folder,
            read_photos_json,
            read_species_json,
            rescan,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
