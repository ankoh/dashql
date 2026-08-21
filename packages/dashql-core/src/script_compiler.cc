#include "dashql/script_compiler.h"

#include "dashql/formatter/formatter.h"
#include "dashql/script.h"
#include "dashql/utils/ast_attributes.h"
#include "dashql/visualize/vegalite.h"

namespace dashql {

using AttributeKey = buffers::parser::AttributeKey;
using ErrorCode = buffers::execution::ScriptCompilationErrorCode;
using NodeType = buffers::parser::NodeType;
using StatementKind = buffers::execution::ScriptCompilationStatementKind;

namespace {

ScriptCompilationError MakeError(ErrorCode code, std::string message, uint32_t statement_id = PROTO_NULL_U32,
                                 uint32_t ast_node_id = PROTO_NULL_U32, std::optional<TextSpan> text_span = {}) {
    return ScriptCompilationError{code, statement_id, ast_node_id, text_span, std::move(message)};
}

std::optional<uint32_t> ReadTerminalSqlNode(const ParsedScript& parsed, uint32_t statement_id, StatementKind& kind) {
    const auto& statement = parsed.statements[statement_id];
    switch (statement.type) {
        case buffers::parser::StatementType::CREATE_FUNCTION:
        case buffers::parser::StatementType::CREATE_TABLE:
        case buffers::parser::StatementType::CREATE_TABLE_AS:
        case buffers::parser::StatementType::CREATE_VIEW:
        case buffers::parser::StatementType::DROP_TABLE:
        case buffers::parser::StatementType::DROP_VIEW:
        case buffers::parser::StatementType::SELECT_INTO:
        case buffers::parser::StatementType::ATTACH_DATABASE:
        case buffers::parser::StatementType::EXPLAIN:
        case buffers::parser::StatementType::SELECT:
        case buffers::parser::StatementType::INSERT:
        case buffers::parser::StatementType::SET:
            kind = StatementKind::QUERY;
            return statement.root;
        case buffers::parser::StatementType::NONE:
            return std::nullopt;
        case buffers::parser::StatementType::VIS_VISUALISE: {
            kind = StatementKind::VISUALIZE;
            const auto& root = parsed.nodes[statement.root];
            auto [source] = LookupAttributes<AttributeKey::VIS_VISUALISE_SELECT>(
                std::span{parsed.nodes}.subspan(root.children_begin_or_value(), root.children_count()));
            if (!source) return std::nullopt;
            return static_cast<uint32_t>(source - parsed.nodes.data());
        }
    }
    return std::nullopt;
}

}  // namespace

flatbuffers::Offset<buffers::execution::ScriptCompilationResult> ScriptCompilationResult::Pack(
    flatbuffers::FlatBufferBuilder& builder) const {
    std::vector<flatbuffers::Offset<buffers::execution::ScriptCompilationError>> error_offsets;
    error_offsets.reserve(errors.size());
    for (const auto& error : errors) {
        auto message = builder.CreateString(error.message);
        buffers::execution::ScriptCompilationErrorBuilder eb{builder};
        eb.add_code(error.code);
        eb.add_statement_id(error.statement_id);
        eb.add_ast_node_id(error.ast_node_id);
        if (error.text_span) eb.add_text_span(&error.text_span.value());
        eb.add_message(message);
        error_offsets.push_back(eb.Finish());
    }
    auto errors_offset = builder.CreateVector(error_offsets);
    auto sql_offset = builder.CreateString(sql);

    flatbuffers::Offset<buffers::execution::CompiledVisualization> visualization_offset;
    if (visualization) {
        visualization_offset = buffers::execution::CreateCompiledVisualization(
            builder, builder.CreateString(visualization->renderer), builder.CreateString(visualization->vegalite_spec),
            builder.CreateString(visualization->umap_spec));
    }
    return buffers::execution::CreateScriptCompilationResult(builder, kind, terminal_statement_id, sql_offset,
                                                             visualization_offset, errors_offset);
}

ScriptCompilationResult ScriptCompiler::Compile(Script& script, const buffers::formatting::FormattingConfigT& config,
                                                ScriptCompilationOptions options) {
    ScriptCompilationResult result;
    if (options.parse_if_outdated &&
        (!script.parsed_script || script.parsed_script->scanned_script->text_version != script.text_version)) {
        script.Parse();
    }
    if (!script.parsed_script) {
        result.errors.push_back(MakeError(ErrorCode::EMPTY_SCRIPT, "script is not parsed"));
        return result;
    }
    auto& parsed = *script.parsed_script;

    for (const auto& [span, message] : parsed.scanned_script->errors) {
        result.errors.push_back(MakeError(ErrorCode::SCANNER_ERROR, message, PROTO_NULL_U32, PROTO_NULL_U32, span));
    }
    for (const auto& error : parsed.errors) {
        result.errors.push_back(MakeError(ErrorCode::PARSER_ERROR, error.message, PROTO_NULL_U32, PROTO_NULL_U32,
                                          parsed.scanned_script->ResolveTextSpan(error.location)));
    }
    if (!result.errors.empty()) return result;
    if (parsed.statements.empty()) {
        result.errors.push_back(MakeError(ErrorCode::EMPTY_SCRIPT, "script has no executable statement"));
        return result;
    }

    constexpr auto execution_features = static_cast<uint32_t>(buffers::parser::ParsedScriptFeature::VISUALIZE);
    if (!options.allow_extensions && (parsed.feature_flags & execution_features) != 0) {
        result.errors.push_back(MakeError(ErrorCode::EXTENSIONS_DISABLED,
                                           "DashQL VISUALIZE syntax is not executable in the shell"));
        return result;
    }
    if ((parsed.feature_flags & execution_features) == 0) {
        result.kind = StatementKind::QUERY;
        result.terminal_statement_id = static_cast<uint32_t>(parsed.statements.size() - 1);
        result.sql = parsed.scanned_script->GetInput();
        return result;
    }

    auto terminal_statement_id = static_cast<uint32_t>(parsed.statements.size() - 1);
    result.terminal_statement_id = terminal_statement_id;

    auto terminal_sql_node_id = ReadTerminalSqlNode(parsed, terminal_statement_id, result.kind);
    if (!terminal_sql_node_id) {
        auto root_id = parsed.statements.back().root;
        result.errors.push_back(MakeError(ErrorCode::LAST_STATEMENT_NOT_EXECUTABLE,
                                          "the final statement must be a query or VISUALIZE statement",
                                          terminal_statement_id, root_id,
                                          parsed.scanned_script->ResolveTextSpan(parsed.nodes[root_id].symbol_span())));
        return result;
    }

    if (result.kind == StatementKind::VISUALIZE &&
        (!script.analyzed_script || script.analyzed_script->parsed_script.get() != script.parsed_script.get())) {
        script.Analyze(false);
    }

    Formatter formatter{parsed};
    result.sql = formatter.FormatNodeAt(*terminal_sql_node_id, config);
    if (result.sql.empty()) {
        result.sql.clear();
        result.errors.push_back(MakeError(ErrorCode::FORMAT_ERROR, "could not format the executable query",
                                          terminal_statement_id, *terminal_sql_node_id));
        return result;
    }

    if (result.kind == StatementKind::VISUALIZE) {
        const VisualizationSpec* visualization = nullptr;
        script.analyzed_script->visualization_specs.ForEach([&](size_t, VisualizationSpec& spec) {
            if (!visualization && spec.ast_statement_id == terminal_statement_id) visualization = &spec;
        });
        if (!visualization || !visualization->renderer) {
            result.sql.clear();
            result.errors.push_back(MakeError(ErrorCode::VISUALIZATION_METADATA_UNAVAILABLE,
                                              "could not resolve visualization metadata", terminal_statement_id,
                                              parsed.statements.back().root));
            return result;
        }
        CompiledVisualization compiled{.renderer = std::string(*visualization->renderer)};
        if (*visualization->renderer == "vegalite") {
            compiled.vegalite_spec = visualize::GenerateVegaLiteSpec(*visualization, *script.analyzed_script);
        } else if (*visualization->renderer == "umap") {
            compiled.umap_spec = visualize::GenerateUmapSpec(*visualization, *script.analyzed_script);
        }
        result.visualization = std::move(compiled);
    }
    return result;
}

void ScriptCompiler::CompileAndPack(flatbuffers::FlatBufferBuilder& builder, Script& script,
                                    const buffers::formatting::FormattingConfigT& config, bool allow_extensions,
                                    bool parse_if_outdated) {
    if (parse_if_outdated &&
        (!script.parsed_script || script.parsed_script->scanned_script->text_version != script.text_version)) {
        script.Parse();
    }

    ScriptCompilationResult compiled;
    if (!script.parsed_script) {
        compiled.errors.push_back(MakeError(ErrorCode::EMPTY_SCRIPT, "script is not parsed"));
    } else {
        auto& parsed = *script.parsed_script;
        for (const auto& [span, message] : parsed.scanned_script->errors) {
            compiled.errors.push_back(
                MakeError(ErrorCode::SCANNER_ERROR, message, PROTO_NULL_U32, PROTO_NULL_U32, span));
        }
        for (const auto& error : parsed.errors) {
            compiled.errors.push_back(MakeError(ErrorCode::PARSER_ERROR, error.message, PROTO_NULL_U32, PROTO_NULL_U32,
                                                parsed.scanned_script->ResolveTextSpan(error.location)));
        }

        constexpr auto execution_features = static_cast<uint32_t>(buffers::parser::ParsedScriptFeature::VISUALIZE);
        if (compiled.errors.empty() && parsed.statements.empty()) {
            compiled.errors.push_back(MakeError(ErrorCode::EMPTY_SCRIPT, "script has no executable statement"));
        } else if (compiled.errors.empty() && !allow_extensions && (parsed.feature_flags & execution_features) != 0) {
            compiled.errors.push_back(MakeError(ErrorCode::EXTENSIONS_DISABLED,
                                                 "DashQL VISUALIZE syntax is not executable in the shell"));
        } else if (compiled.errors.empty() && (parsed.feature_flags & execution_features) == 0) {
            compiled.kind = StatementKind::QUERY;
            compiled.terminal_statement_id = static_cast<uint32_t>(parsed.statements.size() - 1);
            compiled.sql = parsed.scanned_script->GetInput();
        } else if (compiled.errors.empty()) {
            compiled = Compile(script, config, {.parse_if_outdated = false});
        }
    }
    builder.Finish(compiled.Pack(builder));
}

}  // namespace dashql
