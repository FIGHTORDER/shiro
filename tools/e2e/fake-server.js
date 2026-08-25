/**
 * A ZkLobbyServer good enough to drive the whole UI, injected into the page
 * before the app boots.
 *
 * The client's only contact with the outside world is four Tauri commands and
 * two events, so replacing `window.__TAURI_INTERNALS__` swaps the real server
 * for this one without the app knowing. That makes the live code paths - the
 * ones that only run inside Tauri - testable in a plain browser.
 *
 * It is a script, not a module, because it runs through
 * Playwright's addInitScript before any bundle loads.
 *
 * Usage from a test:
 *   await page.addInitScript({ path: "tools/e2e/fake-server.js" });
 *   ...
 *   await page.evaluate(() => window.__ZKS.push('BattleAdded {"Header":{...}}'));
 */
(() => {
  /** eventId -> {event, handler}. Ids are what `listen` hands back, and what
   *  `unlisten` gives us to take a handler back off. */
  const handlers = new Map();
  let nextId = 1;
  const emit = (event, payload) => {
    for (const [id, h] of handlers) {
      if (h.event === event) h.handler({ event, id, payload });
    }
  };

  const state = {
    /** Every line the client sent, for assertions. */
    sent: [],
    /** The version the updater should offer, or null for "you are current". */
    offerUpdate: null,
    /** Set when the app asked the updater to install. */
    installedUpdate: false,
    /** Lines the scripted responses have queued. */
    push: line => emit("zks://line", line),
    emitGame: status => emit("zks://game", status),
    /** Set by a test to intercept a command instead of the default reply. */
    onSend: null,
    /** Pull the socket out from under the client. */
    drop: reason => emit("zks://status", { kind: "disconnected", reason: reason || "reset by peer" }),
    /* What the peer does when the client dials. "ok" accepts and talks; "hang
       up" accepts and closes at once, which the relay reports as a connection
       followed immediately by a drop; "refuse" never completes, which it
       reports by failing the command instead. The last two are the two ways a
       connection can end before a login has begun. */
    connectAs: "ok",
    /** Dials so far, so a retry nobody asked for can be seen. */
    connects: 0,
    /* Content downloads. `missing` is what the preflight reports as absent, so
       a test can put the launcher through the download gate; `emitContent`
       stands in for the supervisor's events. */
    missing: [],
    lastJobId: null,
    /** A Shiro-managed install that nothing has been downloaded into. */
    managed: { root: "C:\\Users\\test\\AppData\\Roaming\\shiro\\zk",
      prepared: false, engineInstalled: false, archives: 0 },
    engineAsked: null,
    lastFetch: null,
    /* zero-k.info being unreadable, which is a different answer from "no such
       player" and has to look different on screen. Set to a reason to make
       every profile read reject the way the Rust side does when the site is
       unreachable, the markup has moved, or the request timed out. */
    webError: null,
    emitContent: status => emit("zks://content", status),
  };
  window.__ZKS = state;

  let jobCounter = 0;
  const line = (cmd, data) => cmd + " " + JSON.stringify(data);
  const soon = fn => setTimeout(fn, 5);

  /* Every MatchMakerStatus carries the counts, and the ones sent after a queue
     request used to carry a different, older set - so joining a queue emptied
     every row on the screen. Named once so they cannot drift again. */
  const QUEUE_COUNTS = { "1v1": 6, "1v1 Narrow": 3, Sortie: 9, Battle: 21, Coop: 3, "2v2+": 5 };
  const INGAME_COUNTS = { "1v1": 2, Sortie: 4, Battle: 14, Coop: 1 };

  /** The post-login flood, trimmed to what the screens actually read. */
  function flood() {
    state.push(line("User", { Name: "Qrow", AccountID: 1, Country: "GB", Clan: "ZKF",
      EffectiveElo: 1842.4, EffectiveMmElo: 1766, Level: 41, Rank: 4, IsAdmin: false, IsBot: false,
      BanMute: false, BanVotes: false, BanSpecChat: false, SyncVersion: 1, RawMmElo: 1766 }));
    // hexed founded battle 11 and is sitting in it, which is what makes
    // "join whatever that player is in" answerable.
    state.push(line("User", { Name: "hexed", AccountID: 2, Country: "US", Clan: "ZKF",
      BattleID: 11,
      EffectiveElo: 1790, EffectiveMmElo: 1701, Level: 33, Rank: 3, IsAdmin: false, IsBot: false,
      BanMute: false, BanVotes: false, BanSpecChat: false, SyncVersion: 1, RawMmElo: 1701 }));
    state.push(line("User", { Name: "lorelei", AccountID: 3, Country: "FR",
      EffectiveElo: 1588, EffectiveMmElo: 1550, Level: 19, Rank: 2, IsAdmin: false, IsBot: false,
      AwaySince: "2026-08-18T09:00:00Z",
      BanMute: false, BanVotes: false, BanSpecChat: false, SyncVersion: 1, RawMmElo: 1550 }));
    // A custom game on purpose: the room panel has to name what it runs, and a
    // room that is not Zero-K is the case that gets it wrong.
    state.push(line("BattleAdded", { Header: { BattleID: 11, Title: "Teams 8v8 - all welcome",
      Map: "Comet Catcher Redux", Founder: "hexed", PlayerCount: 9, MaxPlayers: 16,
      Game: "Supreme-K 3.42",
      SpectatorCount: 2, Mode: 6, IsRunning: false } }));
    state.push(line("BattleAdded", { Header: { BattleID: 12, Title: "private - do not join",
      Map: "Barren v3", Founder: "lorelei", PlayerCount: 4, MaxPlayers: 8, Password: "x",
      Mode: 4, IsRunning: false } }));
    state.push(line("BattleAdded", { Header: { BattleID: 13, Title: "running match",
      Map: "TartarusV7", Founder: "Qrow", PlayerCount: 12, MaxPlayers: 12, Mode: 6,
      IsRunning: true, RunningSince: "2026-08-18T09:30:00Z" } }));
    /* Two rooms nobody can walk into, because the list has to tell them apart
       from the ones you can. 14 is at its cap, which the server answers by
       quietly spectating whoever arrives. 15 is *over* its cap, which only
       happens where the server's time queue is on: everybody counts as a
       player until the game starts, and then the last to claim a slot are
       spectated. PlayerCount excludes spectators and bots, so it is the number
       MaxPlayers is measured against. Both are kept quieter than battle 11 so
       the busiest-room ordering above still has the same answer. */
    state.push(line("BattleAdded", { Header: { BattleID: 14, Title: "full house",
      Map: "Barren v3", Founder: "lorelei", PlayerCount: 6, MaxPlayers: 6,
      SpectatorCount: 0, Mode: 6, IsRunning: false } }));
    state.push(line("BattleAdded", { Header: { BattleID: 15, Title: "queue for a slot",
      Map: "Barren v3", Founder: "lorelei", PlayerCount: 8, MaxPlayers: 6,
      SpectatorCount: 0, Mode: 6, IsRunning: false, TimeQueueEnabled: true } }));
    /* The news every client is sent on connect. Three items rather than one,
       because the awkward shapes are the point: the second has no picture,
       which the server sends as the bare site URL rather than as an absent
       field, and the third is a headline on its own. Both are real - every
       field on a NewsItem is nullable and NullValueHandling.Ignore drops the
       ones that are. Only the first has a `Time`, which is already generous:
       `EventTime` is nullable and the site leaves it unset, so live items come
       back without one. */
    state.push(line("NewsList", { NewsItems: [
      { Header: "Cloakbots rebalanced in v1.14.9.0", Text: "Two new maps in the pool.",
        Time: "2026-08-19T18:30:00Z", Url: "https://zero-k.info/Forum/Thread/32123",
        Image: "http://zero-k.info/img/lobbynews/1.png" },
      { Header: "Summer 1v1 tournament", Text: "Sign-ups close on Sunday.",
        Url: "https://zero-k.info/Forum/Thread/32101", Image: "http://zero-k.info" },
      { Header: "Map contest results are up" },
    ] }));
    state.push(line("JoinChannelResponse", { Success: true, ChannelName: "zk",
      Channel: { ChannelName: "zk", IsDeluge: false, Users: ["Qrow", "hexed", "lorelei"],
        Topic: { Text: "Welcome to Zero-K", SetBy: "zk-admin" } } }));
    state.push(line("Say", { Place: 0, Target: "zk", User: "hexed", Text: "anyone up for teams",
      Time: "2026-08-18T09:51:00Z", IsEmote: false, Ring: false, AllowRelay: true }));
    state.push(line("FriendList", { Friends: [{ Name: "hexed" }, { Name: "lorelei" }] }));
    /* The queues ZkLobbyServer actually runs, names and descriptions verbatim
       from MatchMaker.cs, and nothing else - because nothing else is on the
       wire. `MatchMakerSetup.Queue` upstream declares Mode, MinSize, MaxSize,
       SafeMaps and the elo knobs, and marks every one of them [JsonIgnore]; our
       generated type lists them because gen-protocol.mjs reads the C# members
       and not that attribute, but a client never sees them. Serialised: Name,
       Description, Maps, Game, MaxPartySize. Maps is a few hundred internal map
       names per queue and nothing here reads it, so it is left out the way the
       server leaves out anything null.

       Seventeen of them, which is the point: this used to be two, and two
       queues will make any layout look fine. */
    state.push(line("MatchMakerSetup", { PossibleQueues: [
      { Name: "Sortie", MaxPartySize: 3,
        Description: "Play 2v2 or 3v3 with players of similar skill." },
      { Name: "Sortie Wide", MaxPartySize: 3, Description: "Play 2v2 or 3v3 with anyone." },
      { Name: "Battle", MaxPartySize: 6,
        Description: "Play 4v4, 5v5 or 6v6 with players of similar skill." },
      { Name: "Battle Wide", MaxPartySize: 6, Description: "Play 4v4, 5v5 or 6v6 with anyone." },
      { Name: "Coop", MaxPartySize: 5, Description: "Play together, against AI or chickens." },
      { Name: "1v1", MaxPartySize: 1, Description: "Play 1v1 with an opponent of similar skill." },
      { Name: "1v1 Narrow", MaxPartySize: 1, Description: "Play 1v1 with a closely matched opponent." },
      { Name: "1v1 Wide", MaxPartySize: 1,
        Description: "Play 1v1 with a potentially not-so-closely matched opponent." },
      { Name: "2v2+", MaxPartySize: 6, Description: "Play a casual 2v2 or larger with anyone." },
      { Name: "3v3+", MaxPartySize: 6, Description: "Play a casual 3v3 or larger with anyone." },
      { Name: "4v4+", MaxPartySize: 6, Description: "Play a casual 4v4 or larger with anyone." },
      { Name: "5v5+", MaxPartySize: 6, Description: "Play a casual 5v5 or larger with anyone." },
      { Name: "6v6+", MaxPartySize: 6, Description: "Play a casual 6v6 or larger with anyone." },
      { Name: "7v7+", MaxPartySize: 6, Description: "Play a casual 7v7 or larger with anyone." },
      { Name: "8v8+", MaxPartySize: 6, Description: "Play a casual 8v8 or larger with anyone." },
      { Name: "9v9+", MaxPartySize: 6, Description: "Play a casual 9v9 or larger with anyone." },
      { Name: "10v10+", MaxPartySize: 6, Description: "Play a casual 10v10 or larger with anyone." },
    ] }));
    state.push(line("MatchMakerStatus", { JoinedQueues: [], QueueCounts: QUEUE_COUNTS,
      IngameCounts: INGAME_COUNTS, UserCount: 100, UserCountDiscord: 12 }));
  }

  /** The roster of a battle we just joined. */
  function joined(battleID) {
    state.push(line("JoinBattleSuccess", {
      BattleID: battleID,
      Options: { commshare: "1", multiplier: "2.0" },
      Players: [
        { Name: "Qrow", AllyNumber: 0 },
        { Name: "hexed", AllyNumber: 1 },
        { Name: "lorelei", IsSpectator: true },
      ],
      Bots: [{ Name: "CAI-Brutal", AllyNumber: 1, AiLib: "CAI", Owner: "hexed" }],
    }));
    state.push(line("User", { Name: "Qrow", AccountID: 1, BattleID: battleID,
      IsAdmin: false, IsBot: false, BanMute: false, BanVotes: false, BanSpecChat: false,
      SyncVersion: 1, RawMmElo: 1766, EffectiveMmElo: 1766, EffectiveElo: 1842, Level: 41, Rank: 4 }));
    state.push(line("Say", { Place: 1, User: "hexed", Text: "hi", Time: "2026-08-18T10:00:00Z",
      IsEmote: false, Ring: false, AllowRelay: true }));
  }

  /** Default replies, so a test only scripts what it cares about. */
  function respond(raw) {
    const sp = raw.indexOf(" ");
    const cmd = sp < 0 ? raw : raw.slice(0, sp);
    const data = sp < 0 ? {} : JSON.parse(raw.slice(sp + 1));

    switch (cmd) {
      case "Register":
        // "shiro-taken" is the one name this server refuses, so a test can see
        // both outcomes.
        soon(() => state.push(line("RegisterResponse",
          data.Name === "shiro-taken" ? { ResultCode: 2 } : { ResultCode: 0 })));
        break;
      case "Login":
        soon(() => {
          /* "shiro-wrong" is refused, and the connection drops straight after -
             which is what the real server does, and the reason a refused login
             could turn into a reconnect loop replaying the same bad hash. */
          if (data.Name === "shiro-wrong") {
            state.logins = (state.logins ?? 0) + 1;
            // 3 is InvalidPassword; 2 would be InvalidName, which is a different message.
            state.push(line("LoginResponse", { ResultCode: 3, BanReason: "" }));
            soon(() => state.drop());
            return;
          }
          state.me = data.Name;
          state.push(line("LoginResponse", { ResultCode: 0, Name: data.Name, SessionToken: "t" }));
          flood();
        });
        break;
      /* The real server echoes a Say back to everyone in the channel or room,
         including the sender - that echo is how a sent line ever appears. This
         server did not, which is why nothing here ever exercised an INCOMING
         chat line, and so nothing caught the log failing to follow one. */
      case "Say":
        soon(() => state.push(line("Say", {
          Place: data.Place, Target: data.Target, User: state.me || "Qrow",
          Text: data.Text, Time: new Date(0).toISOString(),
        })));
        break;
      case "JoinBattle":
        soon(() => joined(data.BattleID));
        break;
      case "OpenBattle":
        soon(() => {
          state.push(line("BattleAdded", { Header: { BattleID: 99, Title: data.Header.Title,
            Map: data.Header.Map, Founder: "Qrow", PlayerCount: 1,
            MaxPlayers: data.Header.MaxPlayers, Mode: 0, IsRunning: false } }));
          joined(99);
        });
        break;
      /* The real server assigns the dictionary and broadcasts it to the room -
         there is no acknowledgement, the echo *is* the acknowledgement, and a
         client that does not wait for it is guessing. */
      case "SetModOptions":
        soon(() => state.push(line("SetModOptions", { Options: data.Options })));
        break;
      /* LeaveBattle gets no reply: the real server tells the *room* you left
         by re-sending User records, and says nothing to the leaver. Removing
         the battle here would be wrong - it is still open without us. */
      case "LeaveBattle":
        break;
      case "MatchMakerQueueRequest":
        soon(() => state.push(line("MatchMakerStatus", { JoinedQueues: data.Queues,
          QueueCounts: QUEUE_COUNTS, IngameCounts: INGAME_COUNTS,
          JoinedTime: new Date().toISOString(), UserCount: 100, UserCountDiscord: 12 })));
        break;
      case "AreYouReadyResponse":
        soon(() => state.push(line("AreYouReadyUpdate", { ReadyAccepted: data.Ready,
          LikelyToPlay: true, YourBattleSize: 4, YourBattleReady: 3 })));
        break;
      case "RequestConnectSpring":
        soon(() => state.push(line("ConnectSpring", { Engine: "2025.06.21", Game: "Zero-K v1.14.8.0",
          Ip: "128.0.0.1", Port: 8452, Map: "TartarusV7", ScriptPassword: "sp-9f2c", Mode: 6,
          Title: "running match", IsSpectator: false })));
        break;
      case "InviteToParty":
        // The invitee accepts instantly; both sides hear the same status.
        soon(() => state.push(line("OnPartyStatus", { PartyID: 7,
          UserNames: ["Qrow", data.UserName] })));
        break;
      case "PartyInviteResponse":
        soon(() => state.push(line("OnPartyStatus", {
          PartyID: data.PartyID, UserNames: data.Accepted ? ["Qrow", "hexed"] : [] })));
        break;
      case "LeaveParty":
        soon(() => state.push(line("OnPartyStatus", { PartyID: data.PartyID, UserNames: [] })));
        break;
      case "KickFromBattle":
        soon(() => state.push(line("JoinBattleSuccess", { BattleID: data.BattleID,
          Options: { commshare: "1", multiplier: "2.0" },
          Players: [{ Name: "Qrow", AllyNumber: 0 }],
          Bots: [{ Name: "CAI-Brutal", AllyNumber: 1, AiLib: "CAI", Owner: "hexed" }] })));
        break;
      case "UpdateBotStatus":
        soon(() => state.push(line("UpdateBotStatus", { Name: data.Name || "CAI-2",
          AiLib: data.AiLib, AllyNumber: data.AllyNumber, Owner: data.Owner })));
        break;
      case "UserProfile":
        soon(() => state.push(line("UserProfile", { Name: data.Name, Level: 33, Rank: 3,
          EffectiveElo: 1790, EffectiveMmElo: 1701, EffectivePwElo: 1400, Kudos: 0,
          Badges: ["veteran"] })));
        break;
      default:
        break;
    }
  }

  /* Tauri's own `unlisten` goes through this object rather than an invoke, so
     without it every teardown throws. */
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: (_event, eventId) => { handlers.delete(eventId); },
  };

  window.__TAURI_INTERNALS__ = {
    // The real one hands back an id and calls window[`_${id}`]; keeping the
    // function itself is equivalent and saves the indirection.
    transformCallback: cb => cb,
    async invoke(cmd, args) {
      switch (cmd) {
        case "plugin:event|listen": {
          const id = nextId++;
          handlers.set(id, { event: args.event, handler: args.handler });
          return id;
        }
        case "plugin:event|unlisten":
          handlers.delete(args.eventId);
          return;
        /* The opener plugin. Every external link leaves through it - an anchor
           that navigates the webview replaces the app with a web page and there
           is no way back - so a link that works is a link that got here.
           Recorded rather than acted on, which is also what stops a test
           opening ten browser windows. */
        case "plugin:opener|open_url":
          state.opened = args.url;
          return null;

        /* The updater. `offerUpdate` is what the endpoint would have answered;
           null is "you are current", which is the default so no other test
           trips over an offer it did not ask for.
           The shape is what @tauri-apps/plugin-updater's `Update` reads off the
           metadata - anything missing arrives as undefined and the app has to
           cope, which is the point of leaving `body` and `date` out. */
        case "plugin:updater|check":
          return state.offerUpdate
            ? { rid: 1, available: true, currentVersion: "0.2.100",
              version: state.offerUpdate }
            : null;
        case "plugin:updater|download_and_install":
        case "plugin:updater|download":
        case "plugin:updater|install":
          state.installedUpdate = true;
          return null;
        case "zks_connect":
          state.connects++;
          if (state.connectAs === "refuse") {
            throw new Error("connect " + args.host + ":" + args.port
              + " failed: connection refused");
          }
          soon(() => {
            emit("zks://status", { kind: "connected" });
            /* A socket the server closes the moment it accepts. The relay
               announces the connection it made and then the drop, in that
               order - a reader that leaves without saying anything is the bug
               this mode exists for. */
            if (state.connectAs === "hang up") {
              soon(() => state.drop("closed by server"));
              return;
            }
            state.push(line("Welcome", { Engine: "2025.06.21", Game: "Zero-K v1.14.8.0",
              UserCount: 100, Version: "1.0", UserCountLimited: false }));
          });
          return;
        case "zks_send":
          state.sent.push(args.line);
          if (state.onSend) state.onSend(args.line);
          respond(args.line);
          return;
        case "zks_password_hash":
          return "aGFzaA==";
        /* Zero-K's featured custom modes. Three shapes on purpose, because
           that is what the live service returns: one that names a game, one
           that names a map and runs on stock Zero-K, and one that is nothing
           but a modoption. */
        case "zks_game_modes":
          return [
            { shortName: "zkarena", displayName: "Arena Mod",
              game: "Arena Mod v1.0.10", options: { terrarestoreonly: "1" } },
            { shortName: "zeroWars", displayName: "Zero Wars",
              map: "ZeroWars v2.1.9", options: {} },
            { shortName: "techk", displayName: "Tech-K", options: { techk: "1" } },
          ];
        /* FindResourceData reaches the whole library - the tens of thousands of
           maps GetPublicCommunityInfo leaves out - and answers with far less
           about each: a name, a support level, an id and four flags. No size
           and no rating, which is the point: a screen showing one of these has
           to look thinner than one showing a catalogue entry.

           Real names and real ids, taken from the live service. The two the
           catalogue also carries are here so a search can be seen to rank them
           first; the rest are reachable no other way. */
        case "zks_find_maps": {
          const library = [
            { name: "Comet Catcher Redux v3.1", support: "MatchMaker", resourceId: 55646,
              is1v1: false, isTeams: true, isFfa: false, isSpecial: false },
            { name: "TartarusV7", support: "Featured", resourceId: 4242,
              is1v1: false, isTeams: true, isFfa: false, isSpecial: false },
            { name: "Red Comet Remake 1.7", support: "MatchMaker", resourceId: 58369,
              is1v1: true, isTeams: true, isFfa: false, isSpecial: false },
            { name: "Comet Catcher Reloaded 1.3", support: "None", resourceId: 20714,
              is1v1: false, isTeams: true, isFfa: false, isSpecial: false },
            { name: "Green Comet Basic", support: "None", resourceId: 8171,
              is1v1: false, isTeams: false, isFfa: false, isSpecial: false },
          ];
          const words = String(args.query || "").toLowerCase().split(/\s+/).filter(Boolean);
          const hits = library.filter(m => words.every(w => m.name.toLowerCase().includes(w)));
          const rank = s => ["MatchMaker", "Featured", "Supported"].indexOf(s) + 1 || 4;
          return hits.sort((a, b) => rank(a.support) - rank(b.support));
        }
        /* What Rust reads off a real install: Zero-K's nine LuaAIs out of the
           game archive, then the engine's skirmish AIs. BARb is absent because
           it is absent on a real install too - it ships with the engine and
           builds BAR units, so the reading drops it. */
        case "zks_list_ais":
          return {
            ais: [
              { lib: "CAI", name: "CAI", desc: "AI that plays regular Zero-K", source: "game" },
              { lib: "Chicken: Beginner", name: "Chicken: Beginner", desc: "For PvE in PvP games", source: "game" },
              { lib: "Chicken: Very Easy", name: "Chicken: Very Easy", desc: "For PvE in PvP games", source: "game" },
              { lib: "Chicken: Easy", name: "Chicken: Easy", desc: "Ice cold", source: "game" },
              { lib: "Chicken: Normal", name: "Chicken: Normal", desc: "Lukewarm", source: "game" },
              { lib: "Chicken: Hard", name: "Chicken: Hard", desc: "Will burn your ass", source: "game" },
              { lib: "Chicken: Suicidal", name: "Chicken: Suicidal", desc: "Flaming hell!", source: "game" },
              { lib: "Chicken: Custom", name: "Chicken: Custom",
                desc: "A chicken experience customizable using modoptions", source: "game" },
              { lib: "Null AI", name: "Null AI", desc: "Empty AI for testing purposes", source: "game" },
              { lib: "CircuitAI|stable", name: "CircuitAI",
                desc: "This AI is using the new C++ wrapper.", source: "engine" },
            ],
            note: null,
            // The archive the room asked for is the one that was read, so
            // nothing here is a guess and the picker says nothing about it.
            gameArchive: "named",
          };
        case "zks_disconnect":
          return;
        case "zks_locate_install":
          state.installRoot = args.root;
          // An override that is not a Zero-K folder fails the way Rust's does.
          if (args.root && !/zero-k/i.test(args.root)) {
            throw new Error(args.root + " is not a Zero-K installation - no engine/ with games, maps or pool beside it.");
          }
          return {
            root: args.root || "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Zero-K",
            source: args.root ? "settings" : "Steam",
          };
        /* What a launch would need. Nothing was stubbed here before, so the
           preflight rejected and prefetchForBattle swallowed it - which is how
           "we never tell the room we have the map" went unnoticed. Default is
           a complete install; `state.missing` makes it incomplete. */
        /* The site's map catalogue. One call answers for every map, which is
           what makes a link to a map's own page affordable. */
        /* The app launcher. The catalogue is compiled into the Rust binary,
           so this stub stands in for that constant. Springen is deliberately
           unavailable here, because that is its real state until it publishes
           a release - and it is the state most likely to look broken. */
        case "zka_catalogue":
          return [
            { id: "sprofiler", name: "Sprofiler", kind: "executable",
              summary: "Check whether Zero-K will run well on this machine",
              description: "Reads what the engine saw the last time it ran.",
              source: "github.com/FIGHTORDER/Sprofiler",
              unavailable: "No build published yet." },
            { id: "splaunch", name: "Splaunch", kind: "executable",
              summary: "Build Zero-K scenarios and play them",
              description: "Place units, set objectives, press Test.",
              source: "github.com/FIGHTORDER/Splaunch",
              unavailable: "No build published yet." },
            { id: "stournament", name: "Stournament", kind: "executable",
              summary: "Run a Zero-K tournament, and picture its map pool",
              description: "Tournament control and map pool images.",
              source: "github.com/FIGHTORDER/stournament", version: "1.0.0",
              download: "https://github.com/FIGHTORDER/stournament/releases/download/dev/Stournament_1.0.0_x64.zip",
              sha256: "9a765ccf71940bc27ac9dd98ec3101dd2dfe5865aca829ca0f3f1fae64d1c66a" },
            { id: "springen", name: "Springen", kind: "executable",
              summary: "Node-graph map generator for Spring and Zero-K",
              description: "Authors terrain and writes a finished .sd7.",
              source: "github.com/FIGHTORDER/Springen", version: "1.0.0",
              download: "https://github.com/FIGHTORDER/Springen/releases/download/dev/Springen_1.0.0_x64.zip",
              sha256: "5c24e8d464e555e3aee1ac469273e8f4daf5bf5ed5fe5adc7b2ecbc43d2204dd" },
          ];
        case "zka_status":
          return [
            { id: "sprofiler", installed: false },
            { id: "splaunch", installed: false },
            { id: "springen", installed: state.installed === "springen" },
          ];
        case "zka_install":
          state.sent.push("install " + args.id);
          state.installed = args.id;
          return null;
        case "zka_launch":
          state.sent.push("launched " + args.id);
          return null;

        /* The profiler. A machine with a real graphics card, so the happy path
           is what the screenshot shows. */
        /* The public catalogue: Featured and MatchMaker only, 343 of them
           against a library of tens of thousands. Every field the real one
           sends, spelled the way Rust serialises it - which is the thing that
           was wrong, and the reason this mock could not have caught it. */
        case "zks_map_catalogue":
          return [
            { name: "TartarusV7", resourceId: 4242, width: 16, height: 16,
              supportLevel: "Featured", is1v1: false, isTeams: true, isFfa: false,
              isChickens: false, isSpecial: false, isAssymetrical: false,
              hills: 2, waterLevel: 1, ratingSum: 40, ratingCount: 9 },
            { name: "Comet_Catcher_Redux", resourceId: 55646, width: 12, height: 16,
              supportLevel: "MatchMaker", is1v1: false, isTeams: true, isFfa: false,
              isChickens: false, isSpecial: false, isAssymetrical: false,
              hills: 1, waterLevel: 1, ratingSum: 26, ratingCount: 6 },
            { name: "Aberdeen3v3v3", resourceId: 7116, width: 16, height: 16,
              supportLevel: "Featured", is1v1: false, isTeams: false, isFfa: true,
              isChickens: false, isSpecial: false, isAssymetrical: false,
              ffaMaxTeams: 3, hills: 3, waterLevel: 1, ratingSum: 12, ratingCount: 4 },
          ];

        /* A player's zero-k.info page. `null` is "no such account" - the site
           says so in forty bytes - and is an answer, not a failure. */
        case "zkw_profile": {
          if (state.webError) throw new Error(state.webError);
          /* "Gholam" is nobody the lobby knows - an account that exists on the
             site but is not connected, which is the case the search exists for.
             Anything else is a miss, so the not-found path is reachable too. */
          if (args.who !== "hexed" && args.who !== "Gholam") return null;
          return {
            accountId: 4242, name: args.who, clan: "ZKF", level: 33,
            /* Name and icon agree, as they do on a real page: the icon's
               second digit is the rank, and rank 3 is Subgiant. */
            rank: "Subgiant", rankIcon: "3_3",
            badges: ["Silver donator"],
            awards: [{ key: "pwn", name: "Complete Annihilation", count: 812 }],
            battlesPlayed: 1904, battlesWatched: 233,
            firstLogin: "6 years ago", lastLogin: "20 minutes ago",
            forumKarma: 12, recent: [],
          };
        }
        /* Chronological, and the last point is where they are now - which is
           the only rating there is for somebody who is not connected. */
        case "zkw_ratings":
          if (state.webError) throw new Error(state.webError);
          return [
            { date: "2026-08-01", elo: 1750 },
            { date: "2026-08-10", elo: 1793.4 },
          ];

        case "zks_content_preflight":
          return {
            install: { root: state.installRoot || "C:\Zero-K", source: "Steam" },
            engineOk: true,
            downloader: "pr-downloader.exe",
            items: state.missing || [],
            writable: true,
          };

        /* The real one queues a job and returns its id; the supervisor then
           reports progress and a finish. Here the test drives those. */
        case "zks_content_fetch": {
          const id = "job-" + (++jobCounter);
          state.lastJobId = id;
          state.lastFetch = { installRoot: args.installRoot, items: args.items };
          state.emitContent({ kind: "queued", id, items: args.items || [] });
          return id;
        }

        case "zks_content_cancel":
          state.emitContent({ kind: "finished", id: args.id, outcome: "killed" });
          return null;

        /* Zero-K installed by Shiro rather than found. The real ones create
           a directory and fetch a 45 MB engine; here the test drives the
           state so the screen can be checked without downloading anything. */
        case "zks_managed_root":
          return state.managed.root;

        case "zks_managed_state":
          return { ...state.managed, engineInstalled: state.managed.engineInstalled };

        case "zks_managed_prepare":
          state.managed.prepared = true;
          return state.managed.root;

        case "zks_managed_install_engine":
          state.engineAsked = args.version;
          emit("zks://engine", { kind: "progress", received: 22, total: 44 });
          state.managed.prepared = true;
          state.managed.engineInstalled = true;
          return state.managed.root + "\\engine";

        case "zks_managed_remove":
          state.managed.prepared = false;
          state.managed.engineInstalled = false;
          state.managed.archives = 0;
          return null;

        case "zks_launch_preview": {
          const root = state.installRoot
            || "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Zero-K";
          if (!args.engine) throw new Error("Zero-K is installed but engine  is not.");
          const exe = root + "\\engine\\win64\\" + args.engine + "\\spring.exe";
          return {
            install: { root, source: state.installRoot ? "settings" : "Steam" },
            exe,
            cwd: root + "\\engine\\win64\\" + args.engine,
            args: ["C:\\Users\\you\\AppData\\Local\\Temp\\shiro\\connect_script.txt"],
            env: [["SPRING_DATADIR", root], ["SPRING_WRITEDIR", root]],
            scriptPath: "C:\\Users\\you\\AppData\\Local\\Temp\\shiro\\connect_script.txt",
            script: "[GAME]\n{\nHostIP=0.0.0.0;\nHostPort=0;\nIsHost=0;\nMyPlayerName="
              + args.player + ";\nMyPasswd=preview;\n}\n",
          };
        }
        case "zks_launch_spring":
          state.launched = args.req;
          soon(() => emit("zks://game", { kind: "launched", pid: 4242 }));
          return 4242;
        default:
          throw new Error("fake-server: unstubbed command " + cmd);
      }
    },
  };
})();
