/**
 * Session lifecycle: wire the relay to the store, run the login handshake,
 * batch the inbound flood.
 */
import {
  connect, disconnect, onLine, onStatus, passwordHash, sendLine, LIVE,
} from "./connection";
import { parseLine, serialize } from "../protocol/wire";
import type { CommandName, Message, MessageMap } from "../protocol/registry";
import type * as T from "../protocol/types";
import type { Login_ClientTypes, SayPlace } from "../protocol/enums";

/**
 * `Login_ClientTypes.ZeroKLobby` restated as a literal, so this module does not
 * import a runtime enum. Checked against the generated enum at compile time -
 * the same pattern the stores use, and the reason these payloads no longer need
 * an `as never` to get past the typed registry.
 */
const CLIENT_TYPE_ZKLOBBY: Login_ClientTypes.ZeroKLobby = 1;
import { useLobby, type ConnectionState } from "../store/lobby";
import { describeRegisterFailure } from "../store/adapters";
import { useRoom } from "../store/room";
import { fanout } from "../store/slices";

export const LOBBY_VERSION = "NewLobby/Shiro 0.1.0";

/**
 * Reconnect backoff, in milliseconds, then every 30s.
 *
 * Deliberately not aggressive. A reconnect loop hammering a production game
 * server is how a new client gets its IP banned, and the server's own
 * BannedTooManyConnectionAttempts exists for exactly that.
 */
const BACKOFF = [2000, 4000, 8000, 16000, 30000];

let unlisten: Array<() => void> = [];
let queue: Message[] = [];
let frame = 0;
let timer = 0;

/** Everything needed to re-establish the session without asking again. */
let session: { creds: Credentials; hash: string; host: string; port: number } | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let attempt = 0;
/** Has this session logged in before? A second time is a reconnect. */
let loggedInBefore = false;

/** Coalesce inbound messages into one store write per animation frame. */
/* Batching is on the frame, with a timer behind it.

   A lobby's normal state during a match is minimised, and WebView2 and
   WebKitGTK both suspend requestAnimationFrame for a hidden window - so a
   frame-only batcher stops processing the protocol at exactly the moment the
   game is running. Ready checks expire unanswered, ConnectSpring is not acted
   on, kick notices go unseen, and the queue grows until the window is looked
   at again.

   Login survived that, which is what kept it hidden: the Welcome -> Login
   reply is sent straight from the line handler, above, and never waits for a
   batch.

   Whichever of the two fires first flushes and cancels the other, so a visible
   window still batches per frame and pays nothing for the fallback. */
const FLUSH_MS = 100;

function flush() {
  if (frame) { cancelAnimationFrame(frame); frame = 0; }
  if (timer) { clearTimeout(timer); timer = 0; }
  const batch = queue;
  queue = [];
  if (!batch.length) return;
  useLobby.getState().applyBatch(batch);
  fanout(batch);
}

function enqueue(m: Message) {
  queue.push(m);
  if (frame || timer) return;
  frame = requestAnimationFrame(flush);
  timer = setTimeout(flush, FLUSH_MS) as unknown as number;
}

/**
 * Send any protocol command. Typed against the generated registry, so a wrong
 * field name or a missing required field is a compile error.
 *
 *   send("JoinChannel", { ChannelName: "zk" });
 */
export function send<K extends CommandName>(cmd: K, data: MessageMap[K]): Promise<void> {
  return sendLine(serialize(cmd, data));
}

export interface Credentials {
  name: string;
  password: string;
}

/**
 * This installation's id for `Login.InstallID`.
 *
 * Lazily imported like the other store reaches, so this module's import graph
 * stays free of anything that needs a browser.
 */
async function installIdentity(): Promise<string> {
  try {
    const { useSettings } = await import("../store/settings");
    return useSettings.getState().ensureInstallId();
  } catch {
    return "";
  }
}

function cancelRetry(): void {
  if (retry) { clearTimeout(retry); retry = null; }
}

/**
 * Re-establish a session that dropped underneath us.
 *
 * Only for a session that got as far as being logged in. A *rejected* login is
 * never retried, because LoginChecker.LogIpFailure() fires on a bad name and
 * repeated failures earn BannedTooManyConnectionAttempts.
 *
 * A drop *before* any login is the attempt failing rather than a session
 * dropping, and this used to retry those too - which nobody could see, because
 * `login()` had already handed the failure back and the login screen was up
 * again. The dialling carried on behind it, and a server that came back logged
 * the player in with nothing on screen saying so. It only stayed hidden while
 * the relay could lose the disconnect entirely; see src-tauri/src/relay.rs.
 */
function scheduleReconnect(): void {
  if (!session || !loggedInBefore || retry) return;
  const delay = BACKOFF[Math.min(attempt, BACKOFF.length - 1)];
  attempt += 1;
  useLobby.getState().setReconnect(attempt);
  retry = setTimeout(() => {
    retry = null;
    if (!session) return;
    reconnectState();
    void connect(session.host, session.port).catch(() => scheduleReconnect());
  }, delay);
}

/**
 * Drop everything the server is about to re-send. A reconnect replays the full
 * directory, and we were not in a battle while disconnected.
 */
function reconnectState(): void {
  useLobby.getState().resetDirectory();
  useRoom.getState().clear();
}

/** Retry immediately - the "Retry now" affordance in the status bar. */
export function reconnectNow(): void {
  if (!session) return;
  cancelRetry();
  attempt = 0;
  useLobby.getState().setReconnect(0);
  reconnectState();
  void connect(session.host, session.port).catch(() => scheduleReconnect());
}

/**
 * Connect and log in. Resolves once the server has accepted or rejected the
 * login; the caller reads the outcome from the store's connection state.
 *
 * Never auto-retries a rejected login: LoginChecker.LogIpFailure() fires on a
 * bad name and repeated failures earn BannedTooManyConnectionAttempts.
 */
export async function login(
  creds: Credentials,
  host: string = LIVE.host,
  port: number = LIVE.port,
): Promise<ConnectionState> {
  await teardown();

  const store = useLobby.getState();
  store.reset();

  const hash = await passwordHash(creds.password);
  const installId = await installIdentity();
  session = { creds, hash, host, port };
  attempt = 0;

  /* Resolves with the state it settled on, not just "it settled". Re-reading
     the store afterwards is a race: a refusal is followed by a drop, and the
     caller would report whichever arrived last rather than the one that
     decided the outcome. */
  const settled = new Promise<ConnectionState>(resolve => {
    const stop = useLobby.subscribe(s => {
      const k = s.connection.kind;
      if (k === "online" || k === "rejected" || k === "disconnected") {
        stop();
        resolve(s.connection);
      }
    });
  });

  unlisten.push(await onStatus(s => {
    useLobby.getState().applyRelayStatus(s);
    // A drop after a good login is a transport problem, not a credentials
    // problem, so it is ours to fix without bothering anyone.
    if (s.kind === "disconnected") scheduleReconnect();
    /* A socket that opened is not yet a session that works, so the backoff is
       not reset here: a server that accepts TCP and then drops us would have
       reset it every time and retried at the first step for ever. What does
       happen here is cancelling any retry still pending - we are connected,
       and letting that timer fire would tear this connection down to make
       another one. */
    if (s.kind === "connected") cancelRetry();
  }));
  unlisten.push(await onLine(line => {
    const m = parseLine(line);
    if (!m) return;

    // An admin threw us off. Retrying would be pointless and rude, so the
    // session is dropped before the disconnect that follows can schedule one.
    if (m.cmd === "KickFromServer") {
      session = null;
      cancelRetry();
    }

    /* A refused login, dropped for the same reason and more urgently.
       The server closes the connection after refusing, which reaches
       `onStatus` as a plain disconnect - and `scheduleReconnect` only asks
       whether there is a session, not whether the credentials were any good.
       So the reconnect fired, `Welcome` arrived, and the handler below sent
       the same bad hash again, on a backoff, indefinitely.

       That is the LoginChecker.LogIpFailure spiral this file's comments
       promise never to enter: a mistyped password could earn the player's IP
       a server-side ban while they sat looking at the login screen. */
    if (m.cmd === "LoginResponse" && (m.data as { ResultCode?: number }).ResultCode !== 0) {
      session = null;
      cancelRetry();
      /* And say so now rather than on the next frame. Inbound messages are
         batched, but the drop that follows a refusal arrives on the status
         channel and is applied immediately - so the batch that would have
         recorded "rejected" landed after "disconnected" had already overwritten
         it, and the player was told they had lost the connection instead of
         being told their password was wrong. */
      const d = m.data as T.LoginResponse;
      useLobby.getState().setConnection({
        kind: "rejected",
        code: d.ResultCode,
        message: d.BanReason ?? "",
      });
    }

    /* A login the server accepted is what "working" means, and the only thing
       the backoff should count from. */
    if (m.cmd === "LoginResponse" && (m.data as { ResultCode?: number }).ResultCode === 0) {
      attempt = 0;
      useLobby.getState().setReconnect(0);
      /* Second time on this session means we dropped and came back. The server
         re-joins the default channels itself but knows nothing about the ones
         this player joined by hand. */
      if (loggedInBefore) {
        void import("../store/chat").then(c => c.useChat.getState().rejoinChannels());
      }
      loggedInBefore = true;
    }

    // The server sends Welcome unprompted on connect; that is our cue to log in.
    if (m.cmd === "Welcome") {
      useLobby.getState().setConnection({ kind: "loggingIn" });
      void sendLine(serialize("Login", {
        Name: creds.name,
        PasswordHash: hash,
        UserID: 0,
        InstallID: installId,
        ClientType: CLIENT_TYPE_ZKLOBBY,
        LobbyVersion: LOBBY_VERSION,
      }));
    }
    enqueue(m);
  }));

  try {
    await connect(host, port);
  } catch (e) {
    /* A dial that never completes is reported by the command failing, and the
       relay has already said `connecting` by then - so without this the store
       sits on `connecting` for ever and the subscription above is never taken
       off. The attempt is over; the store has to be told, the same as it would
       be for a socket that opened and then died. */
    useLobby.getState().setConnection({
      kind: "disconnected",
      reason: String((e as { message?: string })?.message ?? e),
    });
    throw e;
  }
  return settled;
}

/**
 * Create an account, then log into it.
 *
 * Registration runs on its own connection with its own listener: the normal
 * session sends `Login` the moment `Welcome` arrives, which is exactly wrong
 * for an account that does not exist yet.
 *
 * Rejections are final. The server counts failed attempts by IP and bans repeat
 * offenders, so nothing here retries.
 */
export async function register(
  creds: Credentials,
  email?: string,
  host: string = LIVE.host,
  port: number = LIVE.port,
): Promise<void> {
  await teardown();
  const hash = await passwordHash(creds.password);
  const installId = await installIdentity();

  /* Attached before connecting, and *awaited*. `Welcome` arrives the moment the
     socket opens, and a listener that is still a pending promise when it does
     misses it - the registration then waits for a reply to a command it never
     sent, until the connection drops. */
  const listeners: Array<() => void> = [];
  let settle: (err?: Error) => void = () => {};
  const outcome = new Promise<void>((resolve, reject) => {
    settle = err => (err ? reject(err) : resolve());
  });

  try {
    listeners.push(await onLine(line => {
      const m = parseLine(line);
      if (!m) return;
      if (m.cmd === "Welcome") {
        void sendLine(serialize("Register", {
          Name: creds.name,
          PasswordHash: hash,
          Email: email,
          UserID: 0,
          InstallID: installId,
        }));
      }
      if (m.cmd === "RegisterResponse") {
        const d = m.data as { ResultCode: number; BanReason?: string };
        settle(d.ResultCode === 0
          ? undefined
          : new Error(describeRegisterFailure(d.ResultCode, d.BanReason)));
      }
    }));
    listeners.push(await onStatus(s => {
      if (s.kind === "disconnected") settle(new Error(`Lost connection: ${s.reason}`));
    }));

    await connect(host, port);
    await outcome;
  } finally {
    /* However this ended - registered, refused, dropped, or the connect itself
       failing before either listener could matter - these do not survive it.
       They used to: a failed connect left them attached, and the next healthy
       login's own disconnect then reached this handler and tore it down. */
    for (const off of listeners) off();
    await disconnect().catch(() => {});
  }

  await login(creds, host, port);
}

export async function teardown(): Promise<void> {
  // Drop the session first: the disconnect this causes must not be retried.
  session = null;
  cancelRetry();
  attempt = 0;
  loggedInBefore = false;
  for (const fn of unlisten) fn();
  unlisten = [];
  // Both halves of the batcher. Cancelling only the frame left the fallback
  // timer to fire into a torn-down session - harmless while `flush` no-ops on
  // an empty queue, and exactly the asymmetry that stops being harmless the
  // day flush does something else.
  if (frame) { cancelAnimationFrame(frame); frame = 0; }
  if (timer) { clearTimeout(timer); timer = 0; }
  queue = [];
  await disconnect().catch(() => {});
}

export function say(text: string, place: SayPlace, target?: string): Promise<void> {
  return sendLine(serialize("Say", {
    Place: place, Target: target, Text: text, IsEmote: false, Ring: false,
  }));
}
