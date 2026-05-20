#pragma once

#include <flatbuffers/buffer.h>
#include <flatbuffers/flatbuffer_builder.h>

#include <functional>
#include <optional>
#include <span>
#include <string_view>
#include <type_traits>
#include <unordered_map>
#include <variant>
#include <vector>

#include "dashql/buffers/index_generated.h"
#include "dashql/catalog.h"
#include "dashql/external.h"
#include "dashql/utils/intrusive_list.h"

namespace dashql {

namespace sx = buffers;

// Convenience aliases for qualified names from CatalogEntry
using QualifiedTableName = CatalogEntry::QualifiedTableName;
using QualifiedColumnName = CatalogEntry::QualifiedColumnName;
using QualifiedFunctionName = CatalogEntry::QualifiedFunctionName;

/// A table reference
struct TableReference : public IntrusiveListNode {
    /// A resolved table entry
    struct ResolvedTableEntry {
        /// The table name, may refer to different catalog entry
        QualifiedTableName table_name;
        /// The resolved schema in the catalog
        QualifiedCatalogObjectID catalog_schema_id;
        /// The resolved table id in the catalog
        QualifiedCatalogObjectID catalog_table_id;
        /// The catalog version of this resolved column
        CatalogVersion referenced_catalog_version = 0;
    };
    /// A relation expression
    struct RelationExpression {
        /// The table name, may refer to different catalog entry
        QualifiedTableName table_name;
        /// THe resolved relation
        std::optional<ResolvedTableEntry> resolved_table;
        /// The ambiguous matches (if any)
        std::vector<ResolvedTableEntry> resolved_alternatives;
    };

    /// The table reference id
    ExternalObjectID table_reference_id;
    /// The AST node id in the target script
    uint32_t ast_node_id;
    /// The location in the target script
    std::optional<sx::parser::SymbolSpan> location;
    /// The AST statement id in the target script
    std::optional<uint32_t> ast_statement_id;
    /// The AST scope root in the target script
    std::optional<uint32_t> ast_scope_root;
    /// The alias name, may refer to different catalog entry
    /// We track alias locations explicitly since we want to treat aliases differently during completion.
    std::optional<std::pair<std::reference_wrapper<RegisteredName>, sx::parser::SymbolSpan>> alias;
    /// The inner relation type
    std::variant<std::monostate, RelationExpression> inner;

    /// Constructor
    TableReference(std::optional<std::pair<std::reference_wrapper<RegisteredName>, sx::parser::SymbolSpan>> alias)
        : alias(alias) {}
    /// Pack as FlatBuffer
    flatbuffers::Offset<buffers::analyzer::TableReference> Pack(flatbuffers::FlatBufferBuilder& builder) const;
};

/// An expression
struct Expression : public IntrusiveListNode {
    /// A resolved column reference
    struct ResolvedColumn {
        /// The resolved catalog schema id
        QualifiedCatalogObjectID catalog_schema_id;
        /// The resolved table column id in the catalog
        QualifiedCatalogObjectID catalog_table_column_id;
        /// The catalog version of the resolved column
        CatalogVersion referenced_catalog_version = 0;
    };
    /// An unresolved column reference
    struct ColumnRef {
        /// The column name, may refer to different catalog entry
        QualifiedColumnName column_name;
        /// The AST scope root in the target script
        std::optional<uint32_t> ast_scope_root;
        /// The resolved column
        std::optional<ResolvedColumn> resolved_column;
    };
    /// A literal
    struct Literal {
        /// The literal type
        buffers::algebra::LiteralType literal_type = buffers::algebra::LiteralType::NULL_;
        /// The raw value
        std::string_view raw_value;
    };
    /// A comparison
    struct Comparison {
        /// The comparison function
        buffers::algebra::ComparisonFunction func = buffers::algebra::ComparisonFunction::UNKNOWN;
        /// The expression id of the left child
        uint32_t left_expression_id = 0;
        /// The expression id of the right child
        uint32_t right_expression_id = 0;
    };
    /// A binary expression
    struct BinaryExpression {
        /// The binary expression function
        buffers::algebra::BinaryExpressionFunction func = buffers::algebra::BinaryExpressionFunction::UNKNOWN;
        /// The expression id of the left child
        uint32_t left_expression_id = 0;
        /// The expression id of the right child
        uint32_t right_expression_id = 0;
    };
    /// A function argument expression?
    struct FunctionArgument {
        /// The ast node id of the argument
        uint32_t ast_node_id = 0;
        /// The ast node id of the argument value
        uint32_t value_ast_node_id = 0;
        /// The name (if the argument is named)
        std::optional<std::reference_wrapper<RegisteredName>> name;
        /// The expression id (if mapped)
        std::optional<uint32_t> expression_id = 0;
    };
    struct FunctionCastArguments {};
    /// A function call expression
    struct FunctionCallExpression {
        /// Generic argument list
        using GenericArguments = std::span<FunctionArgument>;
        /// CAST arguments
        struct CastArguments {};
        /// EXTRACT arguments
        struct ExtractArguments {};
        /// OVERLAY arguments
        struct OverlayArguments {};
        /// POSITION arguments
        struct PositionArguments {};
        /// SUBSTRING arguments
        struct SubstringArguments {};
        /// TRIM arguments
        struct TrimArguments {
            buffers::parser::TrimDirection direction;
        };
        /// TREAT arguments
        struct TreatArguments {};

        /// The qualified function name
        std::variant<buffers::parser::KnownFunction, QualifiedFunctionName> function_name =
            buffers::parser::KnownFunction::CURRENT_TIME;
        /// The type modifiers
        uint8_t function_call_modifiers = 0;
        /// The arguments (if any)
        std::variant<std::monostate, GenericArguments, CastArguments, ExtractArguments, OverlayArguments,
                     PositionArguments, SubstringArguments, TrimArguments, TreatArguments>
            arguments = std::monostate{};
    };
    /// An interval type
    struct IntervalType {
        /// The interval type
        dashql::buffers::parser::IntervalType interval_type;
        /// The expression for the interval precision (if any)
        std::optional<int32_t> precision_expression;
    };
    /// A constant interval cast
    struct ConstIntervalCast {
        /// The expression id of the value
        uint32_t value_expression_id;
        // The interval type (if not in the value text)
        std::optional<IntervalType> interval;
    };

    /// The expression id as reference_index
    uint32_t expression_id;
    /// The AST node id in the target script
    uint32_t ast_node_id;
    /// The location in the target script
    std::optional<sx::parser::SymbolSpan> location;
    /// The AST statement id in the target script
    std::optional<uint32_t> ast_statement_id;
    /// The inner expression type
    std::variant<std::monostate, ColumnRef, Literal, Comparison, BinaryExpression, FunctionCallExpression,
                 ConstIntervalCast>
        inner;
    /// The expression id of the subtree that contains the target column ref
    std::optional<uint32_t> target_expression_id = std::nullopt;
    /// Is the expression a constant?
    bool is_constant_expression = false;
    /// Is the expression a column computation?
    bool is_column_computation = false;
    /// Is the expression a filter?
    bool is_column_filter = false;

    /// Constructor
    Expression() : inner(std::monostate{}) {}
    // Check if the expression is a column ref
    inline bool IsColumnRef() const { return std::holds_alternative<ColumnRef>(inner); }
    // Check if the expression is a literal
    inline bool IsLiteral() const { return std::holds_alternative<Literal>(inner); }
    // Check if the expression is a constant
    inline bool IsConstantExpression() const { return is_constant_expression; }
    // Check if the expression is a column computation
    inline bool IsColumnComputation() const { return is_column_computation; }
    // Check if the expression is a column filter
    inline bool IsColumnFilter() const { return is_column_filter; }
    /// Pack as FlatBuffer
    flatbuffers::Offset<buffers::algebra::Expression> Pack(flatbuffers::FlatBufferBuilder& builder) const;
};
static_assert(std::is_trivially_destructible_v<Expression>, "Expressions should remain destructable");

/// A result target
struct ResultTarget {
    /// A star result target
    struct Star {};
    /// An unnamed result target
    struct Unnamed {
        /// The expression
        uint32_t expression_id;
    };
    /// A named result target
    struct Named {
        /// The expression
        uint32_t expression_id;
    };
    /// An inner
    std::variant<Star, Unnamed, Named> inner;
};

/// A naming scope
struct NameScope : public IntrusiveListNode {
    /// The id of the scope (== scope index in the script)
    size_t name_scope_id;
    /// The AST scope root
    size_t ast_node_id;
    /// The AST statement id
    size_t ast_statement_id;
    /// The parent scope
    NameScope* parent_scope;
    /// The child scopes
    IntrusiveList<IntrusiveListNode> child_scopes;
    /// The column references in this scope
    IntrusiveList<Expression> expressions;
    /// The table references in this scope
    IntrusiveList<TableReference> table_references;

    /// The result targets in this scope
    std::vector<ResultTarget> result_targets;
    /// The named tables in scope
    std::unordered_map<std::string_view, std::reference_wrapper<const CatalogEntry::TableDeclaration>>
        referenced_tables_by_name;
};

/// A constant expression
struct ConstantExpression {
    /// The root expression
    std::reference_wrapper<Expression> root;
};

/// A column computation
struct ColumnComputation {
    /// The root expression
    std::reference_wrapper<Expression> root;
    /// The column ref expression
    std::reference_wrapper<Expression> column_ref;
};

/// A column filter
struct ColumnFilter {
    /// The root expression
    std::reference_wrapper<Expression> root;
    /// The column ref expression
    std::reference_wrapper<Expression> column_ref;
};

}  // namespace dashql
