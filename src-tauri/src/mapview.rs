//! Map imagery for the 3D view, fetched here rather than in the webview.
//!
//! zero-k.info sends no `Access-Control-Allow-Origin` on `/Resources/`, so a
//! canvas textured from those URLs cross-origin is tainted and WebGL refuses
//! it. The bytes have to arrive through Rust. They are small: a heightmap is
//! 10-16 kB and a minimap 74-87 kB, against roughly 30 MB for the archive.

use std::time::Duration;

use base64::Engine as _;
use serde::Serialize;

const BASE: &str = "https://zero-k.info/Resources/";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const READ_TIMEOUT: Duration = Duration::from_secs(30);

/// Well past the largest measured asset (87 kB) and far short of anything that
/// would hurt to hold in a JSON string.
const MAX_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapTerrain {
    /// `data:` URLs, ready for an `<img>` the canvas can read back.
    pub heightmap: String,
    pub minimap: String,
}

/// Zero-K addresses these by name with spaces turned into underscores, not
/// percent-encoded. Getting this wrong is the usual reason a map image 404s.
fn asset_url(name: &str, kind: &str) -> String {
    format!("{BASE}{}.{kind}.jpg", name.replace(' ', "_"))
}

fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent("shiro")
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(READ_TIMEOUT)
        .build()
        .map_err(|e| format!("could not build an HTTP client: {e}"))
}

/// True when the response is an image rather than the site's error page.
///
/// A missing asset does not always answer 404: the site serves a small HTML
/// page for some names, so the content type has to be checked as well.
fn is_image(status: u16, content_type: Option<&str>) -> bool {
    status == 200 && content_type.is_some_and(|c| c.starts_with("image/"))
}

fn fetch_one(client: &reqwest::blocking::Client, url: &str) -> Result<Vec<u8>, String> {
    let res = client.get(url).send().map_err(|e| format!("could not reach {url}: {e}"))?;
    let status = res.status().as_u16();
    let ctype = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    if !is_image(status, ctype.as_deref()) {
        return Err(format!("no image published ({status})"));
    }
    let bytes = res.bytes().map_err(|e| format!("could not read {url}: {e}"))?;
    if bytes.len() > MAX_BYTES {
        return Err(format!("image is larger than expected ({} bytes)", bytes.len()));
    }
    Ok(bytes.to_vec())
}

fn data_url(bytes: &[u8]) -> String {
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    format!("data:image/jpeg;base64,{b64}")
}

/// Both assets a 3D view needs, or an error naming which one is missing.
#[tauri::command]
pub fn zks_map_terrain(name: String) -> Result<MapTerrain, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("no map name given".into());
    }
    let client = client()?;
    let height = fetch_one(&client, &asset_url(name, "heightmap"))
        .map_err(|e| format!("heightmap: {e}"))?;
    let colour = fetch_one(&client, &asset_url(name, "minimap"))
        .map_err(|e| format!("minimap: {e}"))?;
    Ok(MapTerrain { heightmap: data_url(&height), minimap: data_url(&colour) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spaces_become_underscores() {
        assert_eq!(
            asset_url("Comet Catcher Redux v3.1", "heightmap"),
            "https://zero-k.info/Resources/Comet_Catcher_Redux_v3.1.heightmap.jpg"
        );
    }

    #[test]
    fn a_name_without_spaces_is_unchanged() {
        assert_eq!(
            asset_url("Aetherium", "minimap"),
            "https://zero-k.info/Resources/Aetherium.minimap.jpg"
        );
    }

    #[test]
    fn the_error_page_is_not_an_image() {
        assert!(!is_image(200, Some("text/html; charset=utf-8")));
        assert!(!is_image(404, Some("image/jpeg")));
        assert!(!is_image(200, None));
        assert!(is_image(200, Some("image/jpeg")));
    }

    #[test]
    fn a_data_url_round_trips() {
        let url = data_url(&[0xff, 0xd8, 0xff]);
        assert_eq!(url, "data:image/jpeg;base64,/9j/");
    }
}
