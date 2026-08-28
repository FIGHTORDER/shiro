function widget:GetInfo()
	return {
		name    = "Shiro UI Skin",
		desc    = "Lets Zero-K's skin setting reach the skins Shiro installs.",
		author  = "Shiro",
		date    = "2026",
		license = "GNU GPL, v2 or later",
		--[[ An api widget, and just above Chili's 1000.

		     Chili binds a skin to a control when the control is BUILT, so a
		     skin set after the interface exists reaches nothing already on
		     screen. That is why Zero-K's own option says it needs a reload.

		     cawidgets loads every widget declaring `api` in a pass of its own
		     before any ordinary widget (cawidgets.lua:590, "first add the api
		     widgets"), which is how a layer 1000 Chili is available to a layer
		     -11 interface widget. Sitting in that pass, one layer above Chili,
		     means the skin is set after Chili exists and before anything has
		     drawn a control with it. No reload, and nothing half-skinned. ]]
		layer   = 1001,
		api     = true,
		enabled = true,
	}
end

--[[
Zero-K's own skin picker cannot see a skin it was not told about.

Chili discovers skins by scanning directories, and `SkinHandler.GetAvailableSkins`
exists to report what it found, but nothing in Zero-K calls it. The picker in
`LuaUI/Configs/epicmenu_conf.lua` is a hardcoded list of eight names, so a skin
installed as files is loaded and usable and still absent from the only control
that would select it. This adds a second control beside it.
]]

--[[ Our own copy of the choice, rather than only epicmenu's.

     epicmenu restores its options when it integrates a widget, which happens
     well after this widget starts. The handler restores widget config inside
     LoadWidget (cawidgets.lua:760), before any Initialize runs, so a copy kept
     here is available at the one moment it can still be applied for free. ]]
local chosen

function widget:SetConfigData(data)
	if type(data) == "table" and type(data.skin) == "string" then
		chosen = data.skin
	end
end

function widget:GetConfigData()
	return { skin = chosen }
end

local function Apply(name)
	if not name or name == "" then
		return false
	end
	local chili = WG.Chili
	if not chili then
		return false
	end
	--[[ A skin that was installed, chosen, and then removed leaves its name
	     saved. Setting one Chili cannot resolve makes every control fall back
	     at once, which reads as Shiro breaking the game rather than as a skin
	     that is no longer there. ]]
	local SH = chili.SkinHandler
	if SH and SH.IsValidSkin and not SH.IsValidSkin(name) then
		Spring.Echo("Shiro: the skin '" .. tostring(name)
			.. "' is not installed, so the current one is left alone.")
		return false
	end
	--[[ Set on the theme directly. WG.crude.SetSkin does exactly this, but it
	     belongs to epicmenu, which has not loaded yet at this point. ]]
	if chili.theme and chili.theme.skin and chili.theme.skin.general then
		chili.theme.skin.general.skinName = name
		return true
	end
	return false
end

options_path = "Settings/HUD Panels/Extras/HUD Skin"

options = {
	shiroSkin = {
		name = "Shiro Skin",
		type = "list",
		--[[ No `value`, and that is what makes the choice survive a reload.
		     epicmenu restores a saved option and then fires OnChange only
		     `if valuechanged`, meaning only when the saved value differs from
		     what the option already holds. An option carrying its own default
		     holds that default, the saved value matches it, nothing counts as
		     changed, and the skin is never applied. Left unset it holds nil,
		     every saved value differs from nil, and OnChange fires every time.
		     Zero-K's own skin option is written the same way.

		     Not `advanced`, unlike Zero-K's: somebody who has installed a
		     Shiro skin should not have to find a second switch first. ]]
		--[[ The dark three. Shiro's light skins are not here because Zero-K's
		     interface hardcodes light text in controls a skin cannot reach,
		     which puts white copy on a white panel. ]]
		items = {
			{ key = "ShiroSlate", name = "Shiro Slate" },
			{ key = "ShiroGraphite", name = "Shiro Graphite" },
			{ key = "ShiroAzure", name = "Shiro Azure" },
		},
		OnChange = function (self)
			chosen = self.value
			Apply(self.value)
		end,
	},
}

function widget:Initialize()
	Apply(chosen)
end
