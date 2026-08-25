/**
 * The sweep must not delete the packages the live manifest still names.
 *
 * `releaseOrder.test.ts` covers the order of the three commands. This covers
 * what the sweep decides to keep, which is a different failure with the same
 * symptom: an update offered and then 404'd.
 *
 * Ordering the uploads closed the window this run can see. It does not close
 * the one the client sees. `latest.json` keeps its filename forever, so it is
 * served from a cache that `--clobber` does not reach into - for some minutes
 * after the new manifest is up, a client can still be handed the old one, and
 * it then asks for packages whose filenames carry the old version. Those are
 * stale by name, and the sweep used to remove them in the same run.
 *
 * Asserting that by matching lines in the YAML would only prove the lines are
 * written. So the step's shell is extracted and executed, against a `gh` and a
 * `curl` that are shell functions - a function beats any PATH lookup, and PATH
 * does not survive the trip into a Windows bash. That distinction is not
 * theoretical: getting it wrong let the real `curl` answer, and the release's
 * own version guard is the only reason nothing was published by a test run.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WORKFLOW = ".github/workflows/build-and-release.yml";

const LIVE = "0.2.124"; // what the published manifest says
const NEW = "0.2.125"; // what this run built
const OLDER = "0.2.123"; // the generation before, which should go

/** The publish step's shell, with the Actions expressions substituted. */
function publishStep(): string {
  const yml = readFileSync(WORKFLOW, "utf8");
  const start = yml.indexOf("      - name: Publish the dev release");
  assert.notEqual(start, -1, `${WORKFLOW} no longer has a "Publish the dev release" step`);
  const marker = "        run: |\n";
  const from = yml.indexOf(marker, start) + marker.length;
  const next = yml.slice(from).search(/^ {6}- name:/m);
  const body = (next === -1 ? yml.slice(from) : yml.slice(from, from + next))
    .split("\n")
    .map(l => (l.startsWith(" ".repeat(10)) ? l.slice(10) : l))
    .join("\n");

  /* The runner substitutes these before bash sees the script. Left in place,
     `${{` is a bad substitution that takes its whole command with it - and the
     command it takes is the one that reads the live version. */
  const shell = body
    .replace(/\$\{\{\s*github\.repository\s*\}\}/g, "QrowZK/shiro")
    .replace(/\$\{\{\s*github\.sha\s*\}\}/g, "deadbeef");
  assert.ok(!shell.includes("${{"), "an Actions expression reached the shell");
  return shell;
}

const FAKES = `
curl() { printf '{"version":"%s"}\\n' "$SIM_LIVE"; }

gh() {
  echo "$*" >> "$SIM/gh.log"
  case "$1 $2" in
    "release view")
      case "$*" in
        *--json*assets*) cat "$SIM/assets.txt" ;;
        *) return 0 ;;
      esac
      ;;
    "release delete-asset")
      grep -vx "$4" "$SIM/assets.txt" > "$SIM/a.tmp" && mv "$SIM/a.tmp" "$SIM/assets.txt"
      ;;
    "release upload")
      shift 3
      for f in "$@"; do
        case "$f" in --*) continue ;; esac
        b=$(basename "$f")
        grep -qx "$b" "$SIM/assets.txt" || echo "$b" >> "$SIM/assets.txt"
      done
      ;;
  esac
  return 0
}

`;

/** Run the publish step in a scratch directory and hand back what survived. */
function runPublish(): { assets: string[]; out: string } {
  const sim = join(tmpdir(), `shiro-publish-sim-${process.pid}`);
  rmSync(sim, { recursive: true, force: true });
  mkdirSync(join(sim, "dist"), { recursive: true });

  /* All four shapes a release publishes, because they are not named alike.
     The rpm is `Shiro-0.2.129-1.x86_64.rpm` - hyphens, and a build number
     after the version - so a sweep that matched `_${version}_` would keep the
     installer and the AppImage and drop the rpm. That is a 404 for exactly
     the Linux users who reported the original one. */
  const existing = [
    `Shiro_${OLDER}_x64-setup.exe`, `Shiro_${LIVE}_x64-setup.exe`,
    `shiro_${OLDER}_amd64.AppImage`, `shiro_${LIVE}_amd64.AppImage`,
    `Shiro_${OLDER}_amd64.deb`, `Shiro_${LIVE}_amd64.deb`,
    `Shiro-${OLDER}-1.x86_64.rpm`, `Shiro-${LIVE}-1.x86_64.rpm`,
    "latest.json",
  ];
  writeFileSync(join(sim, "assets.txt"), existing.join("\n") + "\n");
  for (const name of [`Shiro_${NEW}_x64-setup.exe`, `shiro_${NEW}_amd64.AppImage`]) {
    writeFileSync(join(sim, "dist", name), "x");
  }
  writeFileSync(join(sim, "latest.json"), `{"version":"${NEW}"}`);
  writeFileSync(join(sim, "step.sh"), FAKES + publishStep());

  const r = spawnSync("bash", ["./step.sh"], {
    cwd: sim,
    encoding: "utf8",
    env: { ...process.env, SHIRO_VERSION: NEW, SIM: sim, SIM_LIVE: LIVE,
      GITHUB_REPOSITORY: "QrowZK/shiro" },
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  assert.equal(r.status, 0, `the publish step failed:\n${out}`);
  /* Silence is not success: the step exits 0 when its version guard refuses,
     and an empty release would then look like a clean sweep. */
  assert.ok(existsSync(join(sim, "gh.log")),
    `the step never called gh - it exited before publishing:\n${out}`);

  const assets = readFileSync(join(sim, "assets.txt"), "utf8").split("\n").filter(Boolean);
  rmSync(sim, { recursive: true, force: true });
  return { assets, out };
}

const has = (assets: string[], version: string) => assets.some(a => a.includes(version));

/* No bash, no run. Skipping loudly beats a green that checked nothing - both
   CI runners have one, so this only ever skips on somebody's desktop. */
const noBash = spawnSync("bash", ["-c", "exit 0"]).status !== 0;

test("this build's packages are published", { skip: noBash && "no bash" }, () => {
  assert.ok(has(runPublish().assets, NEW));
});

test("every shape of package the live manifest names survives, rpm included",
  { skip: noBash && "no bash" }, () => {
    /* One assertion per filename shape rather than one for the set: a sweep
       that kept three of the four would otherwise pass a test that only asked
       whether the version appeared anywhere. */
    const { assets } = runPublish();
    for (const shape of [`Shiro_${LIVE}_x64-setup.exe`, `shiro_${LIVE}_amd64.AppImage`,
      `Shiro_${LIVE}_amd64.deb`, `Shiro-${LIVE}-1.x86_64.rpm`]) {
      assert.ok(assets.includes(shape), `${shape} was swept while its manifest could still be cached`);
    }
  });

test("the packages the live manifest names survive the sweep", { skip: noBash && "no bash" }, () => {
  /* The one that matters. A client handed a cached manifest naming these has
     minutes in which to ask for them, and the answer has to be the file rather
     than a 404 - which is what a Linux tester reported and what the ordering
     fix alone did not reach. */
  const { assets } = runPublish();
  assert.ok(has(assets, LIVE), `${LIVE}'s packages were swept while its manifest could still be cached`);
});

test("the generation before that is swept, so the release does not grow forever", { skip: noBash && "no bash" }, () => {
  /* Kept for one release, not kept for good: by the next run nothing can still
     be holding the manifest that named these. */
  const { assets } = runPublish();
  assert.ok(!has(assets, OLDER), `${OLDER} is still on the release two builds later`);
});

test("the manifest itself is never swept", { skip: noBash && "no bash" }, () => {
  assert.ok(runPublish().assets.includes("latest.json"));
});
