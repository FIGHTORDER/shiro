/* Fake data shaped exactly like the ZkLobbyServer payloads documented in
   docs/DESIGN_HANDOFF.md section 6. Replaced by the real protocol store
   once the Rust TCP relay lands - see docs/ARCHITECTURE.md section 4. */
import { playerRank, rankColour } from "./net/ranks.ts";
import { newsList } from "./store/adapters.ts";

/* Rank tints are derived rather than written into the fixtures below: the live
   path computes them in `userToChip`, and a demo that hard-coded them would
   drift from it the moment either changed. */
function tinted(value) {
  if (Array.isArray(value)) return value.map(tinted);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = tinted(v);
  if (typeof out.elo === "number" && out.eloTint === undefined) {
    /* Only an Elo here: these fixtures predate the rank field, and the demo is
       allowed the fallback the live path almost never needs. */
    out.eloTint = rankColour(playerRank({ elo: out.elo }));
  }
  /* Same rule for how full a room is: `battleToRow` works it out from the two
     counts, and a fixture that stated it separately could contradict the very
     numbers printed beside it. */
  if (typeof out.players === "number" && typeof out.maxPlayers === "number" && out.maxPlayers > 0) {
    if (out.full === undefined) out.full = out.players >= out.maxPlayers;
    if (out.queued === undefined) out.queued = Math.max(0, out.players - out.maxPlayers);
  }
  return out;
}

export default tinted({
  welcome: { Engine: "2025.06.21", Game: "Zero-K v1.14.8.0", UserCount: 100 },
  /* Lobby news, in the shape ZkLobbyServer puts on the wire and then through
     the same adapter the live path uses - so the demo shows what normalisation
     produced rather than a tidier version of it. Four items because four is
     what the awkward cases need:

       1. the whole thing, with a picture, addressed the way the server
          addresses it - `http://zero-k.info`, which the adapter has to upgrade
          before the CSP will load it;
       2. no picture, which arrives as the bare site URL rather than as an
          absent field, because the server interpolates a null relative path;
       3. no link and no picture;
       4. a headline and nothing else, which is a legal item.

     Only one carries a `Time`, and that is already more than the live server
     sends: `EventTime` is nullable and the site's news form leaves it alone, so
     real items come back without one. A fixture that stamped all four would
     have designed a date line into a strip that almost never has dates.

     Item 1's picture is a real one on the site. If it ever goes, the strip
     drops the picture and keeps the headline, which is the behaviour worth
     seeing anyway. */
  news: newsList([
    { Header: "Zero-K v1.14.8.0", Time: "2026-08-19T18:30:00Z",
      Text: "Cloakbots rebalanced, two new maps in the pool, and the campaign "
        + "gets its missing tutorial mission.",
      Url: "https://zero-k.info/Forum/Thread/32123",
      Image: "http://zero-k.info/img/lobbynews/1.png" },
    { Header: "Summer 1v1 tournament - sign-ups close Sunday",
      Text: "Double elimination, best of three, seeded on ladder Elo.",
      Url: "https://zero-k.info/Forum/Thread/32101",
      Image: "http://zero-k.info" },
    { Header: "Server maintenance Thursday 23:00 UTC",
      Text: "Matches in progress will finish. Expect ten minutes of downtime." },
    { Header: "Map contest results are up" },
  ]),
  me: { name: "Shadowfury", clan: "ZKF", country: "DE", faction: "machines", level: 41, elo: 1842, mmElo: 1766 },
  /* Zero-K's map catalogue, in the shape zks_map_catalogue returns.
     Eleven rows rather than three hundred and forty-three, and every one of
     them copied verbatim out of a live GetPublicCommunityInfo response - names,
     ids, dimensions, flags and vote totals - so the demo is a smaller version
     of the screen rather than a prettier one. The real ids also mean the demo's
     map links reach the real pages, and the real names mean the real minimaps
     load.

     Chosen for the cases the screen has to get right: a portrait map and two
     extreme landscape ones, so the picture wells are exercised; the most-voted
     map and a five-out-of-five from a single vote, which is what the ranking
     has to tell apart; an unrated map; one the service flags for nothing at
     all; and one of the four maps in the whole catalogue marked Special. */
  maps: [
    { name: "Ravaged_v2", resourceId: 18482, width: 10, height: 10,
      supportLevel: "Featured", is1v1: true, isTeams: true, isFfa: false,
      isChickens: false, isSpecial: false, isAssymetrical: false,
      hills: 3, waterLevel: 1, ratingSum: 112, ratingCount: 25 },
    { name: "Small Supreme Battlefield V2", resourceId: 7770, width: 16, height: 16,
      supportLevel: "Featured", is1v1: false, isTeams: true, isFfa: false,
      isChickens: false, isSpecial: false, isAssymetrical: false,
      hills: 2, waterLevel: 2, ratingSum: 191, ratingCount: 46 },
    // Five out of five, from one person. Must not outrank the two above.
    { name: "FrostyCove v1.13", resourceId: 58903, width: 10, height: 10,
      supportLevel: "MatchMaker", is1v1: true, isTeams: true, isFfa: false,
      isChickens: false, isSpecial: false, isAssymetrical: false,
      hills: 2, waterLevel: 1, ratingSum: 5, ratingCount: 1 },
    { name: "Comet Catcher Redux v3.1", resourceId: 55646, width: 12, height: 16,
      supportLevel: "MatchMaker", is1v1: false, isTeams: true, isFfa: false,
      isChickens: false, isSpecial: false, isAssymetrical: false,
      hills: 1, waterLevel: 1, ratingSum: 26, ratingCount: 6 },
    { name: "Aberdeen3v3v3", resourceId: 7116, width: 16, height: 16,
      supportLevel: "Featured", is1v1: false, isTeams: false, isFfa: true,
      isChickens: false, isSpecial: false, isAssymetrical: false,
      ffaMaxTeams: 3, hills: 3, waterLevel: 1, ratingSum: 12, ratingCount: 4 },
    { name: "Icy Run v2", resourceId: 7513, width: 12, height: 4,
      supportLevel: "Featured", is1v1: false, isTeams: true, isFfa: false,
      isChickens: false, isSpecial: false, isAssymetrical: false,
      hills: 2, waterLevel: 1, ratingSum: 48, ratingCount: 13 },
    { name: "Chicken Nuggets v5", resourceId: 55783, width: 16, height: 6,
      supportLevel: "MatchMaker", is1v1: false, isTeams: false, isFfa: false,
      isChickens: true, isSpecial: false, isAssymetrical: true,
      hills: 2, waterLevel: 1, ratingSum: 46, ratingCount: 12 },
    { name: "Chicken_Farm_v02", resourceId: 7230, width: 6, height: 16,
      supportLevel: "Featured", is1v1: false, isTeams: false, isFfa: false,
      isChickens: true, isSpecial: false, isAssymetrical: true,
      hills: 3, waterLevel: 1, ratingSum: 39, ratingCount: 11 },
    { name: "hotstepper", resourceId: 19055, width: 8, height: 8,
      supportLevel: "Featured", is1v1: true, isTeams: false, isFfa: false,
      isChickens: false, isSpecial: true, isAssymetrical: false,
      ffaMaxTeams: 5, hills: 2, waterLevel: 1, ratingSum: 53, ratingCount: 13 },
    { name: "Craterv02", resourceId: 23558, width: 18, height: 14,
      supportLevel: "Featured", is1v1: false, isTeams: true, isFfa: false,
      isChickens: false, isSpecial: false, isAssymetrical: false,
      hills: 3, waterLevel: 1 },
    { name: "Castel_godsV21", resourceId: 7216, width: 16, height: 16,
      supportLevel: "Featured", is1v1: false, isTeams: false, isFfa: false,
      isChickens: false, isSpecial: false, isAssymetrical: false,
      ffaMaxTeams: 4, hills: 2, waterLevel: 1, ratingSum: 27, ratingCount: 7 },
  ],

  battles: [
    { id:1, title:"Teams 8v8 - no noobs", map:"Argent_Strata_1.1", founder:"Shadowfury", players:11, maxPlayers:16, spectators:3, mode:"Teams" },
    { id:2, title:"1v1 ladder", map:"Canis_River_v1.4", founder:"quantum", players:2, maxPlayers:2, spectators:12, mode:"1v1", matchmaker:true },
    { id:3, title:"private - do not join", map:"Rainbow_Comet_v1.25", founder:"ZKF|hexed", players:8, maxPlayers:8, spectators:0, mode:"FFA", locked:true, running:true, runningSince:252 },
    { id:4, title:"newbies welcome, will explain", map:"Hide_and_Seek_2.2.3", founder:"tinman", players:4, maxPlayers:12, spectators:1, mode:"Teams" },
    { id:5, title:"coop vs 4 brutal AI", map:"Skate_Park_v1.00", founder:"lorelei", players:3, maxPlayers:8, spectators:0, mode:"Coop" },
    { id:6, title:"FFA 8 way chaos", map:"Rainbow_Comet_v1.25", founder:"vex", players:6, maxPlayers:8, spectators:2, mode:"FFA" },
    { id:7, title:"clan practice [ZKF] only", map:"Argent_Strata_1.1", founder:"ZKF|nine", players:9, maxPlayers:16, spectators:0, mode:"Teams", locked:true },
    { id:8, title:"1v1 casual anyone", map:"Canis_River_v1.4", founder:"a", players:1, maxPlayers:2, spectators:0, mode:"1v1" },
    // Over its cap on purpose: the time-queue case, where the last two to
    // claim a slot are spectated when the game starts.
    { id:9, title:"big teams 16v16 come on", map:"Skate_Park_v1.00", founder:"marrow", players:34, maxPlayers:32, spectators:5, mode:"Teams" },
    { id:10, title:"running - 40 min in", map:"Hide_and_Seek_2.2.3", founder:"pell", players:12, maxPlayers:12, spectators:8, mode:"Teams", running:true, runningSince:2464 }
  ],
  room: {
    id:1, title:"Teams 8v8 - no noobs", map:"Argent_Strata_1.1", founder:"Shadowfury", mode:"Teams",
    // Eight humans across the two teams; the bot takes no slot.
    players:8, maxPlayers:16,
    options:[
      { key:"noelo", label:"No Elo", value:"1", known:true, desc:"Prevent battle from affecting Elo rankings" },
      { key:"startmetal", label:"Starting metal", value:"1300", known:true },
      { key:"maxunits", label:"Max units", value:"2000", known:true },
      // A key the option table has no entry for - a custom game's, or one the
      // server set itself. Shown as it arrived rather than hidden.
      { key:"commshare", label:"commshare", value:"1", known:false },
    ],
    teams:[
      { ally:0, players:[
        { user:{name:"Shadowfury",clan:"ZKF",country:"DE",faction:"machines",level:41,elo:1842}, host:true },
        { user:{name:"quantum",clan:"ZKF",country:"PL",faction:"rising",level:12,elo:1503}, party:1 },
        { user:{name:"tinman",country:"GB",faction:"hegemony",level:27,elo:1671}, party:1 },
        { user:{name:"a",country:"JP",faction:"rising",level:3,elo:987,presence:"away"} },
        { user:{name:"CAI-Brutal",bot:true}, sync:"ok" }
      ]},
      { ally:1, players:[
        { user:{name:"hexed",clan:"ZKF",country:"US",faction:"machines",level:33,elo:1790} },
        { user:{name:"lorelei",country:"FR",faction:"hegemony",level:19,elo:1588}, sync:"downloading" },
        { user:{name:"vexatiousmachinist",country:"BR",faction:"rising",level:8,elo:1204}, sync:"missing" },
        { user:{name:"marrow",country:"SE",faction:"machines",level:44,elo:1955} }
      ]}
    ],
    spectators:[
      { user:{name:"pell",country:"NL",presence:"room",level:52,elo:2210} },
      { user:{name:"nine",clan:"ZKF",country:"CA",presence:"room",level:21,elo:1499} },
      { user:{name:"zk-admin",country:"US",presence:"room",admin:true,level:60,elo:2400} }
    ],
    // The two above whose sync mark is not "ok" - the same set `!start` names.
    waitingOn:["lorelei","vexatiousmachinist"],
    chat:[
      { time:"21:03", user:{name:"quantum",clan:"ZKF",country:"PL"}, text:"map veto?" },
      { time:"21:03", user:{name:"Shadowfury",clan:"ZKF",country:"DE"}, text:"argent is fine, it is balanced enough for 8v8" },
      { time:"21:04", emote:true, user:{name:"hexed"}, text:"rolls a die" },
      { time:"21:04", system:true, text:"lorelei joined the room" },
      { time:"21:05", user:{name:"lorelei",country:"FR"}, text:"downloading the map, one sec" },
      { time:"21:05", ring:true, user:{name:"hexed",clan:"ZKF",country:"US"}, text:"you are up - we need one more on team 2 or this never starts" }
    ]
  },
  channels: [
    { id:"zk", label:"#zk", unread:12 },
    { id:"newbies", label:"#newbies" },
    { id:"main", label:"#main", unread:3 },
    { id:"hexed", label:"hexed", mention:true, dm:true }
  ],
  /* All three ratings, written down rather than derived. The friends panel used
     to invent the matchmaker and Planetwars figures from the general elo when it
     had only one - which is fine fiction here and was a lie on the live path,
     where it drew invented numbers under the real labels. Fiction belongs in
     this file. */
  channelUsers: [
    {name:"Shadowfury",clan:"ZKF",country:"DE",faction:"machines",presence:"room",level:41,elo:1842,mmElo:1766,pwElo:1710},
    {name:"hexed",clan:"ZKF",country:"US",faction:"machines",presence:"online",level:33,elo:1790,mmElo:1701,pwElo:1655},
    {name:"quantum",clan:"ZKF",country:"PL",faction:"rising",presence:"room",level:12,elo:1503,mmElo:1488,pwElo:1442},
    {name:"marrow",country:"SE",faction:"machines",presence:"ingame",level:44,elo:1955,mmElo:1902,pwElo:1840},
    {name:"pell",country:"NL",presence:"ingame",level:52,elo:2210,mmElo:2144,pwElo:2077},
    {name:"lorelei",country:"FR",faction:"hegemony",presence:"away",level:19,elo:1588,mmElo:1550,pwElo:1503},
    {name:"tinman",country:"GB",faction:"hegemony",presence:"online",level:27,elo:1671,mmElo:1624,pwElo:1590},
    {name:"zk-admin",country:"US",admin:true,presence:"online",level:60,elo:2400,mmElo:2318,pwElo:2265},
    {name:"a",country:"JP",faction:"rising",presence:"away",level:3,elo:987,mmElo:1012,pwElo:1000},
    {name:"vexatiousmachinist",country:"BR",faction:"rising",presence:"online",level:8,elo:1204,mmElo:1180,pwElo:1155},
    {name:"nine",clan:"ZKF",country:"CA",presence:"online",level:21,elo:1499,mmElo:1466,pwElo:1430},
    {name:"CAI-Brutal",bot:true,presence:"online"}
  ],
  channelChat: [
    { time:"20:51", user:{name:"tinman",country:"GB"}, text:"anyone up for teams" },
    { time:"20:52", user:{name:"nine",clan:"ZKF",country:"CA"}, text:"in 10" },
    { time:"20:55", system:true, text:"marrow is now in game" },
    { time:"20:58", user:{name:"zk-admin",country:"US",admin:true}, text:"server restart at 23:00 UTC, matches in progress will finish" },
    { time:"21:01", emote:true, user:{name:"pell"}, text:"is already queuing" },
    { time:"21:02", user:{name:"hexed",clan:"ZKF",country:"US"}, text:"Shadowfury hosted, room is open - 11/16 and we need people who can actually hold a flank instead of feeding their com in the first five minutes" },
    { time:"21:06", ring:true, user:{name:"quantum",clan:"ZKF",country:"PL"}, text:"Shadowfury get in here" }
  ],
  debrief: {
    /* Field names are `buildDebriefView`'s, not the mockup's: the demo is the
       only place the debriefing gets exercised without a server, so a fixture
       shaped differently from the live view hides exactly the bugs it should
       be catching. It hid two - the rating panel and the match length never
       rendered for a real match. */
    result:"Victory", map:"Argent_Strata_1.1", mode:"Teams", elapsed:"27:14", category:"Team",
    /* A rank Zero-K actually has. "Sergeant" was invented for the mockup and
       read as though the game used military ranks, which it does not. */
    rating:{ change:18, next:1842, rank:"Giant", rankup:true, prevRankElo:1750, nextRankElo:1900 },
    xp:{ change:640, next:12480, prevLevelXp:9000, nextLevelXp:16000, levelUp:false, level:41 },
    awards:[
      { name:"Most damage dealt", value:"148,320" },
      { name:"Largest army", value:"96 units" },
      { name:"First blood", value:"2:41" }
    ],
    team:[
      { user:{name:"Shadowfury",clan:"ZKF",country:"DE",faction:"machines",level:41}, elo:1842, change:18, win:true },
      { user:{name:"quantum",clan:"ZKF",country:"PL",faction:"rising",level:12}, elo:1521, change:18, win:true },
      { user:{name:"tinman",country:"GB",faction:"hegemony",level:27}, elo:1689, change:18, win:true },
      { user:{name:"a",country:"JP",faction:"rising",level:3}, elo:1005, change:18, win:true }
    ],
    opponents:[
      { user:{name:"hexed",clan:"ZKF",country:"US",faction:"machines",level:33}, elo:1773, change:-17, win:false },
      { user:{name:"lorelei",country:"FR",faction:"hegemony",level:19}, elo:1571, change:-17, win:false },
      { user:{name:"marrow",country:"SE",faction:"machines",level:44}, elo:1938, change:-17, win:false },
      { user:{name:"vexatiousmachinist",country:"BR",faction:"rising",level:8}, elo:1187, change:-17, win:false }
    ]
  }
});
