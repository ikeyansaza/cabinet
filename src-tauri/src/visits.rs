use serde_json::{json, Value};
use std::path::Path;

/// parent_dir 直下の visits.json を読み、{"visits":[...],"wishlist":[...]} の形に正規化して返す。
/// - ファイルが無い／オブジェクトでない場合は両方空配列（Ok）。
/// - 片方のキーが無い／配列でない場合は、そのキーだけ空配列で補う。
/// - ファイルはあるが JSON として壊れている場合は Err。手編集の typo を「空」と見なすと、
///   次の保存で既存の記録を全部上書きしてしまうため、握りつぶさない。
pub fn read_visits(parent: &Path) -> Result<Value, String> {
    let path = parent.join("visits.json");
    let parsed: Option<Value> = match std::fs::read_to_string(&path) {
        Err(_) => None,
        Ok(text) => Some(
            serde_json::from_str(&text).map_err(|e| format!("visits.json が壊れています: {e}"))?,
        ),
    };

    let take_array = |key: &str| -> Value {
        match parsed.as_ref().and_then(|v| v.get(key)) {
            Some(Value::Array(a)) => Value::Array(a.clone()),
            _ => json!([]),
        }
    };
    Ok(json!({ "visits": take_array("visits"), "wishlist": take_array("wishlist") }))
}

/// visits.json を atomic 書き込み。value はオブジェクトで visits / wishlist が
/// 両方配列のときだけ受け付ける。既存ファイルが壊れている場合も上書きしない（手で直してもらう）。
pub fn write_visits(parent: &Path, value: &Value) -> Result<(), String> {
    let ok = value.get("visits").map_or(false, Value::is_array)
        && value.get("wishlist").map_or(false, Value::is_array);
    if !ok {
        return Err("visits.json must be an object with `visits` and `wishlist` arrays".into());
    }
    read_visits(parent)?; // 壊れた既存ファイルを上書きしないための確認
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
        assert_eq!(read_visits(tmp.path()).unwrap(), empty_shape());
    }

    // 手編集で壊れた visits.json を「空」として扱うと、次の保存で全履歴が上書きされてしまう。
    // 読み込みはエラーを返し、書き込みも壊れたファイルを上書きしない。
    #[test]
    fn malformed_file_is_an_error() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("visits.json"), r#"{"visits":[],}"#).unwrap();
        assert!(read_visits(tmp.path()).is_err());
    }

    #[test]
    fn write_refuses_to_overwrite_malformed_file() {
        let tmp = TempDir::new().unwrap();
        let broken = r#"{"visits":[{"id":"a"}],}"#;
        fs::write(tmp.path().join("visits.json"), broken).unwrap();
        assert!(write_visits(tmp.path(), &empty_shape()).is_err());
        assert_eq!(fs::read_to_string(tmp.path().join("visits.json")).unwrap(), broken);
    }

    #[test]
    fn fills_missing_wishlist() {
        let tmp = TempDir::new().unwrap();
        fs::write(
            tmp.path().join("visits.json"),
            r#"{"visits":[{"id":"2025-10-12-1"}]}"#,
        )
        .unwrap();
        let v = read_visits(tmp.path()).unwrap();
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
        assert_eq!(read_visits(tmp.path()).unwrap(), value);
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
