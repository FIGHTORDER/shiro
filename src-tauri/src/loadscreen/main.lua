-- Shiro's loading screen.
--
-- This file is placed by Shiro at <datadir>/LuaIntro/Addons/main.lua. It is not
-- part of any archive and it does not modify one: Zero-K's own
-- luaintro/main.lua sets `VFS.DEF_MODE = VFS.RAW_FIRST`, so the raw data
-- directory is searched before the game archive and this is found first. The
-- game's checksum is untouched, which is the whole point - a modified archive
-- would desync from the server.
--
-- The capitals in that path are the engine's, not a preference: the addon
-- handler looks for `LuaIntro/Addons/`, and a raw file is only found by the
-- exact name asked for. Every path in this file is spelled the same way, for
-- the same reason - Linux will not forgive it and Windows will.
--
-- It replaces Zero-K's addon of the same name rather than drawing beside it, so
-- the progress bar below is ours and has to work. Deleting this file restores
-- the original, which is the uninstall.
--
-- Two PNGs are placed beside it, in LuaIntro/Images. Unlike the font, they can
-- fail to resolve - so every one of them is bound once, checked once, and
-- simply not drawn if it is not there. A missing picture costs a picture; it
-- must never cost the screen, because what is behind this screen is somebody
-- waiting to play.

if addon.InGetInfo then
	return {
		name    = "Main",
		desc    = "Shiro's loading screen",
		author  = "Shiro",
		license = "GPL2",
		layer   = 0,
		depend  = {"LoadProgress"},
		enabled = true,
	}
end

--------------------------------------------------------------------------------
-- The design, as delivered.
--
-- Every measurement is a fraction of viewport *height*, which is what lets
-- 16:9, 21:9 and 4:3 share one layout: nothing reflows, and only the art has a
-- width cap. Coordinates are normalised with the origin bottom-left and Y up,
-- so a larger Y is higher on the screen.

local INSET_H, INSET_W = 0.098, 0.075   -- side inset: 0.098 H, capped at 0.075 W

local RULE_Y   = 0.145                  -- the track's centre line
local FILL_H   = 0.005                  -- of H, floored at 2 px
local ROW_Y    = 0.075                  -- baseline of the step / number row
local LOCKUP_Y = 0.420                  -- bottom of the mark-over-wordmark block
local MARK_H   = 0.098                  -- the mark is square, measured in H
local MARK_GAP = 0.025                  -- mark to wordmark

local ART_H, ART_W = 0.80, 0.42         -- plate height: min(0.80 H, 0.42 W)

-- The match block, which takes the plate's place when Shiro has written one.
-- The designer's numbers, converted from the 1280x720 board: right inset,
-- bottom 152/720, column gap 56/720, and the two type sizes from the table.
local MATCH_Y     = 0.211               -- bottom of the whole block
local MATCH_GAP   = 0.039               -- teams row to the map block above it
local LABEL_GAP   = 0.011               -- a label to the thing it labels
local COL_GAP     = 0.078               -- between the two team columns
local LINE        = 1.6                 -- player name line height, in ems

-- The plate's own shape. tools/gen-loadscreen-art.mjs inverts the client's
-- glaive-sidelit.png without resampling it, so this is that file's aspect and
-- has to be changed with it.
local ART_ASPECT = 807 / 1400

-- Hex, converted. There is no chroma anywhere on this screen: the faction
-- colours are the lobby's identity, and this is drawn before there are teams to
-- colour. One screen serves all four skins for the same reason - it is in the
-- dark, in front of a game, not inside the client.
local GROUND = 0x0A / 0xFF              -- #0A0A0A
local A_PLATE, A_RULE, A_FILL, A_STEP = 0.13, 0.12, 0.88, 0.56

-- Instrument Sans and DM Mono are not loaded here, and this is a deliberate
-- retreat rather than an oversight: shipping a face beside the addon has never
-- been tried in LuaIntro, and a font that fails to load is a blank screen in
-- front of a match. So this takes the fallback the design offers by name -
-- the engine's own FreeSansBold at 0.96 of every size, with the wordmark
-- tracked +.16em instead of +.20em. The number loses its mono face with it;
-- it is a two-digit percentage that is redrawn as it changes, so the cost is
-- the drift, not legibility.
local FALLBACK = 0.96
local WORDMARK, STEP, NUMBER = 0.0260 * FALLBACK, 0.0155 * FALLBACK, 0.0155 * FALLBACK
local MAPNAME, PLAYER = 0.0305 * FALLBACK, 0.0180 * FALLBACK
local TRACK_WORDMARK, TRACK_STEP = 0.16, 0.09

--------------------------------------------------------------------------------
-- Progress.

-- The match, if Shiro wrote one beside this file at launch.
--
-- Read once, and defensively at every step: the file is optional, it is
-- rewritten per launch by another program, and a screen that throws is a black
-- screen in front of a game. Anything unexpected here leaves `match` nil and
-- the plate is drawn instead - which is the design's own shipping layout, so
-- the fallback is a complete screen rather than a degraded one.
local MATCH_FILE = "LuaIntro/shiro-match.lua"

local function readMatch()
	if not (VFS and VFS.FileExists and VFS.FileExists(MATCH_FILE)) then
		return nil
	end
	local ok, chunk = pcall(VFS.LoadFile, MATCH_FILE)
	if not ok or type(chunk) ~= "string" then
		return nil
	end
	local loaded, fn = pcall(loadstring or load, chunk)
	if not loaded or type(fn) ~= "function" then
		return nil
	end
	local ran, value = pcall(fn)
	if not ran or type(value) ~= "table" then
		return nil
	end
	-- Shape it here so the draw call can trust what it holds.
	local teams = {}
	if type(value.teams) == "table" then
		for i = 1, #value.teams do
			local t = value.teams[i]
			if type(t) == "table" and type(t.players) == "table" and #t.players > 0 then
				local names = {}
				for j = 1, #t.players do
					if type(t.players[j]) == "string" then
						names[#names + 1] = t.players[j]
					end
				end
				if #names > 0 then
					teams[#teams + 1] = {
						label = type(t.label) == "string" and t.label or ("Team " .. #teams + 1),
						players = names,
					}
				end
			end
		end
	end
	if #teams == 0 then
		return nil
	end
	return {
		map = type(value.map) == "string" and value.map or "",
		teams = teams,
	}
end

local matchOk, match = pcall(readMatch)
if not matchOk then
	match = nil
end

local lastLoadMessage = ""
local lastStep = ""
-- Floor and ceiling for the phase in progress. The ceiling starts open, not
-- closed: the bands are applied as min(max(engine, floor), ceiling), so a
-- ceiling of zero clamps the engine's own number to zero - and it stays there
-- until one of the five exact-match messages below arrives. The engine emits
-- far more messages than those five, so on a load that starts with any other
-- one the bar sat at 0% while the machine was visibly working.
local lastProgress = {0, 1}

-- The engine's progress reporting is coarse and stops for long stretches, so
-- Zero-K brackets each phase between a floor and a ceiling and lets the bar
-- move within it. Same table, same reason: without it the bar sits still
-- through pathing and looks hung.
local progressByLastLine = {
	["Parsing Map Information"]     = {0.00, 0.20},
	["Loading Weapon Definitions"]  = {0.10, 0.50},
	["Loading LuaRules"]            = {0.40, 0.80},
	["Loading LuaUI"]               = {0.70, 0.95},
	["Loading Skirmish AIs"]        = {0.90, 0.99},
}

-- The engine shouts its phases in Title Case. The design asks for sentence
-- case, then sets the row in capitals - so the mapping is what survives if the
-- capitals are ever dropped, and `LuaRules` keeps its own spelling either way.
local stepByLastLine = {
	["Parsing Map Information"]     = "Parsing map information",
	["Loading Weapon Definitions"]  = "Loading weapon definitions",
	["Loading LuaRules"]            = "Loading LuaRules",
	["Loading LuaUI"]               = "Loading LuaUI",
	["Loading Skirmish AIs"]        = "Loading skirmish AIs",
}

function addon.LoadProgress(message, replaceLastLine)
	lastLoadMessage = message or ""
	if lastLoadMessage:find("Path") then
		-- Pathing emits no fixed message, so it gets its own band and its own
		-- one-word label.
		lastProgress = {0.30, 0.60}
		lastStep = "Pathing"
	else
		lastStep = stepByLastLine[lastLoadMessage] or lastLoadMessage
	end
	lastProgress = progressByLastLine[lastLoadMessage] or lastProgress
end

-- The bar is the only moving thing on the screen and it moves only when the
-- engine says so: 180 ms of ease-out onto each new value, and never backwards.
-- Nothing here is otherwise time-based, so a stall reads as the machine working
-- rather than as the app hanging.
--
-- Wall clock, not frames: the engine is loading, the frame rate is whatever is
-- left over, and an ease counted in frames would run at a different speed on
-- every machine. Neither clock below is documented for LuaIntro, so if neither
-- turns out to be there the bar snaps instead - which is the honest failure,
-- and the same behaviour the screen had before.
local EASE = 0.18

local clock
do
	if Spring and Spring.GetTimer and Spring.DiffTimers then
		local started = Spring.GetTimer()
		local ok, seconds = pcall(Spring.DiffTimers, Spring.GetTimer(), started)
		if ok and type(seconds) == "number" then
			clock = function()
				local fine, elapsed = pcall(Spring.DiffTimers, Spring.GetTimer(), started)
				return fine and elapsed or 0
			end
		end
	end
	if not clock and os and os.clock then
		clock = os.clock
	end
end

local shown, easeFrom, easeTo, easeSince = 0, 0, 0, nil

local function target()
	local p = SG.GetLoadProgress()
	if p == 0 then
		return lastProgress[1]
	end
	return math.min(math.max(p, lastProgress[1]), lastProgress[2])
end

local function progress()
	local want = target()
	-- Never backwards. The bands can hand back a smaller number when a phase
	-- changes - a floor of 0.30 after a ceiling of 0.50 - and a bar that
	-- retreats reads as an error rather than as progress.
	if want > easeTo then
		easeFrom, easeTo, easeSince = shown, want, clock and clock()
	end
	if easeSince then
		local t = (clock() - easeSince) / EASE
		if t >= 1 then
			shown = easeTo
		else
			shown = easeFrom + (easeTo - easeFrom) * (1 - (1 - math.max(t, 0)) ^ 3)
		end
	else
		shown = easeTo
	end
	return shown
end

--------------------------------------------------------------------------------
-- Type.

local font = gl.LoadFont("FreeSansBold.otf", 64, 12, 1.5)

-- font:Print has no letter spacing, so tracked type is printed a glyph at a
-- time. Everything printed here is ASCII - five capitals for the wordmark, and
-- the engine's own English phase names - so stepping by byte is safe and saves
-- a UTF-8 reader on a screen that cannot afford one.
local trackable = font and type(font.GetTextWidth) == "function"

local function tracked(text, x, y, size, track, align)
	if not trackable then
		font:Print(text, x, y, size, align == "r" and "ro" or "o")
		return
	end
	local gap = track * size
	if align == "r" then
		-- Right-aligned tracked text has to be measured before it is drawn:
		-- the glyphs are printed one at a time from a left edge, and the
		-- tracking makes the run wider than the string measures.
		local width = -gap
		for i = 1, #text do
			width = width + font:GetTextWidth(text:sub(i, i)) * size + gap
		end
		x = x - width
	end
	for i = 1, #text do
		local glyph = text:sub(i, i)
		font:Print(glyph, x, y, size, "o")
		x = x + font:GetTextWidth(glyph) * size + gap
	end
end

--------------------------------------------------------------------------------
-- The two pictures.
--
-- Bound on the first frame rather than at file scope: this file is read by the
-- addon handler, and nothing promises a GL context is current while it is being
-- read. Bound *once* either way, because this is redrawn every frame on a
-- machine that is busy loading a game.
--
-- Two names are tried per image. The bare VFS path takes the engine's default
-- filtering, which is kinder to a 1400 px plate drawn at a third of that; the
-- `:n:` form is the one Zero-K's own addon uses and is therefore known to
-- resolve from here. Whichever binds first is kept.
local IMAGES = {
	mark  = "LuaIntro/Images/shiro-mark.png",
	plate = "LuaIntro/Images/shiro-glaive-plate.png",
}

local bound

local function textures()
	if bound then
		return bound
	end
	bound = {}
	for key, file in pairs(IMAGES) do
		bound[key] = false
		for _, name in ipairs({file, ":n:" .. file}) do
			local ok, applied = pcall(gl.Texture, name)
			if ok and applied then
				bound[key] = name
				break
			end
		end
	end
	pcall(gl.Texture, false)
	return bound
end

-- Plain TexRect, no flip. Spring uploads a file texture with t = 0 at the
-- image's bottom, which is why every widget that draws an icon in screen space
-- gets away with `gl.TexRect(x, y, x + w, y + h)`. That is read from how the
-- engine is used, not verified here - there is no engine on the machine this
-- was written on - and it is the one thing on this screen that would be
-- unmistakably wrong if the convention is the other way round: the Glaive would
-- stand on its head.
local function picture(name, x1, y1, x2, y2, alpha)
	if not name then
		return
	end
	gl.Color(1, 1, 1, alpha)
	gl.Texture(name)
	gl.TexRect(x1, y1, x2, y2)
	gl.Texture(false)
end

--------------------------------------------------------------------------------

-- The match, right-aligned in the plate's place. Pixel space, so this is only
-- ever called from inside the one scale the strings share.
--
-- Laid out from the right edge and from the bottom up, because that is the only
-- way to place right-aligned text of unknown width without measuring the whole
-- block first. Widths come from the font, so a missing GetTextWidth costs the
-- second column its position rather than the screen.
local function drawMatch(vsx, vsy, insetPx)
	local rightPx = vsx - insetPx
	local step, player = STEP * vsy, PLAYER * vsy

	-- The teams row, bottom-aligned on MATCH_Y and growing upward.
	local rows = 0
	for i = 1, #match.teams do
		rows = math.max(rows, #match.teams[i].players)
	end
	local namesTop = MATCH_Y * vsy + rows * player * LINE
	local labelY = namesTop + LABEL_GAP * vsy

	local edge = rightPx
	for i = #match.teams, 1, -1 do
		local team = match.teams[i]

		gl.Color(1, 1, 1, A_STEP)
		tracked(team.label:upper(), edge, labelY, step, TRACK_STEP, "r")

		gl.Color(1, 1, 1, 0.75)
		local widest = 0
		for j = 1, #team.players do
			local name = team.players[j]
			font:Print(name, edge, namesTop - j * player * LINE, player, "ro")
			if font.GetTextWidth then
				widest = math.max(widest, font:GetTextWidth(name) * player)
			end
		end
		if font.GetTextWidth then
			widest = math.max(widest, font:GetTextWidth(team.label) * step)
		end
		edge = edge - widest - COL_GAP * vsy
	end

	-- The map, above the teams.
	if match.map ~= "" then
		local nameY = labelY + step + MATCH_GAP * vsy
		gl.Color(1, 1, 1, 1)
		font:Print(match.map, rightPx, nameY, MAPNAME * vsy, "ro")
		gl.Color(1, 1, 1, A_STEP)
		tracked("MAP", rightPx, nameY + MAPNAME * vsy + LABEL_GAP * vsy, step,
			TRACK_STEP, "r")
	end
end

function addon.DrawLoadScreen()
	local loaded = progress()
	local vsx, vsy = gl.GetViewSizes()
	local image = textures()

	-- One inset for both sides, measured in height and capped in width so a
	-- narrow viewport does not push the two columns into each other.
	local insetPx = math.min(INSET_H * vsy, INSET_W * vsx)
	local left = insetPx / vsx
	local right = 1 - left

	-- 1. The ground. Flat, not the map: a dimmed map puts arbitrary art behind
	--    the one thing that has to stay legible for a minute, and makes the
	--    screen look different on every machine.
	gl.Color(GROUND, GROUND, GROUND, 1)
	gl.Rect(0, 0, 1, 1)

	-- 2. The plate, standing on the rule at the right inset. Its height is
	--    capped against width, so 4:3 gives up the art rather than the layout.
	--
	--    Unless there is a match to show, in which case the roster takes this
	--    space rather than sharing it - the designer's instruction, and the
	--    reason every other measurement on the screen is unchanged either way.
	if not match then
		local plate = math.min(ART_H * vsy, ART_W * vsx)
		picture(image.plate, right - (plate * ART_ASPECT) / vsx, RULE_Y,
			right, RULE_Y + plate / vsy, A_PLATE)
	end

	-- 3. The mark, above the wordmark it is locked up with. The block is
	--    measured from its bottom, and the wordmark is all capitals, so the
	--    bottom is the wordmark's baseline and the em box above it is the space
	--    the type takes.
	local markBottom = LOCKUP_Y + WORDMARK + MARK_GAP
	picture(image.mark, left, markBottom, left + (MARK_H * vsy) / vsx,
		markBottom + MARK_H, 1)

	-- 4. All three strings, in pixel space. Scaled once and printed together
	--    rather than switching space per string.
	if font then
		gl.PushMatrix()
		gl.Scale(1 / vsx, 1 / vsy, 1)

		gl.Color(1, 1, 1, 1)
		tracked("SHIRO", insetPx, LOCKUP_Y * vsy, WORDMARK * vsy, TRACK_WORDMARK)

		gl.Color(1, 1, 1, A_STEP)
		tracked(lastStep:upper(), insetPx, ROW_Y * vsy, STEP * vsy, TRACK_STEP)

		-- Floored, not rounded: 99.6% is not 100%, and a screen that says it is
		-- finished while the machine is still working is the one lie this
		-- screen has to avoid.
		gl.Color(1, 1, 1, 1)
		font:Print(("%d%%"):format(math.floor(loaded * 100)), vsx - insetPx,
			ROW_Y * vsy, NUMBER * vsy, "ro")

		if match then
			drawMatch(vsx, vsy, insetPx)
		end

		gl.PopMatrix()
	end

	-- 5. The rule, then the fill over it. This order is the design's: the fill
	--    drawn last is never anti-aliased against the plate behind it.
	local pixel = 1 / vsy
	local rule = pixel / 2                              -- 1 px, never scaled
	local fill = math.max(FILL_H, 2 * pixel) / 2

	gl.Color(1, 1, 1, A_RULE)
	gl.Rect(left, RULE_Y - rule, right, RULE_Y + rule)

	gl.Color(1, 1, 1, A_FILL)
	gl.Rect(left, RULE_Y - fill,
		left + (right - left) * math.max(0, math.min(1, loaded)), RULE_Y + fill)

	gl.Color(1, 1, 1, 1)
end

function addon.Shutdown()
	if font then
		gl.DeleteFont(font)
		font = nil
	end
end
