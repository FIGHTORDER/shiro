import React from "react";
import { Dialog, Button, Meter } from "./ds/shiro.js";
import D from "./data.js";

import ErrorBoundary from "./ErrorBoundary.jsx";
import AppShell from "./screens/AppShell.jsx";
import LoginScreen from "./screens/LoginScreen.jsx";
import BattleListScreen from "./screens/BattleListScreen.jsx";
import BattleRoomScreen from "./screens/BattleRoomScreen.jsx";
import { canEdit as canEditOptions } from "./net/modOptions.ts";
import { useWebProfile } from "./hooks/useWebProfile.js";
import ChatScreen from "./screens/ChatScreen.jsx";
import QueueScreen from "./screens/QueueScreen.jsx";
import DebriefingScreen from "./screens/DebriefingScreen.jsx";
import FriendsScreen from "./screens/FriendsScreen.jsx";
import ProfileScreen from "./screens/ProfileScreen.jsx";
import AppsScreen from "./screens/AppsScreen.jsx";
import SettingsScreen from "./screens/SettingsScreen.jsx";
import DownloadsScreen from "./screens/DownloadsScreen.jsx";
import HostBattleDialog from "./screens/HostBattleDialog.jsx";
import ReportDialog from "./screens/ReportDialog.jsx";
import MapsScreen from "./screens/MapsScreen.jsx";
import { mapCatalogue } from "./net/zkcatalogue.ts";
import AddAiDialog from "./screens/AddAiDialog.jsx";
import ModOptionsDialog from "./screens/ModOptionsDialog.jsx";
import JoinPasswordDialog from "./screens/JoinPasswordDialog.jsx";
import RegisterDialog from "./screens/RegisterDialog.jsx";
import FirstRunInstallDialog from "./screens/FirstRunInstallDialog.jsx";
import LoadingDialog from "./screens/LoadingDialog.jsx";

import { inTauri } from "./net/connection";
import { login, register, teardown, send, say, reconnectNow } from "./net/session";
import { useLobby } from "./store/lobby";
import { useRoom } from "./store/room";
import { useContent, prefetchForBattle } from "./store/content";
import { useGame } from "./store/game";
import { useChat, BATTLE_ROOM, selectTabs } from "./store/chat";
import { useMatchmaker, secondsLeft } from "./store/matchmaker";
import { useFriends } from "./store/friends";
import { useParty, inviteSecondsLeft } from "./store/party";
import { useSettings } from "./store/settings";
import { useUpdate } from "./store/update.ts";
import { appVersion } from "./net/update.ts";
import { catalogue, statuses as appStatuses, launchApp, installApp, uninstallApp } from "./net/apps.ts";
import { openExternal } from "./net/external.ts";
import { managedState, managedRoot, installEngine, removeManaged, onEngine,
  loadScreenState, setLoadScreen } from "./net/managed.ts";
import { seedDefaultSettings } from "./net/engineSettings.ts";
import { useSite, channelOf, isExternalUrl } from "./store/site";
/* Imported for its side effect: the module registers a slice that flags the
   window and posts a notification when something is waiting on an answer.
   Nothing here reads from it, so without this import it would never load. */
import "./store/notify";
import { useHistory, buildDebriefView } from "./store/history";
import { AutohostModeLabel } from "./protocol/enums";
import {
  battleList, statusBarKind, describeFailure, roomModel, chatLines, userToChip, newsList,
} from "./store/adapters";

/* A rating we were actually told, rounded, or nothing.
   `Math.round(x || 0)` gave 0 for a field the record did not carry, and a zero
   on a rating tile reads as a player who is terrible rather than as an answer
   we do not have. docs/PROFILE-AND-SEARCH.md section 5. */
const rounded = n => (typeof n === "number" && n ? Math.round(n) : undefined);

/* Click-through: login -> battle list -> battle room -> (launch) -> debriefing.
   The ready-check is a shell-level overlay because it interrupts any screen.

   Every screen has a live path and a demo path. Inside Tauri the stores drive
   everything; in a plain browser tab the same components render src/data.js so
   the click-through still works without a server. */
export default function App() {
  const live = inTauri();

  const [loggedIn, setLoggedIn] = React.useState(false);
  const [view, setView] = React.useState("battles");
  const [room, setRoom] = React.useState(null);
  const [queued, setQueued] = React.useState(false);
  const [check, setCheck] = React.useState(0);
  const [launching, setLaunching] = React.useState(false);
  const [hosting, setHosting] = React.useState(false);
  /* The map to open the host dialog on, when it was opened from the map list
     rather than from the Host button. */
  const [hostMap, setHostMap] = React.useState("");
  const [mapList, setMapList] = React.useState(undefined);
  /* The team an AI is being picked for. Null rather than a boolean, because
     team 0 is a team. */
  const [addingAiTo, setAddingAiTo] = React.useState(null);
  const [editingOptions, setEditingOptions] = React.useState(false);
  const [locked, setLocked] = React.useState(null);
  const [install, setInstall] = React.useState(null);
  const [profileOf, setProfileOf] = React.useState(null);
  const [away, setAway] = React.useState(false);
  const [registering, setRegistering] = React.useState(false);
  /* Undefined means your own profile; a name means you searched for them. */
  const [viewingProfile, setViewingProfile] = React.useState(undefined);
  const [loadingIn, setLoadingIn] = React.useState(false);

  const settings = useSettings();
  const updateState = useUpdate(s => s.state);

  /* The app launcher. The catalogue is compiled into the binary, so this is a
     read of what is installed rather than a fetch. Everything it lists is a
     separate program, so opening one means starting it. */
  const [appCatalogue, setAppCatalogue] = React.useState([]);
  const [appStatusList, setAppStatusList] = React.useState([]);
  const [appError, setAppError] = React.useState(undefined);
  const [installing, setInstalling] = React.useState(undefined);

  const refreshApps = React.useCallback(() => {
    catalogue().then(setAppCatalogue, () => setAppCatalogue([]));
    appStatuses().then(setAppStatusList, () => setAppStatusList([]));
  }, []);
  React.useEffect(() => { refreshApps(); }, [refreshApps]);

  /* The version the binary reports, not one written into the UI - CI stamps it
     at build time, so a literal here would be a number that was true once. */
  const [appVer, setAppVer] = React.useState("0.1.0");
  React.useEffect(() => {
    let live2 = true;
    void appVersion().then(v => { if (live2) setAppVer(v); }, () => {});
    return () => { live2 = false; };
  }, []);

  /* One check a session, a few seconds after start so it is not competing with
     logging in. Nothing installs on its own. */
  React.useEffect(() => {
    if (!live) return undefined;
    const t = setTimeout(() => void useUpdate.getState().check(), 4000);
    return () => clearTimeout(t);
  }, [live]);

  /* Offer the update once, when the startup check finds one.
     `null` means not yet offered, `false` means offered and declined - and it
     stays declined for the session, because asking twice about the same build
     is nagging. Next launch asks again, which is the point. */
  const [updateOffer, setUpdateOffer] = React.useState(null);
  React.useEffect(() => {
    if (updateOffer === null && updateState.kind === "available") setUpdateOffer(true);
  }, [updateState.kind, updateOffer]);
  /* `logout` is one of the site's actions, but the handler is defined below;
     a ref keeps the definition where it reads best. */
  const handleLogoutRef = React.useRef(null);

  const connection = useLobby(s => s.connection);
  const welcome = useLobby(s => s.welcome);
  const me = useLobby(s => s.me);
  /* Somebody else's profile, from their zero-k.info page. Only fetched for a
     name we are actually looking at, and only when it is not our own - see
     docs/PROFILES-WITHOUT-ENDPOINTS.md section 5 on not crawling them. */
  const webProfileState = useWebProfile(
    live && viewingProfile && viewingProfile !== me ? viewingProfile : undefined,
  );

  const liveBattles = useLobby(s => s.battles);
  const liveNews = useLobby(s => s.news);
  const liveUsers = useLobby(s => s.users);
  const reconnectAttempt = useLobby(s => s.reconnect);
  const kicked = useLobby(s => s.kicked);
  const notices = useLobby(s => s.notices);
  const siteCommand = useSite(s => s.pending);

  /* The live battle room. `useRoom` holds membership; the header it decorates
     still comes from the public battle directory in `useLobby`. */
  const liveRoomID = useRoom(s => s.battleID);

  /* Zero-K installed by Shiro rather than found. Only ever started by pressing
     the button in Settings: this is gigabytes, and the engine version comes
     from the server rather than from a guess. */
  const [managedInfo, setManagedInfo] = React.useState(undefined);
  const [managedBusy, setManagedBusy] = React.useState(false);
  const [loadScreen, setLoadScreenOn] = React.useState(false);
  const [managedProgress, setManagedProgress] = React.useState(undefined);
  const [managedError, setManagedError] = React.useState(undefined);

  /* Asked once, when Shiro first knows the answer: an existing install should
     be named rather than silently used, and a missing one should be offered
     here rather than in a Settings section nobody opens. */
  const [askInstall, setAskInstall] = React.useState(false);

  const refreshManaged = React.useCallback(version => {
    managedState(version).then(setManagedInfo, () => setManagedInfo(undefined));
    loadScreenState().then(setLoadScreenOn, () => setLoadScreenOn(false));
  }, []);


  React.useEffect(() => {
    if (!live) return undefined;
    let stop;
    onEngine(s => {
      if (s.kind === "progress") setManagedProgress({ received: s.received, total: s.total });
      if (s.kind === "failed") setManagedError(s.reason);
    }).then(fn => { stop = fn; }, () => {});
    return () => { if (stop) stop(); };
  }, [live]);

  React.useEffect(() => { if (live) refreshManaged(welcome?.Engine); },
    [live, welcome?.Engine, refreshManaged]);


  /* Joining is a request, not an arrival - the room only exists once the server
     answers - so following it has to happen when it turns up rather than when
     the button is pressed. Leaving is the same in reverse. */
  const wasInRoom = React.useRef(false);
  React.useEffect(() => {
    const now = Boolean(liveRoomID);
    if (now && !wasInRoom.current) setView("room");
    else if (!now && wasInRoom.current) setView(v => (v === "room" ? "battles" : v));
    wasInRoom.current = now;
  }, [liveRoomID]);

  const roomPlayers = useRoom(s => s.players);
  const roomBots = useRoom(s => s.bots);
  const roomOptions = useRoom(s => s.modOptions);
  const roomPoll = useRoom(s => s.poll);
  const roomPollOutcome = useRoom(s => s.pollOutcome);

  const chatRooms = useChat(s => s.rooms);
  const chatOrder = useChat(s => s.order);
  const chatActive = useChat(s => s.active);

  const phase = useGame(s => s.phase);
  const contentJobs = useContent(s => s.jobs);
  const contentOrder = useContent(s => s.order);
  /* The most recent job, which in a room is the one we started on join. */
  const activeDownload = contentOrder.length ? contentJobs[contentOrder[0]] : undefined;

  const mmQueues = useMatchmaker(s => s.queues);
  const mmJoined = useMatchmaker(s => s.joined);
  const mmCounts = useMatchmaker(s => s.counts);
  const mmIngame = useMatchmaker(s => s.ingame);
  const mmJoinedTime = useMatchmaker(s => s.joinedTime);
  const mmBanned = useMatchmaker(s => s.bannedSeconds);
  const mmCheck = useMatchmaker(s => s.check);

  const partyMembers = useParty(s => s.members);
  const partyID = useParty(s => s.partyID);
  const partyInvite = useParty(s => s.invite);
  const rejoinOffer = useGame(s => s.rejoin);

  const friendNames = useFriends(s => s.friends);
  const ignoreNames = useFriends(s => s.ignores);
  const records = useHistory(s => s.records);
  const recordIndex = useHistory(s => s.index);
  const profiles = useHistory(s => s.profiles);

  React.useEffect(() => () => { if (live) void teardown(); }, [live]);

  /* Where Zero-K lives. A disk scan, so it is asked once - and again only when
     the settings screen asks, or the override changes. */
  const [detectNonce, redetect] = React.useReducer(n => n + 1, 0);

  /* Install the engine, point the app at the directory it went into, and pull
     the game in behind it.
     
     One copy, because Settings and the first-run dialog do exactly the same
     thing and the two had already started to drift. The root is asked for
     rather than read off `managedInfo`: that comes from an earlier
     `managedState()` call, and if that call had failed the engine installed,
     `installRoot` was never set, and the game fetch silently skipped - leaving
     an install the rest of the app could not see. */
  /* An install made before this existed has the same gap, and it will not be
     set up again - so the same pass runs once a session against whatever
     directory Shiro is pointed at. It writes only absent keys, so on a
     configured install it writes nothing at all. */
  const seededSettings = React.useRef(false);
  React.useEffect(() => {
    if (!live || seededSettings.current) return;
    if (!managedInfo?.prepared || settings.installRoot !== managedInfo.root) return;
    seededSettings.current = true;
    void seedDefaultSettings(managedInfo.root).catch(() => {});
  }, [live, managedInfo, settings.installRoot]);

  const installManaged = React.useCallback(async version => {
    if (!version) return;
    setManagedError(undefined);
    setManagedProgress(undefined);
    setManagedBusy(true);
    try {
      await installEngine(version);
      const dir = await managedRoot().catch(() => "");
      if (dir) {
        /* `installRoot` is already threaded through detection, the content
           preflight, the archive reader and the launcher, so setting it here is
           what turns an engine on disk into the installation Shiro actually
           uses - there is no second path to build. */
        useSettings.getState().set({ installRoot: dir });
        if (redetect) redetect();

        /* Give it Zero-K's own settings before anything runs in it. A fresh
           directory has never met Zero-K's settings screen, so everything
           performance-related falls back to the *engine's* defaults - and the
           engine defaults vsync to adaptive, which Zero-K turns off in all five
           of its presets. Adaptive is the one that gets reported as a stuttery
           camera: it syncs while the frame rate holds and stops when it does
           not, so the pacing oscillates rather than being consistently wrong.
           Only keys that are absent are written, so this never overrules
           somebody who has set something. */
        await seedDefaultSettings(dir).catch(() => {});

        /* And pull the game in now rather than at the first battle. The
           pr-downloader that does it is the one that arrived inside the
           engine, in that same directory. */
        const game = useLobby.getState().welcome?.Game;
        if (game) {
          await useContent.getState()
            .fetch(version, [{ kind: "game", name: game }], dir)
            .catch(e => setManagedError(String(e?.message ?? e)));
        }
      } else {
        setManagedError("The engine installed, but its folder could not be located.");
      }
      refreshManaged(version);
    } catch (e) {
      setManagedError(String(e?.message ?? e));
    } finally {
      setManagedBusy(false);
    }
  }, [redetect, refreshManaged]);
  const [installError, setInstallError] = React.useState("");
  /* Only once detection has actually run - asking before that would tell
     somebody with Zero-K installed that they have not got it. */
  React.useEffect(() => {
    /* After logging in, not before. The login screen is not the place to be
       interrupted, and the offer needs the engine version the server only
       sends once you are on. */
    if (!live || !loggedIn || settings.installPromptSeen) return;
    if (!install && !installError) return;
    setAskInstall(true);
  }, [live, loggedIn, install, installError, settings.installPromptSeen]);
  React.useEffect(() => {
    if (!live) return;
    let cancelled = false;
    void import("./net/launch").then(({ locateInstall }) =>
      locateInstall(settings.installRoot).then(
        i => { if (!cancelled) { setInstall(i); setInstallError(""); } },
        e => { if (!cancelled) { setInstall(null); setInstallError(String(e)); } },
      ));
    return () => { cancelled = true; };
  }, [live, settings.installRoot, detectNonce]);

  /* The demo ready-check counts itself down; the live one runs against the
     deadline the server gave us. */
  React.useEffect(() => {
    if (!check) return;
    const t = setInterval(() => setCheck(c => (c > 1 ? c - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [check]);

  /* Both countdowns run against a deadline the server set, so the UI only has
     to re-render; there is no local clock to keep in step.

     The battle list's elapsed times need the same thing for a different reason.
     `runningSince` is computed from `Date.now()` at render, so a row only
     advances when something re-renders it - and a quiet battle gets no updates,
     so its clock sat still and then jumped when an unrelated message arrived.
     That is the "timers get stuck" report: they were never ticking, only being
     recalculated whenever the store happened to change. */
  const anyRunning = React.useMemo(
    () => Object.values(liveBattles).some(b => b.IsRunning),
    [liveBattles],
  );
  const [, forceTick] = React.useReducer(n => n + 1, 0);
  React.useEffect(() => {
    if (!mmCheck && !partyInvite && !anyRunning) return;
    const t = setInterval(forceTick, 500);
    return () => clearInterval(t);
  }, [mmCheck, partyInvite, anyRunning]);

  /* A finished match is the one thing that should pull you out of whatever you
     were doing: the debriefing is the point of having played. */
  const newest = records[0];
  React.useEffect(() => {
    // Two exceptions. Spectators are never pulled there - they have no rating
    // change, no XP and no awards, so the screen has nothing to tell them. And
    // anyone who would rather go straight back to the battle list can turn it
    // off in settings.
    if (!newest || newest.spectator || !settings.autoOpenDebriefing) return;
    setView("debrief");
  }, [newest && newest.serverBattleId]);

  /* Content, as soon as you are in the room rather than at the whistle.
     BattleHeader carries the game and map minutes before ConnectSpring does, so
     the download runs while people are still picking teams. The launch still
     runs its own preflight - this is a head start, not the gate. */
  React.useEffect(() => {
    if (!live || liveRoomID == null) return;
    const header = liveBattles[liveRoomID];
    if (!header) return;
    void prefetchForBattle(
      liveRoomID,
      header.Engine || welcome?.Engine || "",
      header.Game,
      header.Map,
      settings.installRoot,
    );
  }, [live, liveRoomID, liveBattles[liveRoomID]?.Map, liveBattles[liveRoomID]?.Game]);

  /* Hooks only: everything below the login screen's early return runs
     conditionally, so a hook down there changes the hook order between
     renders. */
  const ignored = React.useMemo(() => new Set(ignoreNames), [ignoreNames]);

  const handleLogin = React.useCallback(async (name, password, remember) => {
    // Remember the name either way - it is not a secret, and typing it every
    // time is the single most annoying thing a lobby can do.
    useSettings.getState().set({ name, remember: Boolean(remember),
      password: remember ? password : undefined });
    if (!live) {
      await new Promise(r => setTimeout(r, 700));
      setLoggedIn(true);
      return;
    }
    const { host, port } = useSettings.getState();
    setLoadingIn(true);
    try {
      /* The outcome login settled on, not whatever the store says now: a
         refusal is followed by the server dropping the connection, and reading
         afterwards reported the drop instead of the refusal. */
      const c = await login({ name, password }, host || undefined, port || undefined);
      if (c.kind !== "online") throw new Error(describeFailure(c));
    } catch (e) {
      // A rejected login goes back to the form; nothing is loading any more.
      setLoadingIn(false);
      throw e;
    }
    setLoggedIn(true);
  }, [live]);

  /* The dialog stays up past the LoginResponse. Being accepted is not the same
     as being usable: the server then floods the whole directory down - hundreds
     of User and BattleAdded lines - and until that lands the battle list is
     empty. That gap is the few seconds this covers.

     There is no "flood finished" message in the protocol, so it clears on the
     first sign of a populated directory, with a hard cap in case a quiet server
     never sends one. */
  React.useEffect(() => {
    if (!loadingIn) return;
    if (connection.kind === "rejected" || connection.kind === "disconnected") {
      setLoadingIn(false);
      return;
    }
    const populated = Object.keys(liveBattles).length > 0
      || Object.keys(liveUsers).length > 0;
    if (connection.kind === "online" && populated) {
      setLoadingIn(false);
      return;
    }
    const cap = setTimeout(() => setLoadingIn(false), 8000);
    return () => clearTimeout(cap);
  }, [loadingIn, connection.kind, liveBattles, liveUsers]);

  /* Zero-K's map list, read the first time somebody opens the Maps screen.
     The catalogue is memoised for the session in net/zkcatalogue.ts, so this
     is one request however often the screen is opened - and nothing else needs
     the whole list, which is why it is not fetched at login. */
  React.useEffect(() => {
    if (view !== "maps" || mapList) return;
    let live = true;
    mapCatalogue().then(
      c => { if (live) setMapList([...c.values()]); },
      () => { if (live) setMapList([]); },
    );
    return () => { live = false; };
  }, [view, mapList]);

  /* A `zk://` link somebody clicked in chat. It goes into the same pending slot
     the website's commands use, so a link in chat, a button on zero-k.info and
     a link followed from a browser all end up in the one handler below rather
     than three that have to be kept agreeing with each other. */
  const openZk = React.useCallback(raw => { useSite.getState().offer(raw); }, []);

  /* Who is being reported, if anyone. Shell-level rather than per-screen: the
     button is on two screens and the dialog is the same one. */
  const [reporting, setReporting] = React.useState(null);

  /* A line that says what just happened and then goes away.
     Sending a party invite produced no evidence at all: `InviteToParty` goes
     out and the server answers only if they accept, which can be never. So the
     honest thing to say is what we did - "Invited hexed" - and not that it
     arrived, which we do not know. */
  const [toast, setToast] = React.useState(null);
  React.useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  /* The website talks to the lobby you already have open: "join this player",
     "add this friend", "open this channel". The grammar is upstream's - see
     store/site.ts - and everything it asks for here is something the app can
     already do. Anything unrecognised is ignored rather than guessed at. */
  React.useEffect(() => {
    if (!live || !siteCommand) return;
    const command = useSite.getState().take();
    if (!command) return;

    for (const { command: action, arg } of command.actions) {
      switch (action) {
        case "join_battle":
        case "join_player": {
          // The argument is a player, not a battle: join whatever they are in.
          const target = useLobby.getState().users[arg];
          if (target?.BattleID != null) {
            useRoom.getState().join(target.BattleID);
            setView("battles");
          }
          break;
        }
        case "add_friend":
          useFriends.getState().add(arg);
          break;
        case "select_map":
          // In a room the host decides, and every autohost takes !map.
          if (useRoom.getState().battleID != null) void say(`!map ${arg}`, 1);
          else setHosting(true);
          break;
        case "logout":
          handleLogoutRef.current?.();
          break;
        default:
          break;
      }
    }

    const channel = channelOf(command.path);
    if (channel) {
      useChat.getState().join(channel);
      setView("chat");
    } else if (command.path === "battles") setView("battles");
    else if (isExternalUrl(command.path)) {
      const url = command.path.startsWith("www.") ? `http://${command.path}` : command.path;
      void openExternal(url);
    }
  }, [live, siteCommand]);

  const handleRegister = React.useCallback(async (name, password, email) => {
    if (!live) {
      await new Promise(r => setTimeout(r, 700));
      setLoggedIn(true);
      return;
    }
    const { host, port } = useSettings.getState();
    await register({ name, password }, email, host || undefined, port || undefined);
    // register() logs in on success, so anything left is a real failure.
    const c = useLobby.getState().connection;
    if (c.kind !== "online") throw new Error(describeFailure(c));
    useSettings.getState().set({ name });
    setLoggedIn(true);
  }, [live]);

  const handleLogout = React.useCallback(() => {
    // Every store holds session state; leaving any of it behind would show the
    // next account the last one's friends.
    if (live) void teardown();
    useLobby.getState().reset();
    useRoom.getState().reset();
    useChat.getState().reset();
    useGame.getState().reset();
    useMatchmaker.getState().reset();
    useParty.getState().reset();
    useFriends.getState().reset();
    useHistory.getState().reset();
    useSettings.getState().forgetPassword();
    setLoggedIn(false);
    setView("battles");
  }, [live]);

  // Who is in each battle room. Only `User` carries BattleID, so this is the
  // only occupancy signal available before joining.
  const occupantsOf = React.useCallback(
    id => Object.values(liveUsers).filter(u => u.BattleID === id && u.Name).map(u => u.Name).sort(),
    [liveUsers]
  );

  handleLogoutRef.current = handleLogout;

  const shell = {
    version: appVer,
    // A mark beside the version, not a dialog over whatever you are doing.
    updateReady: updateState.kind === "available" || updateState.kind === "ready",
    connection: live ? statusBarKind(connection, reconnectAttempt) : "online",
    users: live ? (welcome?.UserCount ?? 0) : D.welcome.UserCount,
    engine: live ? (welcome?.Engine ?? "-") : D.welcome.Engine,
    game: live ? (welcome?.Game ?? "-") : D.welcome.Game,
    attempt: live ? reconnectAttempt : 0,
    onReconnect: live ? reconnectNow : undefined,
  };

  if (!loggedIn) {
    return (
      <AppShell view={view} onView={setView} {...shell}>
        <ErrorBoundary>
          <LoginScreen onLogin={handleLogin} live={live}
            onRegister={() => setRegistering(true)}
            defaultName={settings.name} defaultPassword={settings.password}
            defaultRemember={settings.remember} />
        </ErrorBoundary>
        <RegisterDialog open={registering} onClose={() => setRegistering(false)}
          onRegister={handleRegister} />

        <LoadingDialog open={live && loadingIn} />
      </AppShell>
    );
  }

  const battles = live ? battleList(liveBattles) : D.battles;
  /* The demo fixture is already through the adapter - see src/data.js - so both
     paths draw what the same normalisation produced. */
  const news = live ? newsList(liveNews) : D.news;
  const liveRoom = live && liveRoomID != null
    ? roomModel(liveBattles[liveRoomID], roomPlayers, roomBots, liveUsers, roomOptions,
        { id: partyID, members: partyMembers })
    : null;
  /* The room on screen, whichever mode we are in. The demo path is supported -
     every screen has one - and reading `liveRoom` directly in this branch threw
     the moment somebody opened a room in the browser. */
  const roomView = liveRoom || (room ? D.room : null);

  /* Not running: the host decides when to start, and every Zero-K autohost
     takes `!start` in room chat - which is exactly what a player types today.
     Running: ask for connect details and launch straight into it. */
  const startRoom = () => {
    /* The demo click-through ends at the debriefing, which is the whole point
       of it - and this guarded on `liveRoom`, so in the browser the button did
       nothing at all. */
    if (!live) {
      setLaunching(true);
      setTimeout(() => {
        setLaunching(false);
        setRoom(null);
        setView("debrief");
      }, 1600);
      return;
    }
    if (!liveRoom) return;
    if (liveRoom.running) useGame.getState().requestStart(liveRoom.id);
    else void say("!start", 1);
  };

  const setBattleStatus = patch => {
    if (me) void send("UpdateUserBattleStatus", { Name: me, ...patch });
  };

  const joinBattle = b => {
    if (!live) { setRoom(b); setView("room"); return; }
    // A locked room needs its password before the join, not after a refusal.
    if (b.locked) setLocked(b);
    else useRoom.getState().join(b.id);
  };

  const openDm = name => {
    useChat.getState().openDm(name);
    setView("chat");
  };

  // ---------------------------------------------------------------- chat ---
  const battleChat = chatRooms[BATTLE_ROOM];
  const chatTabs = live
    ? selectTabs({ rooms: chatRooms, order: chatOrder })
    : D.channels;
  const activeRoom = chatRooms[chatActive];
  /* Alphabetical, and case-insensitively so: the server hands the roster over
     in join order, which is arrival order to the server and no order at all to
     a reader looking for one name in two hundred. `localeCompare` rather than
     `<` because Zero-K names are not all ASCII. */
  const chatUsers = live
    ? (activeRoom
      ? activeRoom.users.map(n => userToChip(liveUsers[n], n))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
      : [])
    : D.channelUsers;

  // ----------------------------------------------------------- matchmaker ---
  /* The name titles the row and the description explains it. They used to be
     the other way round, which reads fine against a fixture whose descriptions
     are "1v1" and "Teams" and not at all against the server, where every
     description is a sentence: "Play a casual 2v2 or larger with anyone."
     `MaxPartySize` is the only other thing MatchMakerSetup actually serialises
     and it decides whether you can bring your party, so it comes along. */
  const queueRows = mmQueues.map(q => ({
    id: q.Name,
    label: q.Name,
    description: q.Description,
    maxParty: q.MaxPartySize,
    waiting: mmCounts[q.Name] ?? 0,
    ingame: mmIngame[q.Name] ?? 0,
  }));

  // ---------------------------------------------------------------- view ---
  let body;
  /* The room is its own destination rather than something that stands in front
     of the battle list. It used to render whenever `view` was "battles", which
     meant the only way to look at what else was open was to leave - and nothing
     on screen said you were still in one. */
  if (roomView && view === "room") body = (
    <BattleRoomScreen room={roomView}
      download={activeDownload}
      onZk={openZk}
      chat={battleChat ? chatLines(battleChat.messages, liveUsers, ignored) : []}
      onLeave={() => { if (live) useRoom.getState().leave(); setRoom(null); setView("battles"); }}
      onSay={text => void say(text, 1)}
      onTeam={ally => setBattleStatus({ AllyNumber: ally, IsSpectator: false })}
      onSpectate={() => setBattleStatus({ IsSpectator: true })}
      sync={{ install, engine: welcome?.Engine }}
      phase={phase}
      poll={roomPoll}
      pollOutcome={roomPollOutcome}
      onVote={option => useRoom.getState().vote(option)}
      onKick={u => useRoom.getState().kick(u.name)}
      /* Which AI is a question now. It used to be answered as "CAI", which is
         one of the nine Zero-K declares and none of the ones the engine
         brings. */
      onAddBot={ally => setAddingAiTo(ally)}
      onPlayer={u => { if (u.name !== me && !u.bot) openDm(u.name); }}
      onEditOptions={() => setEditingOptions(true)}
      /* The server's rule, read backwards: only the founder may set options,
         and an autohost's founder is never a person. */
      optionsLocked={canEditOptions(roomView.founder, me, Boolean(liveUsers[me]?.IsAdmin))
        ? undefined : "Only the room's host can change these"}
      chatHeight={settings.roomChatHeight}
      onChatHeight={h => useSettings.getState().set({ roomChatHeight: h })}
      onStart={startRoom} />
  );
  else if (view === "apps") body = (
    <AppsScreen apps={appCatalogue} statuses={appStatusList} error={appError}
      installing={installing}
      onInstall={id => {
        setAppError(undefined);
        setInstalling(id);
        installApp(id)
          .then(refreshApps, e => setAppError(String(e?.message ?? e)))
          .finally(() => setInstalling(undefined));
      }}
      onLaunch={id => {
        setAppError(undefined);
        /* With the Zero-K directory, so an app that wants to read the install
           is told about it rather than searching the usual places - which stop
           being the usual places the moment Shiro installs the game itself. */
        launchApp(id, settings.installRoot)
          .then(refreshApps, e => setAppError(String(e?.message ?? e)));
      }}
      onUninstall={id => {
        setAppError(undefined);
        uninstallApp(id).then(refreshApps, e => setAppError(String(e?.message ?? e)));
      }} />
  );
  else if (view === "battles") body = <BattleListScreen battles={battles}
    news={news}
    occupants={live ? occupantsOf : null}
    onHost={() => setHosting(true)}
    onSpectate={b => {
      if (live) useRoom.getState().join(b.id, undefined, true);
      else { setRoom(b); setView("room"); }
    }}
    /* So that being in a room is visible from the one screen you would go to
       looking for another one. */
    inRoom={liveRoom || (room ? D.room : null)}
    onReturn={() => setView("room")}
    onLeaveRoom={() => { if (live) useRoom.getState().leave(); setRoom(null); }}
    onJoin={joinBattle} />;
  else if (view === "chat") body = (
    <ChatScreen
      onZk={openZk}
      channels={chatTabs}
      users={chatUsers}
      messages={live
        ? (activeRoom ? chatLines(activeRoom.messages, liveUsers, ignored) : [])
        : D.channelChat}
      active={live ? chatActive : undefined}
      topic={live && activeRoom && activeRoom.topic ? activeRoom.topic.Text : undefined}
      onTab={live ? id => useChat.getState().setActive(id) : undefined}
      onSend={live ? text => useChat.getState().say(chatActive, text) : undefined}
      onClose={live ? id => useChat.getState().close(id) : undefined}
      onJoin={live ? name => useChat.getState().join(name) : undefined}
      onUser={live ? openDm : undefined} />
  );
  else if (view === "maps") body = (
    /* An empty live list is a real answer - offline, or the service is down -
       so it must not fall through to the demo fixtures. `[]` is truthy, which
       is exactly how the first version of this line showed nothing at all. */
    <MapsScreen maps={live ? (mapList ?? []) : D.maps}
      loading={live && mapList === undefined}
      onHost={name => { setHostMap(name); setHosting(true); }} />
  );
  else if (view === "queue") body = (
    <QueueScreen
      queued={queued}
      queues={live ? queueRows : undefined}
      joined={live ? mmJoined : undefined}
      joinedTime={live ? mmJoinedTime : undefined}
      bannedSeconds={live ? mmBanned : undefined}
      elo={live && me && liveUsers[me] ? Math.round(liveUsers[me].EffectiveMmElo) : undefined}
      party={live ? partyMembers.map(n => userToChip(liveUsers[n], n)) : D.channelUsers.slice(0, 2)}
      onInvite={live
        ? name => {
          useParty.getState().sendInvite(name);
          setToast(`Invited ${name}`);
        }
        : undefined}
      onLeaveParty={live ? () => useParty.getState().leave() : undefined}
      /* The whole set every time, because that is what the request carries -
         there is no join and no leave to tell apart. */
      onQueue={live
        ? names => useMatchmaker.getState().setQueues(names)
        : names => setQueued(names.length > 0)}
      onFake={live ? undefined : () => setCheck(9)} />
  );
  else if (view === "profile") body = (
    <ProfileScreen
      me={live ? me : "demo"}
      users={live ? liveUsers : {}}
      profile={live && me ? profiles[me] : undefined}
      viewing={viewingProfile}
      onView={setViewingProfile}
      /* Only for somebody else: our own awards and progression arrive over the
         socket in UserProfile, so asking the website for them would be a
         request for what we already have. */
      web={webProfileState}
      /* The elo series and the table are the matches this client actually saw
         land. There is no history in the protocol, so this is all there is. */
      records={live ? records.map(r => {
        const v = buildDebriefView(r, me, n => liveUsers[n], profiles);
        return { elo: v.rating ? v.rating.next : undefined };
      }) : []}
      matchRows={live ? records.map(r => {
        const v = buildDebriefView(r, me, n => liveUsers[n], profiles);
        return {
          id: r.serverBattleId, map: v.map, result: v.result,
          mode: v.mode != null ? AutohostModeLabel[v.mode] : undefined, elapsed: v.elapsed,
          change: v.rating ? v.rating.change : undefined,
        };
      }) : []}
      onMessage={live ? openDm : undefined}
      onAddFriend={live ? name => useFriends.getState().add(name) : undefined}
      onIgnore={live ? name => useFriends.getState().ignore(name) : undefined}
      onReport={live ? name => setReporting(name) : undefined}
      onExternal={name => openExternal(`https://zero-k.info/Users/Detail?name=${encodeURIComponent(name)}`)} />
  );
  else if (view === "friends") body = (
    <FriendsScreen
      users={live ? friendNames.map(n => userToChip(liveUsers[n], n)) : D.channelUsers}
      /* Our own profile is pushed by the server and is the rich one. For anyone
         else only their User record exists - the protocol has no way to ask for
         another person's profile - so the screen shows what we do have rather
         than nothing at all. */
      profile={live && profileOf ? (profiles[profileOf] ? {
        level: profiles[profileOf].Level,
        rank: profiles[profileOf].Rank,
        elo: rounded(profiles[profileOf].EffectiveElo),
        mmElo: rounded(profiles[profileOf].EffectiveMmElo),
        pwElo: rounded(profiles[profileOf].EffectivePwElo),
        badges: profiles[profileOf].Badges,
      } : liveUsers[profileOf] ? {
        level: liveUsers[profileOf].Level,
        rank: liveUsers[profileOf].Rank,
        elo: rounded(liveUsers[profileOf].EffectiveElo),
        mmElo: rounded(liveUsers[profileOf].EffectiveMmElo),
        /* No Planetwars rating in a `User` record and no way to ask for one, so
           it stays undefined and the tile stays a dash. */
        badges: liveUsers[profileOf].Badges,
      } : undefined) : undefined}
      /* Who the panel above is about. It is fetched by name one commit behind
         the row the screen has selected, so the screen has to be able to tell
         that they do not match yet rather than drawing the wrong person. */
      profileFor={live ? profileOf : undefined}
      onSelect={live ? name => setProfileOf(name) : undefined}
      onMessage={live ? openDm : undefined}
      onIgnore={live ? name => useFriends.getState().ignore(name) : undefined}
      onReport={live ? name => setReporting(name) : undefined}
      onAdd={live ? name => useFriends.getState().add(name) : undefined}
      onRemove={live ? name => useFriends.getState().remove(name) : undefined} />
  );
  else if (view === "downloads") body = (
    <DownloadsScreen jobs={contentJobs} order={contentOrder}
      onCancel={id => useContent.getState().cancel(id)}
      onClear={() => useContent.getState().clearFinished()}
      onSettings={() => setView("settings")} />
  );
  else if (view === "settings") body = (
    <SettingsScreen
      /* Only inside the app: the browser demo has no updater to ask, and a
         "Check for updates" button that cannot is worse than none. */
      update={live ? {
        state: updateState,
        check: () => useUpdate.getState().check(),
        install: () => useUpdate.getState().install(),
        restart: () => useUpdate.getState().restart(),
      } : undefined}
      version={appVer}
      me={live ? me : "Shadowfury"}
      install={live ? install : { root: "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Zero-K", source: "Steam" }}
      installError={installError}
      engine={live ? welcome?.Engine : D.welcome.Engine}
      settings={settings}
      onSettings={patch => useSettings.getState().set(patch)}
      onRedetect={live ? redetect : undefined}
      onPreview={live
        ? () => import("./net/launch").then(({ launchPreview }) =>
          launchPreview(welcome?.Engine ?? "", me ?? ""))
        : undefined}
      onLogout={handleLogout}
      managed={live ? {
        state: managedInfo,
        busy: managedBusy,
        progress: managedProgress,
        error: managedError,
        loadScreen,
        /* What the game looks like is the player's call, not the launcher's,
           so this is a switch rather than something that just happens. */
        onLoadScreen: on => {
          setManagedError(undefined);
          setLoadScreen(on).then(setLoadScreenOn,
            e => setManagedError(String(e?.message ?? e)));
        },
        onPrepare: () => void installManaged(welcome?.Engine),
        onRemove: () => {
          setManagedError(undefined);
          removeManaged()
            .then(() => {
              /* Stop pointing at a directory that is no longer there, or the
                 launcher keeps naming it in error messages. */
              if (settings.installRoot === managedInfo?.root) {
                useSettings.getState().set({ installRoot: undefined });
                if (redetect) redetect();
              }
              refreshManaged(welcome?.Engine);
            }, e => setManagedError(String(e?.message ?? e)));
        },
      } : undefined}
      away={away}
      onAway={live ? next => { setAway(next); void send("ChangeUserStatus", { IsAfk: next }); } : undefined} />
  );
  /* Without this, being on "room" with no room to show fell through to the
     bottom of the chain and rendered the debriefing. Leaving from anywhere but
     the room itself - a kick, the host closing it - lands here. */
  else if (view === "room") body = <BattleListScreen battles={battles}
    news={news}
    occupants={live ? occupantsOf : null}
    onHost={() => setHosting(true)}
    onSpectate={b => (live ? useRoom.getState().join(b.id, undefined, true) : setRoom(b))}
    onJoin={joinBattle} />;
  else body = (
    <DebriefingScreen
      d={live
        ? (records[recordIndex]
          ? buildDebriefView(records[recordIndex], me, n => liveUsers[n], profiles)
          : null)
        : D.debrief}
      inRoom={Boolean(liveRoom || room)}
      onBack={() => setView(liveRoom || room ? "room" : "battles")} />
  );

  const mmSeconds = secondsLeft(mmCheck, Date.now());
  const overlay = (
    <>
      <Dialog open={check > 0 || Boolean(mmCheck)} title="Ready check" urgent width={380}
        footer={mmCheck
          ? <>
            <Button variant="ghost" onClick={() => useMatchmaker.getState().respond(false)}>Decline</Button>
            <Button variant="primary" disabled={mmCheck.accepted}
              onClick={() => useMatchmaker.getState().respond(true)}>
              {mmCheck.accepted ? "Waiting for the others" : "Ready"}
            </Button>
          </>
          : <>
            <Button variant="ghost" onClick={() => { setCheck(0); setQueued(false); }}>Decline</Button>
            <Button variant="primary" onClick={() => { setCheck(0); setQueued(false); setRoom(D.room); }}>Ready</Button>
          </>}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16 }}>
          <span style={{ font: "var(--text-title)", color: "var(--text-hi)" }}>Match found. Ready?</span>
          <span style={{ font: "var(--text-num-lg)", color: "var(--text-hi)", fontVariantNumeric: "tabular-nums" }}>
            {mmCheck ? mmSeconds : check}s
          </span>
        </div>
        <div style={{ marginTop: 14 }}>
          <Meter value={mmCheck ? mmSeconds : check} max={mmCheck ? 30 : 9} height={2} />
        </div>
        {mmCheck && mmCheck.battleSize ? (
          <div style={{ marginTop: 12, font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-core)",
            color: mmCheck.likelyToPlay ? "var(--text-low)" : "var(--signal-warn)" }}>
            {(mmCheck.battleReady ?? 0)} of {mmCheck.battleSize} accepted
            {mmCheck.likelyToPlay ? "" : " - this one may not happen"}
          </div>
        ) : null}
      </Dialog>

      {/* One dialog for the whole start sequence: check content, fetch what is
          missing, then hand off. The engine must not be started before content
          is settled - an engine told to join a game whose archive it lacks sits
          on "waiting for connection" forever with nothing to explain why. */}
      <Dialog
        open={launching || phase.kind === "launching" || phase.kind === "preflight"
          || phase.kind === "downloading"}
        title={phase.kind === "downloading" ? "Downloading" : "Launching"}
        width={380}
        footer={phase.kind === "downloading" ? (
          <>
            <Button variant="ghost" onClick={() => {
              useContent.getState().cancel(phase.jobId);
              useGame.setState({ phase: { kind: "idle" } });
            }}>Cancel</Button>
            <Button variant="secondary" onClick={() => {
              const c = useGame.getState().last;
              useContent.getState().cancel(phase.jobId);
              if (c) void useGame.getState().launch(c);
            }}>Launch anyway</Button>
          </>
        ) : undefined}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
          {phase.kind === "preflight" ? (
            <>
              <span style={{ font: "var(--text-ui)", color: "var(--text-body)" }}>
                Checking you have the game and map.
              </span>
              <Meter indeterminate />
            </>
          ) : phase.kind === "downloading" ? (
            <>
              <span style={{ font: "var(--text-ui)", color: "var(--text-body)" }}>
                Getting content Zero-K needs for this match.
              </span>
              <Meter value={phase.percent} max={100}
                label={phase.what} right={phase.percent + "%"} />
              <span style={{ font: "var(--w-regular) var(--size-tiny)/1.5 var(--font-core)",
                color: "var(--text-low)" }}>
                Starting without it would leave the engine waiting for a connection
                it can never make.
              </span>
            </>
          ) : (
            <>
              <span style={{ font: "var(--text-ui)", color: "var(--text-body)" }}>Handing off to the engine.</span>
              <Meter indeterminate />
              <span style={{ font: "var(--w-regular) var(--size-tiny)/1.5 var(--font-core)", color: "var(--text-low)" }}>
                Shiro goes dormant while the match runs and comes back with your results.
              </span>
            </>
          )}
        </div>
      </Dialog>

      <ModOptionsDialog open={editingOptions} current={roomOptions}
        onClose={() => setEditingOptions(false)}
        onApply={options => useRoom.getState().setModOptions(options)} />

      <HostBattleDialog open={hosting}
        onClose={() => { setHosting(false); setHostMap(""); }}
        defaultTitle={me ? me + "'s battle" : "New battle"}
        defaultMap={hostMap}
        maps={[...new Set(battles.map(b => b.map).filter(Boolean))].sort()}
        onHost={opts => (live
          ? useRoom.getState().host({
            ...opts,
            engine: welcome?.Engine,
            /* Welcome's game is the fallback, not the answer: a chosen custom
               mode names its own, and spreading Welcome over the top would
               have quietly hosted plain Zero-K every time. */
            game: opts.game || welcome?.Game,
          })
          : setRoom(D.room))} />

      {/* The room's game rather than Welcome's: a room running a custom mode
          declares its own AIs, and Welcome names the default one. */}
      <AddAiDialog ally={addingAiTo} onClose={() => setAddingAiTo(null)}
        engine={welcome?.Engine}
        game={roomView?.game || welcome?.Game}
        installRoot={settings.installRoot}
        onAdd={(lib, ally) => useRoom.getState().addBot(lib, ally)} />

      <JoinPasswordDialog battle={locked} onClose={() => setLocked(null)}
        onJoin={password => useRoom.getState().join(locked.id, password)} />

      <Dialog open={Boolean(partyInvite)} title="Party invite" width={360}
        footer={<>
          <Button variant="ghost" onClick={() => useParty.getState().respond(false)}>Decline</Button>
          <Button variant="primary" onClick={() => useParty.getState().respond(true)}>Join party</Button>
        </>}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16 }}>
          <span style={{ font: "var(--text-ui)", color: "var(--text-body)" }}>
            {partyInvite ? partyInvite.members.filter(n => n !== me).join(", ") : ""} want you in their party.
          </span>
          <span style={{ font: "var(--text-num)", color: "var(--text-hi)", fontVariantNumeric: "tabular-nums" }}>
            {inviteSecondsLeft(partyInvite, Date.now())}s
          </span>
        </div>
      </Dialog>

      {/* The server has something to say that is not chat: a mute, a ban, an
          announcement. One at a time, oldest first. */}
      <Dialog open={notices.length > 0} title="Message from the server" width={400}
        footer={<Button variant="primary" onClick={() => useLobby.getState().clearNotice()}>OK</Button>}>
        <span style={{ font: "var(--text-ui)", color: "var(--text-body)", whiteSpace: "pre-wrap" }}>
          {notices[0] || ""}
        </span>
      </Dialog>

      {/* An admin threw us off. There is nothing to retry, so the only way
          out is back to the login screen. */}
      <Dialog open={Boolean(kicked)} title="Disconnected by an admin" width={380}
        footer={<Button variant="primary" onClick={() => { useLobby.getState().clearKick(); handleLogout(); }}>
          Back to login
        </Button>}>
        <span style={{ font: "var(--text-ui)", color: "var(--text-body)" }}>
          {kicked ? kicked.reason : ""}
        </span>
      </Dialog>

      {/* Above the status bar and out of the way of everything else. Not a
          Dialog: this interrupts nothing and wants no acknowledgement, and a
          modal for "yes, that worked" is the kind of thing people learn to
          dismiss without reading. */}
      {toast && (
        <div role="status" aria-live="polite"
          style={{ position: "absolute", left: "50%", bottom: "calc(var(--shell-statusbar) + var(--sp-6))",
            transform: "translateX(-50%)", zIndex: 55, pointerEvents: "none",
            padding: "var(--sp-4) var(--sp-6)", background: "var(--surface-panel)",
            border: "1px solid var(--w-20)",
            font: "var(--text-ui-sm)", color: "var(--text-hi)", whiteSpace: "nowrap",
            animation: "shiro-enter var(--dur-base) var(--ease-out) both" }}>
          {toast}
        </div>
      )}

      {/* An update, offered once at startup.
          docs/UPDATES.md used to rule this out - "an update prompt over a
          battle is an interruption" - and that reasoning still holds for a
          prompt that arrives mid-session. This one cannot: it is shown from
          the startup check, before there is a battle to interrupt, and a
          decline is remembered for the session. */}
      <Dialog open={updateOffer === true && updateState.kind === "available"}
        title="Update available" width={360}
        onClose={() => setUpdateOffer(false)}
        footer={<>
          <Button variant="ghost" onClick={() => setUpdateOffer(false)}>Later</Button>
          <Button variant="primary" icon="download"
            onClick={() => { setUpdateOffer(false); void useUpdate.getState().install(); }}>
            Install now
          </Button>
        </>}>
        <span style={{ font: "var(--text-ui)", color: "var(--text-body)" }}>
          {updateState.kind === "available" && updateState.update?.version
            ? `Shiro ${updateState.update.version} is ready to install.`
            : "A newer Shiro is ready to install."}
          {" "}Installing takes a moment and then asks you to restart.
        </span>
      </Dialog>

      {/* Reporting somebody, from wherever their name was. */}
      <ReportDialog open={Boolean(reporting)} name={reporting || ""}
        onClose={() => setReporting(null)}
        onSend={(name, text) => useFriends.getState().report(name, text)} />

      {/* Sent after login when a game you were in is still running: the lobby
          crashed, or you closed it mid-match. Purely an offer. */}
      <Dialog open={rejoinOffer != null} title="You are still in a game" width={380}
        footer={<>
          <Button variant="ghost" onClick={() => useGame.getState().takeRejoin(false)}>Ignore</Button>
          <Button variant="primary" icon="play"
            onClick={() => useGame.getState().takeRejoin(true)}>Rejoin</Button>
        </>}>
        <span style={{ font: "var(--text-ui)", color: "var(--text-body)" }}>
          {rejoinOffer != null && liveBattles[rejoinOffer]
            ? liveBattles[rejoinOffer].Title + " is still running."
            : "A battle you were in is still running."}
        </span>
      </Dialog>

      {/* Login is accepted long before the directory flood that follows it
          lands, so this outlives the login screen. */}
      <LoadingDialog open={live && loadingIn} />
    </>
  );

  return (
    <AppShell view={view} inRoom={Boolean(liveRoom || room)} {...shell}
      /* Battles, pressed from the debriefing while still in a room, means the
         room - that is where the match came from and where the next one starts.
         Only from there: once you are in the room, Battles means the list
         again, so the "first press goes back" behaviour needs no flag to
         remember it. */
      onView={v => setView(
        v === "battles" && view === "debrief" && (liveRoom || room) ? "room" : v)}
      overlay={overlay} me={me}>
        <FirstRunInstallDialog
          open={askInstall}
          install={live ? install : undefined}
          engine={welcome?.Engine}
          root={managedInfo?.root}
          onClose={() => {
            setAskInstall(false);
            useSettings.getState().set({ installPromptSeen: true });
          }}
          onSettings={() => setView("settings")}
          onInstall={() => {
            setView("settings");
            void installManaged(welcome?.Engine);
          }} />
      <ErrorBoundary>{body}</ErrorBoundary>
    </AppShell>
  );
}
