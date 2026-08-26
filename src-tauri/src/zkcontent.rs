//! Zero-K's own content service, for what pr-downloader cannot reach.
//!
//! pr-downloader resolves a name through rapid and springfiles. Between them
//! those cover the base game and most maps in circulation, and neither has
//! recent community maps or any of the custom mods. Zero-K runs a WCF service
//! which does have them, and one SOAP call turns a name into a file URL.
//!
//! Three things about that service shape this module:
//!
//! * It is SOAP, and it answers on plain HTTP only - a POST to the HTTPS
//!   endpoint 404s. So the *resolution* cannot be encrypted. The download can
//!   be, and is: the returned links are `http://` but the same paths serve over
//!   `https://`, so we upgrade them and never fetch content in the clear.
//! * A name it does not know comes back as a nil result, not a fault, with
//!   HTTP 200. So does an empty name and one full of markup. There is no error
//!   to catch - absence is a shape, and [`parse_response`] returns `Ok(None)`.
//! * `links` can be empty on a resource that genuinely exists and is served
//!   elsewhere, which is a different answer from nil and is reported
//!   differently.
//!
//! The parsing half is pure and tested against responses captured verbatim from
//! the live service (`src/fixtures/downloadfile-*.xml`), including the 7 kB of
//! base64 torrent we do not want, because a blob sitting next to the fields we
//! do want is exactly what a careless scan would trip over.

use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

const ENDPOINT: &str = "http://zero-k.info/ContentService.svc";
const SOAP_ACTION: &str = "http://tempuri.org/IContentService/DownloadFile";

/// Hosts we will take content from.
///
/// The official client merely prefers zero-k.info when ordering links; we
/// require it. We have none of its history of third-party mirrors to support,
/// and the list of links arrives over plain HTTP, so an attacker who can see
/// that exchange would otherwise get to name the download host outright.
const ALLOWED_HOST: &str = "zero-k.info";

/// Which directory a resource belongs in.
///
/// Decided by the service, never inferred from the extension: `.sd7` and `.sdz`
/// both appear on both sides.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ResourceKind {
    Map,
    Mod,
}

impl ResourceKind {
    pub fn directory(self) -> &'static str {
        match self {
            ResourceKind::Map => "maps",
            ResourceKind::Mod => "games",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Resolved {
    pub kind: ResourceKind,
    /// Downloadable URLs, https, allowed host only. May be empty.
    pub urls: Vec<String>,
    /// Other internal names this one needs. May include `rapid://` entries,
    /// which are pr-downloader's job rather than ours.
    pub dependencies: Vec<String>,
    /// The archive's MD5, from `torrentFileName`.
    pub md5: Option<String>,
}

// ------------------------------------------------------------------ xml ----

/// Escape a value for an XML text node.
///
/// The name comes off the wire from the lobby server, so it is not ours to
/// trust; `Supreme-K 3.42` shows these are not tidy identifiers to begin with.
pub fn xml_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 16);
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(c),
        }
    }
    out
}

fn xml_unescape(s: &str) -> String {
    let named = s
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        // Last, so an escaped ampersand cannot re-form one of the above.
        .replace("&amp;", "&");
    if !named.contains("&#") {
        return named;
    }
    // Numeric entities. The game-mode payloads are JSON with `&#xD;` at every
    // line end, and a JSON parser will not accept that as whitespace.
    let mut out = String::with_capacity(named.len());
    let mut rest = named.as_str();
    while let Some(at) = rest.find("&#") {
        out.push_str(&rest[..at]);
        let after = &rest[at + 2..];
        let Some(end) = after.find(';') else {
            out.push_str(&rest[at..]);
            return out;
        };
        let body = &after[..end];
        let parsed = body
            .strip_prefix(['x', 'X'])
            .and_then(|hex| u32::from_str_radix(hex, 16).ok())
            .or_else(|| body.parse::<u32>().ok())
            .and_then(char::from_u32);
        match parsed {
            Some(c) => out.push(c),
            // Not a number we understand: leave it exactly as it was.
            None => out.push_str(&rest[at..at + 2 + end + 1]),
        }
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    out
}

/// Reject anything that cannot be a sane content name before it reaches the
/// wire, on the same grounds as `content::check_name`.
fn check_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("empty content name".into());
    }
    if name.chars().any(|c| c.is_control()) {
        return Err(format!("content name contains a control character: {name:?}"));
    }
    Ok(())
}

pub fn build_request(internal_name: &str) -> Result<String, String> {
    check_name(internal_name)?;
    Ok(format!(
        concat!(
            r#"<?xml version="1.0" encoding="utf-8"?>"#,
            r#"<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>"#,
            r#"<DownloadFile xmlns="http://tempuri.org/"><internalName>{}</internalName></DownloadFile>"#,
            r#"</s:Body></s:Envelope>"#,
        ),
        xml_escape(internal_name)
    ))
}

/// Where an element's content starts, and whether the tag closed itself.
///
/// Namespace prefixes vary by response (`a:`, `b:`, none), so matching is on
/// the local name. Returns the open tag's attribute text as well, which is how
/// `i:nil` is spotted.
fn find_element<'a>(xml: &'a str, local: &str) -> Option<(usize, &'a str, bool)> {
    let bytes = xml.as_bytes();
    let mut i = 0;
    while let Some(off) = xml[i..].find('<') {
        let start = i + off;
        let rest = &xml[start + 1..];
        if rest.starts_with('/') || rest.starts_with('?') || rest.starts_with('!') {
            i = start + 1;
            continue;
        }
        let name_end = rest
            .find(|c: char| c == '>' || c == '/' || c.is_whitespace())
            .unwrap_or(rest.len());
        let name = &rest[..name_end];
        if name.rsplit(':').next() == Some(local) {
            let gt = match rest.find('>') {
                Some(g) => g,
                None => return None,
            };
            let attrs = &rest[name_end..gt];
            let self_closing = bytes.get(start + gt) == Some(&b'/');
            return Some((start + 1 + gt + 1, attrs, self_closing));
        }
        i = start + 1;
    }
    None
}

/// The text between an element's tags. `None` when absent or self-closing.
fn element_text<'a>(xml: &'a str, local: &str) -> Option<&'a str> {
    let (content_start, _, self_closing) = find_element(xml, local)?;
    if self_closing {
        return None;
    }
    let rest = &xml[content_start..];
    // These elements never contain a same-named child, so the first matching
    // close tag is ours.
    let mut i = 0;
    while let Some(off) = rest[i..].find("</") {
        let at = i + off;
        let after = &rest[at + 2..];
        let name_end = after.find('>')?;
        if after[..name_end].trim().rsplit(':').next() == Some(local) {
            return Some(&rest[..at]);
        }
        i = at + 2;
    }
    None
}

/// Every `<string>` inside a named container.
///
/// Walks by tag position rather than by searching for the text it just read.
/// An empty `<string></string>` has empty text, `find("")` answers 0, and the
/// old loop then re-read the same element forever - a hang, and an unbounded
/// `Vec`, reachable from a response on a plaintext channel.
fn string_array(xml: &str, container: &str) -> Vec<String> {
    let Some(inner) = element_text(xml, container) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let mut rest = inner;
    loop {
        let Some(open) = find_open_tag(rest, "string") else { break };
        let Some(close_at) = rest[open.1..].find("</") else { break };
        let close = open.1 + close_at;
        out.push(xml_unescape(&rest[open.1..close]));
        // Past the closing tag, whatever it contained: this always advances.
        let Some(end) = rest[close..].find('>') else { break };
        rest = &rest[close + end + 1..];
    }
    out
}

/// Where a `<local>` open tag starts and its content begins, namespace or not.
fn find_open_tag(xml: &str, local: &str) -> Option<(usize, usize)> {
    let mut i = 0;
    loop {
        let at = i + xml[i..].find('<')?;
        let after = &xml[at + 1..];
        let end = after.find('>')?;
        let name = after[..end].split_whitespace().next().unwrap_or("");
        if !name.starts_with('/') && name.rsplit(':').next() == Some(local) {
            // A self-closing tag has no content to read.
            if !after[..end].ends_with('/') {
                return Some((at, at + 1 + end + 1));
            }
        }
        i = at + 1 + end + 1;
        if i >= xml.len() {
            return None;
        }
    }
}

/// The 32 hex digits before `.torrent`, if they are there.
fn md5_from_torrent_name(name: &str) -> Option<String> {
    let stem = name.strip_suffix(".torrent")?;
    let candidate = stem.rsplit('_').next()?;
    let ok = candidate.len() == 32 && candidate.chars().all(|c| c.is_ascii_hexdigit());
    ok.then(|| candidate.to_ascii_lowercase())
}

/// True if `url` points somewhere we are willing to download from.
fn host_allowed(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://")) else {
        return false;
    };
    // Authority ends at the first '/', '?' or '#'. Strip any userinfo, which is
    // the classic way to make a URL look like it points somewhere it does not.
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host = authority.rsplit('@').next().unwrap_or(authority);
    let host = host.split(':').next().unwrap_or(host).to_ascii_lowercase();
    host == ALLOWED_HOST || host.ends_with(&format!(".{ALLOWED_HOST}"))
}

/// Upgrade a link to HTTPS. The service hands back `http://`; the same paths
/// serve over TLS, and there is no reason to move 90 MB of game content in the
/// clear when we do not have to.
fn to_https(url: &str) -> String {
    match url.strip_prefix("http://") {
        Some(rest) => format!("https://{rest}"),
        None => url.to_string(),
    }
}

/// Read a `DownloadFile` response.
///
/// `Ok(None)` means the service does not know the name - a nil result, which is
/// also what a malformed request produces. `Ok(Some(r))` with an empty
/// `r.urls` means it knows the name but does not serve the file.
pub fn parse_response(xml: &str) -> Result<Option<Resolved>, String> {
    if let Some(fault) = element_text(xml, "faultstring") {
        return Err(format!("the content service refused: {}", xml_unescape(fault).trim()));
    }
    let Some((_, attrs, _)) = find_element(xml, "DownloadFileResult") else {
        return Err("no DownloadFileResult in the response".into());
    };
    if attrs.contains("nil=\"true\"") {
        return Ok(None);
    }

    let kind = match element_text(xml, "resourceType").map(str::trim) {
        Some("Map") => ResourceKind::Map,
        Some("Mod") => ResourceKind::Mod,
        Some(other) => return Err(format!("unknown resourceType {other:?}")),
        None => return Err("no resourceType in the response".into()),
    };

    // rapid:// entries are instructions to use pr-downloader, not URLs, and
    // anything off-host is refused outright.
    let urls = string_array(xml, "links")
        .into_iter()
        .filter(|u| host_allowed(u))
        .map(|u| to_https(&u))
        .collect();

    Ok(Some(Resolved {
        kind,
        urls,
        dependencies: string_array(xml, "dependencies"),
        md5: element_text(xml, "torrentFileName").and_then(md5_from_torrent_name),
    }))
}

// -------------------------------------------------------------- searching ----

/// A map the service knows about.
///
/// Less than a `CatalogueMap` knows, deliberately: `FindResourceData` reaches
/// the whole library and answers with no dimensions and no rating, so a screen
/// showing one of these has to look thinner than one showing a catalogue entry
/// rather than pad the gap out with zeroes.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapHit {
    pub name: String,
    /// Zero-K's own rating of the map. "MatchMaker" is the curated set the
    /// ladder draws from, so those are worth showing first.
    pub support: String,
    /* The response carried these all along and the parser read two elements of
       ten. The id is the one that matters: it is what addresses a map's page on
       zero-k.info, so a searched map can link to itself rather than to a search
       - and searching is the only way to reach the 30,000-odd maps the public
       catalogue leaves out. */
    pub resource_id: Option<u32>,
    /// Absent, not false: the service sends no flag at all for some hits, and
    /// "we were not told" is a different claim from "not a 1v1 map".
    pub is_1v1: Option<bool>,
    pub is_teams: Option<bool>,
    pub is_ffa: Option<bool>,
    pub is_special: Option<bool>,
}

/// Every `<InternalName>` in a FindResourceData response, with its support
/// level, best first.
///
/// The catalogue is enormous and unfiltered - a search for "wars" over mods
/// returns four hundred results going back to Star Wars TA - so the ordering
/// matters more than it looks. Maps the matchmaker will use come first.
pub fn parse_search(xml: &str) -> Result<Vec<MapHit>, String> {
    if let Some(fault) = element_text(xml, "faultstring") {
        return Err(format!("the content service refused: {}", xml_unescape(fault).trim()));
    }
    let mut out = Vec::new();
    let mut rest = xml;
    while let Some((start, _, _)) = find_element(rest, "ResourceData") {
        let block_end = rest[start..]
            .find("</a:ResourceData>")
            .map(|i| start + i)
            .unwrap_or(rest.len());
        let block = &rest[start..block_end];
        /* `i:nil="true"` is how this response says "no answer", and it is a
           self-closing element - so a tag that is present but nil reads as
           absent here, which is what it means. */
        let flag = |tag: &str| element_text(block, tag).map(|v| v.trim() == "true");
        if let Some(name) = element_text(block, "InternalName") {
            out.push(MapHit {
                name: xml_unescape(name),
                support: element_text(block, "MapSupportLevel").unwrap_or("").to_string(),
                resource_id: element_text(block, "ResourceID")
                    .and_then(|s| s.trim().parse::<u32>().ok())
                    .filter(|id| *id != 0),
                is_1v1: flag("MapIs1v1"),
                is_teams: flag("MapIsTeams"),
                is_ffa: flag("MapIsFfa"),
                is_special: flag("MapIsSpecial"),
            });
        }
        rest = &rest[block_end.min(rest.len())..];
        if rest.is_empty() {
            break;
        }
    }
    // Stable, so equal-ranked maps keep the service's own order.
    out.sort_by_key(|m| match m.support.as_str() {
        "MatchMaker" => 0,
        "Featured" => 1,
        "Supported" => 2,
        _ => 3,
    });
    Ok(out)
}

fn search_request(words: &[String], kind: &str) -> Result<String, String> {
    let mut items = String::new();
    for w in words {
        check_name(w)?;
        items.push_str(&format!("<a:string>{}</a:string>", xml_escape(w)));
    }
    Ok(format!(
        concat!(
            r#"<?xml version="1.0" encoding="utf-8"?>"#,
            r#"<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>"#,
            r#"<FindResourceData xmlns="http://tempuri.org/">"#,
            r#"<words xmlns:a="http://schemas.microsoft.com/2003/10/Serialization/Arrays">{}</words>"#,
            r#"<type>{}</type></FindResourceData></s:Body></s:Envelope>"#,
        ),
        items, kind
    ))
}

/// Search Zero-K's map catalogue.
///
/// Async so the SOAP round trip lands on a worker rather than the main thread,
/// where it froze the window for the length of a search.
#[tauri::command]
pub async fn zks_find_maps(query: String) -> Result<Vec<MapHit>, String> {
    tauri::async_runtime::spawn_blocking(move || find_maps_blocking(query))
        .await
        .map_err(|e| format!("the map search did not finish: {e}"))?
}

fn find_maps_blocking(query: String) -> Result<Vec<MapHit>, String> {
    let words: Vec<String> =
        query.split_whitespace().map(str::to_string).filter(|w| !w.is_empty()).collect();
    if words.is_empty() {
        return Ok(Vec::new());
    }
    let body = search_request(&words, "Map")?;
    let res = soap_client()?
        .post(ENDPOINT)
        .header("Content-Type", "text/xml; charset=utf-8")
        .header("SOAPAction", format!("\"{}\"", "http://tempuri.org/IContentService/FindResourceData"))
        .body(body)
        .send()
        .map_err(|e| format!("could not reach the Zero-K content service: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("the content service answered {}", res.status()));
    }
    parse_search(&res.text().map_err(|e| format!("unreadable response: {e}"))?)
}

// ------------------------------------------------------------ game modes ----

/// One of Zero-K's featured custom game modes.
///
/// A mode is not simply "a different game". Measured against the live service,
/// the seven featured modes divide three ways: most name a `game` archive,
/// Zero Wars names a `map` instead and runs on stock Zero-K, and Tech-K names
/// neither and is nothing but a modoption. Anything that assumed mode implies
/// game would host a plain Zero-K room for two of the seven.
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameMode {
    pub short_name: String,
    pub display_name: String,
    /// Goes to `BattleHeader.Game`, when the mode has one.
    pub game: Option<String>,
    /// Goes to `BattleHeader.Map`. Only Zero Wars uses this today.
    pub map: Option<String>,
    /// Modoptions, applied once the server has put us in the room.
    pub options: std::collections::BTreeMap<String, String>,
}

/// Read a `GetFeaturedCustomGameModes` response.
///
/// `FileContent` is JSON, despite sitting beside a genuinely base64 field in
/// the same service - it arrives XML-escaped, `&#xD;` and all.
pub fn parse_game_modes(xml: &str) -> Result<Vec<GameMode>, String> {
    if let Some(fault) = element_text(xml, "faultstring") {
        return Err(format!("the content service refused: {}", xml_unescape(fault).trim()));
    }
    let mut out = Vec::new();
    let mut rest = xml;
    while let Some((start, _, _)) = find_element(rest, "CustomGameModeInfo") {
        let end = rest[start..]
            .find("</a:CustomGameModeInfo>")
            .map(|i| start + i)
            .unwrap_or(rest.len());
        let block = &rest[start..end];
        let display = element_text(block, "DisplayName").map(xml_unescape).unwrap_or_default();
        let file = element_text(block, "FileName").map(xml_unescape).unwrap_or_default();

        let mut mode = GameMode {
            short_name: file.clone(),
            display_name: display,
            ..Default::default()
        };
        if let Some(content) = element_text(block, "FileContent") {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&xml_unescape(content)) {
                let text = |k: &str| {
                    v.get(k).and_then(|x| x.as_str()).map(str::to_string).filter(|s| !s.is_empty())
                };
                // Upstream spells it both ways - `shortName` on six of them and
                // `shortname` on Stiofan's - so fall back to the file name.
                if let Some(sn) = text("shortName").or_else(|| text("shortname")) {
                    mode.short_name = sn;
                }
                mode.game = text("game");
                mode.map = text("map");
                if let Some(opts) = v.get("options").and_then(|o| o.as_object()) {
                    for (k, val) in opts {
                        let as_text = match val {
                            serde_json::Value::String(s) => s.clone(),
                            other => other.to_string(),
                        };
                        mode.options.insert(k.clone(), as_text);
                    }
                }
            }
        }
        if !mode.short_name.is_empty() {
            out.push(mode);
        }
        rest = &rest[end.min(rest.len())..];
        if rest.is_empty() {
            break;
        }
    }
    Ok(out)
}

/// The featured custom game modes, for the host dialog.
#[tauri::command]
pub async fn zks_game_modes() -> Result<Vec<GameMode>, String> {
    tauri::async_runtime::spawn_blocking(game_modes_blocking)
        .await
        .map_err(|e| format!("the game-mode list did not finish: {e}"))?
}

fn game_modes_blocking() -> Result<Vec<GameMode>, String> {
    let body = concat!(
        r#"<?xml version="1.0" encoding="utf-8"?>"#,
        r#"<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>"#,
        r#"<GetFeaturedCustomGameModes xmlns="http://tempuri.org/"/>"#,
        r#"</s:Body></s:Envelope>"#,
    );
    let res = soap_client()?
        .post(ENDPOINT)
        .header("Content-Type", "text/xml; charset=utf-8")
        .header(
            "SOAPAction",
            "\"http://tempuri.org/IContentService/GetFeaturedCustomGameModes\"",
        )
        .body(body)
        .send()
        .map_err(|e| format!("could not reach the Zero-K content service: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("the content service answered {}", res.status()));
    }
    parse_game_modes(&res.text().map_err(|e| format!("unreadable response: {e}"))?)
}

// ------------------------------------------------------------- filenames ----

/// The file name a URL implies, refused if it could escape the target folder.
/// One map in the site's own catalogue.
///
/* The rename is load-bearing and its absence was silent. Rust says `is_1v1`
   and the client reads `is1v1`; without this every multi-word field arrived as
   `undefined` and every screen drew the shape of a map it had been told nothing
   about. `width` and `height` are one word each, which is why size was the only
   thing that ever worked and why the fault looked like four unrelated ones.
   See `the_catalogue_reaches_the_client_under_the_names_it_reads`. */
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogueMap {
    pub name: String,
    pub resource_id: u32,
    /* Everything below was arriving in the same response all along and being
       dropped on the floor: the parser read two fields out of sixteen. It is
       what the site knows about a map, and it is the difference between a
       picture with a name under it and being able to say the thing a player
       actually wants to know - how big, how many people, and is it any good.

       All optional. A map the service has not rated has no rating, and saying
       "0" would be a claim rather than a gap. */
    pub width: Option<u32>,
    pub height: Option<u32>,
    /// Featured, MatchMaker, or whatever the service adds next - kept as text
    /// rather than an enum, because an unknown level should not fail a parse.
    pub support_level: Option<String>,
    pub is_1v1: bool,
    pub is_teams: bool,
    pub is_ffa: bool,
    pub is_chickens: bool,
    pub is_special: bool,
    pub is_assymetrical: bool,
    /// How many sides an FFA on this map is drawn for.
    pub ffa_max_teams: Option<u32>,
    pub hills: Option<u32>,
    pub water_level: Option<u32>,
    /* The two halves of the community rating, kept apart rather than divided
       here. A mean of nothing is not zero, and the count is worth showing next
       to the score - four votes and four hundred are not the same claim. */
    pub rating_sum: Option<u32>,
    pub rating_count: Option<u32>,
}

/// Read the `MapItems` out of a `GetPublicCommunityInfo` response.
pub fn parse_catalogue(xml: &str) -> Result<Vec<CatalogueMap>, String> {
    let mut out = Vec::new();
    let mut at = 0;
    while let Some(i) = xml[at..].find("<a:MapItem>") {
        let start = at + i;
        let Some(end) = xml[start..].find("</a:MapItem>") else { break };
        let item = &xml[start..start + end];
        let name = element_text(item, "Name").map(xml_unescape);
        let id = element_text(item, "ResourceID").and_then(|s| s.trim().parse().ok());
        let num = |tag: &str| element_text(item, tag).and_then(|v| v.trim().parse::<u32>().ok());
        /* Absent reads as false. The service sends every flag on every map, so
           a missing one means the shape changed - and guessing true about a
           map's suitability would put people on a map that does not suit. */
        let flag = |tag: &str| element_text(item, tag).map(|v| v.trim() == "true").unwrap_or(false);
        if let (Some(name), Some(resource_id)) = (name, id) {
            if !name.is_empty() && resource_id != 0 {
                out.push(CatalogueMap {
                    name,
                    resource_id,
                    width: num("Width"),
                    height: num("Height"),
                    support_level: element_text(item, "SupportLevel").map(xml_unescape),
                    is_1v1: flag("Is1v1"),
                    is_teams: flag("IsTeams"),
                    is_ffa: flag("IsFFA"),
                    is_chickens: flag("IsChickens"),
                    is_special: flag("IsSpecial"),
                    is_assymetrical: flag("IsAssymetrical"),
                    ffa_max_teams: num("FFAMaxTeams"),
                    hills: num("Hills"),
                    water_level: num("WaterLevel"),
                    rating_sum: num("RatingSum"),
                    rating_count: num("RatingCount"),
                });
            }
        }
        at = start + end;
    }
    Ok(out)
}

/// The site's map catalogue: every featured and supported map, with the
/// `ResourceID` that addresses its detail page.
///
/// One call answers for the whole catalogue, which is the point. `DownloadFile`
/// and `FindResourceData` answer for one name at a time, so a link that wants
/// to reach a map's own page cannot afford them - it would be a request per
/// minimap. This is fetched once and kept.
#[tauri::command]
pub async fn zks_map_catalogue() -> Result<Vec<CatalogueMap>, String> {
    /* A SOAP round trip and a parse of three hundred maps, on the thread that
       draws the window. Audit finding R5, and the same shape `zks_managed_state`
       was already fixed for. */
    tauri::async_runtime::spawn_blocking(map_catalogue_blocking)
        .await
        .map_err(|e| format!("reading the map catalogue did not finish: {e}"))?
}

fn map_catalogue_blocking() -> Result<Vec<CatalogueMap>, String> {
    let body = "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\"><s:Body><GetPublicCommunityInfo xmlns=\"http://tempuri.org/\"/></s:Body></s:Envelope>";
    let res = soap_client()?
        .post(ENDPOINT)
        .header("Content-Type", "text/xml; charset=utf-8")
        .header(
            "SOAPAction",
            "\"http://tempuri.org/IContentService/GetPublicCommunityInfo\"",
        )
        .body(body)
        .send()
        .map_err(|e| format!("could not reach the Zero-K content service: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("the content service answered {}", res.status()));
    }
    let text = res.text().map_err(|e| format!("unreadable response: {e}"))?;
    parse_catalogue(&text)
}

pub fn file_name_for(url: &str) -> Result<String, String> {
    let path = url
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(url)
        .split(['?', '#'])
        .next()
        .unwrap_or("");
    let name = path.rsplit('/').next().unwrap_or("");
    if name.is_empty() {
        return Err(format!("no file name in {url}"));
    }
    // A name is a name. Anything that could climb out of maps/ or games/, or
    // name a drive, is a bug or an attack and is not worth distinguishing.
    if name.contains("..") || name.contains('/') || name.contains('\\') || name.contains(':') {
        return Err(format!("refusing an unsafe file name: {name:?}"));
    }
    if !name.ends_with(".sd7") && !name.ends_with(".sdz") {
        return Err(format!("not a Spring archive: {name:?}"));
    }
    Ok(name.to_string())
}

// ----------------------------------------------------------------- http ----

/// A connection that is never going to be answered.
///
/// The body deliberately has no total bound - a 90 MB map on a slow line is not
/// a hung request, and [`STALL_TIMEOUT`] is what catches one that is - but
/// reaching the server should take milliseconds, and without this a black-holed
/// connect sat there for the OS's own timeout with the download UI showing
/// nothing at all.
const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);

/// How long a SOAP call may take, start to finish.
///
/// These are two-line requests answered from a database; anything approaching
/// this is a service that is not going to answer. Bounded start to finish,
/// where a file download can only be bounded per read, because there is nothing
/// large about them.
const SOAP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

/// How long a file download may go without a single byte arriving.
///
/// Not a cap on the transfer. The blocking client applies its timeout to each
/// read of the body as well as to the request, so this is a stall deadline: a
/// 90 MB map on a slow line keeps going for as long as something keeps
/// arriving. What it ends is the other case - a connection that was accepted
/// and then went quiet, which had no bound at all and could sit there for the
/// life of the process.
///
/// That mattered more here than the wait: this download runs on the supervisor
/// thread, holding the one download slot, so a connection that never spoke
/// again took every later download of the session with it.
const STALL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

/// What a stopped transfer says. The caller has a better sentence for the
/// player and replaces this; it exists so a cancel is not mistaken for a
/// failure on the way back up.
const CANCELLED: &str = "the download was cancelled";

fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent("shiro")
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(STALL_TIMEOUT)
        .build()
        .map_err(|e| format!("could not build an HTTP client: {e}"))
}

/// The same, for the small SOAP calls that resolve a name.
fn soap_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent("shiro")
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(SOAP_TIMEOUT)
        .build()
        .map_err(|e| format!("could not build an HTTP client: {e}"))
}

/// Ask the service where a name lives.
pub fn resolve(internal_name: &str) -> Result<Option<Resolved>, String> {
    let body = build_request(internal_name)?;
    let res = soap_client()?
        .post(ENDPOINT)
        .header("Content-Type", "text/xml; charset=utf-8")
        .header("SOAPAction", format!("\"{SOAP_ACTION}\""))
        .body(body)
        .send()
        .map_err(|e| format!("could not reach the Zero-K content service: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("the content service answered {}", res.status()));
    }
    let text = res.text().map_err(|e| format!("unreadable response: {e}"))?;
    parse_response(&text)
}

/// Download `url` to `dest`, resuming a previous attempt where possible.
///
/// Writes to `<dest>.part` and renames on success, so a half-finished archive
/// is never visible to the engine as an installed one.
///
/// `cancelled` is asked before the request and again on every block, because
/// there is nothing else to stop this: the caller runs it on the thread that
/// holds the download slot, with the downloader process already exited. The
/// `.part` is left where it is, which is the whole point of writing one - a
/// cancelled 90 MB map resumes rather than starting again.
pub fn fetch_to(
    url: &str,
    dest: &Path,
    expect_md5: Option<&str>,
    cancelled: impl Fn() -> bool,
    mut on_progress: impl FnMut(u64, u64),
) -> Result<(), String> {
    if cancelled() {
        return Err(CANCELLED.to_string());
    }
    if !host_allowed(url) {
        return Err(format!("refusing to download from {url}"));
    }
    let part = PathBuf::from(format!("{}.part", dest.display()));
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("could not create {}: {e}", parent.display()))?;
    }

    let http = client()?;
    let mut have = std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0);

    /* Resuming splices the tail of one response onto the head of another, with
       nothing tying the two together - no If-Range, no ETag, no validator of
       any kind. A checksum at the end is what makes that safe, so a resume is
       only attempted when the service named an md5. Without one the leftover is
       thrown away and the file fetched whole: re-downloading is cheap next to
       installing a splice nobody can check. */
    if have > 0 && expect_md5.is_none() {
        let _ = std::fs::remove_file(&part);
        have = 0;
    }

    let fetch = |from: u64| -> Result<reqwest::blocking::Response, String> {
        let mut req = http.get(url);
        if from > 0 {
            req = req.header("Range", format!("bytes={from}-"));
        }
        req.send().map_err(|e| format!("download failed: {e}"))
    };

    let mut res = fetch(have)?;

    /* 416 means the leftover is already as long as the resource - a completed
       or over-long `.part`. Asking again tomorrow gets the same answer, so the
       download was stuck for good; drop it and fetch the file whole. */
    if res.status().as_u16() == 416 {
        let _ = std::fs::remove_file(&part);
        have = 0;
        res = fetch(0)?;
    }

    // Resume only if the server actually agreed to; a 200 to a Range request
    // means it is sending the whole file and appending would corrupt it.
    let resuming = have > 0 && res.status().as_u16() == 206;
    if !res.status().is_success() {
        return Err(format!("download failed: HTTP {}", res.status()));
    }
    let total = res.content_length().unwrap_or(0) + if resuming { have } else { 0 };

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(!resuming)
        .open(&part)
        .map_err(|e| format!("could not open {}: {e}", part.display()))?;
    if resuming {
        file.seek(SeekFrom::End(0))
            .map_err(|e| format!("could not seek {}: {e}", part.display()))?;
    }

    let mut done = if resuming { have } else { 0 };
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        if cancelled() {
            return Err(CANCELLED.to_string());
        }
        let n = res.read(&mut buf).map_err(|e| format!("download interrupted: {e}"))?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n])
            .map_err(|e| format!("could not write {}: {e}", part.display()))?;
        done += n as u64;
        on_progress(done, total);
    }
    file.flush().map_err(|e| format!("could not flush {}: {e}", part.display()))?;
    drop(file);

    if let Some(want) = expect_md5 {
        let got = md5_of(&part)?;
        if !got.eq_ignore_ascii_case(want) {
            let _ = std::fs::remove_file(&part);
            return Err(format!(
                "the download did not match its checksum (wanted {want}, got {got}); discarded"
            ));
        }
    }

    /* Already there, and in use.
       Windows refuses to replace a file another process has open, and the
       obvious other process is the game: the map being fetched is often the one
       currently loaded. If the archive already sitting at the destination is
       the thing we were about to write, then failing here would report "could
       not download" about content that is installed and working.

       Two ways to be sure of that, in order of how sure they are:

       - the file there hashes to the checksum we just verified, so it *is* the
         content, whatever went wrong with the rename; or
       - the rename failed the way an in-use file fails, and something
         full-sized is there.

       Anything else - a full disk, a missing directory, a cross-device move -
       is a real error, and taking the fallback for it would silently prefer an
       unverified file already on disk over the verified one just downloaded. */
    if let Err(e) = std::fs::rename(&part, dest) {
        let already = std::fs::metadata(dest).map(|m| m.len()).unwrap_or(0);
        let is_the_same = expect_md5.is_some_and(|want| {
            md5_of(dest).is_ok_and(|got| got.eq_ignore_ascii_case(want))
        });
        if is_the_same || (already > 0 && looks_like_in_use(&e)) {
            let _ = std::fs::remove_file(&part);
            return Ok(());
        }
        return Err(format!("could not put {} in place: {e}", dest.display()));
    }
    Ok(())
}

/// Did this rename fail because something else has the file open?
///
/// Windows says so with ERROR_SHARING_VIOLATION (32) or ERROR_ACCESS_DENIED
/// (5). Rust has no stable `ErrorKind` for the first, so the raw codes are
/// checked as well as the kind - a wrong guess here would turn a real failure
/// into a silent success.
fn looks_like_in_use(e: &std::io::Error) -> bool {
    if matches!(e.kind(), std::io::ErrorKind::PermissionDenied) {
        return true;
    }
    matches!(e.raw_os_error(), Some(5) | Some(32) | Some(33))
}

fn md5_of(path: &Path) -> Result<String, String> {
    let mut file =
        std::fs::File::open(path).map_err(|e| format!("could not read {}: {e}", path.display()))?;
    let mut ctx = md5::Context::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf).map_err(|e| format!("could not read {}: {e}", path.display()))?;
        if n == 0 {
            break;
        }
        ctx.consume(&buf[..n]);
    }
    Ok(format!("{:x}", ctx.compute()))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Captured verbatim from the live service; see the module comment.
    const MAP: &str = include_str!("fixtures/downloadfile-map.xml");
    const MOD: &str = include_str!("fixtures/downloadfile-mod.xml");
    const NO_LINKS: &str = include_str!("fixtures/downloadfile-nolinks.xml");
    const UNKNOWN: &str = include_str!("fixtures/downloadfile-unknown.xml");
    const COMMUNITY: &str = include_str!("fixtures/communityinfo.xml");

    #[test]
    fn a_map_resolves_to_one_https_url() {
        let r = parse_response(MAP).unwrap().expect("a result");
        assert_eq!(r.kind, ResourceKind::Map);
        assert_eq!(r.urls, ["https://zero-k.info/content/maps/HideandSeek2.2.3.sd7"]);
        assert_eq!(r.md5.as_deref(), Some("96a198564a13de79926b29f824d45622"));
        assert!(r.dependencies.is_empty());
    }

    /// The service hands back `http://`. Downloading game content in the clear
    /// when the same path serves over TLS would be a choice, not a constraint.
    #[test]
    fn links_are_upgraded_to_https() {
        for fixture in [MAP, MOD] {
            for url in parse_response(fixture).unwrap().unwrap().urls {
                assert!(url.starts_with("https://"), "{url}");
            }
        }
    }

    /// `links` is not a list of URLs. A rapid entry is an instruction to use
    /// pr-downloader, and passing it to an HTTP client would be nonsense.
    #[test]
    fn rapid_entries_are_not_treated_as_urls() {
        let r = parse_response(MOD).unwrap().expect("a result");
        assert_eq!(r.kind, ResourceKind::Mod);
        assert_eq!(r.urls, ["https://zero-k.info/content/games/supreme3.42.sdz"]);
    }

    /// Absence has two shapes and they mean different things.
    #[test]
    fn an_unknown_name_is_none_but_a_served_elsewhere_one_is_not() {
        assert_eq!(parse_response(UNKNOWN).unwrap(), None);
        let red = parse_response(NO_LINKS).unwrap().expect("Red Comet exists");
        assert!(red.urls.is_empty(), "it just is not served from here");
        assert_eq!(red.md5.as_deref(), Some("2be4f8b3709359902c056fdb2e67af44"));
    }

    const SEARCH: &str = include_str!("fixtures/findresource-maps.xml");
    const SEARCH_NONE: &str = include_str!("fixtures/findresource-none.xml");

    #[test]
    fn a_search_returns_the_names_the_server_would_accept() {
        let hits = parse_search(SEARCH).unwrap();
        assert!(hits.len() >= 8, "got {}", hits.len());
        let names: Vec<&str> = hits.iter().map(|h| h.name.as_str()).collect();
        assert!(names.contains(&"Comet Catcher Redux v3.1"), "{names:?}");
        // The map name, not a file name - this is what goes in BattleHeader.Map.
        assert!(names.iter().all(|n| !n.ends_with(".sd7") && !n.ends_with(".sdz")));
    }

    /// The catalogue is unfiltered and huge, so the order is the feature.
    #[test]
    fn matchmaker_maps_come_first() {
        let hits = parse_search(SEARCH).unwrap();
        let first_other = hits.iter().position(|h| h.support != "MatchMaker");
        let last_mm = hits.iter().rposition(|h| h.support == "MatchMaker");
        if let (Some(f), Some(l)) = (first_other, last_mm) {
            assert!(l < f, "a MatchMaker map sorted below a non-MatchMaker one");
        }
    }

    #[test]
    fn a_search_with_no_hits_is_empty_rather_than_an_error() {
        assert_eq!(parse_search(SEARCH_NONE).unwrap(), Vec::new());
    }

    #[test]
    fn a_blank_search_never_reaches_the_wire() {
        // The blocking half, since the command itself is now a thin async
        // wrapper around it - and a test must not need a Tauri runtime.
        assert_eq!(find_maps_blocking("   ".into()).unwrap(), Vec::new());
    }

    #[test]
    fn search_words_are_escaped_like_any_other_name() {
        let r = search_request(&["a & b".into()], "Map").unwrap();
        assert!(r.contains("a &amp; b"), "{r}");
        assert!(search_request(&["bad
word".into()], "Map").is_err());
    }

    const MODES: &str = include_str!("fixtures/gamemodes.xml");

    /// The three shapes a mode comes in, all present in one live response.
    #[test]
    fn a_mode_may_set_a_game_a_map_or_only_options() {
        let modes = parse_game_modes(MODES).unwrap();
        assert_eq!(modes.len(), 7, "{:?}", modes.iter().map(|m| &m.short_name).collect::<Vec<_>>());
        let by = |n: &str| modes.iter().find(|m| m.short_name == n).cloned().expect(n);

        // The common case: a different game archive.
        let arena = by("zkarena");
        assert_eq!(arena.game.as_deref(), Some("Arena Mod v1.0.10"));
        assert_eq!(arena.map, None);
        assert_eq!(arena.options.get("terrarestoreonly").map(String::as_str), Some("1"));

        // Zero Wars is a MAP on stock Zero-K. Treating a mode as a game would
        // host a plain Zero-K room here.
        let zw = by("zeroWars");
        assert_eq!(zw.game, None);
        assert_eq!(zw.map.as_deref(), Some("ZeroWars v2.1.9"));

        // Tech-K is neither - it is one modoption.
        let techk = by("techk");
        assert_eq!(techk.game, None);
        assert_eq!(techk.map, None);
        assert_eq!(techk.options.get("techk").map(String::as_str), Some("1"));
    }

    /// Six of the seven spell it `shortName`; Stiofan's spells it `shortname`.
    #[test]
    fn the_short_name_survives_upstreams_inconsistent_casing() {
        let modes = parse_game_modes(MODES).unwrap();
        assert!(modes.iter().all(|m| !m.short_name.is_empty()));
        assert!(modes.iter().any(|m| m.display_name == "Stiofan's Balance Refumble"));
    }

    /// FileContent is JSON, not base64 - despite sitting beside a genuinely
    /// base64 field in the same service - and arrives with `&#xD;` at every
    /// line end, which serde_json will not accept as whitespace.
    #[test]
    fn numeric_entities_are_decoded_or_the_json_will_not_parse() {
        assert_eq!(xml_unescape("a&#xD;&#xA;b"), "a\r\nb");
        assert_eq!(xml_unescape("&#65;&#x42;"), "AB");
        // Nonsense is left alone rather than eaten.
        assert_eq!(xml_unescape("&#zz;"), "&#zz;");
        assert_eq!(xml_unescape("&#123"), "&#123");
        // The named path still works.
        assert_eq!(xml_unescape("&amp;lt;"), "&lt;");
    }

    #[test]
    fn a_fault_is_an_error_rather_than_an_absence() {
        let xml = "<s:Envelope><s:Body><s:Fault><faultstring>no</faultstring>\
                   </s:Fault></s:Body></s:Envelope>";
        assert!(parse_response(xml).is_err());
    }

    // --- the request -------------------------------------------------------

    #[test]
    fn the_name_is_escaped_on_the_way_out() {
        let r = build_request("Fish & <Chips> \"2\"").unwrap();
        assert!(r.contains("Fish &amp; &lt;Chips&gt; &quot;2&quot;"), "{r}");
        assert!(!r.contains("<Chips>"));
    }

    #[test]
    fn a_name_that_could_not_be_content_never_reaches_the_wire() {
        assert!(build_request("").is_err());
        assert!(build_request("   ").is_err());
        assert!(build_request("bad\nname").is_err());
    }

    #[test]
    fn round_trips_a_name_with_markup_in_it() {
        // The escaping has to survive our own parser, not just look right.
        let escaped = xml_escape("a & b < c");
        assert_eq!(xml_unescape(&escaped), "a & b < c");
        // An escaped ampersand must not re-form another entity.
        assert_eq!(xml_unescape(&xml_escape("&lt;")), "&lt;");
    }

    // --- hosts and names ---------------------------------------------------

    #[test]
    fn only_zero_k_hosts_are_accepted() {
        assert!(host_allowed("https://zero-k.info/content/maps/x.sd7"));
        assert!(host_allowed("http://files.zero-k.info/x.sd7"));
        assert!(!host_allowed("https://evil.example/x.sd7"));
        // The classic disguises.
        assert!(!host_allowed("https://zero-k.info.evil.example/x.sd7"));
        assert!(!host_allowed("https://evil.example/?zero-k.info"));
        assert!(!host_allowed("https://zero-k.info@evil.example/x.sd7"));
        assert!(!host_allowed("ftp://zero-k.info/x.sd7"));
    }

    #[test]
    fn a_file_name_cannot_climb_out_of_its_folder() {
        assert_eq!(
            file_name_for("https://zero-k.info/content/maps/HideandSeek2.2.3.sd7").unwrap(),
            "HideandSeek2.2.3.sd7"
        );
        assert_eq!(
            file_name_for("https://zero-k.info/content/games/supreme3.42.sdz?v=2").unwrap(),
            "supreme3.42.sdz"
        );
        assert!(file_name_for("https://zero-k.info/a/..%2Fx.sd7").is_err());
        assert!(file_name_for("https://zero-k.info/a/").is_err());
        assert!(file_name_for("https://zero-k.info/a/thing.exe").is_err());
    }

    /// The stop has to reach the transfer itself. By the time this runs the
    /// downloader process has exited, so there is nothing left for a cancel to
    /// kill - and this holds the one download slot while it works, which is
    /// minutes on a 90 MB archive. Refusing before the request also means a
    /// cancel that lands during the resolve does not start a download nobody
    /// wants.
    #[test]
    fn a_cancelled_download_never_reaches_the_network() {
        let dest = std::env::temp_dir().join("shiro-cancelled-before-the-request.sd7");
        let err = fetch_to(
            "https://zero-k.info/content/maps/HideandSeek2.2.3.sd7",
            &dest,
            None,
            || true,
            |_, _| panic!("progress from a download that never started"),
        )
        .unwrap_err();
        assert!(err.contains("cancelled"), "{err}");
        assert!(!dest.exists(), "nothing should have been written");
    }

    #[test]
    fn maps_and_mods_land_in_different_places() {
        assert_eq!(ResourceKind::Map.directory(), "maps");
        assert_eq!(ResourceKind::Mod.directory(), "games");
    }

    #[test]
    fn the_checksum_is_only_taken_when_it_looks_like_one() {
        assert_eq!(
            md5_from_torrent_name("Hide_and_Seek_2.2.3_96a198564a13de79926b29f824d45622.torrent")
                .as_deref(),
            Some("96a198564a13de79926b29f824d45622")
        );
        assert_eq!(md5_from_torrent_name("no-md5-here.torrent"), None);
        assert_eq!(md5_from_torrent_name("Map_deadbeef.torrent"), None);
        assert_eq!(md5_from_torrent_name("something.else"), None);
    }

    /// Against the live service. Ignored by default so the suite stays offline
    /// and deterministic:
    ///
    ///     cargo test zkcontent::tests::live -- --ignored --nocapture
    #[test]
    #[ignore = "hits zero-k.info"]
    fn live_resolves_what_pr_downloader_cannot() {
        let map = resolve("Hide and Seek 2.2.3").unwrap().expect("the service knows it");
        assert_eq!(map.kind, ResourceKind::Map);
        assert!(map.urls[0].starts_with("https://zero-k.info/"), "{:?}", map.urls);
        assert!(map.md5.is_some());
        println!("  map  -> {} (md5 {:?})", map.urls[0], map.md5);

        let m = resolve("Supreme-K 3.42").unwrap().expect("a custom mod too");
        assert_eq!(m.kind, ResourceKind::Mod);
        println!("  mod  -> {:?} deps {:?}", m.urls, m.dependencies);

        assert_eq!(resolve("This Map Does Not Exist 9.9.9").unwrap(), None);
        println!("  unknown -> None, as expected");
    }

    /// The torrent element is 7 kB of base64 sitting between the fields we
    /// want. A scan that is not anchored on element names wanders into it.
    #[test]
    fn the_base64_torrent_does_not_confuse_the_scan() {
        assert!(MAP.len() > 8000, "fixture should still carry the blob");
        let r = parse_response(MAP).unwrap().unwrap();
        assert_eq!(r.urls.len(), 1);
        assert!(!r.urls[0].contains("torrent"));
    }

    #[test]
    fn the_catalogue_is_names_with_the_ids_that_address_them() {
        let maps = parse_catalogue(COMMUNITY).unwrap();
        assert!(!maps.is_empty());
        assert_eq!(maps[0].name, "Aberdeen3v3v3");
        assert_eq!(maps[0].resource_id, 7116);
        assert!(maps.iter().all(|m| m.resource_id != 0 && !m.name.is_empty()));
    }

    #[test]
    fn a_map_carries_what_the_service_knows_about_it() {
        /* Sixteen fields arrive and two were being read. Everything below was
           in this fixture the whole time, which is why the assertions could be
           written before the parser was. */
        let maps = parse_catalogue(COMMUNITY).unwrap();
        let m = &maps[0];
        assert_eq!((m.width, m.height), (Some(16), Some(16)));
        assert_eq!(m.support_level.as_deref(), Some("Featured"));
        assert_eq!((m.rating_sum, m.rating_count), (Some(12), Some(4)));
        assert_eq!(m.ffa_max_teams, Some(3));
        assert!(m.is_ffa, "Aberdeen3v3v3 is an FFA map");
        assert!(!m.is_1v1 && !m.is_teams && !m.is_chickens);
        assert_eq!((m.hills, m.water_level), (Some(3), Some(1)));
    }

    /* The gap every other test in this file steps over. Parsing is only half the
       journey: a field can be read correctly out of the XML, held correctly in
       the struct, asserted on correctly here - and still never reach the screen,
       because the name it is serialised under is not the name the client reads.

       That is not hypothetical. `CatalogueMap` shipped without
       `rename_all = "camelCase"`, so `is_1v1`, `rating_sum`, `support_level` and
       nine others went out in snake_case to a client asking for camelCase, and
       every one of them arrived as `undefined`. The parse tests above were green
       throughout. `width` and `height` are single words and survived, which is
       exactly why the symptom looked like several unrelated faults rather than
       one - size worked and nothing else did.

       So these two assert the wire, not the struct: the whole key set, spelled
       out, against what src/net/zkcatalogue.ts declares. Adding a field to
       either side without the other fails here. */
    #[test]
    fn the_catalogue_reaches_the_client_under_the_names_it_reads() {
        let maps = parse_catalogue(COMMUNITY).unwrap();
        let json = serde_json::to_value(&maps[0]).unwrap();
        let obj = json.as_object().expect("a map serialises as an object");

        let mut got: Vec<&str> = obj.keys().map(String::as_str).collect();
        got.sort_unstable();
        // Verbatim from the CatalogueMap interface in src/net/zkcatalogue.ts.
        let mut want = [
            "name", "resourceId", "width", "height", "supportLevel", "is1v1", "isTeams", "isFfa",
            "isChickens", "isSpecial", "isAssymetrical", "ffaMaxTeams", "hills", "waterLevel",
            "ratingSum", "ratingCount",
        ];
        want.sort_unstable();
        assert_eq!(got, want, "the client reads these names and no others");

        /* And that the values went out under them rather than merely appearing
           somewhere - a rename that moved a key would still pass a key check. */
        assert_eq!(obj["resourceId"], 7116);
        assert_eq!(obj["isFfa"], true);
        assert_eq!(obj["ffaMaxTeams"], 3);
        assert_eq!(obj["ratingSum"], 12);
        assert_eq!(obj["supportLevel"], "Featured");
    }

    #[test]
    fn a_search_hit_reaches_the_client_under_the_names_it_reads() {
        let hits = parse_search(SEARCH).unwrap();
        let json = serde_json::to_value(&hits[0]).unwrap();
        let obj = json.as_object().expect("a hit serialises as an object");

        let mut got: Vec<&str> = obj.keys().map(String::as_str).collect();
        got.sort_unstable();
        // Verbatim from the MapHit interface in src/net/zkcatalogue.ts.
        let mut want = ["name", "support", "resourceId", "is1v1", "isTeams", "isFfa", "isSpecial"];
        want.sort_unstable();
        assert_eq!(got, want);
        assert_eq!(obj["resourceId"], 55646);
        assert_eq!(obj["isTeams"], true);
    }

    /// Searching is how the 30,000-odd maps outside the public catalogue are
    /// reached, and a hit that carries its id can link to its own page instead
    /// of to a search - the same fix the catalogue got, for the other half of
    /// the library.
    #[test]
    fn a_search_hit_carries_the_id_that_addresses_its_page() {
        let hits = parse_search(SEARCH).unwrap();
        let comet = hits
            .iter()
            .find(|h| h.name == "Comet Catcher Redux v3.1")
            .expect("the fixture has it");
        assert_eq!(comet.resource_id, Some(55646));
        assert_eq!(comet.is_teams, Some(true));
        assert_eq!(comet.is_1v1, Some(false));
        /* Not width, not height, not a rating. FindResourceData does not send
           them, and a screen showing a search hit must look thinner than one
           showing a catalogue entry rather than invent the difference. */
    }

    #[test]
    fn a_hit_the_service_says_nothing_about_is_unknown_rather_than_false() {
        let xml = "<a:ResourceData><a:InternalName>Bare</a:InternalName>\
                   <a:MapIs1v1 i:nil=\"true\"/></a:ResourceData>";
        let hits = parse_search(xml).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].resource_id, None);
        assert_eq!(hits[0].is_1v1, None, "nil is not told, and told is not false");
        assert_eq!(hits[0].is_teams, None);
    }

    #[test]
    fn a_map_missing_its_extras_still_parses() {
        /* The name and the id are what a map needs to exist; the rest is what
           the site happens to know. A shape change upstream must cost the
           detail, not the catalogue. */
        let xml = "<a:MapItem><a:Name>Bare</a:Name><a:ResourceID>1</a:ResourceID></a:MapItem>";
        let maps = parse_catalogue(xml).unwrap();
        assert_eq!(maps.len(), 1);
        assert_eq!(maps[0].width, None);
        assert_eq!(maps[0].rating_count, None);
        assert!(!maps[0].is_teams, "an absent flag is not a suitable map");
    }

    #[test]
    fn a_response_without_maps_is_empty_rather_than_an_error() {
        assert!(parse_catalogue("<s:Envelope/>").unwrap().is_empty());
    }

    #[test]
    fn only_an_in_use_failure_is_treated_as_one() {
        use std::io::{Error, ErrorKind};
        // What Windows says when the game has the map open.
        assert!(looks_like_in_use(&Error::from_raw_os_error(32)));
        assert!(looks_like_in_use(&Error::from_raw_os_error(5)));
        assert!(looks_like_in_use(&Error::new(ErrorKind::PermissionDenied, "denied")));
        // A full disk or a missing directory is a real failure, and accepting
        // it would keep an unverified file already on disk in preference to the
        // verified one just downloaded.
        assert!(!looks_like_in_use(&Error::new(ErrorKind::NotFound, "gone")));
        assert!(!looks_like_in_use(&Error::new(ErrorKind::Other, "no space left on device")));
    }

    #[test]
    fn an_empty_string_element_does_not_spin_forever() {
        /* `<string></string>` has empty text; a loop that advanced by searching
           for the text it had just read found it at offset zero and read the
           same element again, for ever, growing a Vec as it went. Reachable
           from a response on a plaintext channel, so it is a hang somebody else
           can cause. */
        let xml = "<links><string></string><string>a</string><string></string></links>";
        assert_eq!(string_array(xml, "links"), vec!["", "a", ""]);
    }

    #[test]
    fn a_namespaced_string_array_still_reads() {
        let xml = "<a:words><a:string>one</a:string><a:string>two</a:string></a:words>";
        assert_eq!(string_array(xml, "words"), vec!["one", "two"]);
    }

    #[test]
    fn an_unterminated_string_element_ends_the_walk() {
        let xml = "<links><string>one</string><string>never closed</links>";
        assert_eq!(string_array(xml, "links"), vec!["one"]);
    }

    #[test]
    fn a_container_that_is_not_there_is_empty_rather_than_an_error() {
        assert!(string_array("<other/>", "links").is_empty());
    }
}
