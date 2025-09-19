#include "dashql/script.h"

#include <flatbuffers/flatbuffer_builder.h>

#include <algorithm>
#include <chrono>
#include <memory>
#include <optional>
#include <unordered_set>
#include <variant>

#include "dashql/analyzer/analyzer.h"
#include "dashql/analyzer/completion.h"
#include "dashql/buffers/index_generated.h"
#include "dashql/catalog.h"
#include "dashql/external.h"
#include "dashql/parser/parse_context.h"
#include "dashql/parser/parser.h"
#include "dashql/parser/scanner.h"

namespace dashql {

/// Helper template for static_assert in generic visitor
template <typename T> constexpr bool always_false = false;

/// Finish a statement
std::unique_ptr<buffers::parser::StatementT> ParsedScript::Statement::Pack() {
    auto stmt = std::make_unique<buffers::parser::StatementT>();
    stmt->statement_type = type;
    stmt->root_node = root;
    stmt->nodes_begin = nodes_begin;
    stmt->node_count = node_count;
    return stmt;
}

/// Constructor
ScannedScript::ScannedScript(const rope::Rope& text, TextVersion text_version, CatalogEntryID external_id)
    : external_id(external_id), text_buffer(text.ToString(true)), text_version(text_version) {}
/// Constructor
ScannedScript::ScannedScript(std::string text, TextVersion text_version, CatalogEntryID external_id)
    : external_id(external_id), text_buffer(std::move(text)), text_version(text_version) {
    if (text_buffer.size() < 2) {
        text_buffer.resize(2);
    }
    text_buffer[text_buffer.size() - 1] = 0;
    text_buffer[text_buffer.size() - 2] = 0;
}

/// Find a token at a text offset
ScannedScript::LocationInfo ScannedScript::FindSymbol(size_t text_offset) {
    using RelativePosition = ScannedScript::LocationInfo::RelativePosition;
    auto& chunks = symbols.GetChunks();
    auto user_text_end = std::max<size_t>(text_buffer.size(), 2) - 2;
    text_offset = std::min<size_t>(user_text_end, text_offset);

    // Helper to determine the insert mode
    auto get_relative_position = [&](size_t text_offset, ChunkBufferEntryID symbol_id) -> RelativePosition {
        // Should actually never happen.
        // We're never pointing one past the last chunk after searching the symbol.
        if (symbol_id.chunk_id >= chunks.size()) {
            return RelativePosition::NEW_SYMBOL_AFTER;
        }
        auto& chunk = chunks[symbol_id.chunk_id];
        auto symbol = chunk[symbol_id.chunk_entry_id];
        auto symbol_begin = symbol.location.offset();
        auto symbol_end = symbol.location.offset() + symbol.location.length();

        // Before the symbol?
        // Can happen wen the offset points at the beginning of the text
        if (text_offset < symbol_begin) {
            return RelativePosition::NEW_SYMBOL_BEFORE;
        }
        // Begin of the token?
        if (text_offset == symbol_begin) {
            return RelativePosition::BEGIN_OF_SYMBOL;
        }
        // End of the token?
        if (text_offset == symbol_end) {
            return RelativePosition::END_OF_SYMBOL;
        }
        // Mid of the token?
        if (text_offset > symbol_begin && (text_offset < symbol_end)) {
            return RelativePosition::MID_OF_SYMBOL;
        }
        // This happens when we're pointing at white-space after a symbol.
        // (end + 1), since end emits END_OF_SYMBOL
        return RelativePosition::NEW_SYMBOL_AFTER;
    };

    // Find chunk that contains the text offset.
    // Chunks grow exponentially in size, so this is logarithmic in cost
    auto chunk_iter = chunks.begin();
    for (; chunk_iter != chunks.end(); ++chunk_iter) {
        size_t text_from = chunk_iter->front().location.offset();
        if (text_from > text_offset) {
            break;
        }
    }

    // Get previous chunk
    if (chunk_iter > chunks.begin()) {
        --chunk_iter;
    }

    // Otherwise we found a chunk that contains the text offset.
    // Binary search the token offset.
    auto symbol_iter =
        std::upper_bound(chunk_iter->begin(), chunk_iter->end(), text_offset,
                         [](size_t ofs, parser::Parser::symbol_type& token) { return ofs < token.location.offset(); });
    if (symbol_iter > chunk_iter->begin()) {
        --symbol_iter;
    }
    size_t chunk_id = chunk_iter - chunks.begin();
    size_t chunk_symbol_id = symbol_iter - chunk_iter->begin();
    assert(symbols.GetSize() >= 1);

    // Hit EOF? Get last token before EOF (if there is one)
    if (symbol_iter->kind_ == parser::Parser::symbol_kind::S_YYEOF) {
        if (chunk_symbol_id == 0) {
            if (chunk_iter > chunks.begin()) {
                --chunk_iter;
                chunk_symbol_id = chunk_iter->size() - 1;
                symbol_iter = chunk_iter->begin() + chunk_symbol_id;
            } else {
                // Very first token is EOF token?
                // Special case empty script buffer
                SymbolLocationInfo current{ChunkBufferEntryID{0, 0}, *symbol_iter, text_offset,
                                           RelativePosition::NEW_SYMBOL_BEFORE};
                return LocationInfo{std::move(current), std::nullopt};
            }
        } else {
            --chunk_symbol_id;
            --symbol_iter;
        }
    }
    // Construct the current symbol information
    ChunkBufferEntryID symbol_id{chunk_id, chunk_symbol_id};
    SymbolLocationInfo current_symbol{symbol_id, *symbol_iter, text_offset,
                                      get_relative_position(text_offset, symbol_id)};
    // Resolve the previous symbol
    auto prev_symbol_id = symbols.GetPrevious(symbol_id);
    SymbolLocationInfo prev_symbol{prev_symbol_id, symbols[prev_symbol_id], text_offset,
                                   get_relative_position(text_offset, prev_symbol_id)};

    return {std::move(current_symbol), std::move(prev_symbol)};
}

flatbuffers::Offset<buffers::parser::ScannedScript> ScannedScript::Pack(flatbuffers::FlatBufferBuilder& builder) {
    buffers::parser::ScannedScriptT out;
    out.external_id = external_id;
    out.errors.reserve(errors.size());
    for (auto& [loc, msg] : errors) {
        auto err = std::make_unique<buffers::parser::ErrorT>();
        err->location = std::make_unique<buffers::parser::Location>(loc);
        err->message = msg;
        out.errors.push_back(std::move(err));
    }
    out.tokens = PackTokens();
    out.line_breaks = line_breaks;
    out.comments = comments;
    return buffers::parser::ScannedScript::Pack(builder, &out);
}

/// Constructor
ParsedScript::ParsedScript(std::shared_ptr<ScannedScript> scan, parser::ParseContext&& ctx)
    : external_id(scan->external_id),
      scanned_script(scan),
      nodes(ctx.nodes.Flatten()),
      statements(std::move(ctx.statements)),
      errors(std::move(ctx.errors)) {
    assert(std::is_sorted(statements.begin(), statements.end(),
                          [](auto& l, auto& r) { return l.nodes_begin < r.nodes_begin; }));
}

/// Resolve an ast node
std::optional<std::pair<size_t, size_t>> ParsedScript::FindNodeAtOffset(size_t text_offset) const {
    if (statements.empty()) {
        return std::nullopt;
    }
    // Find statement that includes the text offset by searching the predecessor of the first statement after the text
    // offset
    size_t statement_id = 0;
    for (; statement_id < statements.size(); ++statement_id) {
        if (nodes[statements[statement_id].root].location().offset() > text_offset) {
            break;
        }
    }
    // First statement and begins > text_offset, bail out
    if (statement_id == 0) {
        return std::nullopt;
    }
    --statement_id;
    // Traverse down the AST
    auto iter = statements[statement_id].root;
    while (true) {
        // Reached node without children? Then return that node
        auto& node = nodes[iter];
        if (node.children_count() == 0) {
            break;
        }
        // Otherwise find the first child that includes the offset
        // Children are not ordered by location but ideally, there should only be a single match.
        std::optional<size_t> child_exact;
        std::optional<size_t> child_end_plus_1;
        for (size_t i = 0; i < node.children_count(); ++i) {
            auto ci = node.children_begin_or_value() + i;
            auto node_begin = nodes[ci].location().offset();
            auto node_end = node_begin + nodes[ci].location().length();
            // Includes the offset?
            // Note that we want an exact match here since AST nodes will include "holes".
            // For example, a select clause does not emit a node for a FROM keyword.
            // It would be misleading if we'd return the closest node that is materialized in the AST.
            if (node_begin <= text_offset) {
                if (node_end > text_offset) {
                    child_exact = ci;
                } else if (node_end == text_offset) {
                    child_end_plus_1 = ci;
                }
            }
        }
        auto child = child_exact.has_value() ? child_exact : child_end_plus_1;
        if (!child.has_value()) {
            // None of the children included the text offset.
            // Abort and return the current node as best match.
            break;
        }
        // Traverse down
        iter = *child;
        child_exact.reset();
        child_end_plus_1.reset();
    }
    // Return (statement, node)-pair
    return std::make_pair(statement_id, iter);
}

/// Pack the FlatBuffer
flatbuffers::Offset<buffers::parser::ParsedScript> ParsedScript::Pack(flatbuffers::FlatBufferBuilder& builder) {
    buffers::parser::ParsedScriptT out;
    out.external_id = external_id;
    out.nodes = nodes;
    out.statements.reserve(statements.size());
    for (auto& stmt : statements) {
        out.statements.push_back(stmt.Pack());
    }
    out.errors.reserve(errors.size());
    for (auto& [loc, msg] : errors) {
        auto err = std::make_unique<buffers::parser::ErrorT>();
        err->location = std::make_unique<buffers::parser::Location>(loc);
        err->message = msg;
        out.errors.push_back(std::move(err));
    }
    return buffers::parser::ParsedScript::Pack(builder, &out);
}

flatbuffers::Offset<buffers::analyzer::QualifiedTableName> AnalyzedScript::QualifiedTableName::Pack(
    flatbuffers::FlatBufferBuilder& builder) const {
    flatbuffers::Offset<flatbuffers::String> database_name_ofs;
    flatbuffers::Offset<flatbuffers::String> schema_name_ofs;
    flatbuffers::Offset<flatbuffers::String> table_name_ofs;
    if (!database_name.get().text.empty()) {
        database_name_ofs = builder.CreateString(database_name.get().text);
    }
    if (!schema_name.get().text.empty()) {
        schema_name_ofs = builder.CreateString(schema_name.get().text);
    }
    if (!table_name.get().text.empty()) {
        table_name_ofs = builder.CreateString(table_name.get().text);
    }
    buffers::analyzer::QualifiedTableNameBuilder out{builder};
    out.add_ast_node_id(ast_node_id.value_or(PROTO_NULL_U32));
    out.add_database_name(database_name_ofs);
    out.add_schema_name(schema_name_ofs);
    out.add_table_name(table_name_ofs);
    return out.Finish();
}

flatbuffers::Offset<buffers::analyzer::QualifiedColumnName> AnalyzedScript::QualifiedColumnName::Pack(
    flatbuffers::FlatBufferBuilder& builder) const {
    flatbuffers::Offset<flatbuffers::String> table_alias_ofs;
    flatbuffers::Offset<flatbuffers::String> column_name_ofs;
    if (table_alias && !table_alias.value().get().text.empty()) {
        table_alias_ofs = builder.CreateString(table_alias.value().get().text);
    }
    if (!column_name.get().text.empty()) {
        column_name_ofs = builder.CreateString(column_name.get().text);
    }
    buffers::analyzer::QualifiedColumnNameBuilder out{builder};
    out.add_ast_node_id(ast_node_id.value_or(PROTO_NULL_U32));
    out.add_table_alias(table_alias_ofs);
    out.add_column_name(column_name_ofs);
    return out.Finish();
}

flatbuffers::Offset<buffers::analyzer::QualifiedFunctionName> AnalyzedScript::QualifiedFunctionName::Pack(
    flatbuffers::FlatBufferBuilder& builder) const {
    flatbuffers::Offset<flatbuffers::String> database_name_ofs;
    flatbuffers::Offset<flatbuffers::String> schema_name_ofs;
    flatbuffers::Offset<flatbuffers::String> function_name_ofs;
    if (!database_name.get().text.empty()) {
        database_name_ofs = builder.CreateString(database_name.get().text);
    }
    if (!schema_name.get().text.empty()) {
        schema_name_ofs = builder.CreateString(schema_name.get().text);
    }
    if (!function_name.get().text.empty()) {
        function_name_ofs = builder.CreateString(function_name.get().text);
    }
    buffers::analyzer::QualifiedFunctionNameBuilder out{builder};
    out.add_ast_node_id(ast_node_id.value_or(PROTO_NULL_U32));
    out.add_database_name(database_name_ofs);
    out.add_schema_name(schema_name_ofs);
    out.add_function_name(function_name_ofs);
    return out.Finish();
}

/// Pack as FlatBuffer
flatbuffers::Offset<buffers::analyzer::TableReference> AnalyzedScript::TableReference::Pack(
    flatbuffers::FlatBufferBuilder& builder) const {
    auto& relation_expr = std::get<AnalyzedScript::TableReference::RelationExpression>(inner);
    auto table_name_ofs = relation_expr.table_name.Pack(builder);

    flatbuffers::Offset<buffers::analyzer::ResolvedTable> resolved_ofs;
    if (relation_expr.resolved_table.has_value()) {
        auto& resolved = relation_expr.resolved_table.value();
        auto resolved_table_name = resolved.table_name.Pack(builder);
        buffers::analyzer::ResolvedTableBuilder resolved_builder{builder};
        auto [db_id, schema_id] = resolved.catalog_schema_id.UnpackSchemaID();
        auto table_id = resolved.catalog_table_id.UnpackTableID();
        resolved_builder.add_catalog_database_id(db_id);
        resolved_builder.add_catalog_schema_id(schema_id);
        resolved_builder.add_catalog_table_id(table_id.Pack());
        resolved_builder.add_table_name(resolved_table_name);
        resolved_builder.add_referenced_catalog_version(resolved.referenced_catalog_version);
        resolved_ofs = resolved_builder.Finish();
    }
    flatbuffers::Offset<flatbuffers::String> alias_name_ofs;
    if (alias_name.has_value()) {
        alias_name_ofs = builder.CreateString(alias_name.value().get().text);
    }
    buffers::analyzer::TableReferenceBuilder out{builder};
    out.add_ast_node_id(ast_node_id);
    out.add_ast_statement_id(ast_statement_id.value_or(std::numeric_limits<uint32_t>::max()));
    if (location.has_value()) {
        out.add_location(&location.value());
    }
    out.add_table_name(table_name_ofs);
    if (alias_name.has_value()) {
        out.add_alias_name(alias_name_ofs);
    }
    if (!resolved_ofs.IsNull()) {
        out.add_resolved_table(resolved_ofs);
    }
    return out.Finish();
}

/// Pack as FlatBuffer
flatbuffers::Offset<buffers::algebra::Expression> AnalyzedScript::Expression::Pack(
    flatbuffers::FlatBufferBuilder& builder) const {
    std::optional<buffers::algebra::ExpressionSubType> inner_type;
    flatbuffers::Offset<void> inner_ofs;

    // Use std::visit for type-safe variant handling
    std::visit(
        [&](const auto& value) {
            using T = std::decay_t<decltype(value)>;

            if constexpr (std::is_same_v<T, std::monostate>) {
                // Empty variant case - no action needed
            } else if constexpr (std::is_same_v<T, AnalyzedScript::Expression::ColumnRef>) {
                auto& column_ref = value;
                auto column_name_ofs = column_ref.column_name.Pack(builder);

                flatbuffers::Offset<buffers::algebra::ResolvedColumn> resolved_ofs;
                if (column_ref.resolved_column.has_value()) {
                    auto& resolved = column_ref.resolved_column.value();
                    buffers::algebra::ResolvedColumnBuilder resolved_builder{builder};
                    auto [db_id, schema_id] = resolved.catalog_schema_id.UnpackSchemaID();
                    auto [table_id, column_idx] = resolved.catalog_table_column_id.UnpackTableColumnID();
                    resolved_builder.add_catalog_database_id(db_id);
                    resolved_builder.add_catalog_schema_id(schema_id);
                    resolved_builder.add_catalog_table_id(table_id.Pack());
                    resolved_builder.add_column_id(column_idx);
                    resolved_builder.add_referenced_catalog_version(resolved.referenced_catalog_version);
                    resolved_ofs = resolved_builder.Finish();
                }
                buffers::algebra::ColumnRefExpressionBuilder out{builder};
                out.add_ast_scope_root(column_ref.ast_scope_root.value_or(std::numeric_limits<uint32_t>::max()));
                out.add_column_name(column_name_ofs);
                if (!resolved_ofs.IsNull()) {
                    out.add_resolved_column(resolved_ofs);
                }
                inner_type = buffers::algebra::ExpressionSubType::ColumnRefExpression;
                inner_ofs = out.Finish().Union();
            } else if constexpr (std::is_same_v<T, AnalyzedScript::Expression::Literal>) {
                auto& literal = value;
                auto raw_value_ofs = builder.CreateString(literal.raw_value);

                buffers::algebra::LiteralBuilder literal_builder{builder};
                literal_builder.add_literal_type(literal.literal_type);
                literal_builder.add_raw_value(raw_value_ofs);

                inner_type = buffers::algebra::ExpressionSubType::Literal;
                inner_ofs = literal_builder.Finish().Union();
            } else if constexpr (std::is_same_v<T, AnalyzedScript::Expression::Comparison>) {
                auto& comparison = value;

                buffers::algebra::ComparisonBuilder comparison_builder{builder};
                comparison_builder.add_func(comparison.func);
                comparison_builder.add_left_child(comparison.left_expression_id);
                comparison_builder.add_right_child(comparison.right_expression_id);

                inner_type = buffers::algebra::ExpressionSubType::Comparison;
                inner_ofs = comparison_builder.Finish().Union();
            } else if constexpr (std::is_same_v<T, AnalyzedScript::Expression::BinaryExpression>) {
                auto& binary = value;

                buffers::algebra::BinaryExpressionBuilder binary_builder{builder};
                binary_builder.add_func(binary.func);
                binary_builder.add_left_child(binary.left_expression_id);
                binary_builder.add_right_child(binary.right_expression_id);

                inner_type = buffers::algebra::ExpressionSubType::BinaryExpression;
                inner_ofs = binary_builder.Finish().Union();
            } else if constexpr (std::is_same_v<T, AnalyzedScript::Expression::FunctionCallExpression>) {
                auto& func_call = value;

                flatbuffers::Offset<buffers::analyzer::QualifiedFunctionName> func_name_ofs;
                if (std::holds_alternative<CatalogEntry::QualifiedFunctionName>(func_call.function_name)) {
                    auto& qualified_name = std::get<CatalogEntry::QualifiedFunctionName>(func_call.function_name);
                    func_name_ofs = qualified_name.Pack(builder);
                }

                // Handle generic arguments as a vector of uint32_t expression IDs
                flatbuffers::Offset<flatbuffers::Vector<uint32_t>> arguments_ofs;
                if (std::holds_alternative<AnalyzedScript::Expression::FunctionCallExpression::GenericArguments>(
                        func_call.arguments)) {
                    auto& generic_args = std::get<AnalyzedScript::Expression::FunctionCallExpression::GenericArguments>(
                        func_call.arguments);
                    std::vector<uint32_t> arg_ids;
                    arg_ids.reserve(generic_args.size());
                    for (const auto& arg : generic_args) {
                        if (arg.expression_id.has_value()) {
                            arg_ids.push_back(arg.expression_id.value());
                        }
                    }
                    arguments_ofs = builder.CreateVector(arg_ids);
                }
                // Note: Other argument types (CastArguments, ExtractArguments, etc.) are handled as std::monostate
                // and will result in an empty arguments vector, which is fine for now

                buffers::algebra::FunctionCallExpressionBuilder func_builder{builder};
                if (!func_name_ofs.IsNull()) {
                    func_builder.add_func_name(func_name_ofs);
                }
                func_builder.add_func_call_modifiers(func_call.function_call_modifiers);
                if (!arguments_ofs.IsNull()) {
                    func_builder.add_arguments(arguments_ofs);
                }

                inner_type = buffers::algebra::ExpressionSubType::FunctionCallExpression;
                inner_ofs = func_builder.Finish().Union();
            } else if constexpr (std::is_same_v<T, AnalyzedScript::Expression::ConstIntervalCast>) {
                auto& interval_cast = value;

                buffers::algebra::ConstIntervalCastBuilder interval_builder{builder};
                interval_builder.add_value_expression(interval_cast.value_expression_id);
                if (interval_cast.interval.has_value()) {
                    interval_builder.add_interval_type(interval_cast.interval.value().interval_type);
                    if (interval_cast.interval.value().precision_expression.has_value()) {
                        interval_builder.add_interval_precision(
                            interval_cast.interval.value().precision_expression.value());
                    }
                }

                inner_type = buffers::algebra::ExpressionSubType::ConstIntervalCast;
                inner_ofs = interval_builder.Finish().Union();
            } else {
                // This will cause a compile error if a new type is added to the variant
                // but not handled in the visitor
                static_assert(always_false<T>, "Unhandled expression type in Pack method");
            }
        },
        inner);
    buffers::algebra::ExpressionBuilder out{builder};
    out.add_ast_node_id(ast_node_id);
    out.add_ast_statement_id(ast_statement_id.value_or(std::numeric_limits<uint32_t>::max()));
    if (location.has_value()) {
        out.add_location(&location.value());
    }
    if (inner_type.has_value()) {
        out.add_inner_type(inner_type.value());
        out.add_inner(inner_ofs);
    }
    return out.Finish();
}

/// Constructor
AnalyzedScript::AnalyzedScript(std::shared_ptr<ParsedScript> parsed, Catalog& catalog)
    : CatalogEntry(catalog, parsed->external_id), parsed_script(std::move(parsed)), node_markers() {
    assert(parsed_script != nullptr);
    node_markers.resize(parsed_script->GetNodes().size(), buffers::analyzer::SemanticNodeMarkerType::NONE);
}

/// Get the name search index
flatbuffers::Offset<buffers::catalog::CatalogEntry> AnalyzedScript::DescribeEntry(
    flatbuffers::FlatBufferBuilder& builder) const {
    std::vector<flatbuffers::Offset<buffers::catalog::SchemaTable>> table_offsets;
    table_offsets.reserve(table_declarations.GetSize());
    uint32_t table_id = 0;
    for (auto& table_chunk : table_declarations.GetChunks()) {
        for (auto& table : table_chunk) {
            auto table_name = builder.CreateString(table.table_name.table_name.get().text);

            std::vector<flatbuffers::Offset<buffers::catalog::SchemaTableColumn>> column_offsets;
            column_offsets.reserve(table.table_columns.size());
            for (auto& column : table.table_columns) {
                auto column_name = builder.CreateString(column.column_name.get().text);
                buffers::catalog::SchemaTableColumnBuilder column_builder{builder};
                column_builder.add_column_name(column_name);
                column_offsets.push_back(column_builder.Finish());
            }
            auto columns_offset = builder.CreateVector(column_offsets);

            buffers::catalog::SchemaTableBuilder table_builder{builder};
            table_builder.add_table_id(table_id++);
            table_builder.add_table_name(table_name);
            table_builder.add_columns(columns_offset);
        }
    }
    auto tables_offset = builder.CreateVector(table_offsets);

    buffers::catalog::SchemaDescriptorBuilder schemaBuilder{builder};
    schemaBuilder.add_tables(tables_offset);
    auto schema_offset = schemaBuilder.Finish();
    std::vector<flatbuffers::Offset<buffers::catalog::SchemaDescriptor>> schemas{schema_offset};
    auto schemas_offset = builder.CreateVector(schemas);

    buffers::catalog::CatalogEntryBuilder catalog{builder};
    catalog.add_catalog_entry_id(catalog_entry_id);
    catalog.add_catalog_entry_type(buffers::catalog::CatalogEntryType::DESCRIPTOR_POOL);
    catalog.add_rank(0);
    catalog.add_schemas(schemas_offset);
    return catalog.Finish();
}

/// Get the name search index
const CatalogEntry::NameSearchIndex& AnalyzedScript::GetNameSearchIndex() {
    if (!name_search_index.has_value()) {
        auto& index = name_search_index.emplace();
        auto& names = parsed_script->scanned_script->name_registry.GetChunks();
        for (auto& names_chunk : names) {
            for (auto& name : names_chunk) {
                auto s = name.text;
                for (size_t i = 1; i <= s.size(); ++i) {
                    auto suffix = s.substr(s.size() - i);
                    index.insert({{suffix.data(), suffix.size()}, name});
                }
            }
        }
    }
    return name_search_index.value();
}

template <typename In, typename Out, size_t ChunkSize>
static flatbuffers::Offset<flatbuffers::Vector<flatbuffers::Offset<Out>>> PackVector(
    flatbuffers::FlatBufferBuilder& builder, const ChunkBuffer<In, ChunkSize>& elems) {
    std::vector<flatbuffers::Offset<Out>> offsets;
    offsets.reserve(elems.GetSize());
    for (auto& chunk : elems.GetChunks()) {
        for (auto& elem : chunk) {
            offsets.push_back(elem.Pack(builder));
        }
    }
    return builder.CreateVector(offsets);
};

template <typename In, typename Out, size_t ChunkSize>
static flatbuffers::Offset<flatbuffers::Vector<const Out*>> packStructVector(flatbuffers::FlatBufferBuilder& builder,
                                                                             const ChunkBuffer<In, ChunkSize>& elems) {
    Out* writer;
    auto out = builder.CreateUninitializedVectorOfStructs(elems.GetSize(), &writer);
    for (auto& chunk : elems.GetChunks()) {
        for (auto& elem : chunk) {
            *(writer++) = static_cast<const Out>(elem);
        }
    }
    return out;
};

// Pack an analyzed script
flatbuffers::Offset<buffers::analyzer::AnalyzedScript> AnalyzedScript::Pack(flatbuffers::FlatBufferBuilder& builder) {
    // Pack tables
    flatbuffers::Offset<flatbuffers::Vector<flatbuffers::Offset<buffers::analyzer::Table>>> tables_ofs;
    {
        std::vector<flatbuffers::Offset<buffers::analyzer::Table>> table_offsets;
        table_offsets.reserve(table_declarations.GetSize());
        for (auto& table_chunk : table_declarations.GetChunks()) {
            for (auto& table : table_chunk) {
                table_offsets.push_back(table.Pack(builder));
            }
        }
        tables_ofs = builder.CreateVector(table_offsets);
    }
    // Pack table references
    auto table_references_ofs =
        PackVector<AnalyzedScript::TableReference, buffers::analyzer::TableReference>(builder, table_references);
    // Pack expressions
    auto expressions_ofs = PackVector<AnalyzedScript::Expression, buffers::algebra::Expression>(builder, expressions);

    // Build index: (db_id, schema_id, table_id) -> table_ref*
    flatbuffers::Offset<flatbuffers::Vector<const buffers::analyzer::IndexedTableReference*>>
        resolved_table_refs_by_id_ofs;
    {
        std::vector<buffers::analyzer::IndexedTableReference> table_refs_by_id;
        table_refs_by_id.reserve(table_references.GetSize());
        table_references.ForEach([&](size_t ref_id, TableReference& ref) {
            if (auto* table_ref = std::get_if<TableReference::RelationExpression>(&ref.inner);
                table_ref && table_ref->resolved_table.has_value()) {
                auto& resolved = table_ref->resolved_table.value();
                auto [db_id, schema_id] = resolved.catalog_schema_id.UnpackSchemaID();
                auto table_id = resolved.catalog_table_id.UnpackTableID().Pack();
                table_refs_by_id.emplace_back(db_id, schema_id, table_id, ref_id);
            }
        });
        std::sort(table_refs_by_id.begin(), table_refs_by_id.end(),
                  [&](buffers::analyzer::IndexedTableReference& l, buffers::analyzer::IndexedTableReference& r) {
                      auto a = std::make_tuple(l.catalog_database_id(), l.catalog_schema_id(), l.catalog_table_id());
                      auto b = std::make_tuple(r.catalog_database_id(), r.catalog_schema_id(), r.catalog_table_id());
                      return a < b;
                  });
        resolved_table_refs_by_id_ofs = builder.CreateVectorOfStructs(table_refs_by_id);
    }

    // Build index: (db_id, schema_id, table_id, column_id) -> column_ref*
    flatbuffers::Offset<flatbuffers::Vector<const buffers::analyzer::IndexedColumnReference*>>
        resolved_column_refs_by_id_ofs;
    {
        std::vector<buffers::analyzer::IndexedColumnReference> column_refs_by_id;
        column_refs_by_id.reserve(expressions.GetSize());
        expressions.ForEach([&](size_t ref_id, Expression& ref) {
            if (auto* column_ref = std::get_if<AnalyzedScript::Expression::ColumnRef>(&ref.inner);
                column_ref && column_ref->resolved_column.has_value()) {
                auto& resolved = column_ref->resolved_column.value();
                auto [db_id, schema_id] = resolved.catalog_schema_id.UnpackSchemaID();
                auto [table_id, column_idx] = resolved.catalog_table_column_id.UnpackTableColumnID();
                column_refs_by_id.emplace_back(db_id, schema_id, table_id.Pack(), column_idx, ref_id);
            }
        });
        std::sort(column_refs_by_id.begin(), column_refs_by_id.end(),
                  [&](buffers::analyzer::IndexedColumnReference& l, buffers::analyzer::IndexedColumnReference& r) {
                      auto a = std::make_tuple(l.catalog_database_id(), l.catalog_schema_id(), l.catalog_table_id(),
                                               l.table_column_id());
                      auto b = std::make_tuple(r.catalog_database_id(), r.catalog_schema_id(), r.catalog_table_id(),
                                               r.table_column_id());
                      return a < b;
                  });
        resolved_column_refs_by_id_ofs = builder.CreateVectorOfStructs(column_refs_by_id);
    }

    // Pack name scopes
    flatbuffers::Offset<flatbuffers::Vector<flatbuffers::Offset<buffers::analyzer::NameScope>>> name_scopes_ofs;
    {
        std::vector<flatbuffers::Offset<buffers::analyzer::NameScope>> name_scope_offsets;
        name_scopes.ForEach([&](size_t scope_id, const NameScope& scope) {
            // Encode child scopes
            builder.StartVector<uint32_t>(scope.child_scopes.GetSize());
            for (auto& child_scope : scope.child_scopes) {
                builder.PushElement(child_scope.buffer_index);
            }
            flatbuffers::Offset<flatbuffers::Vector<uint32_t>> child_scopes_ofs{
                builder.EndVector(scope.child_scopes.GetSize())};

            // Encode expressions
            builder.StartVector<uint32_t>(scope.child_scopes.GetSize());
            for (auto& expr : scope.expressions) {
                builder.PushElement(expr.buffer_index);
            }
            flatbuffers::Offset<flatbuffers::Vector<uint32_t>> expressions_ofs{
                builder.EndVector(scope.expressions.GetSize())};

            // Encode table references
            builder.StartVector<uint32_t>(scope.table_references.GetSize());
            for (auto& ref : scope.table_references) {
                builder.PushElement(ref.buffer_index);
            }
            flatbuffers::Offset<flatbuffers::Vector<uint32_t>> table_refs_ofs{
                builder.EndVector(scope.table_references.GetSize())};

            buffers::analyzer::NameScopeBuilder scope_builder{builder};
            scope_builder.add_scope_id(scope_id);
            scope_builder.add_ast_node_id(scope.ast_node_id);
            scope_builder.add_ast_statement_id(scope.ast_statement_id);
            scope_builder.add_child_scopes(child_scopes_ofs);
            scope_builder.add_expressions(expressions_ofs);
            scope_builder.add_table_references(table_refs_ofs);

            name_scope_offsets.push_back(scope_builder.Finish());
        });
        name_scopes_ofs = builder.CreateVector(name_scope_offsets);
    }

    // Pack constant expressions
    buffers::analyzer::ConstantExpression* constant_expressions_writer;
    auto constant_expressions_ofs =
        builder.CreateUninitializedVectorOfStructs(constant_expressions.GetSize(), &constant_expressions_writer);
    constant_expressions.ForEach([&](size_t i, const AnalyzedScript::ConstantExpression& restriction) {
        auto& root = restriction.root.get();
        assert(root.ast_statement_id.has_value());
        assert(root.location.has_value());
        constant_expressions_writer[i] = buffers::analyzer::ConstantExpression(
            root.ast_node_id, root.ast_statement_id.value(), root.location.value(), root.expression_id);
    });

    // Pack column restrictions
    buffers::analyzer::ColumnRestriction* column_restriction_writer;
    auto column_restrictions_ofs =
        builder.CreateUninitializedVectorOfStructs(column_restrictions.GetSize(), &column_restriction_writer);
    column_restrictions.ForEach([&](size_t i, const AnalyzedScript::ColumnRestriction& restriction) {
        auto& root = restriction.root.get();
        auto& column_ref = restriction.column_ref.get();
        assert(root.ast_statement_id.has_value());
        assert(root.location.has_value());
        column_restriction_writer[i] =
            buffers::analyzer::ColumnRestriction(root.ast_node_id, root.ast_statement_id.value(), root.location.value(),
                                                 root.expression_id, column_ref.expression_id);
    });

    // Pack column transforms
    buffers::analyzer::ColumnTransform* column_transform_writer;
    auto column_transforms_ofs =
        builder.CreateUninitializedVectorOfStructs(column_transforms.GetSize(), &column_transform_writer);
    column_transforms.ForEach([&](size_t i, const AnalyzedScript::ColumnTransform& transform) {
        auto& root = transform.root.get();
        auto& column_ref = transform.column_ref.get();
        assert(root.ast_statement_id.has_value());
        assert(root.location.has_value());
        column_transform_writer[i] =
            buffers::analyzer::ColumnTransform(root.ast_node_id, root.ast_statement_id.value(), root.location.value(),
                                               root.expression_id, column_ref.expression_id);
    });

    buffers::analyzer::AnalyzedScriptBuilder out{builder};
    out.add_catalog_entry_id(catalog_entry_id);
    out.add_tables(tables_ofs);
    out.add_table_references(table_references_ofs);
    out.add_resolved_table_references_by_id(resolved_table_refs_by_id_ofs);
    out.add_expressions(expressions_ofs);
    out.add_resolved_column_references_by_id(resolved_column_refs_by_id_ofs);
    out.add_constant_expressions(constant_expressions_ofs);
    out.add_column_restrictions(column_restrictions_ofs);
    out.add_column_transforms(column_transforms_ofs);
    out.add_name_scopes(name_scopes_ofs);
    return out.Finish();
}

Script::Script(Catalog& catalog, uint32_t catalog_entry_id)
    : catalog(catalog), catalog_entry_id(catalog_entry_id), text(1024) {
    assert(!catalog.Contains(catalog_entry_id));
}

Script::~Script() { catalog.DropScript(*this); }

/// Insert a character at an offet
void Script::InsertCharAt(size_t char_idx, uint32_t unicode) {
    std::array<std::byte, 6> buffer;
    auto length = dashql::utf8::utf8proc_encode_char(unicode, reinterpret_cast<uint8_t*>(buffer.data()));
    std::string_view encoded{reinterpret_cast<char*>(buffer.data()), static_cast<size_t>(length)};
    text.Insert(char_idx, encoded);
    ++text_version;
}
/// Insert a text at an offet
void Script::InsertTextAt(size_t char_idx, std::string_view encoded) {
    text.Insert(char_idx, encoded);
    ++text_version;
}
/// Erase a text at an offet
void Script::EraseTextRange(size_t char_idx, size_t count) {
    text.Remove(char_idx, count);
    ++text_version;
}
/// Replace the text in the script
void Script::ReplaceText(std::string_view encoded) {
    text = rope::Rope{1024, encoded};
    ++text_version;
}
/// Print a script as string
std::string Script::ToString() { return text.ToString(); }

/// Update memory statisics
std::unique_ptr<buffers::statistics::ScriptMemoryStatistics> Script::GetMemoryStatistics() {
    auto memory = std::make_unique<buffers::statistics::ScriptMemoryStatistics>();
    memory->mutate_rope_bytes(text.GetStats().text_bytes);

    std::unordered_set<const ScannedScript*> registered_scanned;
    std::unordered_set<const ParsedScript*> registered_parsed;
    std::unordered_set<const AnalyzedScript*> registered_analyzed;
    registered_scanned.reserve(4);
    registered_parsed.reserve(4);
    registered_analyzed.reserve(4);
    auto registerScript = [&](AnalyzedScript* analyzed, buffers::statistics::ScriptProcessingMemoryStatistics& stats) {
        if (!analyzed) return;
        // Added analyzed before?
        if (registered_analyzed.contains(analyzed)) return;
        size_t table_column_bytes = 0;
        for (auto& table_chunk : analyzed->table_declarations.GetChunks()) {
            for (auto& table : table_chunk) {
                table_column_bytes += table.table_columns.size() * sizeof(CatalogEntry::TableColumn);
            }
        }
        size_t analyzer_description_bytes =
            analyzed->database_references.GetSize() * sizeof(CatalogEntry::DatabaseReference) +
            analyzed->schema_references.GetSize() * sizeof(CatalogEntry::SchemaReference) +
            analyzed->table_declarations.GetSize() * sizeof(CatalogEntry::TableDeclaration) + table_column_bytes +
            analyzed->table_references.GetSize() * sizeof(decltype(analyzed->table_references)::value_type) +
            analyzed->expressions.GetSize() * sizeof(decltype(analyzed->expressions)::value_type) +
            analyzed->function_arguments.GetSize() * sizeof(decltype(analyzed->function_arguments)::value_type) +
            analyzed->name_scopes.GetSize() * sizeof(decltype(analyzed->name_scopes)::value_type);
        size_t analyzer_name_index_bytes = 0;
        size_t analyzer_name_search_index_size = 0;
        if (auto& index = analyzed->name_search_index) {
            analyzer_name_index_bytes = index->size() * index->average_bytes_per_value();
            analyzer_name_search_index_size = index->size();
        }
        stats.mutate_analyzer_description_bytes(analyzer_description_bytes);
        stats.mutate_analyzer_name_index_size(analyzer_name_search_index_size);
        stats.mutate_analyzer_name_index_bytes(analyzer_name_index_bytes);

        // Added parsed before?
        ParsedScript* parsed = analyzed->parsed_script.get();
        if (registered_parsed.contains(parsed)) return;
        size_t parser_ast_bytes = parsed->nodes.size() * sizeof(decltype(parsed->nodes)::value_type);
        stats.mutate_parser_ast_bytes(parser_ast_bytes);

        // Added scanned before?
        ScannedScript* scanned = parsed->scanned_script.get();
        if (registered_scanned.contains(scanned)) return;
        size_t scanner_symbol_bytes = scanned->symbols.GetSize() + sizeof(parser::Parser::symbol_type);
        size_t scanner_dictionary_bytes = scanned->name_pool.GetSize() + scanned->name_registry.GetByteSize();
        stats.mutate_scanner_input_bytes(scanned->GetInput().size());
        stats.mutate_scanner_symbol_bytes(scanner_symbol_bytes);
        stats.mutate_scanner_name_dictionary_bytes(scanner_dictionary_bytes);
    };
    registerScript(analyzed_script.get(), memory->mutable_latest_script());
    return memory;
}

/// Get statisics
std::unique_ptr<buffers::statistics::ScriptStatisticsT> Script::GetStatistics() {
    auto stats = std::make_unique<buffers::statistics::ScriptStatisticsT>();
    stats->memory = GetMemoryStatistics();
    stats->timings = std::make_unique<buffers::statistics::ScriptProcessingTimings>(timing_statistics);
    return stats;
}

buffers::status::StatusCode Script::Scan() {
    auto time_before = std::chrono::steady_clock::now();
    auto [script, status] = parser::Scanner::Scan(text, text_version, catalog_entry_id);
    scanned_script = std::move(script);
    timing_statistics.mutate_scanner_last_elapsed(
        std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now() - time_before).count());
    return status;
}

buffers::status::StatusCode Script::Parse() {
    auto time_before = std::chrono::steady_clock::now();
    auto [script, status] = parser::Parser::Parse(scanned_script);
    parsed_script = std::move(script);
    timing_statistics.mutate_parser_last_elapsed(
        std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now() - time_before).count());
    return status;
}

/// Analyze a script
buffers::status::StatusCode Script::Analyze(bool parse_if_outdated) {
    buffers::status::StatusCode status;

    if (parse_if_outdated) {
        // Scan the script, if needed
        if (scanned_script == nullptr || scanned_script->text_version != text_version) {
            status = Scan();
            if (status != buffers::status::StatusCode::OK) {
                return status;
            }
        }
        // Parse the script, if needed
        if (parsed_script == nullptr || parsed_script->scanned_script.get() != scanned_script.get()) {
            status = Parse();
            if (status != buffers::status::StatusCode::OK) {
                return status;
            }
        }
    }

    // Check if the script was already analyzed.
    // In that case, we have to clean up anything that we "registered" in the scanned script before.
    if (analyzed_script) {
        for (auto& chunk : scanned_script->name_registry.GetChunks()) {
            for (auto& entry : chunk) {
                entry.coarse_analyzer_tags = 0;
                entry.resolved_objects.Clear();
            }
        }
    }
    // Analyze a script
    auto time_before_analyzing = std::chrono::steady_clock::now();
    std::shared_ptr<AnalyzedScript> analyzed;
    std::tie(analyzed, status) = Analyzer::Analyze(parsed_script, catalog);
    timing_statistics.mutate_analyzer_last_elapsed(
        std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now() - time_before_analyzing)
            .count());
    if (status != buffers::status::StatusCode::OK) {
        return status;
    }
    analyzed_script = std::move(analyzed);

    return buffers::status::StatusCode::OK;
}

/// Move the cursor to a offset
std::pair<const ScriptCursor*, buffers::status::StatusCode> Script::MoveCursor(size_t text_offset) {
    auto [maybe_cursor, status] = ScriptCursor::Place(*this, text_offset);
    if (status == buffers::status::StatusCode::OK) {
        cursor = std::move(maybe_cursor);
    }
    return {cursor.get(), status};
}
/// Complete at the cursor
std::pair<std::unique_ptr<Completion>, buffers::status::StatusCode> Script::CompleteAtCursor(
    size_t limit, ScriptRegistry* registry) const {
    // Fail if the user forgot to move the cursor
    if (cursor == nullptr) {
        return {nullptr, buffers::status::StatusCode::COMPLETION_MISSES_CURSOR};
    }
    // Fail if the scanner is not associated with a scanner token
    if (!cursor->scanner_location.has_value()) {
        return {nullptr, buffers::status::StatusCode::COMPLETION_MISSES_SCANNER_TOKEN};
    }
    // Compute the completion
    return Completion::Compute(*cursor, limit, registry);
}
/// Complete at the cursor after selecting a candidate of a previous completion
std::pair<std::unique_ptr<Completion>, buffers::status::StatusCode> Script::CompleteAtCursorWithCandidate(
    const buffers::completion::Completion& completion, size_t candidate_idx) const {
    // Fail if the user forgot to move the cursor
    if (cursor == nullptr) {
        return {nullptr, buffers::status::StatusCode::COMPLETION_MISSES_CURSOR};
    }
    // Fail if the scanner is not associated with a scanner token
    if (!cursor->scanner_location.has_value()) {
        return {nullptr, buffers::status::StatusCode::COMPLETION_MISSES_SCANNER_TOKEN};
    }
    // Compute the completion
    return Completion::ComputeWithCandidate(*cursor, completion, candidate_idx);
}
/// Complete at the cursor after qualifying a candidate of a previous completion
std::pair<std::unique_ptr<Completion>, buffers::status::StatusCode> Script::CompleteAtCursorWithQualifiedCandidate(
    const buffers::completion::Completion& completion, size_t candidate_idx, size_t catalog_object_idx) const {
    // Fail if the user forgot to move the cursor
    if (cursor == nullptr) {
        return {nullptr, buffers::status::StatusCode::COMPLETION_MISSES_CURSOR};
    }
    // Fail if the scanner is not associated with a scanner token
    if (!cursor->scanner_location.has_value()) {
        return {nullptr, buffers::status::StatusCode::COMPLETION_MISSES_SCANNER_TOKEN};
    }
    // Compute the completion
    return Completion::ComputeWithQualifiedCandidate(*cursor, completion, candidate_idx, catalog_object_idx);
}

void AnalyzedScript::FollowPathUpwards(uint32_t ast_node_id, std::vector<uint32_t>& ast_node_path,
                                       std::vector<std::reference_wrapper<AnalyzedScript::NameScope>>& scopes) const {
    assert(parsed_script != nullptr);

    ast_node_path.clear();
    scopes.clear();

    // Traverse all parent ids of the node
    auto& nodes = parsed_script->nodes;
    for (std::optional<size_t> node_iter = ast_node_id; node_iter.has_value();
         node_iter = nodes[node_iter.value()].parent() != node_iter.value()
                         ? std::optional{nodes[node_iter.value()].parent()}
                         : std::nullopt) {
        // Remember the node path
        ast_node_path.push_back(*node_iter);
        // Probe the name scopes
        auto scope_iter = name_scopes_by_root_node.find(node_iter.value());
        if (scope_iter != name_scopes_by_root_node.end()) {
            scopes.push_back(scope_iter->second);
        }
    }
}

}  // namespace dashql
