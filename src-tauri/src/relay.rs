//! Thin TCP relay for the ZkLobbyServer protocol.
//!
//! Deliberately dumb: it owns the socket lifecycle and nothing else. It does not
//! parse messages or hold lobby state - that all lives in TypeScript. See
//! docs/ARCHITECTURE.md section 4 for why.
//!
//! Wire format is `CommandName {json}\n`, UTF-8, newline delimited.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use base64::Engine as _;
use serde::Serialize;
use socket2::{SockRef, TcpKeepalive};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;

/// One decoded line from the server, forwarded verbatim.
const LINE_EVENT: &str = "zks://line";
/// Connection lifecycle transitions.
const STATUS_EVENT: &str = "zks://status";

/// Keepalive is done at the TCP layer, not the protocol layer.
///
/// There is deliberately no application-level ping. `Ping` is NOT a registered
/// command on ZkLobbyServer - sending it makes the server throw
/// `Invalid json type ... : Ping` on every beat, which lands in their logs
/// against the user's account and burns the connection's throttle budget
/// (ClientConnection.OnCommandReceived calls Throttle(line.Length) on the way
/// through). Chobby's `Interface:Ping` exists but is fenced behind a
/// `REVERSE_COMPAT` flag that is off; the line was copied without the fence.
///
/// The server has no idle timeout, so nothing needs to be sent at all. These
/// only make the OS notice a socket that died silently - a NAT or router
/// dropping the mapping produces no FIN, so without them a dead connection
/// looks healthy until the next write.
const KEEPALIVE_IDLE: Duration = Duration::from_secs(60);
const KEEPALIVE_INTERVAL: Duration = Duration::from_secs(15);

/// A connect that never answers must not hang the caller.
///
/// The OS gives up on an unanswered SYN after a minute or more, and the login
/// screen sits on "Connecting" for all of it. A server that is up answers in
/// milliseconds; one that does not is worth reporting quickly, because the
/// reconnect above this already knows how to wait and try again.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

/// Which connection a reader belongs to.
///
/// Without it a reader that outlives its own connection clears whatever is in
/// the slot on its way out - including a healthy connection that replaced it.
static CONN_SEQ: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Status {
    Connecting,
    Connected,
    Disconnected { reason: String },
}

struct Conn {
    id: u64,
    tx: mpsc::UnboundedSender<String>,
    tasks: Vec<JoinHandle<()>>,
}

impl Conn {
    fn shutdown(self) {
        // Aborting the reader drops its half of the socket, which closes it.
        for t in self.tasks {
            t.abort();
        }
        drop(self.tx);
    }
}

#[derive(Default)]
pub struct Relay {
    conn: Arc<Mutex<Option<Conn>>>,
    /// One connect at a time, start to finish.
    ///
    /// The lock on `conn` is dropped while connecting, so two overlapping
    /// calls used to interleave: the slower one installed itself last and
    /// clobbered the faster one's slot, leaving a live, logged-in socket with
    /// nothing pointing at it - still reading lines, still emitting them, and
    /// clearing the healthy connection when it eventually died.
    connecting: Arc<Mutex<()>>,
}

#[tauri::command]
pub async fn zks_connect(
    app: AppHandle,
    relay: State<'_, Relay>,
    host: String,
    port: u16,
) -> Result<(), String> {
    // Held for the whole call, connect included, so two of these cannot
    // interleave and leave the loser's socket running unattended.
    let _turn = relay.connecting.lock().await;
    let id = CONN_SEQ.fetch_add(1, Ordering::SeqCst);

    // Never leave a previous socket running underneath a new one.
    if let Some(prev) = relay.conn.lock().await.take() {
        prev.shutdown();
    }

    app.emit(STATUS_EVENT, Status::Connecting).ok();

    let stream = tokio::time::timeout(CONNECT_TIMEOUT, TcpStream::connect((host.as_str(), port)))
        .await
        .map_err(|_| format!("connect {host}:{port} timed out"))?
        .map_err(|e| format!("connect {host}:{port} failed: {e}"))?;
    stream.set_nodelay(true).ok();

    // TCP-level keepalive. See the KEEPALIVE_* docs above for why this is here
    // and not an application-level ping. Best effort: an OS that refuses the
    // option is not a reason to fail the connection.
    {
        let keepalive = TcpKeepalive::new()
            .with_time(KEEPALIVE_IDLE)
            .with_interval(KEEPALIVE_INTERVAL);
        if let Err(e) = SockRef::from(&stream).set_tcp_keepalive(&keepalive) {
            eprintln!("could not enable TCP keepalive: {e}");
        }
    }

    let (read_half, mut write_half) = stream.into_split();
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    let writer = tokio::spawn(async move {
        while let Some(line) = rx.recv().await {
            if write_half.write_all(line.as_bytes()).await.is_err() {
                break;
            }
        }
    });

    let slot = relay.conn.clone();
    let reader_app = app.clone();

    /* Taken before the reader exists and held until `Connected` is out, which
       is what makes installing a connection and announcing it one step.
       A server that closes the moment it accepts hands the reader an EOF to
       report while this call is still between spawning it and installing what
       it spawned - and the reader's own exit goes through this same lock. Left
       to race, the reader either finds the slot still empty, reads that as a
       connection that was superseded and leaves without a word, or announces
       the drop before the connect announces the connection. Either way the UI
       is left believing it holds a socket that is already gone, with no
       `Disconnected` to reconnect from and a login sitting on the spinner. */
    let mut slot_guard = relay.conn.lock().await;

    let reader = tokio::spawn(async move {
        let mut lines = BufReader::new(read_half).lines();
        let reason = loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    if line.trim().is_empty() {
                        continue;
                    }
                    reader_app.emit(LINE_EVENT, line).ok();
                }
                Ok(None) => break "closed by server".to_string(),
                Err(e) => break format!("read error: {e}"),
            }
        };
        /* Clear the slot so the UI cannot keep writing into a dead socket -
           but only if the slot is still ours. A superseded connection dying is
           not news, and announcing it would tell the UI it had disconnected
           while the connection it is actually using is fine. */
        {
            let mut current = slot.lock().await;
            if current.as_ref().map(|c| c.id) != Some(id) {
                return;
            }
            *current = None;
        }
        reader_app
            .emit(STATUS_EVENT, Status::Disconnected { reason })
            .ok();
    });

    *slot_guard = Some(Conn {
        id,
        tx,
        tasks: vec![reader, writer],
    });

    // Still holding the slot, so the reader cannot get in front of this.
    app.emit(STATUS_EVENT, Status::Connected).ok();
    Ok(())
}

#[tauri::command]
pub async fn zks_send(relay: State<'_, Relay>, line: String) -> Result<(), String> {
    let guard = relay.conn.lock().await;
    let conn = guard.as_ref().ok_or("not connected")?;
    let mut line = line;
    if !line.ends_with('\n') {
        line.push('\n');
    }
    conn.tx.send(line).map_err(|_| "writer closed".to_string())
}

#[tauri::command]
pub async fn zks_disconnect(relay: State<'_, Relay>) -> Result<(), String> {
    if let Some(conn) = relay.conn.lock().await.take() {
        conn.shutdown();
    }
    Ok(())
}

/// `Login.PasswordHash` is base64 of the RAW MD5 digest bytes, not of the hex
/// string. Verified against the live server - see docs/ARCHITECTURE.md section 5.
#[tauri::command]
pub fn zks_password_hash(password: String) -> String {
    let digest = md5::compute(password.as_bytes());
    base64::engine::general_purpose::STANDARD.encode(digest.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn password_hash_is_base64_of_raw_digest() {
        // Known-good vector: md5("") = d41d8cd98f00b204e9800998ecf8427e
        // raw bytes base64 -> 1B2M2Y8AsgTpgAmY7PhCfg==
        assert_eq!(zks_password_hash(String::new()), "1B2M2Y8AsgTpgAmY7PhCfg==");
    }
}
