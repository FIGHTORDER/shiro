//! Map imagery for the 3D view, fetched here rather than in the webview.
//!
//! zero-k.info sends no `Access-Control-Allow-Origin` on `/Resources/`, so a
//! canvas textured from those URLs cross-origin is tainted and WebGL refuses
//! it. The bytes have to arrive through Rust. They are small: a heightmap is
//! 10-16 kB and a minimap 74-87 kB, against roughly 30 MB for the archive.

use std::io::Read as _;
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

/// What went wrong, in a shape the dialog can branch on.
///
/// It used to tell a missing asset from a dead connection by looking for the
/// word "heightmap" in the message. Every transport error names the URL it
/// failed to reach, and that URL contains the word, so a captive portal was
/// reported to the player as a map Zero-K had never published a heightmap for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TerrainErrorKind {
    /// The site answered, and what it answered with was not an image.
    Missing,
    /// The site was not reached at all.
    Network,
    /// Anything else. The message is the whole explanation.
    Other,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerrainError {
    pub kind: TerrainErrorKind,
    /// Which of the two pictures failed, when the failure belongs to one.
    pub asset: Option<&'static str>,
    pub message: String,
}

impl TerrainError {
    fn new(kind: TerrainErrorKind, asset: Option<&'static str>, message: impl Into<String>) -> Self {
        Self { kind, asset, message: message.into() }
    }
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

fn fetch_one(asset: &'static str, url: &str) -> Result<Vec<u8>, TerrainError> {
    let client = client().map_err(|e| TerrainError::new(TerrainErrorKind::Other, Some(asset), e))?;
    let res = client.get(url).send().map_err(|e| {
        TerrainError::new(TerrainErrorKind::Network, Some(asset), format!("could not reach {url}: {e}"))
    })?;
    let status = res.status().as_u16();
    let ctype = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    if !is_image(status, ctype.as_deref()) {
        return Err(TerrainError::new(
            TerrainErrorKind::Missing,
            Some(asset),
            format!("no image published ({status})"),
        ));
    }
    /* Refused before the body is held, not after: `bytes()` buffers the whole
       response first, so a length checked on what it returns bounds nothing.
       A chunked reply carries no Content-Length, hence the capped read too. */
    if res.content_length().is_some_and(|n| n > MAX_BYTES as u64) {
        return Err(oversized(asset));
    }
    let mut body = Vec::new();
    res.take(MAX_BYTES as u64 + 1).read_to_end(&mut body).map_err(|e| {
        TerrainError::new(TerrainErrorKind::Network, Some(asset), format!("could not read {url}: {e}"))
    })?;
    if body.len() > MAX_BYTES {
        return Err(oversized(asset));
    }
    Ok(body)
}

fn oversized(asset: &'static str) -> TerrainError {
    TerrainError::new(
        TerrainErrorKind::Other,
        Some(asset),
        format!("the {asset} is larger than the {MAX_BYTES} byte limit"),
    )
}

fn unfinished(asset: &'static str, e: impl std::fmt::Display) -> TerrainError {
    TerrainError::new(
        TerrainErrorKind::Other,
        Some(asset),
        format!("the {asset} fetch did not finish: {e}"),
    )
}

fn data_url(bytes: &[u8]) -> String {
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    format!("data:image/jpeg;base64,{b64}")
}

/// Both assets a 3D view needs, or a `TerrainError` saying which one failed
/// and what kind of failure it was.
///
/// Off the main thread, as the downloads in `apps.rs` and `skins.rs` are: these
/// are blocking GETs, and a synchronous command runs on the event loop, so the
/// window stopped painting for as long as the site took to answer. The two
/// assets do not depend on each other, so they go out at once and the wait is
/// the slower of them rather than the sum. A missing heightmap is still
/// reported ahead of a missing minimap, as before.
#[tauri::command]
pub async fn zks_map_terrain(name: String) -> Result<MapTerrain, TerrainError> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(TerrainError::new(TerrainErrorKind::Other, None, "no map name given"));
    }
    let height_url = asset_url(&name, "heightmap");
    let minimap_url = asset_url(&name, "minimap");

    let height = tauri::async_runtime::spawn_blocking(move || fetch_one("heightmap", &height_url));
    let colour = tauri::async_runtime::spawn_blocking(move || fetch_one("minimap", &minimap_url));

    let height = height.await.map_err(|e| unfinished("heightmap", e))?;
    let colour = colour.await.map_err(|e| unfinished("minimap", e))?;

    Ok(MapTerrain { heightmap: data_url(&height?), minimap: data_url(&colour?) })
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

    /* The dialog branches on `kind`, so the wire spelling of these is load
       bearing: a rename here silently turns every failure into "something else
       went wrong" over there. */
    #[test]
    fn a_failure_names_its_kind_and_its_asset() {
        let missing = TerrainError::new(TerrainErrorKind::Missing, Some("heightmap"), "no image published (404)");
        let v = serde_json::to_value(&missing).unwrap();
        assert_eq!(v["kind"], "missing");
        assert_eq!(v["asset"], "heightmap");
        assert_eq!(v["message"], "no image published (404)");

        let net = TerrainError::new(TerrainErrorKind::Network, Some("minimap"), "could not reach x");
        assert_eq!(serde_json::to_value(&net).unwrap()["kind"], "network");

        let other = TerrainError::new(TerrainErrorKind::Other, None, "no map name given");
        let v = serde_json::to_value(&other).unwrap();
        assert_eq!(v["kind"], "other");
        assert!(v["asset"].is_null());
    }

    /* An unreachable site and a map with no heightmap used to be one string
       apart, and the string they shared was the word in the URL. */
    #[test]
    fn an_oversized_body_is_not_reported_as_a_missing_map() {
        let e = oversized("heightmap");
        assert_eq!(e.kind, TerrainErrorKind::Other);
        assert_eq!(e.asset, Some("heightmap"));
        assert!(e.message.contains("larger"));
    }

    #[test]
    fn a_data_url_round_trips() {
        let url = data_url(&[0xff, 0xd8, 0xff]);
        assert_eq!(url, "data:image/jpeg;base64,/9j/");
    }
}
