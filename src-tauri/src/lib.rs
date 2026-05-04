mod state;
mod exif;
mod scan;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
                    app.state::<AppState>().set_photos_dir(Some(path_buf));
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_photos_dir,
            set_photos_dir,
            pick_folder,
            read_photos_json,
            read_species_json,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
