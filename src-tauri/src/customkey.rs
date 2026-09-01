//! Zero-K's "custom key" encoding: a Lua table literal in URL-safe base64.
//!
//! The engine's start script carries only strings, so anything structured that
//! has to reach a gadget is written as Lua source and base64'd into one value.
//! `Spring.Utilities.UsefulTableToCustomKey` is
//! `Base64Encode(TableToString(t))`, and the campaign gadget decodes it by
//! running it as Lua. So this has to produce Lua that parses, not merely
//! something that round-trips through this module.
//!
//! ## The alphabet is not the usual one
//!
//! `LuaMenu/Addons/base64.lua` uses `-` for 62 and `_` for 63, and pads with
//! `=`. That is **URL-safe base64**, not standard - standard's `+` and `/`
//! would decode to the wrong bytes and the gadget would see garbage. This is
//! the collision that had to be found the hard way in Splaunch, so it is
//! written down here rather than left to a default.
//!
//! ## The Lua it writes
//!
//! From `Addons/tablefunctions.lua`:
//!
//! - a number key becomes `[1]=`, a string key stays bare: `vitalCommanders=`
//! - strings are quoted, with `\n \r \t \a \v "` escaped
//! - booleans are `true`/`false`
//! - every entry, including the last, is followed by a comma
//!
//! Verified against a value shipped in Chobby's own `benchmarkFile.lua`, which
//! is in the test below: a real encoder's real output, not a guess at one.

use base64::Engine;
use serde_json::Value as Json;

/// `UsefulTableToCustomKey`: the Lua literal, base64'd.
///
/// `None` for a null, matching the Lua returning nil for a nil - the caller
/// then leaves the key out of the script entirely rather than writing an empty
/// one, which is the difference between "no midgame units" and a gadget
/// decoding `""` and finding no table.
pub fn custom_key(value: &Json) -> Option<String> {
    if value.is_null() {
        return None;
    }
    Some(base64::engine::general_purpose::URL_SAFE.encode(table_to_string(value)))
}

/// `TableToString` on a whole table: the outer `{...}` with no key.
pub fn table_to_string(value: &Json) -> String {
    let mut out = String::new();
    write_value(&mut out, value, None);
    out
}

/// One key, spelled the way Lua would index it.
///
/// A key that reads as an integer is written `[3]=`, anything else bare. Lua
/// distinguishes the number 3 from the string "3" and JSON does not, so a table
/// whose keys were genuinely the strings "0" and "1" would come out as numbers.
/// Nothing in the campaign has such a table - and the alternative, quoting
/// every key, would break the many tables that really are integer-keyed, like
/// the `[0]`/`[1]` allyteam map in `defeatConditionConfig`.
fn write_key(out: &mut String, key: &str) {
    if key.parse::<i64>().is_ok() {
        out.push('[');
        out.push_str(key);
        out.push(']');
    } else {
        out.push_str(key);
    }
    out.push('=');
}

fn write_value(out: &mut String, value: &Json, key: Option<&str>) {
    match value {
        // A Lua function reaches `TableToString` as an unknown type, which
        // writes nothing and leaves a stray comma behind - `{,}`, which is not
        // Lua. Ours are already gone by here (campaignpack drops them), and a
        // null is skipped by the callers below for the same reason.
        Json::Null => {}
        Json::Bool(b) => {
            if let Some(k) = key {
                write_key(out, k);
            }
            out.push_str(if *b { "true" } else { "false" });
        }
        Json::Number(n) => {
            if let Some(k) = key {
                write_key(out, k);
            }
            out.push_str(&number(n));
        }
        Json::String(s) => {
            if let Some(k) = key {
                write_key(out, k);
            }
            out.push('"');
            escape_into(out, s);
            out.push('"');
        }
        Json::Array(items) => {
            if let Some(k) = key {
                write_key(out, k);
            }
            out.push('{');
            // Lua lists are 1-based, and this is what makes a JSON array come
            // back as one rather than as a table keyed from zero.
            for (i, item) in items.iter().enumerate() {
                if item.is_null() {
                    continue;
                }
                write_value(out, item, Some(&(i + 1).to_string()));
                out.push(',');
            }
            out.push('}');
        }
        Json::Object(map) => {
            if let Some(k) = key {
                write_key(out, k);
            }
            out.push('{');
            for (k, v) in map {
                if v.is_null() {
                    continue;
                }
                write_value(out, v, Some(k));
                out.push(',');
            }
            out.push('}');
        }
    }
}

/// A number the way Lua 5.1 writes one.
///
/// Lua has no integer type in 5.1 and prints every number with `%.14g`, so a
/// whole number comes out without a fractional part. Writing `3.0` where the
/// game wrote `3` would still parse, but the two are compared as strings often
/// enough elsewhere that matching upstream exactly is worth the four lines.
fn number(n: &serde_json::Number) -> String {
    if let Some(i) = n.as_i64() {
        return i.to_string();
    }
    match n.as_f64() {
        Some(f) if f.fract() == 0.0 && f.abs() < 1e15 => format!("{}", f as i64),
        Some(f) => {
            let s = format!("{f:.14}");
            let s = s.trim_end_matches('0').trim_end_matches('.').to_string();
            if s.is_empty() { "0".into() } else { s }
        }
        None => "0".into(),
    }
}

/// The six escapes `TableToString` applies, and only those.
///
/// Deliberately not a general Lua string escaper: a backslash is left alone,
/// because upstream leaves it alone, and a value that round-trips differently
/// here than it does in the game is worse than one that is escaped loosely.
fn escape_into(out: &mut String, s: &str) {
    for c in s.chars() {
        match c {
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\x07' => out.push_str("\\a"),
            '\x0b' => out.push_str("\\v"),
            '"' => out.push_str("\\\""),
            _ => out.push(c),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Chobby's own `benchmarkFile.lua` ships this value, encoded by the real
    /// Lua. If this module agrees with it byte for byte, it agrees with the
    /// encoder the gadget was written against.
    const GOLDEN: &str = "e1swXT17fSxbMV09e3ZpdGFsVW5pdFR5cGVzPXtbMV09InN0YXRpY2hlYXZ5YXJ0eSIsfSxpZ25vcmVVbml0TG9zc0RlZmVhdD1mYWxzZSxhbGx5VGVhbUxvc3NPYmplY3RpdmVJRD0xLHZpdGFsQ29tbWFuZGVycz1mYWxzZSxsb3NlQWZ0ZXJTZWNvbmRzPWZhbHNlLH0sfQ==";

    /// Parse a Lua table literal back into JSON, using the real interpreter.
    ///
    /// Comparing encoded strings directly would be comparing `pairs` order,
    /// which is arbitrary in Lua and sorted here. What actually has to hold is
    /// that the gadget, which parses this as Lua, ends up with the same table -
    /// so the test parses it as Lua too.
    fn as_table(lua_literal: &str) -> Json {
        crate::campaignpack::read_table(&format!("return {lua_literal}"), "customkey.lua")
            .expect("the literal parses as Lua")
    }

    #[test]
    fn the_encoding_matches_a_value_the_real_encoder_produced() {
        let mut inner = serde_json::Map::new();
        inner.insert("vitalUnitTypes".into(), json!(["staticheavyarty"]));
        inner.insert("ignoreUnitLossDefeat".into(), json!(false));
        inner.insert("allyTeamLossObjectiveID".into(), json!(1));
        inner.insert("vitalCommanders".into(), json!(false));
        inner.insert("loseAfterSeconds".into(), json!(false));
        let mut outer = serde_json::Map::new();
        // `[]`, not `{}`: an empty Lua table has no JSON identity, and the
        // reader settles it as a list (see `campaignpack::is_array`). Both
        // spellings encode to `{}`, which is the invariant that matters - the
        // test below pins it - so this is the shape a round trip can reach.
        outer.insert("0".into(), json!([]));
        outer.insert("1".into(), Json::Object(inner));
        let ours = Json::Object(outer);

        let golden = String::from_utf8(
            base64::engine::general_purpose::URL_SAFE.decode(GOLDEN).unwrap(),
        )
        .unwrap();

        // Lua parses both to the same table.
        assert_eq!(as_table(&table_to_string(&ours)), as_table(&golden));

        // And that table is the one we started from, so the encoding is not
        // merely self-consistent - it agrees with the shipped value.
        assert_eq!(as_table(&golden), ours);
    }

    /// The whole point of the format: what comes back out is what went in.
    #[test]
    fn a_planet_sized_table_survives_lua_parsing_it_back() {
        let value = json!({
            "defeatConditionConfig": [{ "vitalCommanders": true, "loseAfterSeconds": false }],
            "objectiveConfig": [
                { "victoryByTime": 300, "description": "Hold the \"north\" ridge\nfor a while" }
            ],
            "startUnits": [{ "name": "staticmex", "x": 3630, "z": 220, "facing": 2 }],
            "empty": [],
            "nested": { "0": { "a": 1 }, "1": { "b": -2.5 } },
        });
        assert_eq!(as_table(&table_to_string(&value)), value);
    }

    /// The alphabet, not the padding, is the thing that goes wrong quietly.
    #[test]
    fn the_alphabet_is_url_safe_not_standard() {
        // Bytes chosen so standard base64 would use both `+` and `/`.
        let value = json!({ "k": "\u{00fb}\u{00ff}\u{00be}" });
        let encoded = custom_key(&value).unwrap();
        assert!(!encoded.contains('+') && !encoded.contains('/'), "{encoded}");

        let round = base64::engine::general_purpose::URL_SAFE.decode(&encoded).unwrap();
        assert_eq!(String::from_utf8(round).unwrap(), table_to_string(&value));
    }

    #[test]
    fn a_list_comes_back_one_based() {
        assert_eq!(table_to_string(&json!(["a", "b"])), "{[1]=\"a\",[2]=\"b\",}");
    }

    #[test]
    fn a_whole_number_has_no_fractional_part() {
        assert_eq!(table_to_string(&json!({ "x": 3.0, "y": 2.5, "z": -7 })), "{x=3,y=2.5,z=-7,}");
    }

    #[test]
    fn the_six_escapes_are_applied_and_a_backslash_is_not() {
        let s = table_to_string(&json!({ "t": "a\nb\tc\"d\\e" }));
        assert_eq!(s, "{t=\"a\\nb\\tc\\\"d\\e\",}");
    }

    #[test]
    fn a_nil_has_no_key_rather_than_an_empty_one() {
        assert_eq!(custom_key(&Json::Null), None);
        // A null inside a table is skipped, because `{,}` is not Lua.
        assert_eq!(table_to_string(&json!({ "a": 1, "b": null })), "{a=1,}");
        assert_eq!(table_to_string(&json!([1, null, 3])), "{[1]=1,[3]=3,}");
    }

    /// Both JSON spellings of "no entries" are the same Lua table.
    ///
    /// This is why a round trip through the reader can turn a `{}` into a `[]`
    /// without anything being lost: the thing the game receives is identical.
    #[test]
    fn an_empty_table_is_empty_braces_whichever_way_it_arrives() {
        assert_eq!(table_to_string(&json!({})), "{}");
        assert_eq!(table_to_string(&json!([])), "{}");
    }
}
