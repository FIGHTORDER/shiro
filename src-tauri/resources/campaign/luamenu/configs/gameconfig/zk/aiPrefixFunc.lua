
local function AiPrefixFunc()
	if WG.Chobby.Configuration:IsCurrentVersionNewerThan(105, 2000) then
		return "1052188"
	end
	if WG.Chobby.Configuration:IsCurrentVersionNewerThan(105, 900) then
		return "1051344"
	end
	return "105"
end

return AiPrefixFunc
