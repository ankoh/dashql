#include "dashql/buffers/index_generated.h"
#include "dashql/script.h"

namespace dashql {

ScriptCursor::ScriptCursor(const Script& script, size_t text_offset)
    : script(script), text_offset(text_offset), context(std::monostate{}) {}

std::vector<ScriptCursor::NameComponent> ScriptCursor::ReadCursorNamePath(sx::parser::Location& name_path_loc) const {
    auto& nodes = script.parsed_script->nodes;

    std::optional<uint32_t> name_ast_node_id = std::visit(
        [&](const auto& ctx) -> std::optional<uint32_t> {
            using T = std::decay_t<decltype(ctx)>;
            if constexpr (std::is_same_v<T, ScriptCursor::TableRefContext>) {
                auto& tableref = script.analyzed_script->table_references[ctx.table_reference_id];
                assert(std::holds_alternative<AnalyzedScript::TableReference::RelationExpression>(tableref.inner));
                return std::get<AnalyzedScript::TableReference::RelationExpression>(tableref.inner)
                    .table_name.ast_node_id;
            } else if constexpr (std::is_same_v<T, ScriptCursor::ColumnRefContext>) {
                auto& expr = script.analyzed_script->expressions[ctx.expression_id];
                assert(std::holds_alternative<AnalyzedScript::Expression::ColumnRef>(expr.inner));
                return std::get<AnalyzedScript::Expression::ColumnRef>(expr.inner).column_name.ast_node_id;
            } else {
                return std::nullopt;
            }
        },
        context);

    // Couldn't find an ast name path?
    if (!name_ast_node_id.has_value()) {
        return {};
    }
    // Is not an array?
    auto& node = nodes[*name_ast_node_id];
    if (node.node_type() != buffers::parser::NodeType::ARRAY) {
        return {};
    }
    name_path_loc = node.location();

    // Get the child nodes
    auto children =
        std::span<buffers::parser::Node>{nodes}.subspan(node.children_begin_or_value(), node.children_count());

    // Collect the name path
    std::vector<NameComponent> components;
    for (size_t i = 0; i != children.size(); ++i) {
        // A child is either a name, an index or a *.
        auto& child = children[i];
        switch (child.node_type()) {
            case buffers::parser::NodeType::NAME: {
                auto& name = script.scanned_script->GetNames().At(child.children_begin_or_value());
                components.push_back(NameComponent{
                    .loc = child.location(),
                    .type = NameComponentType::Name,
                    .name = name,
                });
                break;
            }
            case buffers::parser::NodeType::OBJECT_SQL_INDIRECTION_STAR:
                components.push_back(NameComponent{
                    .loc = child.location(),
                    .type = NameComponentType::Star,
                    .name = std::nullopt,
                });
                break;
            case buffers::parser::NodeType::OBJECT_SQL_INDIRECTION_INDEX:
                components.push_back(NameComponent{
                    .loc = child.location(),
                    .type = NameComponentType::Index,
                    .name = std::nullopt,
                });
                break;
            case buffers::parser::NodeType::OBJECT_EXT_TRAILING_DOT:
                components.push_back(NameComponent{
                    .loc = child.location(),
                    .type = NameComponentType::TrailingDot,
                    .name = std::nullopt,
                });
                return components;
            default:
                // XXX Bail out
                return {};
        }
    }
    return components;
}

std::pair<std::unique_ptr<ScriptCursor>, buffers::status::StatusCode> ScriptCursor::Place(const Script& script,
                                                                                          size_t text_offset) {
    auto cursor = std::make_unique<ScriptCursor>(script, text_offset);

    // Has the script been scanned?
    if (script.scanned_script) {
        cursor->scanner_location.emplace(script.scanned_script->FindSymbol(text_offset));
    }

    // Has the script been parsed?
    if (script.parsed_script) {
        // Try to find the ast node the cursor is pointing at
        if (auto ast_node = script.parsed_script->FindNodeAtOffset(text_offset)) {
            // Try to find the ast node the cursor is pointing at
            cursor->statement_id = std::get<0>(*ast_node);
            cursor->ast_node_id = std::get<1>(*ast_node);

            // Analyzed and analyzed is same version as the parsed script?
            // Note that the user may re-parse and re-analyze a script after changes.
            // This ensures that we're consistent when building the cursor.
            auto& analyzed = script.analyzed_script;
            if (analyzed && analyzed->parsed_script == script.parsed_script) {
                // First find all name scopes that the ast node points into.
                script.analyzed_script->FollowPathUpwards(*cursor->ast_node_id, cursor->ast_path_to_root,
                                                          cursor->name_scopes);

                // Check if there's a table or column ref in the innermost scope containing the node
                if (cursor->name_scopes.size() != 0) {
                    auto& innermost_scope = cursor->name_scopes.front().get();
                    auto& nodes = script.parsed_script->nodes;

                    // Find first node that is a table or column ref
                    for (auto node_id : cursor->ast_path_to_root) {
                        bool matched = false;
                        switch (nodes[node_id].node_type()) {
                            // Node is a column ref?
                            // Then we check all expressions in the innermost scope.
                            case buffers::parser::NodeType::OBJECT_SQL_COLUMN_REF: {
                                matched = true;
                                for (auto& expression : innermost_scope.expressions) {
                                    if (node_id == expression.ast_node_id && expression.IsColumnRef()) {
                                        cursor->context = ColumnRefContext{expression.expression_id};
                                    }
                                }
                                break;
                            }
                            // Node is a table ref?
                            // Then we check all table refs in the innermost scope.
                            case buffers::parser::NodeType::OBJECT_SQL_TABLEREF: {
                                matched = true;
                                for (auto& table_ref : innermost_scope.table_references) {
                                    if (node_id == table_ref.ast_node_id) {
                                        assert(table_ref.table_reference_id.GetOrigin() ==
                                               analyzed->GetCatalogEntryId());
                                        cursor->context = TableRefContext{table_ref.table_reference_id.GetObject()};
                                    }
                                }
                                break;
                            }
                            default:
                                break;
                        }
                        // Stop when we reached the root of the innermost name scope.
                        if (matched || node_id == innermost_scope.ast_node_id) {
                            break;
                        }
                    }
                }
            }
        }
    }
    return {std::move(cursor), buffers::status::StatusCode::OK};
}

/// Pack the cursor info
flatbuffers::Offset<buffers::cursor::ScriptCursor> ScriptCursor::Pack(flatbuffers::FlatBufferBuilder& builder) const {
    auto out = std::make_unique<buffers::cursor::ScriptCursorT>();
    out->text_offset = text_offset;
    if (scanner_location) {
        auto& target_symbol = scanner_location->current;
        auto& symbol = script.scanned_script->symbols[target_symbol.symbol_id];
        auto symbol_offset = symbol.location.offset();
        out->scanner_symbol_id = script.scanned_script->symbols.GetFlatEntryID(target_symbol.symbol_id);
        out->scanner_relative_position =
            static_cast<buffers::cursor::RelativeSymbolPosition>(target_symbol.relative_pos);
        out->scanner_symbol_offset = symbol_offset;
        out->scanner_symbol_kind = static_cast<uint32_t>(symbol.kind_);
    } else {
        out->scanner_symbol_id = std::numeric_limits<uint32_t>::max();
        out->scanner_relative_position = buffers::cursor::RelativeSymbolPosition::AFTER_SYMBOL;
        out->scanner_symbol_offset = 0;
        out->scanner_symbol_kind = 0;
    }
    out->statement_id = statement_id.value_or(std::numeric_limits<uint32_t>::max());
    out->ast_node_id = ast_node_id.value_or(std::numeric_limits<uint32_t>::max());
    out->ast_path_to_root = ast_path_to_root;
    out->name_scopes.reserve(name_scopes.size());
    for (auto& name_scope : name_scopes) {
        out->name_scopes.push_back(name_scope.get().name_scope_id);
    }
    switch (context.index()) {
        case 0:
            break;
        case 1: {
            auto& table_ref = std::get<ScriptCursor::TableRefContext>(context);
            buffers::cursor::ScriptCursorTableRefContextT ctx;
            ctx.table_reference_id = table_ref.table_reference_id;
            out->context.Set(std::move(ctx));
            break;
        }
        case 2: {
            auto& column_ref = std::get<ScriptCursor::ColumnRefContext>(context);
            buffers::cursor::ScriptCursorColumnRefContextT ctx;
            ctx.expression_id = column_ref.expression_id;
            out->context.Set(std::move(ctx));
            break;
        }
    }
    return buffers::cursor::ScriptCursor::Pack(builder, out.get());
}

}  // namespace dashql
