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
