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
