use crate::scan;
use notify::RecursiveMode;
#[allow(unused_imports)]
use notify::Watcher;
use notify_debouncer_mini::{new_debouncer, Debouncer};
use parking_lot::Mutex;
use std::path::PathBuf;
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
        let mut debouncer = new_debouncer(
            Duration::from_millis(500),
            move |res: notify_debouncer_mini::DebounceEventResult| {
                match res {
                    Ok(_events) => {
                        let _ = scan::scan_and_merge(&dir_clone);
                        let _ = app_clone.emit("photos-updated", ());
                    }
                    Err(e) => eprintln!("[album] watch error: {e:?}"),
                }
            },
        )
        .map_err(|e| e.to_string())?;

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
