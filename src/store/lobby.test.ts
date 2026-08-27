/**
 * Run with:  node --test src/store/lobby.test.ts
 * (Node strips the types; imports need explicit .ts extensions and this file
 * must not import an enum - see protocol/wire.test.ts.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import type { Message } from "../protocol/registry.ts";
import { useLobby } from "./lobby.ts";

function msg(cmd: string, data: unknown): Message {
  return { cmd, data } as unknown as Message;
}

const fresh = () => useLobby.getState().reset();

test("battle records are merged, so a partial update cannot blank a title", () => {
  fresh();
  useLobby.getState().applyMessage(msg("BattleAdded", {
    Header: { BattleID: 3, Title: "Teams", Map: "Comet Catcher Redux", PlayerCount: 4 },
  }));
  useLobby.getState().applyMessage(msg("BattleUpdate", { Header: { BattleID: 3, PlayerCount: 5 } }));
  const b = useLobby.getState().battles[3];
  assert.equal(b.Title, "Teams");
  assert.equal(b.PlayerCount, 5);
});

test("the default engine and game follow the server without a new Welcome", () => {
  fresh();
  useLobby.getState().applyMessage(msg("Welcome", {
    Engine: "2025.06.21", Game: "Zero-K v1.14.8.0", UserCount: 100, UserCountLimited: false,
  }));
  useLobby.getState().applyMessage(msg("DefaultEngineChanged", { Engine: "2025.07.01" }));
  assert.equal(useLobby.getState().welcome!.Engine, "2025.07.01");
  assert.equal(useLobby.getState().welcome!.Game, "Zero-K v1.14.8.0", "the rest survives");
  useLobby.getState().applyMessage(msg("DefaultGameChanged", { Game: "Zero-K v1.15" }));
  assert.equal(useLobby.getState().welcome!.Game, "Zero-K v1.15");
});

test("a kick from the server is recorded with its reason", () => {
  fresh();
  useLobby.getState().applyMessage(msg("KickFromServer", { Name: "Qrow", Reason: "spamming" }));
  assert.equal(useLobby.getState().kicked!.reason, "spamming");
  useLobby.getState().clearKick();
  assert.equal(useLobby.getState().kicked, undefined);
});

test("a kick with no reason still says something", () => {
  fresh();
  useLobby.getState().applyMessage(msg("KickFromServer", {}));
  assert.match(useLobby.getState().kicked!.reason, /No reason/);
});

test("reconnecting forgets the directory but keeps the session", () => {
  fresh();
  useLobby.getState().applyMessage(msg("LoginResponse", { ResultCode: 0, Name: "Qrow" }));
  useLobby.getState().applyMessage(msg("BattleAdded", { Header: { BattleID: 1, Title: "x" } }));
  useLobby.getState().applyMessage(msg("User", { Name: "hexed", AccountID: 2 }));
  useLobby.getState().resetDirectory();
  assert.deepEqual(useLobby.getState().battles, {});
  assert.deepEqual(useLobby.getState().users, {});
  assert.equal(useLobby.getState().me, "Qrow", "we are still logged in");
});

test("an unknown command is counted, not thrown away silently", () => {
  fresh();
  useLobby.getState().applyMessage(msg("PwStatus", { MinLevel: 1 }));
  assert.equal(useLobby.getState().unhandled.PwStatus, 1);
});

test("a server message box is not chat, and is not scrolled past", () => {
  fresh();
  useLobby.getState().applyMessage(msg("Say", {
    Place: 5, Text: "You have been muted for 10 minutes.",
    IsEmote: false, Ring: false,
  }));
  assert.deepEqual(useLobby.getState().notices, ["You have been muted for 10 minutes."]);
  assert.equal(useLobby.getState().chat.length, 0, "and does not land in the chat log");
  useLobby.getState().clearNotice();
  assert.deepEqual(useLobby.getState().notices, []);
});

test("notices queue rather than replace each other", () => {
  fresh();
  for (const text of ["first", "second"]) {
    useLobby.getState().applyMessage(msg("Say", {
      Place: 5, Text: text, IsEmote: false, Ring: false,
    }));
  }
  assert.deepEqual(useLobby.getState().notices, ["first", "second"]);
});

test("two notices in one batch both survive", () => {
  fresh();
  useLobby.getState().applyBatch([
    msg("Say", { Place: 5, Text: "a", IsEmote: false, Ring: false }),
    msg("Say", { Place: 5, Text: "b", IsEmote: false, Ring: false }),
  ]);
  assert.deepEqual(useLobby.getState().notices, ["a", "b"]);
});

test("the news the server sends on connect is kept, not counted as unhandled", () => {
  fresh();
  useLobby.getState().applyMessage(msg("NewsList", {
    NewsItems: [
      { Header: "Zero-K v1.14.8.0", Text: "Cloakbots rebalanced.",
        Time: "2026-08-19T18:30:00Z", Url: "https://zero-k.info/Forum/Thread/1",
        Image: "http://zero-k.info/img/lobbynews/1.png" },
    ],
  }));
  assert.equal(useLobby.getState().news.length, 1);
  assert.equal(useLobby.getState().news[0].Header, "Zero-K v1.14.8.0");
  assert.equal(useLobby.getState().unhandled.NewsList, undefined,
    "it was landing in the unhandled counter and being thrown away");
});

/* NewsListManager rebuilds the whole cache and broadcasts it again, so the
   second list is the list - an item deleted on the site has to disappear here,
   which a merge would never let it do. */
test("a second news list replaces the first rather than adding to it", () => {
  fresh();
  useLobby.getState().applyMessage(msg("NewsList", {
    NewsItems: [{ Header: "old" }, { Header: "older" }],
  }));
  useLobby.getState().applyMessage(msg("NewsList", { NewsItems: [{ Header: "new" }] }));
  assert.deepEqual(useLobby.getState().news, [{ Header: "new" }]);
});

test("a news list with nothing in it, or nothing usable in it, is not a crash", () => {
  fresh();
  useLobby.getState().applyMessage(msg("NewsList", {}));
  assert.deepEqual(useLobby.getState().news, [], "NewsItems can be absent entirely");
  useLobby.getState().applyMessage(msg("NewsList", { NewsItems: [null, "surprise", { Header: "x" }] }));
  assert.deepEqual(useLobby.getState().news, [{ Header: "x" }],
    "only objects survive the cast into the hand-written shape");
});

test("a user who left a battle is not still in it", () => {
  fresh();
  useLobby.getState().applyMessage(msg("User", {
    Name: "hexed", AccountID: 2, BattleID: 11,
    AwaySince: "2026-08-18T09:00:00Z", InGameSince: "2026-08-18T09:30:00Z",
  }));
  assert.equal(useLobby.getState().users.hexed.BattleID, 11);

  /* The server rebuilds the whole record on every change and omits what is
     null, so leaving a room arrives as a `User` with no BattleID at all.
     Merged as "absent means unchanged", they never left. */
  useLobby.getState().applyMessage(msg("User", { Name: "hexed", AccountID: 2, Clan: "ZKF" }));
  const u = useLobby.getState().users.hexed;
  assert.equal(u.BattleID, undefined, "still listed in a battle they left");
  assert.equal(u.AwaySince, undefined, "still greyed out as away");
  assert.equal(u.InGameSince, undefined, "still shown as in a game");
  assert.equal(u.Clan, "ZKF", "and what the broadcast does carry is kept");
});

test("a user who left their clan is not still wearing its tag", () => {
  fresh();
  useLobby.getState().applyMessage(msg("User", {
    Name: "hexed", AccountID: 2, Clan: "ZKF", Faction: "Dynasty",
    Country: "US", Avatar: "corsair", Icon: "supporter", Badges: ["dev"],
  }));
  assert.equal(useLobby.getState().users.hexed.Clan, "ZKF");

  /* Same shape of thing as leaving a battle: the record is rebuilt whole and
     the field is simply gone. Only three names used to be read that way, so
     the clan tag, the faction and the avatar stayed on screen for the rest of
     the session. */
  useLobby.getState().applyMessage(msg("User", { Name: "hexed", AccountID: 2, Country: "US" }));
  const u = useLobby.getState().users.hexed;
  assert.equal(u.Clan, undefined, "still in a clan they left");
  assert.equal(u.Faction, undefined, "still in a faction they left");
  assert.equal(u.Avatar, undefined);
  assert.equal(u.Icon, undefined);
  assert.equal(u.Badges, undefined);
  assert.equal(u.Country, "US", "and what is still there is still there");
});

test("a user update that still names a battle keeps it", () => {
  fresh();
  useLobby.getState().applyMessage(msg("User", { Name: "hexed", AccountID: 2, BattleID: 11 }));
  useLobby.getState().applyMessage(msg("User", { Name: "hexed", AccountID: 2, BattleID: 11, Country: "US" }));
  assert.equal(useLobby.getState().users.hexed.BattleID, 11);
  assert.equal(useLobby.getState().users.hexed.Country, "US");
});

test("an engine change in the same batch as a Welcome does not throw the Welcome away", () => {
  fresh();
  useLobby.getState().applyBatch([
    msg("Welcome", {
      Engine: "2025.06.21", Game: "Zero-K v1.14.8.0", UserCount: 100, UserCountLimited: false,
    }),
    msg("DefaultEngineChanged", { Engine: "2025.07.01" }),
  ]);
  const w = useLobby.getState().welcome!;
  assert.equal(w.Engine, "2025.07.01", "the newer engine wins");
  assert.equal(w.Game, "Zero-K v1.14.8.0", "and the Welcome it arrived with survives");
  assert.equal(w.UserCount, 100);
});

test("a batch that changes nothing leaves the directories alone", () => {
  fresh();
  useLobby.getState().applyMessage(msg("User", { Name: "hexed", AccountID: 2 }));
  const before = useLobby.getState();
  // A room full of chatter is `Say` after `Say`; cloning every directory for
  // each frame of it is four new objects a frame, sized by everyone online.
  useLobby.getState().applyBatch([
    msg("Say", { Place: 0, Target: "zk", User: "hexed", Text: "hi",
      IsEmote: false, Ring: false }),
  ]);
  const after = useLobby.getState();
  assert.equal(after.users, before.users, "the user directory was rebuilt for nothing");
  assert.equal(after.battles, before.battles);
});
