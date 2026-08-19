#include "dashql/analyzer/completion.h"
#include "dashql/buffers/index_generated.h"
#include "dashql/script.h"

namespace dashql {

ScriptCursor::ScriptCursor(const Script& script, size_t text_offset)
    : script(script), text_offset(text_offset), context(std::monostate{}) {}

std::vector<ScriptCursor::NameComponent> ScriptCursor::ReadCursorNamePath(sx::parser::SymbolSpan& name_path_loc) const {
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
                // The sentinel represents a recovered `alias.` context with no column-ref AST node.
                if (ctx.expression_id == std::numeric_limits<uint32_t>::max()) return std::nullopt;
                auto& expr = script.analyzed_script->expressions[ctx.expression_id];
                assert(std::holds_alternative<AnalyzedScript::Expression::ColumnRef>(expr.inner));
                return std::get<AnalyzedScript::Expression::ColumnRef>(expr.inner).column_name.ast_node_id;
            } else {
                return std::nullopt;
            }
        },
        context);

    if (!name_ast_node_id.has_value()) {
        return {};
    }
    // Is not an array?
    auto& node = nodes[*name_ast_node_id];
    if (node.node_type() != buffers::parser::NodeType::ARRAY) {
        return {};
    }
    name_path_loc = node.symbol_span();

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
                    .loc = child.symbol_span(),
                    .type = NameComponentType::Name,
                    .name = name,
                });
                break;
            }
            case buffers::parser::NodeType::OBJECT_SQL_INDIRECTION_STAR:
                components.push_back(NameComponent{
                    .loc = child.symbol_span(),
                    .type = NameComponentType::Star,
                    .name = std::nullopt,
                });
                break;
            case buffers::parser::NodeType::OBJECT_SQL_INDIRECTION_INDEX:
                components.push_back(NameComponent{
                    .loc = child.symbol_span(),
                    .type = NameComponentType::Index,
                    .name = std::nullopt,
                });
                break;
            case buffers::parser::NodeType::OBJECT_EXT_TRAILING_DOT:
                components.push_back(NameComponent{
                    .loc = child.symbol_span(),
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

std::unique_ptr<ScriptCursor> ScriptCursor::Place(const Script& script, size_t text_offset) {
    auto cursor = std::make_unique<ScriptCursor>(script, text_offset);

    // Has the script been scanned?
    if (script.scanned_script) {
        cursor->scanner_location.emplace(script.scanned_script->FindSymbol(text_offset));
    }

    // Has the script been parsed?
    if (script.parsed_script) {
        // Try to find the ast node the cursor is pointing at
        auto ast_node = script.parsed_script->FindNodeAtOffset(text_offset);
        // A trailing-dot token may span into following whitespace. Anchor lookup at the dot so
        // the cursor remains associated with the qualifier rather than a later sibling node.
        if (cursor->scanner_location.has_value() && cursor->scanner_location->current.symbolIsTrailingDot()) {
            const auto dot_offset = cursor->scanner_location->current.symbol.location.offset();
            if (auto qualifier_node = script.parsed_script->FindNodeAtOffset(dot_offset); qualifier_node.has_value()) {
                ast_node = qualifier_node;
            }
        }
        if (ast_node.has_value()) {
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
                                        bool at_alias = false;
                                        if (table_ref.alias.has_value()) {
                                            auto& [alias_name, alias_loc] = table_ref.alias.value();
                                            auto alias_ts = script.scanned_script->ResolveTextSpan(alias_loc);
                                            at_alias = text_offset >= alias_ts.offset();
                                        }
                                        cursor->context =
                                            TableRefContext{table_ref.table_reference_id.GetObject(), at_alias};
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
        // In incomplete SQL, the parser can omit the column-ref node for `alias.` even though name
        // resolution already registered the alias in a scope. This also occurs inside explicit JOIN
        // predicates, where the AST path still reaches the SELECT scope. Recover a synthetic
        // column-ref context from the semantic scope in either case.
        if (std::holds_alternative<std::monostate>(cursor->context) && cursor->scanner_location.has_value() &&
            script.analyzed_script) {
            const auto& current = cursor->scanner_location->current;
            const auto* dot = (current.symbolIsDot() || current.symbolIsTrailingDot())
                                  ? &current
                                  : cursor->scanner_location->previous.has_value() &&
                                            (cursor->scanner_location->previous->symbolIsDot() ||
                                             cursor->scanner_location->previous->symbolIsTrailingDot())
                                        ? &*cursor->scanner_location->previous
                                        : nullptr;
            if (dot == nullptr) return cursor;
            const auto dot_offset = static_cast<size_t>(dot->symbol.location.offset());
            const auto& input = script.scanned_script->GetInput();
            size_t qualifier_end = std::min(dot_offset, input.size());
            while (qualifier_end > 0 && input[qualifier_end - 1] == '.') --qualifier_end;
            size_t qualifier_begin = qualifier_end;
            while (qualifier_begin > 0 &&
                   (std::isalnum(static_cast<unsigned char>(input[qualifier_begin - 1])) ||
                    input[qualifier_begin - 1] == '_')) {
                --qualifier_begin;
            }
            const auto qualifier_text = input.substr(qualifier_begin, qualifier_end - qualifier_begin);
            AnalyzedScript::NameScope* best_scope = nullptr;
            size_t best_scope_length = std::numeric_limits<size_t>::max();
            for (auto& scope_ref : cursor->name_scopes) {
                auto& scope = scope_ref.get();
                if (scope.referenced_tables_by_name.contains(qualifier_text)) {
                    best_scope = &scope;
                    break;
                }
            }
            // Prefer the narrowest scope containing the cursor. The same alias can legally occur
            // in nested queries, so choosing the first global match would leak the wrong columns.
            if (best_scope == nullptr && cursor->name_scopes.empty()) {
                script.analyzed_script->name_scopes.ForEach([&](size_t, AnalyzedScript::NameScope& scope) {
                    if (!scope.referenced_tables_by_name.contains(qualifier_text)) return;
                    const auto scope_span = script.scanned_script->ResolveTextSpan(
                        script.parsed_script->nodes[scope.ast_node_id].symbol_span());
                    const auto scope_end = static_cast<size_t>(scope_span.offset()) + scope_span.length();
                    const bool contains_cursor = scope_span.offset() <= text_offset && text_offset <= scope_end;
                    if (contains_cursor && scope_span.length() < best_scope_length) {
                        best_scope = &scope;
                        best_scope_length = scope_span.length();
                    } else if (best_scope == nullptr &&
                               (!cursor->statement_id.has_value() || scope.ast_statement_id == *cursor->statement_id)) {
                        best_scope = &scope;
                    }
                });
            }
            if (best_scope != nullptr) {
                if (cursor->name_scopes.empty()) cursor->name_scopes.emplace_back(*best_scope);
                cursor->context = ColumnRefContext{std::numeric_limits<uint32_t>::max()};
            }
        }
    }
    return cursor;
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
        out->scanner_symbol_completable = Completion::IsSymbolKindCompletable(symbol.kind_);
    } else {
        out->scanner_symbol_id = std::numeric_limits<uint32_t>::max();
        out->scanner_relative_position = buffers::cursor::RelativeSymbolPosition::AFTER_SYMBOL;
        out->scanner_symbol_offset = 0;
        out->scanner_symbol_kind = 0;
        out->scanner_symbol_completable = false;
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
