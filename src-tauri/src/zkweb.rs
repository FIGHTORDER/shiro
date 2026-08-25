//! Reading player profiles off zero-k.info.
//!
//! The lobby protocol will not tell us anything about a player who is not
//! connected, and `UserProfile` is server-to-client only - awards, kudos and
//! progression are yours and nobody else's. The Zero-K developers were asked
//! for an endpoint and declined, so the remaining source is the site's own
//! player page. `docs/PROFILES-WITHOUT-ENDPOINTS.md` has the measurements.
//!
//! Three things make this workable rather than a guess:
//!
//! 1. `/Users/Detail/<name>` resolves a **name**, so nothing has to look an ID
//!    up first. It is case-sensitive.
//! 2. A miss is 40 bytes of `Invalid account (neither an ID nor name)` - an
//!    unambiguous "no such player" rather than a page that merely looks empty.
//! 3. The page is server-rendered. Nothing here needs a browser.
//!
//! And one thing makes it a liability: it is somebody else's markup, with no
//! promise of stability. So the parsers are pinned against saved pages in
//! `fixtures/`, and every field is optional. A page that changes shape should
//! cost us a field and a failing test, never a panic or a wrong number.
//!
//! On manners: robots.txt disallows five paths and not this one, so this is
//! permitted - but permitted and welcome are different, and they have just
//! said no to us once. Hence the identifying user agent, the cache, and one
//! request per profile actually looked at. No crawling.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;

const BASE: &str = "https://zero-k.info";
const ALLOWED_HOST: &str = "zero-k.info";

/// Identifies us, and says where to complain. Traffic they can attribute is
/// traffic they can ask us to stop; anonymous traffic is not.
const USER_AGENT: &str = concat!(
    "Shiro/",
    env!("CARGO_PKG_VERSION"),
    " (Zero-K lobby client; +https://github.com/QrowZK/shiro)"
);

/// Their answer for a name that is not an account. Exact, and only 40 bytes.
const NOT_AN_ACCOUNT: &str = "Invalid account (neither an ID nor name)";

/// A player page is ~32 KB. Anything an order of magnitude past that is not a
/// player page, and we would rather stop reading than buffer it.
const MAX_BYTES: u64 = 2 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(15);

/// How long a fetched page stays good. Profiles change on the timescale of
/// games played, not seconds, and every request reaches their application
/// server - the responses are `Cache-Control: private`, so nothing else caches
/// them for us.
const PROFILE_TTL: Duration = Duration::from_secs(300);
const RATINGS_TTL: Duration = Duration::from_secs(1800);

// ------------------------------------------------------------------ types ---

/// One award and how many times it has been won.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Award {
    pub key: String,
    pub name: String,
    pub count: u32,
}

/// A battle the player was recently in. Deliberately not called "history":
/// it is the last handful, not a record.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RecentBattle {
    pub id: u32,
    pub map: String,
    pub players: Option<u32>,
}

/// What a player page tells us. Every field is optional because every field is
/// somebody else's markup.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub account_id: Option<u32>,
    pub name: String,
    pub clan: Option<String>,
    pub clan_id: Option<u32>,
    pub avatar: Option<String>,
    pub level: Option<u32>,
    pub level_percent: Option<u32>,
    pub xp_to_next: Option<u32>,
    pub rank: Option<String>,
    /// The `<levelBracket>_<rank>` icon id, whose second digit is the rank
    /// `src/net/ranks.ts` names and colours from.
    pub rank_icon: Option<String>,
    pub badges: Vec<String>,
    pub awards: Vec<Award>,
    pub battles_played: Option<u32>,
    pub battles_watched: Option<u32>,
    pub first_login: Option<String>,
    pub last_login: Option<String>,
    pub forum_karma: Option<i32>,
    pub recent: Vec<RecentBattle>,
}

/// One point on a rating chart.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RatingPoint {
    pub date: String,
    pub elo: f64,
}

// ------------------------------------------------------------------- http ---

fn host_allowed(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://")) else {
        return false;
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host = authority.rsplit('@').next().unwrap_or(authority);
    let host = host.split(':').next().unwrap_or(host).to_ascii_lowercase();
    host == ALLOWED_HOST || host.ends_with(&format!(".{ALLOWED_HOST}"))
}

fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(TIMEOUT)
        // A redirect is how a fetch of an allowed host ends up somewhere else.
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("could not build an HTTP client: {e}"))
}

fn get(url: &str) -> Result<String, String> {
    if !host_allowed(url) {
        return Err(format!("refusing to fetch {url}: not zero-k.info"));
    }
    let res = client()?
        .get(url)
        .send()
        .map_err(|e| format!("could not reach zero-k.info: {e}"))?;

    // A 500 here means "no such series", not an outage - see the doc.
    if !res.status().is_success() {
        return Err(format!("zero-k.info answered {}", res.status()));
    }
    if let Some(len) = res.content_length() {
        if len > MAX_BYTES {
            return Err(format!("that page is {len} bytes, which is not a player page"));
        }
    }
    res.text().map_err(|e| format!("unreadable response: {e}"))
}

// ------------------------------------------------------------------ cache ---

struct Cached<T> {
    at: Instant,
    value: T,
}

static PROFILES: Mutex<Option<HashMap<String, Cached<Option<Profile>>>>> = Mutex::new(None);
static RATINGS: Mutex<Option<HashMap<String, Cached<Vec<RatingPoint>>>>> = Mutex::new(None);

fn cached<T: Clone>(
    store: &Mutex<Option<HashMap<String, Cached<T>>>>,
    key: &str,
    ttl: Duration,
) -> Option<T> {
    let guard = store.lock().ok()?;
    let map = guard.as_ref()?;
    let hit = map.get(key)?;
    (hit.at.elapsed() < ttl).then(|| hit.value.clone())
}

fn remember<T>(store: &Mutex<Option<HashMap<String, Cached<T>>>>, key: String, value: T) {
    if let Ok(mut guard) = store.lock() {
        let map = guard.get_or_insert_with(HashMap::new);
        // Nothing here is worth unbounded memory; a session looks at a handful.
        if map.len() > 256 {
            map.clear();
        }
        map.insert(key, Cached { at: Instant::now(), value });
    }
}

// ----------------------------------------------------------------- parsing ---

/// Strip HTML tags and collapse whitespace, so a value split across lines and
/// markup reads as one string. The page indents inside its own `<span>`s -
/// `8242 played, 6657\n watched` is one line to a reader and two to a regex.
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
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn unescape(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
}

/// The text between the first `open` and the next `close` after it.
fn between<'a>(hay: &'a str, open: &str, close: &str) -> Option<&'a str> {
    let start = hay.find(open)? + open.len();
    let rest = &hay[start..];
    let end = rest.find(close)?;
    Some(&rest[..end])
}

/// Every `attr='value'` or `attr="value"` for `attr`, in document order.
fn attrs(html: &str, attr: &str) -> Vec<String> {
    let mut out = Vec::new();
    for quote in ['\'', '"'] {
        let needle = format!("{attr}={quote}");
        let mut at = 0;
        while let Some(i) = html[at..].find(&needle) {
            let start = at + i + needle.len();
            match html[start..].find(quote) {
                Some(end) => {
                    out.push(unescape(&html[start..start + end]));
                    at = start + end;
                }
                None => break,
            }
        }
    }
    out
}

/// The first run of digits after `marker`, if it is close enough to be that
/// marker's number rather than the next thing on the page.
fn number_after(hay: &str, marker: &str) -> Option<u32> {
    let i = hay.find(marker)? + marker.len();
    let window = &hay[i..hay.len().min(i + 40)];
    let digits: String = window
        .chars()
        .skip_while(|c| !c.is_ascii_digit())
        .take_while(|c| c.is_ascii_digit())
        .collect();
    digits.parse().ok()
}

/// Read a player page.
///
/// `Ok(None)` is "no such player" - their 40-byte answer - and is a result, not
/// a failure. Anything that is not a player page and not that answer is an
/// error, because silently returning an empty profile would look like a player
/// who has done nothing.
pub fn parse_profile(html: &str) -> Result<Option<Profile>, String> {
    if html.trim() == NOT_AN_ACCOUNT {
        return Ok(None);
    }
    let Some(title) = between(html, "<title>", "</title>") else {
        return Err("that is not a zero-k.info page".into());
    };
    let title = text_of(title);
    let Some(name) = title.strip_suffix(" user page - Zero-K").map(str::trim) else {
        return Err(format!("unexpected page title: {title}"));
    };

    let mut p = Profile { name: unescape(name), ..Default::default() };

    /* Two haystacks. `flat` is what a reader sees; `labelled` adds the `title`
       tooltips, because the page keeps the exact numbers there - "Level 183",
       "Progress to the next level: 46%", "XP remaining for level 184: 3963" -
       and stripping tags throws attributes away with them. */
    let flat = text_of(html);
    let labelled = {
        let mut all = flat.clone();
        for t in attrs(html, "title") {
            all.push(' ');
            all.push_str(&text_of(&t));
        }
        all
    };

    // The account's own id, from the links the page makes to itself.
    p.account_id = attrs(html, "href")
        .iter()
        .find_map(|h| h.rsplit("UserId=").next().filter(|s| *s != h.as_str()).and_then(|s| s.parse().ok()))
        .filter(|id| *id != 0);

    if let Some(clan) = between(html, "/Clans/Detail/", "'") {
        p.clan_id = clan.parse().ok();
    }
    p.clan = attrs(html, "src")
        .iter()
        .find_map(|s| s.strip_prefix("/img/clans/").and_then(|c| c.strip_suffix(".png")))
        .map(str::to_string);
    p.avatar = attrs(html, "src")
        .iter()
        .find(|s| s.starts_with("/img/avatars/"))
        .cloned();

    p.level = number_after(&labelled, "Current level:");
    p.level_percent = number_after(&labelled, "Progress to the next level:");
    p.xp_to_next = number_after(&labelled, "XP remaining for level")
        // "XP remaining for level 184: 3963" - the first number is the level.
        .and_then(|_| {
            labelled
                .split("XP remaining for level")
                .nth(1)
                .and_then(|r| r.split(':').nth(1))
                .and_then(|r| r.trim().split_whitespace().next())
                .and_then(|n| n.parse().ok())
        });

    // The icon is the same grid src/net/ranks.ts colours from - upstream's own
    // tooltip says so: "Rank is represented by the icon's color ... Level is
    // represented by the icon's shape."
    let (rank, rank_icon) = rank_from_tooltip(html);
    p.rank = rank;
    p.rank_icon = rank_icon;

    p.badges = parse_badges(html);

    p.awards = parse_awards(html);

    if let Some(rest) = flat.split(" played, ").nth(1) {
        p.battles_played = flat.split(" played, ").next().and_then(last_number);
        p.battles_watched = rest.split_whitespace().next().and_then(|n| n.parse().ok());
    }

    p.first_login = after_label(&flat, "First Login:");
    p.last_login = after_label(&flat, "Last Login:");

    if let Some(k) = flat.split("Forum karma:").nth(1) {
        let plus: String = k.chars().skip_while(|c| *c != '+').take(8).collect();
        p.forum_karma = plus.trim_start_matches('+').trim().split(' ').next().and_then(|n| n.parse().ok());
    }

    p.recent = parse_recent(html);

    Ok(Some(p))
}

fn last_number(s: &str) -> Option<u32> {
    let digits: String = s.chars().rev().take_while(|c| c.is_ascii_digit()).collect();
    digits.chars().rev().collect::<String>().parse().ok()
}

/// "First Login: 15 years ago," - up to the comma or the next label.
fn after_label(flat: &str, label: &str) -> Option<String> {
    let rest = flat.split(label).nth(1)?.trim_start();
    let value: String = rest.chars().take_while(|c| *c != ',' && *c != '<').collect();
    let value = value.trim();
    // "Last Login:" runs into "Forum karma:" when there is no comma.
    let value = value.split("Forum").next().unwrap_or(value).trim();
    (!value.is_empty()).then(|| value.to_string())
}

/// The rank's name and icon, from the tooltip that states them.
///
/// Both come from the raw attribute rather than the stripped text, for two
/// different reasons. The name, because the tooltip reads
/// `Current rank: <img .../> Singularity <br /> ...` and once the tags are gone
/// so is the boundary - the name runs into the sentence after it. The icon,
/// because the page also carries a *legend* of every rank image to explain the
/// scheme, so the first `/img/ranks/` on the page belongs to nobody. This
/// player's is the one inside this tooltip.
fn rank_from_tooltip(html: &str) -> (Option<String>, Option<String>) {
    for title in attrs(html, "title") {
        let Some(rest) = title.split("Current rank:").nth(1) else { continue };

        let icon = between(rest, "/img/ranks/", ".png").map(str::to_string);

        // Step over the icon tag, then stop at the next tag.
        let after_img = match rest.find('>') {
            Some(i) if rest[..i].contains("<img") => &rest[i + 1..],
            _ => rest,
        };
        let name = after_img.split('<').next().unwrap_or("").trim();
        return ((!name.is_empty()).then(|| name.to_string()), icon);
    }
    (None, None)
}

/// Badges, from the badge strip alone.
///
/// `nicetitle` is the page's tooltip attribute and it is on everything - the
/// login control, the rank icon's explainer, "Click to find a clan!". Reading
/// them all gives you help text, not badges. Only the images inside the badges
/// block are badges, and the clan crest among them carries a `$clan$` token the
/// page expands client-side rather than a label.
fn parse_badges(html: &str) -> Vec<String> {
    let Some(start) = html.find("id=\"badges\"") else {
        return Vec::new();
    };
    let block = &html[start..];
    let block = match block.find("</div>") {
        Some(end) => &block[..end],
        None => block,
    };
    let mut out = Vec::new();
    for chunk in block.split("<img").skip(1) {
        if !attrs(chunk, "src").iter().any(|s| s.starts_with("/img/badges/")) {
            continue;
        }
        if let Some(label) = attrs(chunk, "nicetitle").into_iter().next() {
            if !label.starts_with('$') {
                out.push(label);
            }
        }
    }
    out
}

fn parse_awards(html: &str) -> Vec<Award> {
    let Some(block) = html.find("usr_trophies").map(|i| &html[i..]) else {
        return Vec::new();
    };
    let block = block.split("</div>\n").collect::<Vec<_>>().join("</div>\n");
    let mut out = Vec::new();
    let mut at = 0;
    while let Some(i) = block[at..].find("/img/Awards/trophy_") {
        let start = at + i + "/img/Awards/trophy_".len();
        let Some(dot) = block[start..].find(".png") else { break };
        let key = block[start..start + dot].to_string();
        let rest = &block[start + dot..];
        let name = between(rest, "title=\"", "\"").map(unescape).unwrap_or_else(|| key.clone());
        // The count sits in the <center> just after the image.
        let count = between(rest, "<center>", "</center>")
            .and_then(|c| text_of(c).trim().parse().ok())
            .unwrap_or(0);
        out.push(Award { key, name, count });
        at = start + dot;
    }
    out
}

fn parse_recent(html: &str) -> Vec<RecentBattle> {
    let Some(block) = html.find("usr_recentbattles").map(|i| &html[i..]) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let mut at = 0;
    while let Some(i) = block[at..].find("/Battles/Detail/") {
        let start = at + i + "/Battles/Detail/".len();
        let digits: String = block[start..].chars().take_while(|c| c.is_ascii_digit()).collect();
        let Ok(id) = digits.parse::<u32>() else {
            at = start;
            continue;
        };
        // The row's text is "<n> on <map>".
        let row = text_of(&block[start..(start + 400).min(block.len())]);
        let after = row.split(" on ").nth(1).unwrap_or("").trim();
        let map: String = after.split(" B").next().unwrap_or(after).trim().to_string();
        let players = row.split(" on ").next().and_then(last_number);
        out.push(RecentBattle { id, map, players });
        at = start + digits.len();
        if out.len() >= 10 {
            break;
        }
    }
    out
}

/// Pull the rating series out of a chart page.
///
/// The page draws with a canvas but ships the numbers inline:
/// `data: [{x: moment("2018-01-20"), y: 2668.475}, ...]`.
pub fn parse_ratings(html: &str) -> Vec<RatingPoint> {
    let mut out = Vec::new();
    let mut at = 0;
    while let Some(i) = html[at..].find("moment(\"") {
        let start = at + i + "moment(\"".len();
        let Some(end) = html[start..].find('"') else { break };
        let date = html[start..start + end].to_string();
        let rest = &html[start + end..];
        let elo = rest
            .find("y:")
            .map(|y| &rest[y + 2..])
            .map(|s| s.trim_start())
            .and_then(|s| {
                let n: String = s.chars().take_while(|c| c.is_ascii_digit() || *c == '.' || *c == '-').collect();
                n.parse().ok()
            });
        if let Some(elo) = elo {
            out.push(RatingPoint { date, elo });
        }
        at = start + end;
    }
    out
}

// --------------------------------------------------------------- commands ---

/// A name (case-sensitive) or a numeric account id.
///
/// Async so the blocking fetch lands on a worker. A sync Tauri command runs on
/// the main thread, and a profile lookup is an HTTP round trip to zero-k.info -
/// the whole window stopped for the length of it, on a click.
#[tauri::command]
pub async fn zkw_profile(who: String) -> Result<Option<Profile>, String> {
    tauri::async_runtime::spawn_blocking(move || profile_blocking(who))
        .await
        .map_err(|e| format!("the profile lookup did not finish: {e}"))?
}

fn profile_blocking(who: String) -> Result<Option<Profile>, String> {
    let who = who.trim();
    if who.is_empty() {
        return Ok(None);
    }
    // Names go in a path segment; anything that could leave it is not a name.
    if who.contains(['/', '?', '#', '\\', '%']) || who.len() > 64 {
        return Ok(None);
    }
    if let Some(hit) = cached(&PROFILES, who, PROFILE_TTL) {
        return Ok(hit);
    }
    let html = get(&format!("{BASE}/Users/Detail/{who}"))?;
    let parsed = parse_profile(&html)?;
    remember(&PROFILES, who.to_string(), parsed.clone());
    Ok(parsed)
}

/// The rating series for an account. A 500 from the site means there is no
/// such series, which is an empty answer rather than an error.
#[tauri::command]
pub async fn zkw_ratings(account_id: u32, category: u8) -> Result<Vec<RatingPoint>, String> {
    tauri::async_runtime::spawn_blocking(move || ratings_blocking(account_id, category))
        .await
        .map_err(|e| format!("the rating lookup did not finish: {e}"))?
}

fn ratings_blocking(account_id: u32, category: u8) -> Result<Vec<RatingPoint>, String> {
    let key = format!("{account_id}:{category}");
    if let Some(hit) = cached(&RATINGS, &key, RATINGS_TTL) {
        return Ok(hit);
    }
    let url = format!("{BASE}/Charts/Ratings?RatingCategory={category}&UserId={account_id}");
    let points = match get(&url) {
        Ok(html) => parse_ratings(&html),
        Err(e) if e.contains("500") => Vec::new(),
        Err(e) => return Err(e),
    };
    remember(&RATINGS, key, points.clone());
    Ok(points)
}

// ------------------------------------------------------------------ tests ---

#[cfg(test)]
mod tests {
    use super::*;

    const DENSE: &str = include_str!("fixtures/user-dense.html");
    const SPARSE: &str = include_str!("fixtures/user-sparse.html");
    const MISSING: &str = include_str!("fixtures/user-missing.html");
    const RATINGS_PAGE: &str = include_str!("fixtures/ratings.html");

    #[test]
    fn a_missing_account_is_an_answer_not_a_failure() {
        // Their exact 40 bytes. A player who does not exist and a page we could
        // not read must not look the same to the caller.
        assert_eq!(parse_profile(MISSING).unwrap(), None);
    }

    #[test]
    fn something_that_is_not_a_player_page_is_an_error() {
        assert!(parse_profile("<html><body>hello</body></html>").is_err());
        assert!(parse_profile("").is_err());
    }

    #[test]
    fn a_dense_account_reads() {
        let p = parse_profile(DENSE).unwrap().expect("a profile");
        assert_eq!(p.name, "PLT_Godde");
        assert_eq!(p.account_id, Some(86744));
        assert_eq!(p.clan.as_deref(), Some("PLOT"));
        assert_eq!(p.clan_id, Some(2433));
        assert_eq!(p.level, Some(183));
        assert_eq!(p.level_percent, Some(46));
        assert_eq!(p.xp_to_next, Some(3963));
        assert_eq!(p.rank.as_deref(), Some("Singularity"));
        assert_eq!(p.rank_icon.as_deref(), Some("7_7"));
        assert_eq!(p.battles_played, Some(8242));
        assert_eq!(p.battles_watched, Some(6657));
        assert_eq!(p.first_login.as_deref(), Some("15 years ago"));
        assert_eq!(p.last_login.as_deref(), Some("33 hours ago"));
        assert_eq!(p.forum_karma, Some(2041));
    }

    #[test]
    fn awards_come_with_their_counts() {
        let p = parse_profile(DENSE).unwrap().unwrap();
        assert!(p.awards.len() >= 25, "got {}", p.awards.len());
        let top = &p.awards[0];
        assert_eq!(top.key, "pwn");
        assert_eq!(top.name, "Complete Annihilation");
        assert_eq!(top.count, 4729);
        // This is the data the lobby protocol will not give us for anyone else.
        assert!(p.awards.iter().all(|a| !a.name.is_empty()));
    }

    #[test]
    fn badges_are_labels_not_placeholders() {
        let p = parse_profile(DENSE).unwrap().unwrap();
        assert!(p.badges.contains(&"Silver donator".to_string()));
        assert!(p.badges.contains(&"Top 3 player".to_string()));
        // The clan badge's nicetitle is "$clan$2433", which is not a label.
        assert!(p.badges.iter().all(|b| !b.starts_with('$')), "{:?}", p.badges);
    }

    #[test]
    fn recent_battles_are_read_but_capped() {
        let p = parse_profile(DENSE).unwrap().unwrap();
        assert!(!p.recent.is_empty());
        assert!(p.recent.len() <= 10);
        assert_eq!(p.recent[0].id, 2489435);
        assert!(!p.recent[0].map.is_empty());
    }

    #[test]
    fn a_second_account_reads_too_and_absent_fields_stay_absent() {
        /* A parser tuned to one page is a parser that breaks on the next one.
           This account has no clan and no badges, which must read as "none"
           rather than as whatever the previous fixture had. */
        let p = parse_profile(SPARSE).unwrap().expect("a profile");
        assert_eq!(p.name, "Zythid");
        assert_eq!(p.account_id, Some(450611));
        assert_eq!(p.clan, None);
        assert_eq!(p.clan_id, None);
        assert!(p.badges.is_empty(), "{:?}", p.badges);
        assert_eq!(p.level, Some(37));
        assert_eq!(p.rank.as_deref(), Some("Red Dwarf"));
    }

    #[test]
    fn the_rating_series_is_numbers() {
        let points = parse_ratings(RATINGS_PAGE);
        assert!(points.len() >= 20, "got {}", points.len());
        assert_eq!(points[0].date, "2018-01-20");
        assert!((points[0].elo - 2668.475).abs() < 0.01, "{}", points[0].elo);
        // Dates should be in order and parseable as dates by the caller.
        assert!(points.windows(2).all(|w| w[0].date <= w[1].date));
    }

    #[test]
    fn ratings_of_a_page_without_a_series_is_empty_not_an_error() {
        assert!(parse_ratings("<html>no chart here</html>").is_empty());
    }

    #[test]
    fn only_zero_k_is_fetchable() {
        assert!(host_allowed("https://zero-k.info/Users/Detail/1"));
        assert!(host_allowed("https://www.zero-k.info/x"));
        assert!(!host_allowed("https://zero-k.info.example.com/x"));
        assert!(!host_allowed("https://example.com/x"));
        // Userinfo is the classic way to make a URL look like somewhere else.
        assert!(!host_allowed("https://zero-k.info@evil.example.com/x"));
        assert!(!host_allowed("file:///etc/passwd"));
    }

    #[test]
    fn text_of_joins_values_split_across_markup_and_lines() {
        // The page indents inside its own spans: "8242 played, 6657\n watched".
        assert_eq!(text_of("<span>8242 played, 6657\n   watched</span>"), "8242 played, 6657 watched");
    }
}
