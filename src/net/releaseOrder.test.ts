/**
 * The publish step must never advertise a download it has already deleted.
 *
 * A release replaces four packages whose filenames carry the version, so last
 * build's are stale by name and get swept. `latest.json` is not stale by name -
 * it keeps its filename forever - so it survives the sweep. Sweep first and the
 * published manifest spends the whole upload naming packages that are already
 * gone: the app sees a new version, then 404s fetching it. A Linux tester hit
 * exactly that, and a failed upload would have left the release that way until
 * the next green build.
 *
 * So the order is load-bearing, and it is three lines of shell in a YAML file
 * that nothing else looks at and that only ever runs on main. This reads the
 * file rather than parsing it: a YAML dependency to check the order of three
 * commands is a worse trade than matching the lines they are written on.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const WORKFLOW = ".github/workflows/build-and-release.yml";
const yml = readFileSync(WORKFLOW, "utf8");

/** Where a line appears, and a readable failure when it does not. */
function at(needle: string): number {
  const i = yml.indexOf(needle);
  assert.notEqual(i, -1, `${WORKFLOW} no longer contains: ${needle}`);
  return i;
}

test("the packages go up before the manifest that names them", () => {
  assert.ok(
    at('gh release upload dev "${packages[@]}"') < at("gh release upload dev latest.json --clobber"),
    "latest.json is published before the packages it points at exist",
  );
});

test("nothing is swept until the new manifest is published", () => {
  assert.ok(
    at("gh release upload dev latest.json --clobber") < at("gh release delete-asset"),
    "a stale package is deleted while the old manifest still names it",
  );
});

test("a version already published is not published again", () => {
  /* A re-run keeps `run_number`, so it rebuilds the same version and would
     clobber the very assets the live manifest names - each one deleted and
     re-uploaded, which is a 404 while it happens and a signature mismatch for
     anything caught mid-replacement. Nothing is gained: the release already
     carries that build. */
  assert.ok(
    at('if [ "$live" = "$SHIRO_VERSION" ]') < at('gh release upload dev "${packages[@]}"'),
    "the re-run guard runs after the upload it is meant to prevent",
  );
});

test("a slow older run does not walk the release backwards", () => {
  /* `concurrency` serialises publishes without ordering them, so a run that
     started earlier can reach the publish step after a newer one. Republishing
     regresses the manifest and the sweep then takes the newer packages with it
     as stale. */
  assert.ok(
    at('if [ "$newest" = "$live" ]') < at('gh release upload dev "${packages[@]}"'),
    "the ordering guard runs after the upload it is meant to prevent",
  );
});

test("the live version is read from the manifest, not the packages", () => {
  /* The two disagree exactly when it matters: an upload that died after the
     packages and before the manifest leaves new packages under an old
     manifest, and that is the run a re-run should be allowed to finish. */
  assert.ok(/live=\$\(curl [^\n]*latest\.json/.test(yml.replace(/\\\n\s*/g, " ")),
    "the guard no longer reads the live version out of latest.json");
});

test("the manifest is not swept as stale", () => {
  /* The sweep keeps whatever `keep` lists. Package names change every build,
     so they are listed from the build; latest.json never changes, so it has to
     be added by hand or every release deletes its own manifest.

     Asserted as a boolean rather than `assert.match`, which prints the whole
     workflow on failure and buries the one line that matters. */
  assert.ok(
    /keep=\$\(printf '%s\\nlatest\.json\\n' "\$keep"\)/.test(yml),
    "latest.json is not added to `keep`, so the sweep deletes the manifest it just published",
  );
});
