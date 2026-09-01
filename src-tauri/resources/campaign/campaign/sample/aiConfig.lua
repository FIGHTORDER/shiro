
local AiPrefixFunc = VFS.Include(LUA_DIRNAME .. "configs/gameConfig/zk/aiPrefixFunc.lua")

local aiLibFunctions = {}

local circuitDifficulties = {
	"CircuitAIEasy",
	"CircuitAINormal",
	"CircuitAIHard",
	"CircuitAIBrutal",
}

local circuitDifficultiesAlly = {
	"CircuitAINormal",
	"CircuitAIHard",
	"CircuitAIHard",
	"CircuitAIBrutal",
}

function aiLibFunctions.Circuit_difficulty_autofill(difficultySetting)
	return AiPrefixFunc() .. circuitDifficulties[difficultySetting]
end

function aiLibFunctions.Circuit_difficulty_autofill_ally(difficultySetting)
	return AiPrefixFunc() .. circuitDifficultiesAlly[difficultySetting]
end

return {
	aiLibFunctions = aiLibFunctions,
}
