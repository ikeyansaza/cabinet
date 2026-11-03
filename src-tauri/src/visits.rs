use serde_json::{json, Value};
use std::path::Path;

/// parent_dir 直下の visits.json を読み、常に {"visits":[...],"wishlist":[...]} の形に正規化して返す。
/// ファイル無し・パース不能・オブジェクトでない場合は両方空配列。
/// 片方のキーが無い／配列でない場合は、そのキーだけ空配列で補う。
pub fn read_visits(parent: &Path) -> Value {
    let path = parent.join("visits.json");
    let parsed: Option<Value> = std::fs::read_to_string(&path)
        .ok()
        .and_then(|text| match serde_json::from_str(&text) {
            Ok(v) => Some(v),
            Err(e) => {
                eprintln!("[album] visits.json JSON parse error: {e}");
                None
            }
        });

    let take_array = |key: &str| -> Value {
        match parsed.as_ref().and_then(|v| v.get(key)) {
            Some(Value::Array(a)) => Value::Array(a.clone()),
            _ => json!([]),
        }
    };
    json!({ "visits": take_array("visits"), "wishlist": take_array("wishlist") })
}

/// visits.json を atomic 書き込み。value はオブジェクトで visits / wishlist が
/// 両方配列のときだけ受け付ける（壊れた形で既存データを上書きしないため）。
pub fn write_visits(parent: &Path, value: &Value) -> Result<(), String> {
    let ok = value.get("visits").map_or(false, Value::is_array)
        && value.get("wishlist").map_or(false, Value::is_array);
    if !ok {
        return Err("visits.json must be an object with `visits` and `wishlist` arrays".into());
    }
    let json = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    crate::edit::write_atomic(&parent.join("visits.json"), json.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;
    use tempfile::TempDir;

    fn empty_shape() -> Value {
        json!({ "visits": [], "wishlist": [] })
    }

    #[test]
    fn missing_file_returns_empty_shape() {
        let tmp = TempDir::new().unwrap();
        assert_eq!(read_visits(tmp.path()), empty_shape());
    }

    #[test]
    fn malformed_file_returns_empty_shape() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("visits.json"), "not json").unwrap();
        assert_eq!(read_visits(tmp.path()), empty_shape());
    }

    #[test]
    fn fills_missing_wishlist() {
        let tmp = TempDir::new().unwrap();
        fs::write(
            tmp.path().join("visits.json"),
            r#"{"visits":[{"id":"2025-10-12-1"}]}"#,
        )
        .unwrap();
        let v = read_visits(tmp.path());
        assert_eq!(v["wishlist"], json!([]));
        assert_eq!(v["visits"][0]["id"].as_str(), Some("2025-10-12-1"));
    }

    #[test]
    fn write_then_read_round_trips() {
        let tmp = TempDir::new().unwrap();
        let value = json!({
            "visits": [{
                "id": "2025-10-12-1", "date": "2025-10-12",
                "place": "アーティゾン美術館", "kind": "美術館"
            }],
            "wishlist": []
        });
        write_visits(tmp.path(), &value).unwrap();
        assert_eq!(read_visits(tmp.path()), value);
    }

    #[test]
    fn write_rejects_missing_arrays() {
        let tmp = TempDir::new().unwrap();
        assert!(write_visits(tmp.path(), &json!({})).is_err());
        assert!(write_visits(tmp.path(), &json!({ "visits": [] })).is_err());
        assert!(write_visits(tmp.path(), &json!([])).is_err());
    }

    #[test]
    fn write_leaves_no_tmp_file() {
        let tmp = TempDir::new().unwrap();
        write_visits(tmp.path(), &empty_shape()).unwrap();
        assert!(!tmp.path().join("visits.tmp").exists());
        assert!(tmp.path().join("visits.json").exists());
    }
}
