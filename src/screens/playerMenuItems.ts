/**
 * What the menu on a name offers.
 *
 * Here rather than in `PlayerMenu.jsx` for the reason `appState.ts` is not in
 * `AppsScreen.jsx`: a `.jsx` cannot be imported by a test, and this got
 * something wrong that only a test would have caught.
 *
 * What it got wrong: bots returned early with no items at all. So an AI added
 * to a room had an empty menu, and there was no way to remove one - reported as
 * "cannot kick added clankers as host". The `kick` and `removeBot` actions had
 * both existed in `store/room.ts` since the room was built; nothing ever called
 * them.
 *
 * `me` gets a shorter menu: befriending or reporting yourself is not a thing,
 * and offering it is the kind of detail that makes a menu feel unconsidered.
 */

export interface MenuUser {
  name: string;
  /** A bot has no account, so most of the menu is meaningless for one. */
  bot?: boolean;
}

/** Every action a caller may supply. All optional: a screen offers what it can. */
export interface MenuActions {
  message?: (name: string) => void;
  profile?: (name: string) => void;
  friend?: (name: string) => void;
  unfriend?: (name: string) => void;
  ignore?: (name: string) => void;
  unignore?: (name: string) => void;
  report?: (name: string) => void;
  /** Host only. */
  kick?: (name: string) => void;
  /** Host only, and the only thing a bot's menu carries. */
  removeBot?: (name: string) => void;
}

export interface MenuItem {
  label?: string;
  icon?: string;
  danger?: boolean;
  divider?: boolean;
  onSelect?: () => void;
}

export interface MenuInput {
  user?: MenuUser;
  me?: string;
  friends?: string[];
  ignores?: string[];
  actions: MenuActions;
  /**
   * Whether this viewer may remove people from the room.
   *
   * The server's rule, and the same one that gates the room's options: the
   * founder, or an admin. Gated here as well as there because a menu that
   * offers something the server will refuse is worse than one that does not
   * offer it.
   */
  canManage?: boolean;
}

export function playerMenuItems({
  user, me, friends, ignores, actions, canManage,
}: MenuInput): MenuItem[] {
  if (!user) return [];
  const name = user.name;

  if (user.bot) {
    return canManage && actions.removeBot
      ? [{
          label: "Remove", icon: "user-minus", danger: true,
          onSelect: () => actions.removeBot?.(name),
        }]
      : [];
  }

  const self = name === me;
  const isFriend = friends?.includes(name);
  const isIgnored = ignores?.includes(name);

  return [
    !self && actions.message
      && { label: "Message", icon: "message-square", onSelect: () => actions.message?.(name) },
    actions.profile
      && { label: "Profile", icon: "user", onSelect: () => actions.profile?.(name) },
    !self && { divider: true },
    !self && actions.friend && (isFriend
      ? { label: "Remove friend", icon: "user-minus", onSelect: () => actions.unfriend?.(name) }
      : { label: "Add friend", icon: "user-plus", onSelect: () => actions.friend?.(name) }),
    !self && actions.ignore && (isIgnored
      ? { label: "Unignore", icon: "volume-2", onSelect: () => actions.unignore?.(name) }
      : { label: "Ignore", icon: "volume-x", onSelect: () => actions.ignore?.(name) }),
    !self && actions.report
      && { label: "Report...", icon: "flag", danger: true, onSelect: () => actions.report?.(name) },
    /* The host's own control, and last because it is the destructive one. */
    !self && canManage && actions.kick && { divider: true },
    !self && canManage && actions.kick
      && {
        label: "Kick from battle", icon: "log-out", danger: true,
        onSelect: () => actions.kick?.(name),
      },
  ].filter(Boolean) as MenuItem[];
}
