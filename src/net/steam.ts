import { invoke } from "@tauri-apps/api/core";

import { inTauri } from "./connection.ts";

/**
 * Signing in with Steam.
 *
 * Zero-K's server already does the hard half. `Login` carries a
 * `SteamAuthToken`; the server hands it to Steam's
 * `ISteamUserAuth/AuthenticateUserTicket` with its own web API key and looks
 * the account up by the `steamid` that comes back. Shiro needs no key and
 * never talks to Steam's web API.
 *
 * All this does is fetch a ticket from `src-tauri/src/steam.rs`, which runs a
 * small separate program to get one. That module explains why it is separate.
 *
 * ## The two flows, and why there are two
 *
 * A ticket only signs you in if the Steam account is already linked to a
 * Zero-K account. From `LoginChecker`:
 *
 * - **Linked:** send the ticket with no name and no password. The server finds
 *   the account by `SteamID` and you are in.
 * - **Not linked:** the server answers `SteamNotLinkedAndLoginMissing`, whose
 *   own text is "send ZK login or register". So Shiro asks for the password
 *   once and sends it *with* the ticket, and the server links the two on the
 *   spot. Every sign-in after that is the first flow.
 *
 * ## The ticket is a credential
 *
 * Single use, valid for minutes, and enough to sign in as that player. Fetch
 * it at the moment of use, hand it straight to the login, and never store it,
 * log it or put it in a URL.
 */

/**
 * Whether to offer Steam sign-in at all.
 *
 * Answers from the presence of the helper on disk. It deliberately does not
 * contact Steam: doing that announces Zero-K as running, and doing it on every
 * launch to answer a question nobody asked would show a player as in-game for
 * no reason.
 */
export function steamAvailable(): Promise<boolean> {
  if (!inTauri()) return Promise.resolve(false);
  return invoke<boolean>("zks_steam_available").catch(() => false);
}

/**
 * A Steam auth ticket for Zero-K, hex encoded.
 *
 * Rejects with a sentence worth showing to a player: Steam not running, Zero-K
 * not in their library, or the helper unavailable.
 */
export function steamTicket(): Promise<string> {
  if (!inTauri()) {
    return Promise.reject(new Error("Steam sign-in needs the desktop app."));
  }
  return invoke<string>("zks_steam_ticket");
}
