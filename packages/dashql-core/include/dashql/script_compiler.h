#pragma once

#include <flatbuffers/flatbuffer_builder.h>

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "dashql/buffers/index_generated.h"
#include "dashql/script_local_relation.h"

namespace dashql {

struct ScriptCompilationError {
    buffers::execution::ScriptCompilationErrorCode code;
    uint32_t statement_id = PROTO_NULL_U32;
    uint32_t ast_node_id = PROTO_NULL_U32;
    std::optional<TextSpan> text_span;
    std::string message;
};

struct CompiledVisualization {
    std::string renderer;
    std::string vegalite_spec;
    std::string umap_spec;
};

struct ScriptCompilationResult {
    buffers::execution::ScriptCompilationStatementKind kind =
        buffers::execution::ScriptCompilationStatementKind::QUERY;
    uint32_t terminal_statement_id = PROTO_NULL_U32;
    std::string sql;
    std::optional<CompiledVisualization> visualization;
    std::vector<ScriptCompilationError> errors;

    flatbuffers::Offset<buffers::execution::ScriptCompilationResult> Pack(
        flatbuffers::FlatBufferBuilder& builder) const;
};

class Script;
struct ScriptCompilationOptions;

struct ScriptCompiler {
    static ScriptCompilationResult Compile(Script& script,
                                           const buffers::formatting::FormattingConfigT& config,
                                           ScriptCompilationOptions options = {});
};

}  // namespace dashql
