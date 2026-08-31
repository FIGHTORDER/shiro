/**
 * How many times each published asset has been downloaded.
 *
 *   node tools/downloads.mjs
 *   node tools/downloads.mjs --json
 *
 * Public API, no token: unauthenticated GitHub allows 60 requests an hour and
 * this needs one per repository. If that runs out the script says so rather
 * than printing zeroes, because a zero that means "rate limited" and a zero
 * that means "nobody downloaded it" look identical and only one of them is
 * worth acting on.
 *
 * ## Reading the numbers
 *
 * Three things to know before drawing conclusions from them.
 *
 * - **A download is a fetch, not a person.** Mirrors, bots, CI and somebody
 *   re-downloading after an antivirus false positive all count once each.
 * - **`latest.json` is not a download at all.** It is the updater manifest, so
 *   every running copy of Shiro fetches it on its update check. That makes it
 *   the closest thing here to a count of clients that are actually running,
 *   and it is why it is reported apart from the installers rather than added
 *   to them.
 * - **The installer counts are cumulative per asset**, and the release
 *   workflow replaces assets on each build, so a version that has been
 *   superseded stops accruing. Comparing versions tells you about release
 *   timing as much as about popularity.
 */

const REPOS = [
  ["FIGHTORDER/shiro", "Shiro"],
  ["FIGHTORDER/Splaunch", "Splaunch"],
  ["FIGHTORDER/Springen", "Springen"],
  ["FIGHTORDER/Sprofiler", "Sprofiler"],
];

const json = process.argv.includes("--json");

/** The updater's manifest, which is fetched rather than downloaded. */
const isManifest = name => name === "latest.json";
/** Signatures ride along with an install and say nothing on their own. */
const isNoise = name => name.endsWith(".sig") || name.endsWith(".sha256");

/* Skins and UI skins are content rather than a build, so they are counted
   apart: lumping them under a platform would suggest a Windows number that is
   really somebody trying a colour scheme. */
const platform = name =>
  /skin/i.test(name) ? "content"
    : /\.(exe|msi)$/i.test(name) || /_x64\.zip$/i.test(name) ? "windows"
      : /\.(deb|rpm|AppImage)$/i.test(name) ? "linux"
        : /\.(dmg|app\.tar\.gz)$/i.test(name) ? "macos"
          : "other";

async function releases(repo) {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "shiro-downloads" },
  });
  if (res.status === 403 || res.status === 429) {
    throw new Error("GitHub rate limit reached - wait an hour, or run `gh auth login`");
  }
  if (!res.ok) throw new Error(`${repo}: GitHub answered ${res.status}`);
  return res.json();
}

const out = [];
for (const [repo, label] of REPOS) {
  let rels;
  try {
    rels = await releases(repo);
  } catch (e) {
    out.push({ repo, label, error: String(e.message ?? e) });
    continue;
  }
  const assets = [];
  for (const r of rels) {
    for (const a of r.assets ?? []) {
      assets.push({
        release: r.tag_name, name: a.name, count: a.download_count ?? 0,
        platform: platform(a.name), updated: (a.updated_at ?? "").slice(0, 10),
      });
    }
  }
  out.push({ repo, label, assets });
}

if (json) {
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

for (const r of out) {
  console.log(`\n${r.label}  (${r.repo})`);
  if (r.error) { console.log(`  ${r.error}`); continue; }
  if (!r.assets.length) { console.log("  nothing published"); continue; }

  const manifests = r.assets.filter(a => isManifest(a.name));
  const real = r.assets.filter(a => !isManifest(a.name) && !isNoise(a.name));

  const byPlatform = {};
  for (const a of real) byPlatform[a.platform] = (byPlatform[a.platform] ?? 0) + a.count;

  for (const a of real.sort((x, y) => y.count - x.count)) {
    if (a.count === 0) continue;
    console.log(`  ${String(a.count).padStart(6)}  ${a.name}`);
  }
  const zero = real.filter(a => a.count === 0);
  if (zero.length) {
    console.log(`  ${"0".padStart(6)}  ${zero.length} asset(s) with no downloads`);
  }

  console.log(`  ${"-".repeat(40)}`);
  console.log(`  ${String(real.reduce((n, a) => n + a.count, 0)).padStart(6)}  downloads`);
  for (const [p, n] of Object.entries(byPlatform).sort((a, b) => b[1] - a[1])) {
    if (n) console.log(`  ${String(n).padStart(6)}    ${p}`);
  }
  for (const m of manifests) {
    console.log(`  ${String(m.count).padStart(6)}  update checks (${m.name}, not a download)`);
  }
}
console.log();
