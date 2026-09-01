//! Searching zero-k.info's battle archive.
//!
//! The demos folder holds the games played on this machine. The site holds
//! every game anybody has played since 2011, and that is the archive the replay
//! screen searches. This is the client for it.
//!
//! ## What this is, and what it is not
//!
//! There is no search API. `ContentService.svc` has fourteen operations and
//! none of them lists battles - `GetSpringBattleInfo` takes a single `gameid`
//! and answers with four fields. So the search is the website's own search
//! page, driven the way a browser drives it.
//!
//! That is a real interface rather than blind scraping: `/Battles` carries a
//! form with named fields, and posting them filters the results. But it is
//! still HTML, with no contract and no version, so everything here is written
//! to **degrade rather than break**. A row that does not parse is skipped, a
//! field that is missing is `None`, and the screen says how many rows came back
//! rather than pretending the archive is empty.
//!
//! ## Being a good guest
//!
//! - `robots.txt` disallows five paths and `/Battles` is not one of them.
//! - The page is public: no login, no session, no credential ever handled here.
//! - One request per page of forty, and one per replay opened. The list is
//!   never enriched row by row, which would be forty requests per scroll.
//! - The user agent says who this is, so their logs can tell.
//!
//! ## The division of labour that makes this cheap
//!
//! The list page carries **no player names, no ratings and no winner** - it has
//! the map, the counts, the date and the length, and that is all. Those are on
//! the detail page, one request each.
//!
//! So they are not read from HTML at all. Every battle links its actual
//! `.sdfz`, and `replays.rs` already reads one completely - players, teams, Elo,
//! factions, the winner and the statistics. Opening a battle downloads the
//! replay and parses it, which is the same code path a local replay takes and
//! depends on no markup whatsoever. The HTML is only ever the index.

use serde::Serialize;

/// The site's own battle list, which is also its search form.
const BATTLES: &str = "https://zero-k.info/Battles";

/// What the page returns per request. Not configurable upstream.
pub const PAGE: usize = 40;

const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
const TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

/// Says who is calling, because a third-party client hammering a volunteer's
/// server anonymously is how third-party clients get blocked.
const AGENT: &str = "shiro-lobby (zero-k third-party client)";

fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent(AGENT)
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(TIMEOUT)
        .build()
        .map_err(|e| format!("could not build an HTTP client: {e}"))
}

// ------------------------------------------------------------------ filters ---

/// The filters the site's form actually offers.
///
/// Deliberately mirrors the form rather than what the screen might want: a
/// filter invented here would have to be applied after the fact, over one page
/// of forty, which silently gives the wrong answer for the other thousand.
/// What the server cannot filter, the screen must not pretend to.
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BattleQuery {
    /// Matches the battle's title.
    pub title: Option<String>,
    /// Matches the map name as a substring - `Isis` finds `Fields_Of_Isis`.
    pub map: Option<String>,
    pub players_from: Option<u32>,
    pub players_to: Option<u32>,
    /// 0 any, 1 today, 2 this week, 3 this month. The form offers no arbitrary
    /// range, so neither does this.
    pub age: Option<u8>,
    /// Minutes.
    pub min_length: Option<u32>,
    pub max_length: Option<u32>,
    /// 0 any, 1 yes, 2 no.
    pub bots: Option<u8>,
    pub mission: Option<u8>,
    pub matchmaker: Option<u8>,
    /// Whether the battle ended in a victory. 0 any, 1 yes, 2 no.
    pub victory: Option<u8>,
    /// 0 any, 1 none, 2 casual, 3 competitive, 4 planetwars. This is the kind
    /// of game, not a rating bracket.
    pub rating: Option<u8>,
    /// Site account ids, which come from `/Autocomplete/UsersNoLink`.
    ///
    /// **Several are ANDed**, not ORed: two ids return the battles both of them
    /// played in, which is what makes "games against this person" answerable
    /// without downloading anything. Verified against the live site.
    ///
    /// The form's own player box submits nothing - its `name` is empty and its
    /// script writes the fields - so `UserId` is the wire name found by trying
    /// them, not one read off the page.
    pub players: Option<Vec<String>>,
    /// How far into the results, in rows.
    pub offset: Option<usize>,
}

impl BattleQuery {
    fn form(&self) -> Vec<(String, String)> {
        let mut f: Vec<(String, String)> = Vec::new();
        let mut put = |k: &str, v: String| f.push((k.to_string(), v));
        put("Title", self.title.clone().unwrap_or_default());
        put("Map", self.map.clone().unwrap_or_default());
        put("PlayersFrom", self.players_from.map(|v| v.to_string()).unwrap_or_default());
        put("PlayersTo", self.players_to.map(|v| v.to_string()).unwrap_or_default());
        put("MinLength", self.min_length.map(|v| v.to_string()).unwrap_or_default());
        put("MaxLength", self.max_length.map(|v| v.to_string()).unwrap_or_default());
        put("Age", self.age.unwrap_or(0).to_string());
        put("Mission", self.mission.unwrap_or(0).to_string());
        put("Bots", self.bots.unwrap_or(0).to_string());
        put("Victory", self.victory.unwrap_or(0).to_string());
        put("Matchmaker", self.matchmaker.unwrap_or(0).to_string());
        put("Rating", self.rating.unwrap_or(0).to_string());
        // 8 is the form's own "any", not a rank.
        put("Rank", "8".to_string());
        if let Some(offset) = self.offset.filter(|o| *o > 0) {
            put("Offset", offset.to_string());
        }
        for id in self.players.iter().flatten() {
            f.push(("UserId".to_string(), id.clone()));
        }
        f
    }
}

// --------------------------------------------------------------------- rows ---

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveBattle {
    /// The site's battle id. Also the match page, at `/Battles/Detail/<id>`.
    pub id: u64,
    pub title: Option<String>,
    pub map: Option<String>,
    /// The game and its version, as the site writes it.
    pub game: Option<String>,
    /// Absolute URL of the map thumbnail the site already serves.
    pub thumbnail: Option<String>,
    pub players: Option<u32>,
    pub spectators: Option<u32>,
    /// Seconds, from the site's own "21 minutes" / "0 seconds" wording.
    pub duration: Option<i32>,
    /// As printed, because the site prints a US-format local time and
    /// re-interpreting it here would move games across days.
    pub played: Option<String>,
    /// How many teams played, when the row states a count.
    ///
    /// With `players` and `bots` that is enough to say 1v1, Teams, FFA or
    /// Cooperative without opening the battle - which is as far as the row
    /// goes, since it never names anybody.
    pub teams: Option<u32>,
    /// The shape the site names itself, where it does.
    ///
    /// A matchmaker battle writes `Teams: 1v1` rather than a number, so the
    /// same field carries a count for one row and a word for the next. The word
    /// is better than anything derived from counts, so it is kept as it is
    /// rather than turned back into one.
    pub shape: Option<String>,
    pub bots: bool,
}

/// The text of an HTML fragment, entities resolved, tags gone.
fn text_of(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    for c in html.chars() {
        match c {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                out.push(' ');
            }
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    let out = out
        .replace("&#39;", "'")
        .replace("&quot;", "\"")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ");
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The labels the row uses, which are also what ends the value before them.
const LABELS: &[&str] = &["Teams:", "Players:", "Spectators:", "Date:", "Duration:"];

/// `Players: 12` and friends, out of the row's flattened text.
///
/// A value ends where the next label begins, not at a run of whitespace:
/// flattening the HTML collapses every run to one space, so a whitespace
/// terminator swallowed the rest of the row. That produced a `Date` carrying
/// the duration after it, which reads fine in a debug dump and is wrong on
/// screen.
fn labelled<'a>(text: &'a str, label: &str) -> Option<&'a str> {
    let at = text.find(label)? + label.len();
    let rest = text[at..].trim_start();
    let end = LABELS
        .iter()
        .filter_map(|l| rest.find(l))
        .min()
        .unwrap_or(rest.len());
    Some(rest[..end].trim())
}

/// The site writes "0 seconds", "21 minutes", "1 hour 4 minutes".
fn seconds(text: &str) -> Option<i32> {
    let mut total = 0i32;
    let mut any = false;
    let words: Vec<&str> = text.split_whitespace().collect();
    for pair in words.windows(2) {
        let Ok(n) = pair[0].parse::<i32>() else { continue };
        let unit = pair[1].trim_end_matches(',').to_ascii_lowercase();
        let mult = if unit.starts_with("second") {
            1
        } else if unit.starts_with("minute") {
            60
        } else if unit.starts_with("hour") {
            3600
        } else {
            continue;
        };
        total += n * mult;
        any = true;
    }
    any.then_some(total)
}

/// The map and the game, out of the line the site writes between the shape and
/// the counts.
///
/// The row reads `Teams: 2 + Bots  Violet Rampart 1.4 (Future Wars v0.42.0)`,
/// and the two are only separated by a line break that is gone by the time this
/// sees it. So the segment is bounded by the labels either side, and the count
/// and the bots marker are stepped over - anchoring on whitespace does not
/// work, because flattening the HTML collapses it.
fn map_and_game(text: &str) -> (Option<String>, Option<String>) {
    let after = match text.find("Teams:") {
        Some(at) => &text[at + "Teams:".len()..],
        None => text,
    };
    let seg = match after.find("Players:") {
        Some(at) => &after[..at],
        None => after,
    };
    let open = match seg.find(" (") {
        Some(at) if seg[at..].contains(')') => at,
        _ => return (None, None),
    };
    let close = seg[open + 2..].find(')').map(|i| i + open + 2);
    let game = close.map(|c| seg[open + 2..c].trim().to_string());

    let mut head = seg[..open].trim();
    // The team count, then the bots marker, both optional in principle.
    if let Some(rest) = head.split_once(char::is_whitespace) {
        if rest.0.chars().all(|c| c.is_ascii_digit()) {
            head = rest.1.trim();
        }
    }
    if let Some(rest) = head.strip_prefix("+ Bots") {
        head = rest.trim();
    }
    /* A matchmaker battle prints its queue in front of the map - `1v1 Agalta
       v1.0`, `4v4 Fields_Of_Isis` - and the same map appears with and without
       it. The thumbnail names the map alone, which is how this was spotted. */
    if let Some((first, rest)) = head.split_once(' ') {
        let queue = first.split_once('v').is_some_and(|(a, b)| {
            !a.is_empty()
                && !b.is_empty()
                && a.chars().all(|c| c.is_ascii_digit())
                && b.chars().all(|c| c.is_ascii_digit())
        });
        if queue {
            head = rest.trim();
        }
    }
    (Some(head.to_string()).filter(|m| !m.is_empty()), game)
}

/// One row, from the block the site draws it in.
///
/// Everything is optional on purpose. This is somebody else's markup, and a
/// changed label should cost one field rather than the row.
fn parse_row(block: &str) -> Option<ArchiveBattle> {
    let id: u64 = {
        let at = block.find("/Battles/Detail/")? + "/Battles/Detail/".len();
        let rest = &block[at..];
        let end = rest.find(|c: char| !c.is_ascii_digit()).unwrap_or(rest.len());
        rest[..end].parse().ok()?
    };

    let text = text_of(block);
    let thumbnail = block
        .split("src='")
        .nth(1)
        .and_then(|r| r.split('\'').next())
        .filter(|s| s.contains("thumbnail"))
        .map(|s| format!("https://zero-k.info{s}"));

    let (map, gm) = map_and_game(&text);

    let num = |label: &str| labelled(&text, label).and_then(|v| v.split_whitespace().next()?.parse().ok());

    /* `Teams: 2` on an ordinary battle, `Teams: 1v1` on a matchmaker one. A
       word there is the site telling us the shape outright, which beats
       anything worked out from counts. */
    let shape_word = labelled(&text, "Teams:")
        .and_then(|v| v.split_whitespace().next())
        .filter(|w| w.chars().any(|c| c.is_ascii_alphabetic()))
        .map(|w| w.trim_end_matches(',').to_string());

    Some(ArchiveBattle {
        id,
        /* From the `<b>` the site wraps it in, not from "everything before the
           first label" - a block can begin mid-attribute, and that put markup
           into the title. */
        title: block
            .split_once("<b>")
            .and_then(|(_, r)| r.split_once("</b>"))
            .map(|(t, _)| text_of(t))
            .filter(|t| !t.is_empty()),
        map,
        game: gm,
        thumbnail,
        players: num("Players:"),
        spectators: num("Spectators:"),
        duration: labelled(&text, "Duration:").and_then(seconds),
        played: labelled(&text, "Date:").map(|s| s.to_string()),
        /* A count, and nothing when the row named a shape instead: `1v1` does
           not parse as a number, which is the right answer here. */
        teams: labelled(&text, "Teams:")
            .and_then(|v| v.split_whitespace().next()?.parse().ok()),
        shape: shape_word,
        bots: text.contains("+ Bots"),
    })
}

/// Every row on a results page.
///
/// Sliced between the links rather than around the `mission` blocks. Each row
/// opens with `<a href='/Battles/Detail/N'>` and the block follows it, so the
/// link that belongs to a row is the one it starts with.
///
/// Bounding a block at the *next* row's block marker instead put that row's
/// opening link inside this row's slice, and every row took the following
/// battle's id - the map, the length and the players of one game filed under
/// the id of the next. Nothing about that looks wrong in a list; it was found
/// by downloading a replay and getting a different game back.
pub fn parse_page(html: &str) -> Vec<ArchiveBattle> {
    const LINK: &str = "/Battles/Detail/";
    let mut starts = Vec::new();
    let mut from = 0usize;
    while let Some(rel) = html[from..].find(LINK) {
        let at = from + rel;
        starts.push(at);
        from = at + LINK.len();
    }

    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for (i, &at) in starts.iter().enumerate() {
        let end = starts.get(i + 1).copied().unwrap_or(html.len());
        if let Some(row) = parse_row(&html[at..end]) {
            /* The same battle appears more than once per row - the thumbnail
               and the title are both links to it - and the first slice is the
               one that carries the content. */
            if seen.insert(row.id) {
                out.push(row);
            }
        }
    }
    out
}

// --------------------------------------------------------------------- fetch ---

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ArchivePage {
    pub battles: Vec<ArchiveBattle>,
    /// Where this page started, so the caller can ask for the next.
    pub offset: usize,
    /// Whether asking for more is worth it. The site gives no total, so this is
    /// "the page was full" rather than a count.
    pub more: bool,
    /// Why the page is empty, in words. Absent when the fetch succeeded.
    pub note: Option<String>,
}

pub fn search(query: &BattleQuery) -> ArchivePage {
    let offset = query.offset.unwrap_or(0);
    let client = match client() {
        Ok(c) => c,
        Err(e) => return ArchivePage { offset, note: Some(e), ..Default::default() },
    };
    let response = client
        .post(BATTLES)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(encode_form(&query.form()))
        .send();
    let html = match response.and_then(|r| r.error_for_status()).and_then(|r| r.text()) {
        Ok(h) => h,
        Err(e) => {
            return ArchivePage {
                offset,
                /* The screen has an offline state for exactly this, and it says
                   what still works. Nothing here should read like a crash. */
                note: Some(format!("zero-k.info could not be reached: {e}")),
                ..Default::default()
            }
        }
    };
    let battles = parse_page(&html);
    ArchivePage { more: battles.len() >= PAGE, offset, battles, note: None }
}

/// Form-encode the pairs.
///
/// Written out rather than pulling in reqwest's `form()`, which is behind a
/// feature this build does not enable, and rather than adding a dependency for
/// twenty lines. Everything not unreserved is percent-encoded, and a space is
/// `+`, which is what a form post means by one.
fn encode_form(pairs: &[(String, String)]) -> String {
    let mut out = String::new();
    for (k, v) in pairs {
        if !out.is_empty() {
            out.push('&');
        }
        percent(&mut out, k);
        out.push('=');
        percent(&mut out, v);
    }
    out
}

fn percent(out: &mut String, text: &str) {
    for b in text.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
}

// -------------------------------------------------------------- autocomplete ---

/// The site's own name lookup, which is how a player name becomes a filter.
const USERS: &str = "https://zero-k.info/Autocomplete/UsersNoLink";

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlayerMatch {
    /// The account id, which is what `UserId` on the search form wants.
    pub id: String,
    pub name: String,
}

/// Names that start with what was typed, as the site resolves them.
///
/// The battle search filters by account id, not by name - two people may have
/// had the same name over the years, and the archive goes back to 2011. So a
/// typed name is resolved first and the id is what gets filtered on.
///
/// The response labels are HTML - flags, rank icons, a clan badge - and none of
/// that is used. Only `id` and `value` are read.
pub fn lookup_players(term: &str) -> Vec<PlayerMatch> {
    if term.trim().is_empty() {
        return Vec::new();
    }
    let Ok(client) = client() else { return Vec::new() };
    let url = format!("{USERS}?term={}", {
        let mut e = String::new();
        percent(&mut e, term);
        e
    });
    let Ok(body) = client.get(&url).send().and_then(|r| r.error_for_status()).and_then(|r| r.text())
    else {
        return Vec::new();
    };
    parse_players(&body)
}

fn parse_players(body: &str) -> Vec<PlayerMatch> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(body) else { return Vec::new() };
    let Some(list) = value.as_array() else { return Vec::new() };
    list.iter()
        .filter_map(|item| {
            let name = item.get("value")?.as_str()?.to_string();
            /* The id arrives as a number, and it goes back as a form field, so
               it is carried as text rather than round-tripped through a type
               that would have to guess at its width. */
            let id = match item.get("id")? {
                serde_json::Value::Number(n) => n.to_string(),
                serde_json::Value::String(s) => s.clone(),
                _ => return None,
            };
            Some(PlayerMatch { id, name })
        })
        .collect()
}

// ----------------------------------------------------------------- download ---

/// A battle's own page, which is the only place the replay's filename appears.
fn detail_url(id: u64) -> String {
    format!("https://zero-k.info/Battles/Detail/{id}")
}

/// The replay link on a battle's page.
///
/// The list page does not carry it, so this is one request - and it is the only
/// thing read out of the detail page. Everything else the screen shows comes
/// from the replay file once it is here, which is why a change to that page
/// costs a download and not a wrong roster.
pub fn replay_link(html: &str) -> Option<String> {
    /* Every occurrence, not the first. The "Watch Replay Now" control puts the
       path in a comma-separated attribute -
       `/replays/x.sdfz,Zero-K v1.14.8.0,map,engine` - so cutting at the quote
       alone returns the whole blob and finds no replay on a page that has one.
       A filename may contain spaces, so a comma is a terminator and a space is
       not. */
    let mut from = 0usize;
    while let Some(rel) = html[from..].find("/replays/") {
        let at = from + rel;
        let rest = &html[at..];
        let end = rest.find(['\'', '"', ',']).unwrap_or(rest.len());
        let path = &rest[..end];
        let lower = path.to_ascii_lowercase();
        if lower.ends_with(".sdfz") || lower.ends_with(".sdf") {
            return Some(format!("https://zero-k.info{path}"));
        }
        from = at + "/replays/".len();
    }
    None
}

/// The filename a link ends in, decoded, with nothing that could climb a path.
///
/// The name comes off somebody else's page and becomes a file on disk, so it is
/// taken apart rather than trusted: only the last segment, percent-decoded, and
/// refused outright if what comes back still looks like a path. Refused rather
/// than sanitised - a sanitised name is still a name somebody else chose.
pub fn safe_filename(url: &str) -> Option<String> {
    let last = url.rsplit('/').next()?;
    let decoded = percent_decode(last);
    if decoded.is_empty()
        || decoded.contains('/')
        || decoded.contains('\\')
        || decoded.contains("..")
        || decoded.starts_with('.')
    {
        return None;
    }
    let lower = decoded.to_ascii_lowercase();
    if !lower.ends_with(".sdfz") && !lower.ends_with(".sdf") {
        return None;
    }
    Some(decoded)
}

fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
            if let Some(v) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(if bytes[i] == b'+' { b' ' } else { bytes[i] });
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

/// A replay this large is not a replay. The biggest real ones are a few tens of
/// megabytes; this only stops a redirect to something else entirely.
const MAX_REPLAY: u64 = 512 * 1024 * 1024;

/// Fetch a battle's replay into the demos folder and return where it landed.
///
/// It goes to the demos folder rather than a cache of its own, and that is the
/// point: once it is there it *is* a replay on this machine, so it appears in
/// the local list, plays with the same button, and there is no second place for
/// the screen to know about.
///
/// Already downloaded is the common case on a second look, and it is not a
/// download at all - the file is simply found.
pub fn download_replay(id: u64, install_root: Option<&str>) -> Result<std::path::PathBuf, String> {
    /* The install has to be named rather than guessed: the one Shiro made
       itself is only a candidate when the caller supplies it, so a command
       that passes None cannot find a managed install at all. */
    let install = crate::install::detect_with(install_root)?;
    let dir = crate::replays::demo_dir(&install.root);
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not open the demos folder: {e}"))?;

    let client = client()?;
    let page = client
        .get(detail_url(id))
        .send()
        .and_then(|r| r.error_for_status())
        .and_then(|r| r.text())
        .map_err(|e| format!("could not reach the battle page: {e}"))?;
    let link =
        replay_link(&page).ok_or_else(|| format!("Battle {id} has no replay to download."))?;
    let name = safe_filename(&link).ok_or("that replay has a name this will not write")?;

    let file = dir.join(&name);
    if file.is_file() {
        return Ok(file);
    }

    let mut response = client
        .get(&link)
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("could not download the replay: {e}"))?;
    if response.content_length().is_some_and(|n| n > MAX_REPLAY) {
        return Err("that download is too large to be a replay".into());
    }

    /* Written beside the target and renamed, so an interrupted download never
       leaves a half file that later looks like a replay already here. */
    let part = dir.join(format!("{name}.part"));
    let mut sink = std::fs::File::create(&part)
        .map_err(|e| format!("could not write to the demos folder: {e}"))?;
    let copied = std::io::copy(&mut response, &mut sink)
        .map_err(|e| format!("the download stopped: {e}"))?;
    drop(sink);
    if copied == 0 {
        let _ = std::fs::remove_file(&part);
        return Err("the download was empty".into());
    }
    std::fs::rename(&part, &file).map_err(|e| format!("could not save the replay: {e}"))?;
    Ok(file)
}

// ------------------------------------------------------------------ commands ---

#[tauri::command]
pub async fn zks_search_battles(query: BattleQuery) -> ArchivePage {
    match tauri::async_runtime::spawn_blocking(move || search(&query)).await {
        Ok(page) => page,
        Err(e) => ArchivePage { note: Some(format!("The search did not finish: {e}")), ..Default::default() },
    }
}

#[tauri::command]
pub async fn zks_lookup_players(term: String) -> Vec<PlayerMatch> {
    tauri::async_runtime::spawn_blocking(move || lookup_players(&term))
        .await
        .unwrap_or_default()
}

/// Download a battle's replay and read it, so a row that knew only what the
/// list printed becomes one that knows everything.
#[tauri::command]
pub async fn zks_download_replay(
    id: u64,
    install_root: Option<String>,
) -> Result<crate::replays::Replay, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = download_replay(id, install_root.as_deref())?;
        crate::replays::read(&path)
            .ok_or_else(|| "the downloaded file is not a replay this can read".to_string())
    })
    .await
    .map_err(|e| format!("the download did not finish: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A row as the site writes one, trimmed to what the parser reads.
    const ROW: &str = "<a href='/Battles/Detail/2498170'>\
        <div class='mission fleft' style='width:400px'>\
        <b>Tommyknocker&#39;s Battle</b><br />Teams: 1 + Bots       <br />\
        Jurassic Sands v1.00 (Zero-K v1.14.8.0)<br />\
        <table><tr><td><span><img src='/Resources/Jurassic_Sands_v1.00.thumbnail.jpg'/></span></td>\
        <td><table><tr><td>Players:</td><td>1</td></tr>\
        <tr><td>Spectators:</td><td>0</td></tr>\
        <tr><td>Date:</td><td>9/1/2026 3:58:20 AM (31 minutes ago)</td></tr>\
        <tr><td>Duration:</td><td>21 minutes</td></tr></table></td></tr></table></div>";

    #[test]
    fn a_row_gives_up_its_fields() {
        let r = parse_row(ROW).expect("a row");
        assert_eq!(r.id, 2498170);
        assert_eq!(r.map.as_deref(), Some("Jurassic Sands v1.00"));
        assert_eq!(r.game.as_deref(), Some("Zero-K v1.14.8.0"));
        assert_eq!(r.players, Some(1));
        assert_eq!(r.spectators, Some(0));
        assert_eq!(r.duration, Some(21 * 60));
        assert_eq!(r.teams, Some(1));
        assert_eq!(r.shape, None, "a count is not a shape");
        assert!(r.bots);
        assert_eq!(
            r.thumbnail.as_deref(),
            Some("https://zero-k.info/Resources/Jurassic_Sands_v1.00.thumbnail.jpg")
        );
    }

    #[test]
    fn the_map_is_separated_from_the_game_and_the_shape() {
        /* All three sit on one line once the markup is gone, with nothing but a
           vanished line break between them. */
        let (m, g) = map_and_game("X Teams: 2 + Bots Violet Rampart 1.4 (Future Wars v0.42.0) Players: 2");
        assert_eq!(m.as_deref(), Some("Violet Rampart 1.4"));
        assert_eq!(g.as_deref(), Some("Future Wars v0.42.0"));
        // Without bots the count is still stepped over.
        let (m2, _) = map_and_game("X Teams: 4 Small Divide (Zero-K v1.0) Players: 4");
        assert_eq!(m2.as_deref(), Some("Small Divide"));
        // A row with no bracket names no map rather than guessing one.
        assert_eq!(map_and_game("Teams: 2 nothing here Players: 2"), (None, None));
    }

    #[test]
    fn an_apostrophe_survives_the_entity() {
        let r = parse_row(ROW).expect("a row");
        assert_eq!(r.title.as_deref(), Some("Tommyknocker's Battle"));
    }

    #[test]
    fn durations_are_read_in_whatever_units_the_site_used() {
        assert_eq!(seconds("0 seconds"), Some(0));
        assert_eq!(seconds("21 minutes"), Some(1260));
        assert_eq!(seconds("1 hour 4 minutes"), Some(3840));
        // Not a duration at all, rather than a confident zero.
        assert_eq!(seconds("ages ago"), None);
    }

    #[test]
    fn a_row_that_makes_no_sense_is_skipped_not_guessed() {
        /* This is somebody else's markup. When it changes, the failure has to
           be a missing row rather than a row full of wrong numbers. */
        assert!(parse_row("<div>nothing here</div>").is_none());
        assert!(parse_row("<a href='/Battles/Detail/abc'>x</a>").is_none());
    }

    #[test]
    fn a_missing_field_is_absent_rather_than_zero() {
        let sparse = "<a href='/Battles/Detail/17'><div class='mission'>Some Battle</div>";
        let r = parse_row(sparse).expect("a row with an id is still a row");
        assert_eq!(r.id, 17);
        assert_eq!(r.players, None, "no count is not a count of zero");
        assert_eq!(r.duration, None);
    }

    #[test]
    fn the_form_says_any_where_nothing_was_asked_for() {
        /* Omitting a field is not the same as asking for its default: the form
           posts every select, and a missing one has bitten this kind of code
           before by falling back to something that is not "any". */
        let f = BattleQuery::default().form();
        let get = |k: &str| f.iter().find(|(a, _)| a == k).map(|(_, v)| v.as_str());
        assert_eq!(get("Age"), Some("0"));
        assert_eq!(get("Rank"), Some("8"), "8 is the form's own Any");
        assert_eq!(get("Victory"), Some("0"));
        assert_eq!(get("Map"), Some(""));
        assert!(get("Offset").is_none(), "offset 0 is the first page, not a parameter");
    }

    #[test]
    fn paging_and_players_reach_the_form() {
        let q = BattleQuery {
            offset: Some(40),
            players: Some(vec!["123".into(), "456".into()]),
            map: Some("Isis".into()),
            ..Default::default()
        };
        let f = q.form();
        assert!(f.contains(&("Offset".to_string(), "40".to_string())));
        assert!(f.contains(&("Map".to_string(), "Isis".to_string())));
        assert_eq!(f.iter().filter(|(k, _)| k == "UserId").count(), 2);
    }

    #[test]
    fn a_form_body_is_encoded_the_way_a_browser_would() {
        let body = encode_form(&[
            ("Map".into(), "Fields Of Isis".into()),
            ("Title".into(), "a&b=c".into()),
        ]);
        // A space is `+` in a form post, and the separators must be escaped or
        // a map name would silently become two fields.
        assert_eq!(body, "Map=Fields+Of+Isis&Title=a%26b%3Dc");
    }

    /// Against the live site, which is the only place this markup exists.
    ///
    /// Ignored by default: CI must not depend on somebody else's server being
    /// up, and a test that quietly passes when the page 404s is worse than one
    /// that is obviously not run. Run it when touching the parser - it is the
    /// only thing that catches the site changing.
    ///
    ///   cargo test --lib zkbattles -- --ignored --nocapture
    #[test]
    #[ignore]
    fn reads_the_live_battle_list() {
        let page = search(&BattleQuery::default());
        if let Some(note) = &page.note {
            eprintln!("skipped: {note}");
            return;
        }
        println!("{} rows, more={}", page.battles.len(), page.more);
        assert!(page.battles.len() > 20, "only {} rows parsed", page.battles.len());

        let with = |f: fn(&ArchiveBattle) -> bool| page.battles.iter().filter(|b| f(b)).count();
        println!(
            "  map {}  game {}  players {}  duration {}  date {}  thumbnail {}",
            with(|b| b.map.is_some()),
            with(|b| b.game.is_some()),
            with(|b| b.players.is_some()),
            with(|b| b.duration.is_some()),
            with(|b| b.played.is_some()),
            with(|b| b.thumbnail.is_some()),
        );
        /* Each of these is a field the screen draws. A site change usually
           takes one of them out, and the count is what shows which. */
        assert!(with(|b| b.map.is_some()) * 2 > page.battles.len(), "most rows lost their map");
        assert!(with(|b| b.players.is_some()) * 2 > page.battles.len(), "most rows lost their count");
        assert!(with(|b| b.duration.is_some()) * 2 > page.battles.len(), "most rows lost their length");
        for b in &page.battles {
            assert!(b.id > 0);
        }

        let sample = &page.battles[0];
        println!("  first: {sample:?}");

        /* Every row's id has to belong to its own content. The detail page for
           a row names the same map, and a mismatch means the rows and the links
           have drifted apart again. */
        if let Ok(client) = client() {
            if let Ok(detail) = client
                .get(detail_url(sample.id))
                .send()
                .and_then(|r| r.error_for_status())
                .and_then(|r| r.text())
            {
                if let Some(map) = sample.map.as_deref() {
                    let key = map.replace(' ', "_");
                    assert!(
                        detail.contains(map) || detail.contains(&key),
                        "row {} says {map}, but its own page does not",
                        sample.id
                    );
                    println!("  row {} and its page agree on {map}", sample.id);
                }
            }
        }

        // The second page must be a different set, or paging is a no-op that
        // would show the same forty rows forever.
        let next = search(&BattleQuery { offset: Some(PAGE), ..Default::default() });
        if next.note.is_none() {
            let first: std::collections::HashSet<u64> = page.battles.iter().map(|b| b.id).collect();
            let overlap = next.battles.iter().filter(|b| first.contains(&b.id)).count();
            println!("  page two: {} rows, {} overlapping", next.battles.len(), overlap);
            assert!(overlap * 4 < next.battles.len().max(1), "paging returned the same rows");
        }

        // And a filter must actually narrow, or the screen lies about the archive.
        let isis = search(&BattleQuery { map: Some("Isis".into()), ..Default::default() });
        if isis.note.is_none() && !isis.battles.is_empty() {
            let named: Vec<&str> = isis.battles.iter().filter_map(|b| b.map.as_deref()).collect();
            println!("  map:Isis -> {:?}", &named[..named.len().min(4)]);
            assert!(
                named.iter().all(|m| m.to_lowercase().contains("isis")),
                "the map filter did not filter: {named:?}"
            );
        }
    }

    #[test]
    fn a_value_ends_where_the_next_label_starts() {
        /* Flattening the markup collapses every run of whitespace, so there is
           no gap to stop at - the date used to swallow the duration behind it. */
        let text = "Teams: 2 Map (Game) Players: 12 Spectators: 3                     Date: 9/1/2026 4:24:23 AM (11 minutes ago) Duration: 4 minutes";
        assert_eq!(labelled(text, "Players:"), Some("12"));
        assert_eq!(labelled(text, "Date:"), Some("9/1/2026 4:24:23 AM (11 minutes ago)"));
        assert_eq!(labelled(text, "Duration:"), Some("4 minutes"));
    }

    #[test]
    fn a_matchmaker_queue_is_not_part_of_the_map_name() {
        /* The site prints the queue in front of the map for ranked games, so
           the same map arrives as `Fields_Of_Isis` and `4v4 Fields_Of_Isis`.
           Left alone, one map became several in every filter and grouping. */
        let (m, _) = map_and_game("X Teams: 2 1v1 Agalta v1.0 (Zero-K v1.14.8.0) Players: 2");
        assert_eq!(m.as_deref(), Some("Agalta v1.0"));
        let (m2, _) = map_and_game("X Teams: 8 4v4 Fields_Of_Isis (Zero-K v1.14.8.0) Players: 8");
        assert_eq!(m2.as_deref(), Some("Fields_Of_Isis"));
        // A map that merely starts with a word containing v is left alone.
        let (m3, _) = map_and_game("X Teams: 2 Valley v2 (Zero-K v1.0) Players: 2");
        assert_eq!(m3.as_deref(), Some("Valley v2"));
    }

    #[test]
    fn a_name_lookup_reads_only_the_id_and_the_name() {
        /* The labels are a pile of flag and rank markup. Nothing here should
           touch them, and a malformed entry must not take the list with it. */
        let body = r#"[{"id":313773,"label":"<img src='/img/flags/AU.png'/>Aquanim","value":"Aquanim"},
                       {"id":"42","label":"x","value":"Aqua"},
                       {"label":"no id"},
                       {"id":7,"value":null}]"#;
        let found = parse_players(body);
        assert_eq!(found.len(), 2);
        assert_eq!(found[0], PlayerMatch { id: "313773".into(), name: "Aquanim".into() });
        assert_eq!(found[1].id, "42");
    }

    #[test]
    fn a_lookup_that_answers_with_nonsense_yields_nothing() {
        assert!(parse_players("not json at all").is_empty());
        assert!(parse_players("{\"not\":\"an array\"}").is_empty());
    }

    #[test]
    fn the_replay_link_is_found_and_bounded() {
        let html = "<a class='textbutton' href='/replays/2026-09-01_02-21-33-445_The Hole v5_2025.06.21.sdfz'>Watch</a>";
        assert_eq!(
            replay_link(html).as_deref(),
            Some("https://zero-k.info/replays/2026-09-01_02-21-33-445_The Hole v5_2025.06.21.sdfz")
        );
        assert_eq!(replay_link("<div>no replay here</div>"), None);
        // A link to something that is not a replay is not a replay link.
        assert_eq!(replay_link("<a href='/replays/notes.txt'>x</a>"), None);
    }

    #[test]
    fn a_comma_separated_attribute_still_yields_the_replay() {
        /* The "Watch Replay Now" control carries the path plus the game, the
           map and the engine in one attribute, and it comes first on the page.
           Reading to the quote returned the whole blob, so a page that plainly
           had a replay reported none. Found against the live site. */
        let html = "<span data-x='/replays/2026-09-01_05-03-57-277_ZeroWars v2.1.9_2025.06.21.sdfz,\
Zero-K v1.14.8.0,ZeroWars v2.1.9,2025.06.21'>Watch Replay Now</span>";
        assert_eq!(
            replay_link(html).as_deref(),
            Some("https://zero-k.info/replays/2026-09-01_05-03-57-277_ZeroWars v2.1.9_2025.06.21.sdfz")
        );
    }

    #[test]
    fn a_later_occurrence_is_used_when_the_first_is_not_a_replay() {
        let html = "<a href='/replays/index.html'>x</a><a href='/replays/real.sdfz'>y</a>";
        assert_eq!(replay_link(html).as_deref(), Some("https://zero-k.info/replays/real.sdfz"));
    }

    #[test]
    fn a_downloaded_name_cannot_climb_out_of_the_folder() {
        assert_eq!(safe_filename("https://x/replays/a.sdfz").as_deref(), Some("a.sdfz"));
        assert_eq!(
            safe_filename("https://x/replays/The%20Hole%20v5.sdfz").as_deref(),
            Some("The Hole v5.sdfz")
        );
        assert_eq!(safe_filename("https://x/replays/..%2F..%2Fevil.sdfz"), None);
        assert_eq!(safe_filename("https://x/replays/.hidden.sdfz"), None);
        assert_eq!(safe_filename("https://x/replays/a.exe"), None);
        assert_eq!(safe_filename("https://x/replays/"), None);
    }

    #[test]
    fn percent_decoding_handles_what_a_url_actually_carries() {
        assert_eq!(percent_decode("The%20Hole"), "The Hole");
        assert_eq!(percent_decode("a+b"), "a b");
        // A stray percent is left alone rather than eating what follows it.
        assert_eq!(percent_decode("100%"), "100%");
    }

    /// Fetch one real replay end to end, against the live site.
    ///
    /// Ignored by default - it needs the network, a Zero-K install to put the
    /// file in, and it writes to the demos folder. It is the only thing that
    /// proves the whole chain: search a battle, find its replay on the detail
    /// page, download it, and read it with the same parser a local file uses.
    ///
    ///   cargo test --lib zkbattles -- --ignored --nocapture
    #[test]
    #[ignore]
    fn fetches_and_reads_one_real_replay() {
        let page = search(&BattleQuery::default());
        if let Some(note) = &page.note {
            eprintln!("skipped: {note}");
            return;
        }
        /* The shortest real battle on the page: long enough to have been a
           game, small enough that this is not a rude thing to download. */
        let Some(target) = page
            .battles
            .iter()
            .filter(|b| b.duration.is_some_and(|d| d > 60))
            .min_by_key(|b| b.duration.unwrap_or(i32::MAX))
        else {
            eprintln!("skipped: nothing on the page had a length");
            return;
        };
        println!(
            "battle {} - {} on {}, {}s",
            target.id,
            target.title.as_deref().unwrap_or("?"),
            target.map.as_deref().unwrap_or("?"),
            target.duration.unwrap_or(0)
        );

        let root = std::env::var("APPDATA")
            .map(|a| format!("{a}\\info.zero-k.shiro\\zk"))
            .ok();
        let path = match download_replay(target.id, root.as_deref()) {
            Ok(p) => p,
            Err(e) => {
                eprintln!("skipped: {e}");
                return;
            }
        };
        println!("saved to {}", path.display());
        assert!(path.is_file());
        assert!(!path.to_string_lossy().ends_with(".part"), "a part file was left behind");

        let replay = crate::replays::read(&path).expect("the download must parse as a replay");
        println!(
            "  {} on {} - {}s, {} players, winners {:?}",
            replay.game.as_deref().unwrap_or("?"),
            replay.map.as_deref().unwrap_or("?"),
            replay.duration,
            replay.players.len(),
            replay.winners
        );
        /* The point of the whole exercise: the list page named nobody, and the
           file does. */
        assert!(!replay.players.is_empty(), "the replay named no players");
        assert!(!replay.engine.is_empty());

        // Asking again must not download again.
        let again = download_replay(target.id, root.as_deref())
            .expect("a second call finds the file");
        assert_eq!(again, path);
    }

    #[test]
    fn a_matchmaker_row_states_its_shape_instead_of_a_count() {
        /* The same field carries a number on one row and a word on the next.
           Parsing it only as a number left every ranked game with no shape at
           all, which is most of the interesting ones. */
        let row = ROW.replace("Teams: 1 + Bots", "Teams: 1v1");
        let r = parse_row(&row).expect("a row");
        assert_eq!(r.shape.as_deref(), Some("1v1"));
        assert_eq!(r.teams, None, "1v1 is not a count of teams");
    }

    /// The feature the whole screen exists for, against the live site: find
    /// somebody's games without downloading anything.
    ///
    ///   cargo test --lib zkbattles -- --ignored --nocapture
    #[test]
    #[ignore]
    fn finds_a_players_games_without_downloading_one() {
        let found = lookup_players("Aquanim");
        if found.is_empty() {
            eprintln!("skipped: the name lookup answered with nothing");
            return;
        }
        let who = found
            .iter()
            .find(|p| p.name.eq_ignore_ascii_case("Aquanim"))
            .unwrap_or(&found[0]);
        println!("{} is account {}", who.name, who.id);

        let mine = search(&BattleQuery {
            players: Some(vec![who.id.clone()]),
            ..Default::default()
        });
        if let Some(note) = &mine.note {
            eprintln!("skipped: {note}");
            return;
        }
        assert!(!mine.battles.is_empty(), "no battles came back for {}", who.name);
        println!("  {} battles", mine.battles.len());

        /* The list page never names a player, so the only way to know the
           filter did anything is to open one battle and look. One, not forty:
           the point of the filter is that it happens on their server. */
        let Ok(client) = client() else { return };
        let sample = &mine.battles[0];
        let Ok(detail) = client
            .get(detail_url(sample.id))
            .send()
            .and_then(|r| r.error_for_status())
            .and_then(|r| r.text())
        else {
            eprintln!("skipped: the battle page did not load");
            return;
        };
        let marker = format!("/Users/Detail/{}", who.id);
        assert!(
            detail.contains(&marker),
            "battle {} came back for {} but does not list them",
            sample.id,
            who.name
        );
        println!("  battle {} does list {}", sample.id, who.name);

        /* Two accounts narrow to the games both played - ANDed, not ORed. That
           is what makes "against this person" answerable, and it is a fact
           about their server rather than anything this can enforce. */
        let second: Option<String> = detail
            .split("/Users/Detail/")
            .skip(1)
            .filter_map(|r| r.split(['\'', '"', '?']).next())
            .map(|id| id.to_string())
            .find(|id| id != &who.id && id.chars().all(|c| c.is_ascii_digit()));
        if let Some(second) = second {
            let both = search(&BattleQuery {
                players: Some(vec![who.id.clone(), second.clone()]),
                ..Default::default()
            });
            if both.note.is_none() && !both.battles.is_empty() {
                println!("  with account {second}: {} battles", both.battles.len());
                /* Comparing counts proves nothing when both pages are full, so
                   this opens one and looks for both people in it. */
                if let Ok(page) = client
                    .get(detail_url(both.battles[0].id))
                    .send()
                    .and_then(|r| r.error_for_status())
                    .and_then(|r| r.text())
                {
                    let has = |id: &str| page.contains(&format!("/Users/Detail/{id}"));
                    assert!(
                        has(&who.id) && has(&second),
                        "battle {} came back for two accounts but lists only one, so they are ORed",
                        both.battles[0].id
                    );
                    println!("  battle {} lists both", both.battles[0].id);
                }
            }
        }
    }

    #[test]
    fn a_page_of_rows_comes_back_without_duplicates() {
        let page = format!("<table>{ROW}{ROW}</table>");
        // The same battle twice is one battle; the page repeats links per row.
        let rows = parse_page(&page);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, 2498170);
    }

    #[test]
    fn each_row_keeps_its_own_battle_id() {
        /* The bug this exists for: a row's content filed under the next row's
           id. Two rows with different maps is the smallest case that shows it,
           and a list looks perfectly reasonable while it is wrong. */
        let second = ROW
            .replace("2498170", "2498171")
            .replace("Jurassic Sands v1.00", "Small Divide")
            .replace("Tommyknocker&#39;s Battle", "Another Battle");
        let rows = parse_page(&format!("<table>{ROW}{second}</table>"));
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].id, 2498170);
        assert_eq!(rows[0].map.as_deref(), Some("Jurassic Sands v1.00"));
        assert_eq!(rows[1].id, 2498171);
        assert_eq!(rows[1].map.as_deref(), Some("Small Divide"));
    }
}
