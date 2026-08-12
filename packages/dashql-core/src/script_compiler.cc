#include "dashql/script_compiler.h"

#include <unordered_map>

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

struct LocalDefinition {
    TerminalPipeDefinition pipe;
    std::reference_wrapper<RegisteredName> name;
};

ScriptCompilationError MakeError(ErrorCode code, std::string message, uint32_t statement_id = PROTO_NULL_U32,
                                 uint32_t ast_node_id = PROTO_NULL_U32, std::optional<TextSpan> text_span = {}) {
    return ScriptCompilationError{code, statement_id, ast_node_id, text_span, std::move(message)};
}

std::optional<uint32_t> ReadTerminalQueryNode(const ParsedScript& parsed, uint32_t statement_id,
                                              StatementKind& kind) {
    const auto& statement = parsed.statements[statement_id];
    if (statement.type == buffers::parser::StatementType::SELECT) {
        kind = StatementKind::QUERY;
        return statement.root;
    }
    if (statement.type != buffers::parser::StatementType::VIS_VISUALISE) return std::nullopt;

    kind = StatementKind::VISUALIZE;
    const auto& root = parsed.nodes[statement.root];
    auto [source] = LookupAttributes<AttributeKey::VIS_VISUALISE_SELECT>(
        std::span{parsed.nodes}.subspan(root.children_begin_or_value(), root.children_count()));
    if (!source) return std::nullopt;
    return static_cast<uint32_t>(source - parsed.nodes.data());
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

ScriptCompilationResult ScriptCompiler::Compile(Script& script,
                                                const buffers::formatting::FormattingConfigT& config,
                                                bool parse_if_outdated) {
    ScriptCompilationResult result;
    if (parse_if_outdated &&
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

    constexpr auto execution_features =
        static_cast<uint32_t>(buffers::parser::ParsedScriptFeature::RELATIONAL_PIPE) |
        static_cast<uint32_t>(buffers::parser::ParsedScriptFeature::VISUALIZE);
    if ((parsed.feature_flags & execution_features) == 0) {
        result.kind = StatementKind::QUERY;
        result.terminal_statement_id = static_cast<uint32_t>(parsed.statements.size() - 1);
        result.sql = parsed.scanned_script->GetInput();
        return result;
    }

    std::vector<LocalDefinition> definitions;
    definitions.reserve(parsed.statements.size() - 1);
    std::unordered_map<std::string_view, uint32_t> names;
    for (uint32_t statement_id = 0; statement_id + 1 < parsed.statements.size(); ++statement_id) {
        auto definition = FindTerminalPipeDefinition(parsed, statement_id);
        if (!definition) {
            auto root_id = parsed.statements[statement_id].root;
            result.errors.push_back(MakeError(
                ErrorCode::PREFIX_NOT_LOCAL_RELATION,
                "every statement before the final query must end in a top-level |> AS name", statement_id, root_id,
                parsed.scanned_script->ResolveTextSpan(parsed.nodes[root_id].symbol_span())));
            continue;
        }
        auto& alias_node = parsed.nodes[definition->alias_node_id];
        auto& name = parsed.scanned_script->GetNames().At(alias_node.children_begin_or_value());
        if (auto [_, inserted] = names.emplace(name.text, statement_id); !inserted) {
            result.errors.push_back(MakeError(
                ErrorCode::DUPLICATE_LOCAL_RELATION,
                std::string("duplicate script-local relation: ") + std::string(name.text), statement_id,
                definition->alias_node_id, parsed.scanned_script->ResolveTextSpan(alias_node.symbol_span())));
        }
        definitions.push_back(LocalDefinition{*definition, name});
    }

    auto terminal_statement_id = static_cast<uint32_t>(parsed.statements.size() - 1);
    result.terminal_statement_id = terminal_statement_id;
    if (FindTerminalPipeDefinition(parsed, terminal_statement_id)) {
        auto root_id = parsed.statements.back().root;
        result.errors.push_back(MakeError(ErrorCode::LAST_STATEMENT_IS_LOCAL_RELATION,
                                          "the final statement must produce a result and cannot end in |> AS name",
                                          terminal_statement_id, root_id,
                                          parsed.scanned_script->ResolveTextSpan(parsed.nodes[root_id].symbol_span())));
        return result;
    }

    auto terminal_query_node_id = ReadTerminalQueryNode(parsed, terminal_statement_id, result.kind);
    if (!terminal_query_node_id) {
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

    ScriptExecutionPlan plan{.terminal_query_node_id = *terminal_query_node_id};
    for (const auto& definition : definitions) {
        plan.local_relations.push_back(ScriptExecutionLocalRelation{
            definition.pipe.alias_node_id,
            definition.pipe.query_node_id,
            definition.pipe.pipe_node_id,
            definition.pipe.body_stage_count,
        });
    }
    Formatter formatter{parsed};
    result.sql = formatter.FormatExecutableQuery(plan, config);
    if (result.sql.empty()) {
        result.sql.clear();
        result.errors.push_back(MakeError(ErrorCode::FORMAT_ERROR, "could not format the executable query",
                                          terminal_statement_id, *terminal_query_node_id));
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

}  // namespace dashql
