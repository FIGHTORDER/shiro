/**
 * The generated types must describe the wire, not the server's class files.
 *
 * `tools/gen-protocol.mjs` reads upstream C# and emits `types.ts`. Its member
 * pattern matched attributes and threw them away, so a member marked
 * `[JsonIgnore]` - which Newtonsoft drops in both directions - was emitted as
 * though it arrived. The result is the worst kind of wrong: a field that is
 * always `undefined` and typed as though it never is, so nothing complains and
 * the feature reading it silently does nothing.
 *
 * Two of those shipped. `MatchMakerSetup.Queue` declares `Mode`, `MinSize` and
 * `MaxSize` - exactly what a client would sort queues by - and marks all three
 * `[JsonIgnore]`, so a screen written against them read nothing. `User.PartyID`
 * is the same, and the party marker in the room has never once been drawn.
 *
 * These read the emitted file rather than run the generator: the generator
 * fetches upstream at a pinned SHA and a test that needs the network is a test
 * that fails on a train. Regenerating with a broken generator puts these fields
 * back, which is exactly when this should fail.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const types = readFileSync("src/protocol/types.ts", "utf8");

/** The interface body for `name`, so a field check cannot match a neighbour. */
function iface(name: string): string {
  const start = types.indexOf(`export interface ${name} {`);
  assert.notEqual(start, -1, `types.ts has no interface ${name}`);
  const end = types.indexOf("\n}", start);
  return types.slice(start, end);
}

test("a queue does not claim the sizes the server keeps to itself", () => {
  /* Named individually rather than as a loop over one list, so a failure says
     which field came back. */
  const queue = iface("MatchMakerSetup_Queue");
  for (const field of ["Mode", "MinSize", "MaxSize", "SafeMaps", "EloCutOffExponent"]) {
    assert.ok(!new RegExp(`^\\s*${field}\\??:`, "m").test(queue),
      `Queue.${field} is [JsonIgnore] upstream and cannot arrive`);
  }
});

test("a queue still carries what the server does send", () => {
  /* The other half of the pair: a generator that dropped too much would pass
     the test above and break everything that reads a queue. */
  const queue = iface("MatchMakerSetup_Queue");
  for (const field of ["Name", "Description", "Maps", "Game", "MaxPartySize"]) {
    assert.ok(new RegExp(`^\\s*${field}\\??:`, "m").test(queue),
      `Queue.${field} is on the wire and must be typed`);
  }
});

test("a user does not claim a party, an address or a sync version", () => {
  const user = iface("User");
  for (const field of ["PartyID", "IpAddress", "SyncVersion", "RawMmElo"]) {
    assert.ok(!new RegExp(`^\\s*${field}\\??:`, "m").test(user),
      `User.${field} is [JsonIgnore] upstream and cannot arrive`);
  }
  assert.ok(/^\s*Name\??:/m.test(user), "User.Name is on the wire and must be typed");
});

test("the news the server sends arrives as news, not as ten unknowns", () => {
  /* `NewsList` is declared in Messages.cs, which the generator reads, but
     `NewsItem` is declared in the content service's API file, which it did not.
     A member whose type cannot be resolved degrades to `unknown`, silently -
     so `NewsItems` came out as `unknown[]` and the ten items ZkLobbyServer
     pushes to every client on connect were untyped and unread. Same for the
     ladder and the forum lists beside it. */
  assert.match(iface("NewsList"), /^\s*NewsItems\?: NewsItem\[\];/m);
  assert.match(iface("LadderList"), /^\s*LadderItems\?: LadderItem\[\];/m);
  assert.match(iface("ForumList"), /^\s*ForumItems\?: ForumItem\[\];/m);
});

test("a news item is five nullable strings, every one of them optional", () => {
  /* The other half of the pair: resolving the name is worth nothing if the
     fields are wrong. All five are reference types or `DateTime?`, and the
     server sets NullValueHandling.Ignore, so all five can simply be absent -
     an item with a headline and nothing else is a legal item and the strip has
     to draw it. A generator that marked any of them required would be lying. */
  const item = iface("NewsItem");
  for (const field of ["Header", "Text", "Time", "Url", "Image"]) {
    assert.match(item, new RegExp(`^\\s*${field}\\?: string;`, "m"),
      `NewsItem.${field} can be absent from the JSON`);
  }
});

test("what we say is not decorated with a field the server drops", () => {
  /* `Say.AllowRelay` is [JsonIgnore] and commented upstream as being needed
     only inside the server. We used to send it on every line of chat. */
  assert.ok(!/^\s*AllowRelay\??:/m.test(iface("Say")));
});
