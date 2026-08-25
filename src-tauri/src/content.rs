//! Acquiring games and maps with `pr-downloader`.
//!
//! A sibling of `launch.rs`, and deliberately shaped like it: everything up to
//! the spawn is pure and unit-tested, so the only part that needs a machine with
//! Zero-K on it is the process itself.
//!
//! Background and the verified CLI are in `docs/DOWNLOADS.md`. The three things
//! from that document that are easy to get wrong, and are handled here:
//!
//! 1. **Progress is carriage-return terminated**, not newline terminated. A
//!    `BufReader::lines()` reader stays silent for an entire download and then
//!    hands you one enormous line — which reads exactly like a hang. See
//!    [`split_chunks`].
//! 2. **Exit codes cannot tell "not found" from "failed".** The shipped binary
//!    does not print the line upstream's source says it does. Callers must
//!    re-check presence after a non-zero exit rather than trust the code.
//! 3. **The write path must be the Zero-K install root.** `launch.rs` points
//!    `SPRING_DATADIR` there and nowhere else, so content downloaded anywhere
//!    else is invisible to the engine.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::archives;
use crate::install;
use crate::zkcontent;

/// The executable, which ships inside every engine directory next to `spring.exe`.
#[cfg(windows)]
const PR_DOWNLOADER: &str = "pr-downloader.exe";
#[cfg(not(windows))]
const PR_DOWNLOADER: &str = "pr-downloader";

/// What a name refers to, which decides the flag.
///
/// `Engine` is deliberately absent: whether pr-downloader accepts Zero-K's
/// engine version strings is unverified and doubtful, and `install::find_engine`
/// already writes a good error for a missing one.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ContentKind {
    Game,
    Map,
}

impl ContentKind {
    fn flag(self) -> &'static str {
        match self {
            ContentKind::Game => "--download-game",
            ContentKind::Map => "--download-map",
        }
    }
}

/// One thing to acquire. `name` is the server's spelling, unmodified — a rapid
/// tag (`zk:stable`) and an archive name (`Adamantine Mountain 2`) both go
/// through the same flag.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
pub struct ContentItem {
    pub kind: ContentKind,
    pub name: String,
}

/// Everything needed to run pr-downloader, resolved but not yet executed.
/// Mirrors `launch::SpawnPlan` field for field on purpose.
#[derive(Debug, PartialEq, Eq)]
pub struct DownloadPlan {
    pub exe: PathBuf,
    pub cwd: PathBuf,
    pub args: Vec<OsString>,
}

/// Locate `pr-downloader`, which lives beside the engine binary.
pub fn find_pr_downloader(root: &Path, engine: &str) -> Result<PathBuf, String> {
    // Same server string, same path component, same guard.
    crate::engine::check_version(engine)?;
    let spring = install::find_engine(root, engine)?;
    let dir = spring
        .parent()
        .ok_or_else(|| format!("engine path {} has no directory", spring.display()))?;
    let exe = dir.join(PR_DOWNLOADER);
    if exe.is_file() {
        Ok(exe)
    } else {
        Err(format!(
            "{} is missing from engine {}. It normally ships with the engine; \
             reinstalling that engine version through the official lobby restores it.",
            PR_DOWNLOADER, engine
        ))
    }
}

/// Refuse names that cannot be passed safely, in the spirit of
/// `launch::check_value`.
///
/// An archive name or rapid tag never contains a newline, a NUL, or a leading
/// `-`. Refusing rather than mangling means a protocol change surfaces as a
/// message instead of a mysteriously wrong command line.
fn check_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("empty content name".into());
    }
    if name.contains(['\n', '\r', '\0']) {
        return Err(format!("content name contains a control character: {name:?}"));
    }
    if name.starts_with('-') {
        return Err(format!("content name would be read as a flag: {name:?}"));
    }
    Ok(())
}

/// Build the command line.
///
/// One invocation carries every item, because the `--download-*` flags are
/// repeatable. `--filesystem-writepath` comes first so the path is set before
/// anything is queued.
///
/// Note what is deliberately NOT passed:
/// - `--disable-logging` silences all stdout including `[Progress]`, and does
///   not silence the stderr noise, so it costs everything and buys nothing.
/// - `--disable-fetch-depends` would break custom games, which declare
///   `depend = { "rapid://zk:stable" }` — dependency fetching is why
///   downloading a mod also brings the base game.
pub fn download_plan(
    exe: &Path,
    root: &Path,
    items: &[ContentItem],
) -> Result<DownloadPlan, String> {
    let mut args: Vec<OsString> = vec![
        OsString::from("--filesystem-writepath"),
        OsString::from(root.as_os_str()),
    ];
    for item in items {
        check_name(&item.name)?;
        args.push(OsString::from(item.kind.flag()));
        args.push(OsString::from(&item.name));
    }
    Ok(DownloadPlan {
        exe: exe.to_path_buf(),
        // Run beside the binary, matching how launch.rs starts the engine.
        cwd: exe.parent().unwrap_or(root).to_path_buf(),
        args,
    })
}

/// Log severity, as pr-downloader labels it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Level {
    Info,
    Warn,
    Debug,
    Error,
}

/// One decoded unit of pr-downloader output.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Line {
    Progress { percent: u8, done: i64, total: i64 },
    Log { level: Level, message: String },
    Other(String),
}

/// Split a buffer on BOTH `\r` and `\n`, returning the complete units and the
/// remainder to carry into the next read.
///
/// This exists as its own function precisely because `[Progress]` is `\r`
/// terminated: a newline-only reader yields nothing until the download ends.
pub fn split_chunks(buf: &str) -> (Vec<&str>, &str) {
    match buf.rfind(['\r', '\n']) {
        // `\r` and `\n` are single-byte, so this is always a char boundary.
        Some(idx) => {
            let (complete, rest) = buf.split_at(idx + 1);
            let parts = complete
                .split(['\r', '\n'])
                .filter(|s| !s.trim().is_empty())
                .collect();
            (parts, rest)
        }
        None => (Vec::new(), buf),
    }
}

/// Strip pr-downloader's `path:line:func():` prefix from a log message.
fn strip_source_prefix(rest: &str) -> String {
    match rest.find("():") {
        Some(i) => rest[i + 3..].trim().to_string(),
        None => rest.trim().to_string(),
    }
}

/// Parse one already-split chunk. All the format knowledge lives here.
pub fn parse_line(s: &str) -> Line {
    let t = s.trim();

    if let Some(rest) = t.strip_prefix("[Progress]") {
        // "  2% [=====   ] 1/50"
        if let Some((pct_part, after)) = rest.split_once('%') {
            let percent = pct_part.trim().parse::<f64>().ok();
            // Skip the bar, then take "done/total".
            let counts = after.rsplit(']').next().unwrap_or("").trim();
            if let Some((done, total)) = counts.split_once('/') {
                if let (Some(p), Ok(d), Ok(tt)) = (
                    percent,
                    done.trim().parse::<i64>(),
                    total.trim().parse::<i64>(),
                ) {
                    return Line::Progress {
                        percent: p.clamp(0.0, 100.0) as u8,
                        done: d,
                        total: tt,
                    };
                }
            }
        }
        return Line::Other(t.to_string());
    }

    for (tag, level) in [
        ("[Info]", Level::Info),
        ("[Warn]", Level::Warn),
        ("[Debug]", Level::Debug),
        ("[Error]", Level::Error),
    ] {
        if let Some(rest) = t.strip_prefix(tag) {
            return Line::Log {
                level,
                message: strip_source_prefix(rest),
            };
        }
    }

    Line::Other(t.to_string())
}

/// What an exit status means, in terms a caller can act on.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Outcome {
    Ok,
    /// Exit 1. Bad arguments, item not found, or nothing queued — these are NOT
    /// distinguishable from each other, so re-check presence before reporting.
    NotFoundOrFailed,
    /// Exit 2. Something was queued but did not finish.
    Unfinished,
    NoDiskSpace,
    DependsFailed,
    /// Killed by a signal, or cancelled by us.
    Killed,
    Unknown(i32),
}

pub fn classify_exit(code: Option<i32>) -> Outcome {
    match code {
        Some(0) => Outcome::Ok,
        Some(1) => Outcome::NotFoundOrFailed,
        Some(2) => Outcome::Unfinished,
        Some(5) => Outcome::NoDiskSpace,
        Some(6) => Outcome::DependsFailed,
        Some(other) => Outcome::Unknown(other),
        None => Outcome::Killed,
    }
}

impl Outcome {
    /// A sentence to put in front of a player.
    pub fn message(self) -> String {
        match self {
            Outcome::Ok => "Content is ready.".into(),
            Outcome::NotFoundOrFailed =>
                "Could not download it. It may not exist on the servers Zero-K uses — \
                 custom games and their maps are distributed separately and cannot be \
                 fetched this way.".into(),
            Outcome::Unfinished =>
                "The download did not finish. Check the connection and try again.".into(),
            Outcome::NoDiskSpace => "Not enough free disk space for this download.".into(),
            Outcome::DependsFailed =>
                "Could not work out what else this content needs.".into(),
            Outcome::Killed => "Download cancelled.".into(),
            Outcome::Unknown(c) => format!("The downloader exited with code {c}."),
        }
    }
}

// ---------------------------------------------------------------- running --

/// Progress and lifecycle for a download job.
const CONTENT_EVENT: &str = "zks://content";

/// How much stderr to keep for a bug report. pr-downloader writes libcurl's full
/// verbose trace there, which is far too noisy to show but exactly what you want
/// attached to a failure.
const LOG_TAIL: usize = 16 * 1024;

/// The stream must be drained even when nothing is listening, or the pipe fills
/// and pr-downloader blocks forever.
const READ_BUF: usize = 8 * 1024;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ContentStatus {
    Queued { id: String, items: Vec<ContentItem> },
    Started { id: String },
    Progress { id: String, percent: u8, done: i64, total: i64 },
    Note { id: String, level: Level, message: String },
    Finished { id: String, outcome: Outcome, message: String, log: Option<String> },
}

#[derive(Clone, Debug)]
struct Job {
    id: String,
    engine: String,
    items: Vec<ContentItem>,
    /// The data directory this job was queued for.
    ///
    /// Carried on the job rather than read off whichever call happened to start
    /// it: a job can sit in the queue across a settings change, and running it
    /// against the new root downloads into one directory while recording it in
    /// another - after which the next preflight fetches it all over again.
    root: Option<String>,
}

struct ActiveJob {
    id: String,
    /// `None` in two moments when the job is still very much active: after the
    /// slot is reserved and before the downloader is spawned, and after the
    /// downloader exits while the zero-k.info fallback runs. The slot stays
    /// occupied throughout, because "something is writing to the pool" is what
    /// it means, and two writers into `pool/` is the thing the queue exists to
    /// prevent.
    child: Option<std::process::Child>,
    /// What this job is downloading, so a request for the same thing can be
    /// told it is already happening. The queue is not enough: this job was
    /// popped off it to start.
    items: Vec<ContentItem>,
    /// Somebody pressed cancel.
    ///
    /// Read rather than inferred from the exit code: on Windows a killed
    /// process exits 1, which is indistinguishable from "not found" - so a
    /// cancel used to be reported as a failure *and* send the fallback off to
    /// download the thing that had just been cancelled.
    cancelled: bool,
}

/// One pr-downloader at a time, with a queue rather than a rejection.
///
/// This is correctness, not tuning: two processes writing `<ZK>\pool\` and
/// `<ZK>\packages\` concurrently is unsupported, and rapid's `.sdp` writes are
/// not atomic. A second request is a legitimate user action, so it waits instead
/// of failing.
#[derive(Default)]
pub struct Content {
    active: std::sync::Arc<std::sync::Mutex<Option<ActiveJob>>>,
    queue: std::sync::Arc<std::sync::Mutex<std::collections::VecDeque<Job>>>,
    /// What each finished job printed, so a download that behaved oddly can be
    /// read afterwards rather than guessed at. Ordered by job id, which is
    /// sequential, so the oldest are the ones dropped.
    logs: std::sync::Arc<std::sync::Mutex<std::collections::BTreeMap<String, String>>>,
}

static JOB_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

fn next_job_id() -> String {
    format!(
        "dl-{}",
        JOB_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    )
}

/// Drain one pipe, decoding as it goes.
///
/// Reads bytes rather than lines on purpose: `[Progress]` is `\r` terminated and
/// a line reader would yield nothing until the download ended.
fn pump<R: std::io::Read + Send + 'static>(
    mut stream: R,
    app: tauri::AppHandle,
    id: String,
    errors_only: bool,
    tail: std::sync::Arc<std::sync::Mutex<String>>,
) {
    std::thread::spawn(move || {
        use tauri::Emitter;
        let mut raw = [0u8; READ_BUF];
        let mut acc = String::new();
        loop {
            let n = match stream.read(&mut raw) {
                Ok(0) | Err(_) => break,
                Ok(n) => n,
            };
            acc.push_str(&String::from_utf8_lossy(&raw[..n]));

            // Take owned copies before reassigning `acc`, which the borrows point into.
            let (parts, rest) = split_chunks(&acc);
            let chunks: Vec<String> = parts.into_iter().map(str::to_string).collect();
            let carry = rest.to_string();
            acc = carry;

            for chunk in chunks {
                /* Both streams, not just stderr.
                   The tail used to hold stderr only, which is the half without
                   the progress or the "Using rapid" lines - so when a download
                   behaved oddly there was nothing recorded that said what it
                   had been doing. Diagnosing it meant guessing.

                   Progress records are dropped: there are thousands of them and
                   they say the same thing, and a log that is 99% progress bar
                   is one nobody can read. */
                if !matches!(parse_line(&chunk), Line::Progress { .. }) {
                    if let Ok(mut t) = tail.lock() {
                        t.push_str(chunk.trim_end());
                        t.push('\n');
                        if t.len() > LOG_TAIL {
                            /* Floor to a character boundary. `t[cut..]` panics
                               off one, and the tail routinely holds multi-byte
                               text: non-ASCII paths, and the U+FFFD this pump
                               creates itself by lossy-decoding each read
                               independently. That panic kills the pump thread,
                               the pipe stops draining, pr-downloader blocks on
                               a full pipe, and the download is stuck at
                               whatever percent it had reached - with no way to
                               tell why. */
                            let mut cut = t.len() - LOG_TAIL;
                            while cut < t.len() && !t.is_char_boundary(cut) {
                                cut += 1;
                            }
                            *t = t[cut..].to_string();
                        }
                    }
                }
                match parse_line(&chunk) {
                    Line::Progress { percent, done, total } if !errors_only => {
                        let _ = app.emit(
                            CONTENT_EVENT,
                            ContentStatus::Progress { id: id.clone(), percent, done, total },
                        );
                    }
                    Line::Log { level, message } => {
                        // Everything else is noise; only what a player could act
                        // on reaches the UI.
                        if matches!(level, Level::Error | Level::Warn) {
                            let _ = app.emit(
                                CONTENT_EVENT,
                                ContentStatus::Note { id: id.clone(), level, message },
                            );
                        }
                    }
                    _ => {}
                }
            }
        }
    });
}

/// Why a job never reached a running downloader.
///
/// Two cases, because they read differently to the person waiting: a cancel is
/// something they asked for, and announcing it as a failure sent people looking
/// for a problem they had just caused on purpose.
enum StartFailed {
    /// Nothing ran and nothing will - no install, no pr-downloader for that
    /// engine, a name the plan refuses, a spawn the system would not do.
    Failed(String),
    /// Cancelled while it was starting.
    Cancelled,
}

impl From<String> for StartFailed {
    fn from(why: String) -> Self {
        StartFailed::Failed(why)
    }
}

impl StartFailed {
    fn report(self) -> (Outcome, String) {
        match self {
            StartFailed::Failed(why) => (Outcome::NotFoundOrFailed, why),
            StartFailed::Cancelled => (Outcome::Killed, Outcome::Killed.message()),
        }
    }
}

/// Take the slot for the next queued job, if nothing is running.
///
/// Reserving here, under the same lock that found the slot empty, is what stops
/// two callers both seeing nothing running, both popping a job, and both
/// starting a downloader - two processes writing `pool/` and `packages/`, which
/// rapid's non-atomic `.sdp` writes do not survive.
fn reserve_next(state: &Content2) -> Option<Job> {
    let mut slot = state.active.lock().ok()?; // poisoned - do not start another
    if slot.is_some() {
        return None; // busy
    }
    let mut q = state.queue.lock().ok()?;
    let job = q.pop_front()?;
    *slot = Some(ActiveJob {
        id: job.id.clone(),
        child: None,
        items: job.items.clone(),
        cancelled: false,
    });
    Some(job)
}

/// Give the slot back, if this job is still the one holding it.
///
/// Guarded by the id because a slot that belongs to somebody else must not be
/// cleared: the next job is already writing to the pool by then.
fn release_slot(state: &Content2, id: &str) {
    if let Ok(mut slot) = state.active.lock() {
        if slot.as_ref().map(|a| a.id.as_str()) == Some(id) {
            *slot = None;
        }
    }
}

/// Reserve, start, and keep going until something is running or the queue is
/// empty.
///
/// Split out from [`start_next`] and generic over the spawn because the part
/// worth testing needs neither a downloader nor a running app: every early
/// return in [`spawn_job`] happens after the slot is reserved and before there
/// is a supervisor to hand it back, so a reservation nobody releases is a queue
/// that never moves again - not for this job, but for every download for the
/// rest of the session, since the recovery pass finds the slot still taken and
/// concludes something is running.
fn drain_queue(
    state: &Content2,
    mut spawn: impl FnMut(&Job) -> Result<(), StartFailed>,
    mut failed: impl FnMut(&Job, StartFailed),
) {
    while let Some(job) = reserve_next(state) {
        let Err(why) = spawn(&job) else { return };
        release_slot(state, &job.id);
        failed(&job, why);
    }
}

/// Start the next queued job if nothing is running.
fn start_next(app: tauri::AppHandle, state: Content2) {
    use tauri::Emitter;

    drain_queue(
        &state,
        |job| spawn_job(&app, job, &state),
        |job, why| {
            let (outcome, message) = why.report();
            let _ = app.emit(
                CONTENT_EVENT,
                ContentStatus::Finished { id: job.id.clone(), outcome, message, log: None },
            );
        },
    );
}

/// What Zero-K's own content service could do for an item pr-downloader missed.
enum Fallback {
    /// Downloaded and put in place. Carries a line for the UI.
    Installed(String),
    /// The service does not have it either. Keep pr-downloader's own message.
    NotThere,
    /// It has it, but getting it went wrong. Worth saying out loud.
    Failed(String),
}

/// Try the ContentService for one item, reporting progress under the same job.
///
/// `cancelled` is carried all the way down to the transfer. By the time this
/// runs there is no process left for `zks_content_cancel` to kill, and the
/// resolve and the download between them can be minutes - all of it holding the
/// slot, so a stop that only took effect afterwards was no stop at all.
fn try_zk_content(
    app: &tauri::AppHandle,
    id: &str,
    item: &ContentItem,
    root: Option<&str>,
    cancelled: &dyn Fn() -> bool,
) -> Fallback {
    use tauri::Emitter;

    let note = |level: Level, message: String| {
        let _ = app.emit(
            CONTENT_EVENT,
            ContentStatus::Note { id: id.to_string(), level, message },
        );
    };

    let resolved = match zkcontent::resolve(&item.name) {
        Ok(Some(r)) => r,
        // A nil result: the service has never heard of it either.
        Ok(None) => return Fallback::NotThere,
        Err(e) => {
            note(Level::Warn, format!("Zero-K's content service: {e}"));
            return Fallback::NotThere;
        }
    };

    // It knows the name but does not serve the file - a real answer, and a
    // different one from "no such thing".
    let Some(url) = resolved.urls.first() else {
        return Fallback::NotThere;
    };

    let install = match install::detect_with(root) {
        Ok(i) => i,
        Err(e) => return Fallback::Failed(e),
    };
    let name = match zkcontent::file_name_for(url) {
        Ok(n) => n,
        Err(e) => return Fallback::Failed(e),
    };
    let dest = install.root.join(resolved.kind.directory()).join(&name);

    note(Level::Info, format!("Not in rapid or springfiles; trying zero-k.info for {}", item.name));

    let app_p = app.clone();
    let id_p = id.to_string();
    let mut last = u8::MAX;
    let progress = move |done: u64, total: u64| {
        let percent = if total > 0 { ((done * 100) / total).min(100) as u8 } else { 0 };
        // The engine's own downloader is chatty; one event per percent is
        // plenty and keeps the bridge quiet.
        if percent != last {
            last = percent;
            let _ = app_p.emit(
                CONTENT_EVENT,
                ContentStatus::Progress {
                    id: id_p.clone(),
                    percent,
                    done: done as i64,
                    total: total as i64,
                },
            );
        }
    };

    match zkcontent::fetch_to(url, &dest, resolved.md5.as_deref(), cancelled, progress) {
        Ok(()) => Fallback::Installed(format!("Downloaded {name} from zero-k.info.")),
        Err(e) => Fallback::Failed(e),
    }
}

/// Whether a freshly spawned downloader belongs in the slot.
///
/// No if the slot is somebody else's now, and no if this job was cancelled
/// while it was starting: `zks_content_cancel` kills the child it finds, and in
/// the window between the reservation and this moment there is no child to
/// find, so it records the cancel and leaves the killing to here. Without that
/// second condition a cancel in that window stopped nothing - pr-downloader
/// went on to fetch the whole thing, holding the slot, and only when it
/// finished was the job announced as cancelled.
fn slot_accepts_child(slot: Option<&ActiveJob>, id: &str) -> bool {
    matches!(slot, Some(a) if a.id == id && !a.cancelled)
}

/// Resolve, spawn, and wire up the three threads.
fn spawn_job(app: &tauri::AppHandle, job: &Job, state: &Content2) -> Result<(), StartFailed> {
    use tauri::Emitter;

    let install = install::detect_with(job.root.as_deref().or(state.root.as_deref()))?;
    let exe = find_pr_downloader(&install.root, &job.engine)?;
    let plan = download_plan(&exe, &install.root, &job.items)?;

    // Bare pr-downloader with nothing queued exits 1, so never spawn an empty job.
    if job.items.is_empty() {
        return Err(StartFailed::Failed("nothing to download".into()));
    }

    let mut cmd = std::process::Command::new(&plan.exe);
    cmd.current_dir(&plan.cwd)
        .args(&plan.args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    // Release builds are windows_subsystem="windows"; a console flashing up on
    // every download would be a visible regression.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("could not start {}: {e}", plan.exe.display()))?;

    let tail = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
    if let Some(out) = child.stdout.take() {
        pump(out, app.clone(), job.id.clone(), false, tail.clone());
    }
    if let Some(err) = child.stderr.take() {
        pump(err, app.clone(), job.id.clone(), true, tail.clone());
    }

    if let Ok(mut slot) = state.active.lock() {
        if slot_accepts_child(slot.as_ref(), &job.id) {
            // The reservation start_next made. Fill it in.
            if let Some(a) = slot.as_mut() {
                a.child = Some(child);
            }
        } else {
            // Somebody else's slot, or cancelled while the process was
            // starting: do not leave an orphan running.
            let mut child = child;
            let _ = child.kill();
            return Err(StartFailed::Cancelled);
        }
    }
    let _ = app.emit(CONTENT_EVENT, ContentStatus::Started { id: job.id.clone() });

    // Supervisor. Polls rather than blocking on wait() so that a cancel can take
    // the lock and kill the child.
    let app_w = app.clone();
    let state_w = state.clone();
    let id = job.id.clone();
    let items_w = job.items.clone();
    // The job's own root, so a settings change while it waited cannot send the
    // download and its record to two different places.
    let root_w = job.root.clone().or_else(|| state.root.clone());
    std::thread::spawn(move || {
        /* Waits for the downloader, then hands the job to the fallback without
           letting go of the slot: the fallback writes into the same pool, and
           releasing here let the next queued job start alongside it. */
        let mut cancelled = false;
        let code = loop {
            std::thread::sleep(std::time::Duration::from_millis(120));
            let mut slot = match state_w.active.lock() {
                Ok(s) => s,
                Err(_) => break None,
            };
            let Some(a) = slot.as_mut() else { break None };
            if a.id != id {
                break None; // superseded
            }
            let Some(child) = a.child.as_mut() else {
                // Reserved but not spawned yet, or already reaped.
                continue;
            };
            match child.try_wait() {
                Ok(Some(status)) => {
                    let c = status.code();
                    cancelled = a.cancelled;
                    a.child = None;
                    break c;
                }
                Ok(None) => continue,
                Err(_) => {
                    cancelled = a.cancelled;
                    a.child = None;
                    break None;
                }
            }
        };

        /* A cancel is not a failure, whatever the exit code says. Windows
           reports a killed process as exit 1, which classifies as
           NotFoundOrFailed - so cancelling used to be announced as "could not
           download it" and then send the fallback to fetch the very thing that
           had just been cancelled. */
        let mut outcome = if cancelled { Outcome::Killed } else { classify_exit(code) };
        let mut message = outcome.message();
        let mut log = if matches!(outcome, Outcome::Ok) {
            None
        } else {
            state_w
                .tail_of(&tail)
                .filter(|s: &String| !s.trim().is_empty())
        };

        /* pr-downloader knows rapid and springfiles, and between them they do
           not have recent community maps or any custom mod. Zero-K runs its own
           service that does. Only reached when pr-downloader has actually
           failed, because it is delta-based against the rapid pool and moves
           far less data than pulling a whole archive.

           This is only correct because each job now carries a single item: the
           exit code used to be an OR over the batch, so there was no per-item
           failure to fall back from. See docs/DOWNLOADS-ZK-CONTENT.md. */
        let cancelled_since = || {
            state_w
                .active
                .lock()
                .ok()
                .and_then(|s| s.as_ref().map(|a| a.id == id && a.cancelled))
                .unwrap_or(false)
        };
        if !matches!(outcome, Outcome::Ok | Outcome::Killed) && !cancelled_since() {
            if let Some(item) = items_w.first() {
                match try_zk_content(&app_w, &id, item, root_w.as_deref(), &cancelled_since) {
                    Fallback::Installed(what) => {
                        outcome = Outcome::Ok;
                        message = what;
                        log = None;
                    }
                    Fallback::NotThere => {}
                    Fallback::Failed(why) => {
                        /* Lead with what actually happened. The generic
                           explanation - that custom games and their maps are
                           distributed separately - is true and useless when the
                           real error was a permission or a disk problem, and
                           reading it sent somebody looking on the wrong side of
                           the machine. */
                        message = if why.contains("os error") || why.contains("denied") {
                            why.clone()
                        } else {
                            format!("{} {why}", outcome.message())
                        };
                    }
                }
                /* Asked again on the way out, because the fallback is the long
                   part: a 90 MB archive over HTTP, minutes of it, with no
                   process for cancel to kill. The stop reaches it as a flag, so
                   whatever it managed to say on its way out, a job the player
                   cancelled ended cancelled. */
                if cancelled_since() {
                    outcome = Outcome::Killed;
                    message = outcome.message();
                }
            }
        }

        /* Keep the log whether or not it went well. A download that succeeded
           strangely - no progress, far too fast, a fallback nobody expected -
           is exactly the one worth reading afterwards. */
        if let Ok(mut logs) = state_w.logs.lock() {
            if let Some(text) = state_w.tail_of(&tail) {
                logs.insert(id.clone(), text);
                /* A handful, so a long session does not accumulate megabytes of
                   download chatter. */
                if logs.len() > 12 {
                    let oldest: Vec<String> = logs.keys().take(logs.len() - 12).cloned().collect();
                    for k in oldest {
                        logs.remove(&k);
                    }
                }
            }
        }

        /* Write down what arrived, so the next preflight knows about it
           without waiting for the engine to restart and rescan. This is the
           difference between fetching a map and being able to say you have it. */
        if outcome == Outcome::Ok {
            if let Ok(install) = install::detect_with(root_w.as_deref()) {
                for item in &items_w {
                    archives::remember_downloaded(&install.root, &item.name);
                }
            }
        }

        // Done writing: release the slot, then let the queue move on.
        release_slot(&state_w, &id);

        let _ = app_w.emit(
            CONTENT_EVENT,
            ContentStatus::Finished { id: id.clone(), outcome, message, log },
        );
        start_next(app_w, state_w);
    });

    Ok(())
}

/// The shared halves of [`Content`], cheap to clone into worker threads.
#[derive(Clone)]
struct Content2 {
    active: std::sync::Arc<std::sync::Mutex<Option<ActiveJob>>>,
    queue: std::sync::Arc<std::sync::Mutex<std::collections::VecDeque<Job>>>,
    logs: std::sync::Arc<std::sync::Mutex<std::collections::BTreeMap<String, String>>>,
    root: Option<String>,
}

impl Content2 {
    fn tail_of(&self, tail: &std::sync::Arc<std::sync::Mutex<String>>) -> Option<String> {
        tail.lock().ok().map(|t| t.clone())
    }
}

impl Content {
    fn shared(&self, root: Option<String>) -> Content2 {
        Content2 {
            active: self.active.clone(),
            queue: self.queue.clone(),
            logs: self.logs.clone(),
            root,
        }
    }
}

/// Queue an acquisition. Progress arrives on `zks://content`.
/// What a fetch request should do about work that is already under way.
#[derive(Debug, PartialEq, Eq)]
enum Dedup {
    /// Nothing new: wait on this job instead.
    Existing(String),
    /// Download these; the rest is already covered.
    Fetch(Vec<ContentItem>),
}

/// Decide against both the running job and the queue.
///
/// The running job is the one that matters most and the one that used to be
/// missed: it was popped off the queue to start, so a queue-only check says
/// "not happening" about the download in progress. Joining at the whistle -
/// prefetch queues the map, then the launch asks for it again - then queues a
/// full duplicate run, and the launch waits behind its own second copy.
fn dedup_fetch(
    running: Option<(&str, &[ContentItem])>,
    queued: &std::collections::VecDeque<Job>,
    items: &[ContentItem],
) -> Dedup {
    let same = |a: &ContentItem, b: &ContentItem| a.kind == b.kind && a.name == b.name;
    let covered = |i: &ContentItem| {
        running.map(|(_, r)| r.iter().any(|e| same(e, i))).unwrap_or(false)
            || queued.iter().any(|j| j.items.iter().any(|e| same(e, i)))
    };

    let fresh: Vec<ContentItem> = items.iter().filter(|i| !covered(i)).cloned().collect();
    if !fresh.is_empty() {
        return Dedup::Fetch(fresh);
    }

    /* Everything asked for is already happening, so hand back the id of the job
       doing it rather than a sentinel. The running job is preferred: it is the
       one that will finish first. */
    let from_running = running
        .filter(|(_, r)| r.iter().any(|e| items.iter().any(|i| same(i, e))))
        .map(|(id, _)| id.to_string());
    let existing = from_running.or_else(|| {
        queued
            .iter()
            .find(|j| j.items.iter().any(|e| items.iter().any(|i| same(i, e))))
            .map(|j| j.id.clone())
    });
    match existing {
        Some(id) => Dedup::Existing(id),
        // Nothing covers it and nothing is fresh only if `items` was empty,
        // which the caller has already refused.
        None => Dedup::Fetch(items.to_vec()),
    }
}

#[tauri::command]
pub fn zks_content_fetch(
    app: tauri::AppHandle,
    content: tauri::State<'_, Content>,
    engine: String,
    items: Vec<ContentItem>,
    install_root: Option<String>,
) -> Result<String, String> {
    use tauri::Emitter;

    if items.is_empty() {
        return Err("nothing to download".into());
    }
    for item in &items {
        check_name(&item.name)?;
    }

    // Deduplicate against what is already queued *or running*. Joining two
    // battles on the same map, or a BattleUpdate flapping between maps, must not
    // enqueue the same download twice.
    let id = next_job_id();
    {
        /* Both locks, in the order start_next takes them, so the decision is
           atomic against a job starting underneath it. Holding `active` also
           means the supervisor cannot retire the job between deciding to wait
           on it and returning its id. */
        let active = self_lock(&content.active)?;
        let mut q = self_lock(&content.queue)?;

        let running = active.as_ref().map(|a| (a.id.as_str(), a.items.as_slice()));
        let fresh = match dedup_fetch(running, &q, &items) {
            Dedup::Existing(existing) => return Ok(existing),
            Dedup::Fetch(fresh) => fresh,
        };

        q.push_back(Job {
            id: id.clone(),
            engine,
            items: fresh.clone(),
            root: install_root.clone(),
        });
        let _ = app.emit(CONTENT_EVENT, ContentStatus::Queued { id: id.clone(), items: fresh });
    }

    start_next(app, content.shared(install_root));
    Ok(id)
}

/// What a download printed.
///
/// Kept because the alternative, when something goes wrong, is guessing: a
/// download that stalls, or finishes suspiciously fast, or quietly falls back
/// to the HTTP path, all look the same from the outside. Without an id this
/// returns the most recent, which is almost always the one being asked about.
#[tauri::command]
pub fn zks_content_log(content: tauri::State<'_, Content>, id: Option<String>) -> Result<String, String> {
    let logs = self_lock(&content.logs)?;
    let text = match id {
        Some(id) => logs.get(&id).cloned(),
        None => logs.values().next_back().cloned(),
    };
    Ok(text.unwrap_or_else(|| "Nothing recorded yet.".into()))
}

/// Stop a running job, or drop a queued one.
///
/// pr-downloader content-addresses the pool and writes incrementally, so a kill
/// leaves a partial pool rather than a corrupt archive and the next run resumes.
/// UNVERIFIED against a real download - confirm on first use.
#[tauri::command]
pub fn zks_content_cancel(
    app: tauri::AppHandle,
    content: tauri::State<'_, Content>,
    id: String,
) -> Result<(), String> {
    use tauri::Emitter;

    let was_queued = {
        let mut q = self_lock(&content.queue)?;
        let before = q.len();
        q.retain(|j| j.id != id);
        q.len() != before
    };

    {
        let mut slot = self_lock(&content.active)?;
        if let Some(a) = slot.as_mut() {
            if a.id == id {
                /* Recorded, not inferred. The supervisor reads this rather than
                   the exit code, because Windows reports a killed process as
                   exit 1 and that is also what "not found" looks like. It also
                   stops the fallback, which would otherwise go and download the
                   thing that was just cancelled. */
                a.cancelled = true;
                if let Some(child) = a.child.as_mut() {
                    let _ = child.kill();
                }
            }
        }
    }

    /* A job cancelled while still in the queue has no supervisor to announce
       it, and callers wait on `Finished` before giving up. Without this they
       waited for a job that would never speak again. */
    if was_queued {
        let _ = app.emit(
            CONTENT_EVENT,
            ContentStatus::Finished {
                id,
                outcome: Outcome::Killed,
                message: Outcome::Killed.message(),
                log: None,
            },
        );
    }
    Ok(())
}

fn self_lock<T>(
    m: &std::sync::Arc<std::sync::Mutex<T>>,
) -> Result<std::sync::MutexGuard<'_, T>, String> {
    m.lock().map_err(|_| "content state is poisoned".to_string())
}

/// What a launch would need and what is missing, without downloading anything.
/// Sibling of `zks_launch_preview`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preflight {
    pub install: install::Install,
    pub engine_ok: bool,
    pub engine_error: Option<String>,
    pub downloader: Option<PathBuf>,
    pub downloader_error: Option<String>,
    pub items: Vec<ContentItem>,
    pub writable: bool,
}

#[tauri::command]
pub fn zks_content_preflight(
    engine: String,
    game: Option<String>,
    map: Option<String>,
    install_root: Option<String>,
) -> Result<Preflight, String> {
    let install = install::detect_with(install_root.as_deref())?;

    let engine_error = install::find_engine(&install.root, &engine).err();
    let (downloader, downloader_error) = match find_pr_downloader(&install.root, &engine) {
        Ok(p) => (Some(p), None),
        Err(e) => (None, Some(e)),
    };

    /* What is missing, not what is needed.
       This used to push the game and the map in unconditionally, so
       `items.len() == 0` was never true for a real battle. The caller reads
       that as "nothing is missing", so every player reported UNSYNCED to every
       room forever - which is how Zero-K's `!start` came to announce Shiro
       users as "still downloading the map" in every game they played, and delay
       each start by ten seconds. It also meant a download was queued on every
       join even with everything already installed.

       `archives::installed` reads the engine's own scan, so the names compared
       here are the same ones the server uses. Absence is read as "not known to
       be here" and still results in a download, which is the safe direction:
       at worst something already present is fetched again. */
    let installed = archives::installed(&install.root);
    let mut items = Vec::new();
    if let Some(g) = game.filter(|s| !s.trim().is_empty()) {
        if !installed.has(&g) {
            items.push(ContentItem { kind: ContentKind::Game, name: g });
        }
    }
    if let Some(m) = map.filter(|s| !s.trim().is_empty()) {
        if !installed.has(&m) {
            items.push(ContentItem { kind: ContentKind::Map, name: m });
        }
    }

    // Probe rather than assume. The install root is writable here only because
    // Steam relaxes ACLs on steamapps; a standalone elevated install is not.
    let probe = install.root.join(".shiro-write-probe");
    let writable = std::fs::write(&probe, b"").is_ok();
    let _ = std::fs::remove_file(&probe);

    Ok(Preflight {
        engine_ok: engine_error.is_none(),
        engine_error,
        downloader,
        downloader_error,
        items,
        writable,
        install,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(kind: ContentKind, name: &str) -> ContentItem {
        ContentItem { kind, name: name.into() }
    }

    fn queue_of(jobs: &[(&str, &[ContentItem])]) -> std::collections::VecDeque<Job> {
        jobs.iter()
            .map(|(id, items)| Job {
                id: (*id).into(),
                engine: "2025.06.21".into(),
                items: items.to_vec(),
                root: None,
            })
            .collect()
    }

    // --- the slot ----------------------------------------------------------

    fn state_with(jobs: &[(&str, &[ContentItem])]) -> Content2 {
        Content2 {
            active: Default::default(),
            queue: std::sync::Arc::new(std::sync::Mutex::new(queue_of(jobs))),
            logs: Default::default(),
            root: None,
        }
    }

    fn held_by(state: &Content2) -> Option<String> {
        state.active.lock().unwrap().as_ref().map(|a| a.id.clone())
    }

    fn reservation(id: &str, cancelled: bool) -> ActiveJob {
        ActiveJob { id: id.into(), child: None, items: Vec::new(), cancelled }
    }

    /// `spawn_job` reserves the slot and then has half a dozen ways to return
    /// before there is a supervisor to give it back: no install, no
    /// pr-downloader beside that engine, a spawn the system refused. The cost of
    /// keeping the reservation is not one dead job - the recovery pass finds the
    /// slot taken, concludes something is running, and every download for the
    /// rest of the session sits in the queue behind a job that ended long ago.
    #[test]
    fn a_start_that_fails_hands_the_slot_back() {
        let map = [item(ContentKind::Map, "Comet Catcher Redux")];
        let state = state_with(&[("dl-1", &map)]);

        let mut reported = Vec::new();
        drain_queue(
            &state,
            |_| Err(StartFailed::Failed("pr-downloader.exe is missing".into())),
            |job, why| reported.push((job.id.clone(), why.report())),
        );

        assert_eq!(held_by(&state), None, "the reservation outlived the job");
        assert_eq!(reported.len(), 1);
        assert_eq!(reported[0].1 .0, Outcome::NotFoundOrFailed);
        assert_eq!(reported[0].1 .1, "pr-downloader.exe is missing");
    }

    /// The half that matters to the player: the next download still runs.
    #[test]
    fn a_download_queued_behind_a_failed_start_still_runs() {
        let map = [item(ContentKind::Map, "Barren v3")];
        let game = [item(ContentKind::Game, "zk:stable")];
        let state = state_with(&[("dl-1", &map), ("dl-2", &game)]);

        let mut tried = Vec::new();
        drain_queue(
            &state,
            |job| {
                tried.push(job.id.clone());
                match job.id.as_str() {
                    "dl-1" => Err(StartFailed::Failed("no pr-downloader".into())),
                    _ => Ok(()),
                }
            },
            |_, _| {},
        );

        assert_eq!(tried, ["dl-1", "dl-2"], "the queue stopped moving");
        assert_eq!(held_by(&state).as_deref(), Some("dl-2"));
    }

    /// Two processes writing `pool/` is the thing the slot exists to prevent.
    #[test]
    fn nothing_else_starts_while_a_download_holds_the_slot() {
        let map = [item(ContentKind::Map, "TartarusV7")];
        let state = state_with(&[("dl-1", &map), ("dl-2", &map)]);

        drain_queue(&state, |_| Ok(()), |_, _| {});
        assert_eq!(held_by(&state).as_deref(), Some("dl-1"));
        assert_eq!(state.queue.lock().unwrap().len(), 1, "dl-2 should still be waiting");

        drain_queue(&state, |_| panic!("a second downloader in the same pool"), |_, _| {});
    }

    /// Somebody else's slot is not yours to clear: by then the next job is
    /// already writing to the pool.
    #[test]
    fn releasing_clears_only_your_own_slot() {
        let map = [item(ContentKind::Map, "Barren v3")];
        let state = state_with(&[("dl-1", &map)]);
        drain_queue(&state, |_| Ok(()), |_, _| {});

        release_slot(&state, "dl-9");
        assert_eq!(held_by(&state).as_deref(), Some("dl-1"));
        release_slot(&state, "dl-1");
        assert_eq!(held_by(&state), None);
    }

    /// A cancel arriving in the window between the reservation and the spawn
    /// finds no child to kill, so it records the stop and leaves the killing to
    /// the moment the child appears. Taking the child anyway let pr-downloader
    /// fetch the whole thing after the player had stopped it - holding the slot
    /// throughout, and announced as cancelled only once the download it was
    /// meant to prevent had finished.
    #[test]
    fn a_cancelled_reservation_does_not_take_the_child() {
        assert!(!slot_accepts_child(Some(&reservation("dl-1", true)), "dl-1"));
    }

    #[test]
    fn a_live_reservation_takes_its_own_child_and_nobody_elses() {
        assert!(slot_accepts_child(Some(&reservation("dl-1", false)), "dl-1"));
        assert!(!slot_accepts_child(Some(&reservation("dl-2", false)), "dl-1"));
        assert!(!slot_accepts_child(None, "dl-1"));
    }

    /// Cancelling is not failing. Reported as one, it sent people looking for a
    /// problem they had just caused on purpose.
    #[test]
    fn a_cancel_while_starting_is_reported_as_a_cancel() {
        assert_eq!(
            StartFailed::Cancelled.report(),
            (Outcome::Killed, "Download cancelled.".to_string())
        );
    }

    #[test]
    fn the_job_already_downloading_counts_as_covered() {
        // It was popped off the queue to start, so a queue-only check calls it
        // "not happening" and queues a second copy of the same download - which
        // the launch then waits behind.
        let map = [item(ContentKind::Map, "Comet Catcher Redux")];
        let empty = queue_of(&[]);
        assert_eq!(
            dedup_fetch(Some(("dl-1", &map)), &empty, &map),
            Dedup::Existing("dl-1".into())
        );
    }

    #[test]
    fn a_queued_job_still_counts() {
        let map = [item(ContentKind::Map, "Barren v3")];
        let q = queue_of(&[("dl-7", &map)]);
        assert_eq!(dedup_fetch(None, &q, &map), Dedup::Existing("dl-7".into()));
    }

    #[test]
    fn the_running_job_is_preferred_over_a_queued_one() {
        // It finishes first, so waiting on it is the shorter wait.
        let map = [item(ContentKind::Map, "TartarusV7")];
        let q = queue_of(&[("dl-9", &map)]);
        assert_eq!(
            dedup_fetch(Some(("dl-4", &map)), &q, &map),
            Dedup::Existing("dl-4".into())
        );
    }

    #[test]
    fn only_the_parts_that_are_not_covered_are_fetched() {
        let map = item(ContentKind::Map, "Comet Catcher Redux");
        let game = item(ContentKind::Game, "zk:stable");
        let running = [map.clone()];
        let empty = queue_of(&[]);
        assert_eq!(
            dedup_fetch(Some(("dl-1", &running)), &empty, &[map, game.clone()]),
            Dedup::Fetch(vec![game])
        );
    }

    #[test]
    fn a_different_kind_of_the_same_name_is_not_the_same_thing() {
        let as_map = item(ContentKind::Map, "Titan");
        let as_game = item(ContentKind::Game, "Titan");
        let running = [as_map];
        let empty = queue_of(&[]);
        assert_eq!(
            dedup_fetch(Some(("dl-1", &running)), &empty, &[as_game.clone()]),
            Dedup::Fetch(vec![as_game])
        );
    }

    fn items() -> Vec<ContentItem> {
        vec![
            ContentItem { kind: ContentKind::Game, name: "zk:stable".into() },
            ContentItem { kind: ContentKind::Map, name: "Adamantine Mountain 2".into() },
        ]
    }

    // --- the command line --------------------------------------------------

    #[test]
    fn writepath_comes_first_and_is_the_install_root() {
        let plan = download_plan(
            Path::new("C:/zk/engine/win64/2025.06.21/pr-downloader.exe"),
            Path::new("C:/zk"),
            &items(),
        )
        .unwrap();
        assert_eq!(plan.args[0], OsString::from("--filesystem-writepath"));
        assert_eq!(plan.args[1], OsString::from("C:/zk"));
    }

    #[test]
    fn one_flag_per_item_with_the_right_flag_per_kind() {
        let plan = download_plan(Path::new("pr.exe"), Path::new("C:/zk"), &items()).unwrap();
        let args: Vec<String> = plan.args.iter().map(|a| a.to_string_lossy().into()).collect();
        assert_eq!(
            args,
            vec![
                "--filesystem-writepath", "C:/zk",
                "--download-game", "zk:stable",
                "--download-map", "Adamantine Mountain 2",
            ]
        );
    }

    /// Bare pr-downloader with nothing queued exits 1, so the caller must not
    /// spawn in that case. The plan still builds; it just has no download flags.
    #[test]
    fn no_items_produces_no_download_flags() {
        let plan = download_plan(Path::new("pr.exe"), Path::new("C:/zk"), &[]).unwrap();
        assert_eq!(plan.args.len(), 2);
        assert!(!plan.args.iter().any(|a| a.to_string_lossy().starts_with("--download")));
    }

    #[test]
    fn refuses_names_that_would_forge_a_different_command() {
        let bad = |n: &str| {
            download_plan(
                Path::new("pr.exe"),
                Path::new("C:/zk"),
                &[ContentItem { kind: ContentKind::Map, name: n.into() }],
            )
            .is_err()
        };
        assert!(bad("map\n--download-game"));
        assert!(bad("--download-game"));
        assert!(bad("with\0nul"));
        assert!(bad("   "));
    }

    #[test]
    fn spaces_in_names_are_fine_because_args_are_not_a_shell_string() {
        assert!(download_plan(
            Path::new("pr.exe"),
            Path::new("C:/zk"),
            &[ContentItem { kind: ContentKind::Map, name: "Adamantine Mountain 2".into() }],
        )
        .is_ok());
    }

    // --- output splitting --------------------------------------------------

    /// The trap this whole module is shaped around.
    #[test]
    fn splits_carriage_return_progress() {
        let buf = "[Progress]   2% [=    ] 1/50 \r[Progress]   4% [==   ] 2/50 \r";
        let (parts, rest) = split_chunks(buf);
        assert_eq!(parts.len(), 2);
        assert_eq!(rest, "");
        assert!(parts[0].contains("2%"));
        assert!(parts[1].contains("4%"));
    }

    #[test]
    fn carries_a_partial_chunk_over_instead_of_dropping_it() {
        let (parts, rest) = split_chunks("[Info] a():done\n[Progress]   5% [=] 3/6");
        assert_eq!(parts.len(), 1);
        assert_eq!(rest, "[Progress]   5% [=] 3/6");
    }

    #[test]
    fn a_buffer_with_no_terminator_yields_nothing_yet() {
        let (parts, rest) = split_chunks("[Progress]  1%");
        assert!(parts.is_empty());
        assert_eq!(rest, "[Progress]  1%");
    }

    #[test]
    fn handles_both_terminators_together() {
        let (parts, _) = split_chunks("a\r\nb\n");
        assert_eq!(parts, vec!["a", "b"]);
    }

    // --- line parsing ------------------------------------------------------

    #[test]
    fn parses_a_real_progress_line() {
        assert_eq!(
            parse_line("[Progress]   2% [=                             ] 1/50 "),
            Line::Progress { percent: 2, done: 1, total: 50 }
        );
    }

    #[test]
    fn parses_a_real_info_line_and_drops_the_source_prefix() {
        let s = "[Info] /build/src/tools/pr-downloader/src/FileSystem/FileSystem.cpp:203:\
                 setWritePath():Using filesystem-writepath: C:/zk";
        assert_eq!(
            parse_line(s),
            Line::Log { level: Level::Info, message: "Using filesystem-writepath: C:/zk".into() }
        );
    }

    #[test]
    fn parses_a_real_error_line() {
        let s = "[Error] /build/src/tools/pr-downloader/src/main.cpp:187:main():\
                 Error occurred while downloading: 1";
        assert_eq!(
            parse_line(s),
            Line::Log { level: Level::Error, message: "Error occurred while downloading: 1".into() }
        );
    }

    #[test]
    fn a_progress_line_it_cannot_read_is_not_mistaken_for_progress() {
        match parse_line("[Progress] garbled") {
            Line::Other(_) => {}
            other => panic!("expected Other, got {other:?}"),
        }
    }

    #[test]
    fn unknown_output_survives_as_other() {
        assert_eq!(parse_line("something else"), Line::Other("something else".into()));
    }

    // --- against real captured output ---------------------------------------
    //
    // Captured from the shipped pr-downloader.exe on 2026-08-18:
    //   pr-downloader --filesystem-writepath <ZK> --download-game "zk:stable"
    // with the content already present (exit 0, 1778 bytes of stdout).
    //
    // The bytes matter: log lines end CRLF, progress lines end with a BARE CR.
    // 14 carriage returns against 11 line feeds in that capture.
    const REAL_STDOUT: &str = concat!(
        "pr-downloader tarball (windows64)\r\n",
        "[Info] /build/src/tools/pr-downloader/src/FileSystem/FileSystem.cpp:203:",
        "setWritePath():Using filesystem-writepath: C:\\Program Files (x86)\\Steam\r\n",
        "[Progress] 100% [==============================] 1/1 \r",
        "[Progress]   0% [                              ] 0/1 \r",
        "[Progress] 100% [==============================] 1/1 \r",
        "[Info] /build/src/tools/pr-downloader/src/pr-downloader.cpp:191:",
        "DownloadSetConfig():Free disk space: 421559 MB\r\n",
    );

    #[test]
    fn real_output_splits_into_clean_chunks() {
        let (parts, rest) = split_chunks(REAL_STDOUT);
        assert_eq!(rest, "", "everything was terminated, nothing should carry over");
        let progress: Vec<&&str> =
            parts.iter().filter(|p| p.starts_with("[Progress]")).collect();
        assert_eq!(progress.len(), 3, "got {parts:?}");
    }

    /// The whole reason `split_chunks` exists. A newline-only reader merges a
    /// progress line with whatever follows it, so this must NOT be how we read.
    #[test]
    fn a_newline_only_reader_would_have_merged_them() {
        let merged = REAL_STDOUT
            .split('\n')
            .filter(|l| l.contains("[Progress]"))
            .count();
        assert_eq!(merged, 1, "all three progress updates collapse into one line");
    }

    #[test]
    fn parses_the_real_progress_lines_verbatim() {
        assert_eq!(
            parse_line("[Progress] 100% [==============================] 1/1 "),
            Line::Progress { percent: 100, done: 1, total: 1 }
        );
        assert_eq!(
            parse_line("[Progress]   0% [                              ] 0/1 "),
            Line::Progress { percent: 0, done: 0, total: 1 }
        );
    }

    /// From a real 2.5 MB map download on 2026-08-18:
    ///   pr-downloader --filesystem-writepath <ZK> --download-map "Red Comet"
    /// exit 0, 13 progress updates, red_comet.sd7 landed.
    ///
    /// The counters are BYTES here, where a rapid repo search reports FILE
    /// COUNTS (26/50). Same format, wildly different magnitudes — so nothing may
    /// assume a small total, and percent has to come from done/total.
    #[test]
    fn parses_byte_counters_from_a_real_transfer() {
        assert_eq!(
            parse_line("[Progress]   0% [=                             ] 7981/2656510 "),
            Line::Progress { percent: 0, done: 7981, total: 2_656_510 }
        );
        assert_eq!(
            parse_line("[Progress]  70% [=====================         ] 1847981/2656510 "),
            Line::Progress { percent: 70, done: 1_847_981, total: 2_656_510 }
        );
        assert_eq!(
            parse_line("[Progress] 100% [==============================] 2656510/2656510 "),
            Line::Progress { percent: 100, done: 2_656_510, total: 2_656_510 }
        );
    }

    #[test]
    fn the_version_banner_is_not_mistaken_for_a_log_line() {
        assert_eq!(
            parse_line("pr-downloader tarball (windows64)"),
            Line::Other("pr-downloader tarball (windows64)".into())
        );
    }

    // --- exit codes --------------------------------------------------------

    #[test]
    fn classifies_the_documented_exit_codes() {
        assert_eq!(classify_exit(Some(0)), Outcome::Ok);
        assert_eq!(classify_exit(Some(1)), Outcome::NotFoundOrFailed);
        assert_eq!(classify_exit(Some(2)), Outcome::Unfinished);
        assert_eq!(classify_exit(Some(5)), Outcome::NoDiskSpace);
        assert_eq!(classify_exit(Some(6)), Outcome::DependsFailed);
        assert_eq!(classify_exit(None), Outcome::Killed);
        assert_eq!(classify_exit(Some(42)), Outcome::Unknown(42));
    }

    /// Exit 1 must not be reported as "not found" on its own — the shipped
    /// binary does not emit the line upstream logs, so the caller has to
    /// re-check presence. The wording reflects that uncertainty.
    #[test]
    fn the_ambiguous_failure_does_not_claim_to_know_why() {
        let m = Outcome::NotFoundOrFailed.message();
        assert!(m.contains("may not exist"), "{m}");
    }
}
