#pragma once

#include <cstdint>
#include <optional>

#include "dashql/script.h"

namespace dashql {

struct TerminalPipeDefinition {
    uint32_t statement_id;
    uint32_t query_node_id;
    uint32_t pipe_node_id;
    uint32_t alias_node_id;
    uint32_t body_stage_count;
};

/// Return the terminal pipe alias when a top-level statement ends in `|> AS name`.
std::optional<TerminalPipeDefinition> FindTerminalPipeDefinition(const ParsedScript& parsed,
                                                                 uint32_t statement_id);

}  // namespace dashql
