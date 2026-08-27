function widget:GetInfo()
	return {
		name    = "Shiro Lobby Button",
		desc    = "Puts the Lobby button back when the game was started by Shiro.",
		author  = "Shiro",
		date    = "2026",
		license = "GNU GPL, v2 or later",
		layer   = 0,
		enabled = true,
	}
end

--[[
Zero-K's own Lobby button lives in gui_epicmenu.lua and is only built when a
LuaMenu is loaded:

	local luaMenu = Spring.GetMenuName and Spring.SendLuaMenuMsg and Spring.GetMenuName()
	if luaMenu then ... Button:New{name = 'lobbyButton'} ... end

Shiro runs the lobby in its own process, so there is no LuaMenu and the button
is correctly skipped. What is left behind is a hole: the bar's visible
background spans the whole 380px window, while its contents are right anchored
and only as wide as the buttons in them, so the 80px the button used to occupy
becomes bare panel at the left end.

This fills that hole rather than reaching into epicmenu. Appending to epicmenu's
own row is possible but not durable: the panel and window are file locals it
never exports, and OnResize disposes the panel and everything under it, so an
appended button disappears on the first resolution change or tweak mode drag.
Reading where the bar is and drawing beside it means the worst case is a button
in the wrong place, not a button that vanishes or a layout we broke.

The click writes a file. Shiro polls for it and raises its window. The engine
sandbox allows exactly this: io.open is write-dir relative and permitted, while
os.execute, io.popen and os.getenv are removed, and SendLuaMenuMsg without a
menu is a silent no-op.
]]

-- Also minimise the game on click. Without it the button does nothing at all
-- when the game was not started by Shiro, since nobody is reading the file.
local MINIMIZE_GAME = true

-- Relative to the engine's write directory, which is where a Lua file write is
-- resolved from and is the Zero-K root Shiro launched.
local SIGNAL_FILE = "LuaUI/shiro-lobby.txt"

-- The Lobby button's own metrics, from gui_epicmenu.lua: B_WIDTH_TOMAINMENU + 1.
local BUTTON_WIDTH = 81

local Chili
local window
local button
local presses = 0

local function Signal()
	presses = presses + 1
	-- Content rather than existence, so a press is a change Shiro notices
	-- rather than a file somebody has to delete before the next one works.
	-- The time keeps it unique across a widget reload, which restarts presses.
	local file = io.open(SIGNAL_FILE, "w")
	if file then
		file:write(string.format("%d:%d\n", os.time(), presses))
		file:close()
	end
end

local function OnClick()
	Signal()
	if MINIMIZE_GAME and Spring.SetWindowMinimized then
		Spring.SetWindowMinimized()
	end
end

--[[ Where the bar is, and where inside it the hole is.

     Read only. Nothing here mutates an object belonging to epicmenu. ]]
local function BarGeometry()
	local screen0 = Chili.Screen0
	if not screen0 or not screen0.GetObjectByName then
		return nil
	end
	local bar = screen0:GetObjectByName("epicmenubar")
	if not bar or not bar.width then
		return nil
	end

	-- Align to the Menu button rather than guessing, so a HUD preset that
	-- changes the bar's height does not leave us floating.
	local y, height = bar.y + 4, bar.height - 9
	local menu = bar.GetObjectByName and bar:GetObjectByName("subMenuButton")
	if menu and menu.height and menu.LocalToScreen then
		local ok, _, screenY = pcall(menu.LocalToScreen, menu, 0, 0)
		if ok and screenY then
			y, height = screenY, menu.height
		end
	end
	return bar.x + 3, y, height
end

local function Place()
	local x, y, height = BarGeometry()
	if not x then
		return false
	end
	window:SetPos(x, y, BUTTON_WIDTH, height)
	button:SetPos(0, 0, BUTTON_WIDTH, height)
	return true
end

local function Build()
	if not Chili.Screen0 then
		return false
	end
	window = Chili.Window:New{
		name = "shiroLobbyButtonHolder",
		parent = Chili.Screen0,
		padding = {0, 0, 0, 0},
		backgroundColor = {0, 0, 0, 0},
		color = {0, 0, 0, 0},
		draggable = false,
		resizable = false,
		tweakDraggable = false,
		tweakResizable = false,
		minimizable = false,
		-- The bar already paints its own skin under this spot, so the holder
		-- is a position and nothing else.
		dockable = false,
	}
	-- Placed before shown. An unpositioned Chili window sits at the top left,
	-- which is a Lobby button in the wrong corner for anyone whose epicmenu is
	-- off, and a visible jump for everyone else.
	window:SetVisibility(false)
	button = Chili.Button:New{
		name = "shiroLobbyButton",
		parent = window,
		caption = "Lobby",
		padding = {0, 0, 0, 0},
		margin = {0, 0, 0, 0},
		tooltip = "Bring Shiro to the front.",
		OnClick = {OnClick},
	}
	return true
end

function widget:ViewResize()
	Place()
end

--[[ The bar can also move without the view resizing, by being dragged in tweak
     mode, so its position is worth re-reading now and then. Twice a second is
     far below anything a person notices and costs one table lookup. ]]
local sinceCheck = 0
function widget:Update(dt)
	sinceCheck = sinceCheck + dt
	if sinceCheck < 0.5 then
		return
	end
	sinceCheck = 0
	if not Place() then
		-- epicmenu is off or gone. Nothing to sit beside, so show nothing
		-- rather than a button floating in the corner.
		window:SetVisibility(false)
		return
	end
	window:SetVisibility(true)
end

function widget:Shutdown()
	if window then
		window:Dispose()
	end
end

function widget:Initialize()
	--[[ Under Chobby the real button is already there and does more than this
	     one can. Two Lobby buttons side by side is worse than none. ]]
	if Spring.GetMenuName and Spring.GetMenuName() ~= "" then
		widgetHandler:RemoveWidget()
		return
	end
	Chili = WG.Chili
	if not Chili then
		widgetHandler:RemoveWidget()
		return
	end
	if not Build() then
		widgetHandler:RemoveWidget()
		return
	end
	if Place() then
		window:SetVisibility(true)
	end
	-- The same hotkey shape epicmenu gives its own button.
	if widgetHandler.AddAction then
		widgetHandler:AddAction("shirolobby", OnClick, nil, "t")
	end
end
