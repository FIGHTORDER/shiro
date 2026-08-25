/**
 * Run with:  node --test src/store/site.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseSiteCommand, channelOf, isExternalUrl, splitLinks, externalHref, useSite } from "./site.ts";
import type { Message } from "../protocol/registry.ts";

test("a bare path is a path", () => {
  assert.deepEqual(parseSiteCommand("battles"), { path: "battles", actions: [] });
});

test("the zk:// prefix is optional and case-insensitive", () => {
  assert.equal(parseSiteCommand("ZK://chat/channel/zk").path, "chat/channel/zk");
  assert.equal(parseSiteCommand("zk://battles").path, "battles");
});

test("actions come after the path, one per @", () => {
  const c = parseSiteCommand("battles@join_battle:hexed@add_friend:lorelei");
  assert.equal(c.path, "battles");
  assert.deepEqual(c.actions, [
    { command: "join_battle", arg: "hexed" },
    { command: "add_friend", arg: "lorelei" },
  ]);
});

test("an argument keeps its colons, because maps and urls have them", () => {
  const c = parseSiteCommand("@start_replay:http://a/b.sdfz,1,2,3");
  assert.deepEqual(c.actions, [{ command: "start_replay", arg: "http://a/b.sdfz,1,2,3" }]);
  assert.equal(c.path, "");
});

test("an action with no argument still parses", () => {
  assert.deepEqual(parseSiteCommand("@logout").actions, [{ command: "logout", arg: "" }]);
});

test("channels are recognised, and nothing else is", () => {
  assert.equal(channelOf("chat/channel/zk"), "zk");
  assert.equal(channelOf("chat/channel"), undefined);
  assert.equal(channelOf("battles"), undefined);
});

test("external urls are told apart from lobby paths", () => {
  assert.equal(isExternalUrl("https://zero-k.info/Maps"), true);
  assert.equal(isExternalUrl("www.zero-k.info"), true);
  assert.equal(isExternalUrl("battles"), false);
  assert.equal(isExternalUrl("chat/channel/zk"), false);
});

test("only the newest command is pending, and it is taken once", () => {
  const msg = (Command: string): Message =>
    ({ cmd: "SiteToLobbyCommand", data: { Command } }) as unknown as Message;
  useSite.getState().reset();
  useSite.getState().applyMessage(msg("battles"));
  useSite.getState().applyMessage(msg("@add_friend:hexed"));
  assert.deepEqual(useSite.getState().take()!.actions, [{ command: "add_friend", arg: "hexed" }]);
  assert.equal(useSite.getState().take(), undefined);
});

/* Linkifying chat. Zero-K's own server writes these lines - PlanetWarsMatchMaker
   says "starts on zk://@join_player:<name>" and FriendJoinedBattleLine writes
   "zk://@join_battle:<id>" - and until now they were plain text in Shiro while
   ZeroKLobby made them clickable. */

const kinds = (t: string) => splitLinks(t).map(c => `${c.kind}:${c.text}`);

test("a line with nothing in it comes back whole", () => {
  assert.deepEqual(splitLinks("good game everyone"),
    [{ text: "good game everyone", kind: "text" }]);
});

test("the server's own join links are links", () => {
  assert.deepEqual(kinds("Battle for planet Tera starts on zk://@join_player:Qrow"),
    ["text:Battle for planet Tera starts on ", "zk:zk://@join_player:Qrow"]);
});

test("a link in the middle of a sentence keeps the sentence", () => {
  assert.deepEqual(kinds("come to zk://@join_battle:5, it is a good map"),
    ["text:come to ", "zk:zk://@join_battle:5", "text:, it is a good map"]);
});

test("a full stop ends the sentence, not the address", () => {
  /* And it stays in the line: trimming it off the link must not delete it from
     what the reader sees, or the sentence quietly loses its punctuation. */
  assert.deepEqual(kinds("see https://zero-k.info/Maps."),
    ["text:see ", "external:https://zero-k.info/Maps", "text:."]);
});

test("www without a scheme still opens somewhere", () => {
  assert.deepEqual(kinds("www.zero-k.info is the site"),
    ["external:www.zero-k.info", "text: is the site"]);
  assert.equal(externalHref("www.zero-k.info"), "https://www.zero-k.info");
  assert.equal(externalHref("http://zero-k.info/x"), "http://zero-k.info/x");
});

test("several links in one line all count", () => {
  assert.deepEqual(kinds("zk://@join_battle:1 or https://zero-k.info"),
    ["zk:zk://@join_battle:1", "text: or ", "external:https://zero-k.info"]);
});

test("a bare word that merely mentions zk is not a link", () => {
  assert.deepEqual(kinds("zk is the game"), ["text:zk is the game"]);
});

test("what splitLinks finds, parseSiteCommand can act on", () => {
  /* The two halves have to agree or a clickable link does nothing. */
  const [, link] = splitLinks("go to zk://@join_battle:42");
  assert.equal(link.kind, "zk");
  assert.deepEqual(parseSiteCommand(link.text).actions,
    [{ command: "join_battle", arg: "42" }]);
});

/* A `zk://` link followed from outside Shiro. It arrives through
   src/net/deeplink.js and lands in the same pending slot the website's
   SiteToLobbyCommand uses, which is what makes one handler enough - and what
   makes a link followed before login wait rather than being lost. */

test("a followed link becomes a pending command", () => {
  useSite.getState().reset();
  useSite.getState().offer("zk://@join_player:Qrow");
  assert.deepEqual(useSite.getState().pending, {
    path: "", actions: [{ command: "join_player", arg: "Qrow" }],
  });
});

test("and waits to be taken, however long login takes", () => {
  /* The app only drains this once the session is live, so nothing here expires
     it. A link followed against a closed Shiro is acted on after login, not
     dropped on the login screen. */
  useSite.getState().reset();
  useSite.getState().offer("zk://battles");
  assert.equal(useSite.getState().pending?.path, "battles");
  assert.equal(useSite.getState().take()?.path, "battles");
  assert.equal(useSite.getState().take(), undefined, "taken once, not twice");
});

test("the newest link wins, because they arrive one click at a time", () => {
  useSite.getState().reset();
  useSite.getState().offer("zk://@join_battle:1");
  useSite.getState().offer("zk://@join_battle:2");
  assert.deepEqual(useSite.getState().pending?.actions, [{ command: "join_battle", arg: "2" }]);
});

test("an empty or blank link is not a command", () => {
  useSite.getState().reset();
  useSite.getState().offer("   ");
  assert.equal(useSite.getState().pending, undefined);
});
