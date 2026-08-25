/**
 * Fail on identifiers that do not exist.
 *
 * The screens are .jsx and `checkJs` is off, so TypeScript never looks at them.
 * That is a deliberate trade - turning it on reports 865 errors, nearly all
 * implicit-any noise from strict mode meeting untyped JSX - but it left one
 * specific hole open: a name that is simply not defined.
 *
 * That is not a style opinion. It is a crash. `uninstallApp` was called in
 * App.jsx without being imported, and every check we had passed: tsc ignored
 * the file, the unit tests do not render it, and the e2e suite runs in a
 * browser where the Apps screen shows "needs the desktop app" and never draws
 * the button. The first thing to notice was a person clicking Remove and
 * watching nothing happen.
 *
 * So: run the full checkJs pass, and fail on exactly the diagnostics that mean
 * "this name does not exist". Everything else stays ignored.
 *
 *   TS2304  Cannot find name 'x'.
 *   TS2552  Cannot find name 'x'. Did you mean 'y'?
 *   TS2339  Property 'x' does not exist on type 'y'.   <- not included: too
 *           noisy against untyped props, and a missing prop is not a crash.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const FATAL = /error TS(2304|2552):/;

/* Run TypeScript's own entry point with this Node rather than going through
   npx: on Windows `npx.cmd` needs a shell to spawn, and a shell here would
   mean quoting rules in a script whose whole job is to be reliable. */
const require = createRequire(import.meta.url);
const tscBin = require.resolve("typescript/bin/tsc");

const tsc = spawnSync(process.execPath, [tscBin, "--noEmit", "--checkJs"], {
  encoding: "utf8",
});

/* tsc exits non-zero for the 800-odd errors we are choosing to ignore, so its
   status says nothing here - the output is the signal. */
const output = `${tsc.stdout ?? ""}${tsc.stderr ?? ""}`;
if (tsc.error) {
  console.error(`could not run tsc: ${tsc.error.message}`);
  process.exit(2);
}

const undefinedNames = output.split("\n").filter(line => FATAL.test(line));

if (undefinedNames.length > 0) {
  console.error("Undefined identifiers - these are crashes, not style:\n");
  for (const line of undefinedNames) console.error(`  ${line}`);
  console.error(`\n${undefinedNames.length} undefined name(s).`);
  process.exit(1);
}

console.log("no undefined identifiers");
