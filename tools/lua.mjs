/**
 * A reader for Lua table literals, shared by the generators.
 *
 * Not an interpreter: it understands table constructors, strings, numbers,
 * booleans and bare names, and it steps over inline `function ... end` bodies
 * without trying to understand them. That is the whole grammar the upstream
 * config tables use - Chobby's `settingsMenu.lua` and Zero-K's
 * `ModOptions.lua` - and anything else throws rather than being guessed at.
 */

/* A reader for Lua table literals. Not an interpreter: it understands table
   constructors, strings, numbers, booleans and bare names, and it steps over
   inline `function ... end` bodies without trying to understand them. That is
   the whole grammar `settingsConfig` uses; anything else throws rather than
   being guessed at. */

const NUMBER = /-?\d+\.?\d*(?:[eE][-+]?\d+)?/y;
const NAME = /[A-Za-z_][\w.:]*(\s*\([^()]*\))?/y;
const KEY = /([A-Za-z_]\w*)\s*=(?!=)/y;
const IDENT = /[A-Za-z_]/;
/* The four words that open or close a Lua block, plus both comment forms and
   both quotes - so a scan can step over anything that would otherwise put a
   stray "end" into the depth count. `for` and `while` contribute only their
   `do`, which is why counting these four is exact. */
const BLOCK = /--\[\[|--|"|'|\b(?:function|if|do|end)\b/g;
const WORDS = { true: true, false: false, nil: null };

class Lua {
  constructor(text) { this.t = text; this.i = 0; }

  at(re) { re.lastIndex = this.i; return re.exec(this.t); }

  ws() {
    for (;;) {
      const c = this.t[this.i];
      if (c === " " || c === "\t" || c === "\r" || c === "\n") this.i++;
      else if (this.t.startsWith("--[[", this.i)) this.i = this.t.indexOf("]]", this.i) + 2;
      else if (this.t.startsWith("--", this.i)) {
        const nl = this.t.indexOf("\n", this.i);
        this.i = nl < 0 ? this.t.length : nl;
      } else return;
    }
  }

  string() {
    const q = this.t[this.i++];
    let out = "";
    while (this.t[this.i] !== q) {
      if (this.t[this.i] === "\\") { out += this.t[this.i + 1]; this.i += 2; }
      else out += this.t[this.i++];
    }
    this.i++;
    return out;
  }

  /** Skip a `function ... end` and return its source. */
  block() {
    const start = this.i;
    let depth = 0;
    for (;;) {
      BLOCK.lastIndex = this.i;
      const m = BLOCK.exec(this.t);
      if (!m) throw new SyntaxError("unterminated function");
      this.i = m.index + m[0].length;
      const tok = m[0];
      if (tok === "--[[") this.i = this.t.indexOf("]]", this.i) + 2;
      else if (tok === "--") {
        const nl = this.t.indexOf("\n", this.i);
        this.i = nl < 0 ? this.t.length : nl;
      } else if (tok === '"' || tok === "'") {
        while (this.t[this.i] !== tok) this.i += this.t[this.i] === "\\" ? 2 : 1;
        this.i++;
      } else if (tok === "end") {
        if (--depth === 0) return this.t.slice(start, this.i);
      } else depth++;
    }
  }

  value() {
    this.ws();
    const c = this.t[this.i];
    if (c === "{") return this.table();
    if (c === '"' || c === "'") return this.string();
    if (!IDENT.test(c)) {
      const n = this.at(NUMBER);
      if (n) { this.i = NUMBER.lastIndex; return Number(n[0]); }
    }
    if (/^function\b/.test(this.t.slice(this.i, this.i + 9))) {
      return { fn: this.block() };
    }
    const m = this.at(NAME);
    if (!m) throw new SyntaxError(`at ${JSON.stringify(this.t.slice(this.i, this.i + 40))}`);
    this.i = NAME.lastIndex;
    const w = m[0].trim();
    // A name we deliberately do not resolve: `UpdateLups`, `defaultUiScale`.
    return w in WORDS ? WORDS[w] : { ref: w };
  }

  table() {
    this.i++;
    const out = {};
    const arr = [];
    for (;;) {
      this.ws();
      if (this.t[this.i] === "}") { this.i++; break; }
      const k = this.at(KEY);
      if (k) { this.i = KEY.lastIndex; out[k[1]] = this.value(); }
      else if (this.t[this.i] === "[") {
        this.i++;
        const key = this.value();
        this.ws(); this.i++;          // ]
        this.ws(); this.i++;          // =
        out[key] = this.value();
      } else arr.push(this.value());
      this.ws();
      if (this.t[this.i] === "," || this.t[this.i] === ";") this.i++;
    }
    if (arr.length && Object.keys(out).length) return { _array: arr, ...out };
    return arr.length ? arr : out;
  }
}

function readAssignment(text, name) {
  const m = new RegExp(`^local ${name} = (?=\\{)`, "m").exec(text);
  if (!m) throw new Error(`no \`local ${name} = {\` in the source`);
  const p = new Lua(text);
  p.i = m.index + m[0].length;
  return p.value();
}

export { Lua, readAssignment };
