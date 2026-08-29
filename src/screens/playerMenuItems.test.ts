import assert from "node:assert/strict";
import test from "node:test";

import { playerMenuItems } from "./playerMenuItems.ts";
import type { MenuActions } from "./playerMenuItems.ts";

/** Everything a screen could offer, so absence is never the reason an item is missing. */
function allActions(): MenuActions {
  return {
    message: () => {}, profile: () => {}, friend: () => {}, unfriend: () => {},
    ignore: () => {}, unignore: () => {}, report: () => {},
    kick: () => {}, removeBot: () => {},
  };
}

const labels = (items: ReturnType<typeof playerMenuItems>) =>
  items.filter(i => i.label).map(i => i.label);

test("a bot a host can manage offers a way to remove it", () => {
  /* The reported bug: an added AI had an empty menu, so there was no way to
     take one out of a room. `removeBot` had existed unused since the room was
     written. */
  const items = playerMenuItems({
    user: { name: "CAI", bot: true }, me: "Qrow", actions: allActions(), canManage: true,
  });
  assert.deepEqual(labels(items), ["Remove"]);
});

test("a bot offers nothing to somebody who is not the host", () => {
  // The server would refuse it, and a menu that offers a refusal is worse.
  const items = playerMenuItems({
    user: { name: "CAI", bot: true }, me: "Qrow", actions: allActions(), canManage: false,
  });
  assert.deepEqual(items, []);
});

test("a bot is never offered the things that need an account", () => {
  const items = playerMenuItems({
    user: { name: "CAI", bot: true }, me: "Qrow", actions: allActions(), canManage: true,
  });
  for (const gone of ["Message", "Profile", "Add friend", "Ignore", "Report..."]) {
    assert.ok(!labels(items).includes(gone), `${gone} is meaningless for a bot`);
  }
});

test("a host can kick another player", () => {
  const items = playerMenuItems({
    user: { name: "hexed" }, me: "Qrow", actions: allActions(), canManage: true,
  });
  assert.ok(labels(items).includes("Kick from battle"));
});

test("a player who is not the host is not offered a kick", () => {
  const items = playerMenuItems({
    user: { name: "hexed" }, me: "Qrow", actions: allActions(), canManage: false,
  });
  assert.ok(!labels(items).includes("Kick from battle"));
});

test("a host is not offered a way to kick themselves", () => {
  const items = playerMenuItems({
    user: { name: "Qrow" }, me: "Qrow", actions: allActions(), canManage: true,
  });
  assert.ok(!labels(items).includes("Kick from battle"));
});

test("an action a screen does not supply is not offered", () => {
  /* Every action is optional, so a screen with no kick handler must not show a
     kick that would do nothing. */
  const items = playerMenuItems({
    user: { name: "hexed" }, me: "Qrow", actions: { profile: () => {} }, canManage: true,
  });
  assert.deepEqual(labels(items), ["Profile"]);
});

test("selecting an item calls the action with that name", () => {
  const kicked: string[] = [];
  const items = playerMenuItems({
    user: { name: "hexed" }, me: "Qrow",
    actions: { ...allActions(), kick: n => kicked.push(n) }, canManage: true,
  });
  items.find(i => i.label === "Kick from battle")!.onSelect!();
  assert.deepEqual(kicked, ["hexed"]);
});

test("the destructive items are marked as such", () => {
  const asBot = playerMenuItems({
    user: { name: "CAI", bot: true }, me: "Qrow", actions: allActions(), canManage: true,
  });
  assert.equal(asBot[0].danger, true);
  const asPlayer = playerMenuItems({
    user: { name: "hexed" }, me: "Qrow", actions: allActions(), canManage: true,
  });
  assert.equal(asPlayer.find(i => i.label === "Kick from battle")!.danger, true);
});

test("no user at all is an empty menu rather than a crash", () => {
  assert.deepEqual(playerMenuItems({ actions: allActions() }), []);
});
