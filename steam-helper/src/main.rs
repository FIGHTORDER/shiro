//! Mints a Zero-K Steam auth ticket and prints it, then exits.
//!
//! Run by `shiro`'s `steam.rs` when somebody chooses to sign in with Steam.
//! Writes exactly one line to stdout and nothing else:
//!
//! ```text
//! ok <hex>
//! err <sentence>
//! ```
//!
//! ## What the ticket is
//!
//! `GetAuthSessionTicket`, hex encoded, which is precisely what Zero-K's own
//! client sends as `SteamAuthToken` (`ChobbyLauncher/SteamClient.cs`). The
//! lobby server hands it to Steam's `ISteamUserAuth/AuthenticateUserTicket`
//! along with Zero-K's app id and its own web API key, gets a `steamid` back,
//! and looks up the account. Nothing here talks to Steam's web API and nothing
//! here needs a key.
//!
//! ## Why it initialises as app 334920
//!
//! A ticket is only valid for the app it was minted for, and the server checks
//! it against Zero-K's id. So this has to introduce itself to Steam as Zero-K.
//! That is the same thing any third-party client would have to do, and it is
//! the part of this worth asking the Zero-K developers about rather than
//! assuming - which is why it lives in a process that exists for one second
//! instead of for as long as the launcher is open.
//!
//! Ownership is what Steam checks, not installation: an account that has ever
//! added Zero-K can mint a ticket without the game on disk.
//!
//! ## Handling
//!
//! The ticket is a credential. It goes to stdout, is read once by the parent,
//! and is never written to a log or a file. It is single use and expires on
//! its own in minutes, but that is a reason not to be careless rather than a
//! reason to be.

use std::io::Write;

use steamworks::networking_types::NetworkingIdentity;
use steamworks::Client;

/// Zero-K on Steam. The ticket is worthless for any other app.
const ZERO_K_APP_ID: u32 = 334920;

/// How long to pump callbacks waiting for the ticket to become usable.
///
/// `GetAuthSessionTicket` hands back its bytes immediately but they are not
/// valid until Steam answers with `GetAuthSessionTicketResponse`, and that
/// answer only arrives while callbacks are being run. Sending too early gets
/// the ticket rejected, which surfaces to a player as an unexplained failed
/// login, so this waits.
const CALLBACK_WAIT: std::time::Duration = std::time::Duration::from_millis(2500);
const CALLBACK_STEP: std::time::Duration = std::time::Duration::from_millis(20);

fn main() {
    let line = match ticket() {
        Ok(hex) => format!("ok {hex}"),
        Err(why) => format!("err {why}"),
    };
    let mut out = std::io::stdout();
    let _ = writeln!(out, "{line}");
    let _ = out.flush();
    if line.starts_with("err ") {
        std::process::exit(1);
    }
}

fn ticket() -> Result<String, String> {
    /* Steam not running, or an account that does not own Zero-K, both land
       here. Neither is an error worth alarming anybody about: it means this
       machine cannot sign in with Steam, and the password still can. */
    let client = Client::init_app(ZERO_K_APP_ID).map_err(|e| {
        format!("Steam is not available ({e}). Is Steam running, and is Zero-K in your library?")
    })?;

    let user = client.user();
    if user.steam_id().raw() == 0 {
        return Err("Steam did not report an account.".into());
    }

    let (_handle, bytes) = user.authentication_session_ticket(NetworkingIdentity::new());
    if bytes.is_empty() {
        return Err("Steam returned an empty ticket.".into());
    }

    let mut waited = std::time::Duration::ZERO;
    while waited < CALLBACK_WAIT {
        client.run_callbacks();
        std::thread::sleep(CALLBACK_STEP);
        waited += CALLBACK_STEP;
    }

    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
