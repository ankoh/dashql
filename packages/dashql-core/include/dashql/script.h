#pragma once

#include <flatbuffers/buffer.h>
#include <flatbuffers/flatbuffer_builder.h>

#include <functional>
#include <optional>
#include <string_view>
#include <type_traits>
#include <variant>

#include "dashql/buffers/index_generated.h"
#include "dashql/catalog.h"
#include "dashql/external.h"
#include "dashql/parser/parser.h"
#include "dashql/text/rope.h"
#include "dashql/utils/hash.h"
#include "dashql/utils/intrusive_list.h"
#include "dashql/utils/string_pool.h"

namespace dashql {
namespace parser {
class ParseContext;
}  // namespace parser

class Analyzer;
class NameSuffixIndex;
class Completion;

using Key = buffers::parser::AttributeKey;
using Location = buffers::parser::Location;
using NameID = uint32_t;
using NodeID = uint32_t;
using ColumnID = uint32_t;
using StatementID = uint32_t;

class ScannedScript {
    friend class Script;

   public:
    /// The origin id
    const CatalogEntryID external_id;
    /// The copied text buffer
    std::string text_buffer;

    /// The scanner errors
    std::vector<std::pair<buffers::parser::Location, std::string>> errors;
    /// The line breaks
    std::vector<buffers::parser::Location> line_breaks;
    /// The comments
    std::vector<buffers::parser::Location> comments;

    /// The name pool
    StringPool<1024> name_pool;
    /// The name registry
    NameRegistry name_registry;
    /// All symbols
    ChunkBuffer<parser::Parser::symbol_type> symbols;

   public:
    /// Constructor
    ScannedScript(const rope::Rope& text, CatalogEntryID external_id = 1);
    /// Constructor
    ScannedScript(std::string text, CatalogEntryID external_id = 1);

    /// Get the input
    auto& GetInput() const { return text_buffer; }
    /// Get the tokens
    auto& GetSymbols() const { return symbols; }
    /// Get the name dictionary
    auto& GetNames() { return name_registry; }

    /// Register a keyword as name
    NameID RegisterKeywordAsName(std::string_view s, sx::parser::Location location) {
        return name_registry.Register(s, location).name_id;
    }
    /// Read a text at a location
    std::string_view ReadTextAtLocation(sx::parser::Location loc) {
        return std::string_view{text_buffer}.substr(loc.offset(), loc.length());
    }

    /// A location info
    struct LocationInfo {
        using RelativePosition = dashql::buffers::cursor::RelativeSymbolPosition;
        /// The text offset
        size_t text_offset;
        /// The last scanner symbol that does not have a begin greater than the text offset
        size_t symbol_id;
        /// The symbol
        parser::Parser::symbol_type& symbol;
        /// The previous symbol (if any)
        std::optional<std::reference_wrapper<parser::Parser::symbol_type>> previous_symbol;
        /// If we would insert at this position, what mode would it be?
        RelativePosition relative_pos;
        /// At EOF?
        bool at_eof;

        /// Constructor
        LocationInfo(size_t text_offset, size_t token_id, parser::Parser::symbol_type& symbol,
                     std::optional<std::reference_wrapper<parser::Parser::symbol_type>> previous_symbol,
                     RelativePosition mode, bool at_eof)
            : text_offset(text_offset),
              symbol_id(token_id),
              symbol(symbol),
              previous_symbol(previous_symbol),
              relative_pos(mode),
              at_eof(at_eof) {}

        /// Is the current symbol a dot?
        bool currentSymbolIsDot() const { return symbol.kind_ == parser::Parser::symbol_kind_type::S_DOT; }
        /// Is the current symbol a dot + space?
        bool currentSymbolIsTrailingDot() const {
            return symbol.kind_ == parser::Parser::symbol_kind_type::S_DOT_TRAILING;
        }
        /// Is the previous symbol a dot?
        bool previousSymbolIsDot() const {
            if (!previous_symbol.has_value()) {
                return false;
            } else {
                return previous_symbol.value().get().kind_ == parser::Parser::symbol_kind_type::S_DOT;
            }
        }
    };
    /// Find token at text offset
    LocationInfo FindSymbol(size_t text_offset);
    /// Pack syntax tokens
    std::unique_ptr<buffers::parser::ScannerTokensT> PackTokens();
    /// Pack scanned program
    flatbuffers::Offset<buffers::parser::ScannedScript> Pack(flatbuffers::FlatBufferBuilder& builder);
};

class ParsedScript {
   public:
    /// A statement
    struct Statement {
        /// The statement type
        buffers::parser::StatementType type = buffers::parser::StatementType::NONE;
        /// The root node
        NodeID root = std::numeric_limits<uint32_t>::max();
        /// The begin of the nodes
        size_t nodes_begin = 0;
        /// The node count
        size_t node_count = 0;
        /// Get as flatbuffer object
        std::unique_ptr<buffers::parser::StatementT> Pack();
    };

    /// The origin id
    const CatalogEntryID external_id;
    /// The scanned script
    std::shared_ptr<ScannedScript> scanned_script;
    /// The nodes
    std::vector<buffers::parser::Node> nodes;
    /// The statements
    std::vector<Statement> statements;
    /// The parser errors
    std::vector<std::pair<buffers::parser::Location, std::string>> errors;

   public:
    /// Constructor
    ParsedScript(std::shared_ptr<ScannedScript> scan, parser::ParseContext&& context);

    /// Get the nodes
    auto& GetNodes() const { return nodes; }
    /// Resolve statement and ast node at a text offset
    std::optional<std::pair<size_t, size_t>> FindNodeAtOffset(size_t text_offset) const;
    /// Build the script
    flatbuffers::Offset<buffers::parser::ParsedScript> Pack(flatbuffers::FlatBufferBuilder& builder);
};

class AnalyzedScript : public CatalogEntry {
    friend class Script;
    friend class NameResolutionPass;

   public:
    /// A table reference
    struct TableReference : public IntrusiveListNode {
        /// A resolved table entry
        struct ResolvedTableEntry {
            /// The table name, may refer to different catalog entry
            QualifiedTableName table_name;
            /// The resolved database id in the catalog
            CatalogDatabaseID catalog_database_id = 0;
            /// The resolved schema id in the catalog
            CatalogSchemaID catalog_schema_id = 0;
            /// The resolved table id in the catalog
            ContextObjectID catalog_table_id;
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
        ContextObjectID table_reference_id;
        /// The AST node id in the target script
        uint32_t ast_node_id;
        /// The location in the target script
        std::optional<sx::parser::Location> location;
        /// The AST statement id in the target script
        std::optional<uint32_t> ast_statement_id;
        /// The AST scope root in the target script
        std::optional<uint32_t> ast_scope_root;
        /// The alias name, may refer to different catalog entry
        std::optional<std::reference_wrapper<RegisteredName>> alias_name;
        /// The inner relation type
        std::variant<std::monostate, RelationExpression> inner;

        /// Constructor
        TableReference(std::optional<std::reference_wrapper<RegisteredName>> alias_name) : alias_name(alias_name) {}
        /// Pack as FlatBuffer
        flatbuffers::Offset<buffers::analyzer::TableReference> Pack(flatbuffers::FlatBufferBuilder& builder) const;
    };

    /// An expression
    struct Expression : public IntrusiveListNode {
        /// A resolved column reference
        struct ResolvedColumn {
            /// The resolved catalog database id
            CatalogDatabaseID catalog_database_id = 0;
            /// The resolved catalog schema id
            CatalogSchemaID catalog_schema_id = 0;
            /// The resolved table id in the catalog
            ContextObjectID catalog_table_id;
            /// The resolved table column id
            uint32_t table_column_id = 0;
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
        std::optional<sx::parser::Location> location;
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
        /// Is the expression a column transform?
        bool is_column_transform = false;
        /// Is the expression a restriction?
        bool is_column_restriction = false;

        /// Constructor
        Expression() : inner(std::monostate{}) {}
        // Check if the expression is a column ref
        inline bool IsColumnRef() const { return std::holds_alternative<ColumnRef>(inner); }
        // Check if the expression is a constant
        inline bool IsConstantExpression() const { return is_constant_expression; }
        // Check if the expression is a column transform
        inline bool IsColumnTransform() const { return is_column_transform; }
        // Check if the expression is a column restriction
        inline bool IsColumnRestriction() const { return is_column_restriction; }
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
    /// A column transform
    struct ColumnTransform {
        /// The root expression
        std::reference_wrapper<Expression> root;
        /// The column ref expression
        std::reference_wrapper<Expression> column_ref;
    };
    /// A column restriction
    struct ColumnRestriction {
        /// The root expression
        std::reference_wrapper<Expression> root;
        /// The column ref expression
        std::reference_wrapper<Expression> column_ref;
    };

    /// The parsed script
    std::shared_ptr<ParsedScript> parsed_script;
    /// The catalog version
    Catalog::Version catalog_version;

    /// The analyzer errors
    std::vector<buffers::analyzer::AnalyzerErrorT> errors;

    /// The node markers.
    /// Semantic node markers annotate the ast with lightweight semantic tags.
    /// For example, we remember which ast nodes store a column ref, literals or constant expressions.
    /// These markers are preserved for Script Snippets and can be used in the UI for hints and highlighting.
    std::unordered_map<NodeID, buffers::analyzer::SemanticNodeMarkerType> node_markers;

    /// The table references
    ChunkBuffer<TableReference, 16> table_references;
    /// The expressions
    ChunkBuffer<Expression, 16> expressions;
    /// The function arguments (referenced by function call expressions)
    ChunkBuffer<Expression::FunctionArgument, 16> function_arguments;
    /// The name scopes
    ChunkBuffer<NameScope, 16> name_scopes;

    /// The name scopes by scope root.
    /// Name scopes maintain intrusive lists with all column reference expressions.
    std::unordered_map<NodeID, std::reference_wrapper<NameScope>> name_scopes_by_root_node;

    /// The constant expressions in the script
    ChunkBuffer<ConstantExpression, 16> constant_expressions;
    /// The column transforms in the script
    ChunkBuffer<ColumnTransform, 16> column_transforms;
    /// The column restrictions in the script
    ChunkBuffer<ColumnRestriction, 16> column_restrictions;

    /// A key to lookup a resolved column ref.
    using ColumnRefLookupKey = std::tuple<ContextObjectID, ColumnID>;
    /// A hasher for column ref keys
    struct ColumnRefLookupKeyHasher {
        size_t operator()(const ColumnRefLookupKey& key) const {
            auto [table, column] = key;
            size_t hash = 0;
            hash_combine(hash, table.Pack());
            hash_combine(hash, hash);
            return hash;
        }
    };
    /// The column transforms indexed by the catalog entry.
    /// This index is used to quickly resolve column transforms in this script through catalog ids.
    std::unordered_multimap<ColumnRefLookupKey, std::reference_wrapper<ColumnTransform>, ColumnRefLookupKeyHasher>
        column_transforms_by_catalog_entry;
    /// The column restrictions indexed by the catalog entry
    /// This index is used to quickly resolve column restrictions in this script through catalog ids.
    std::unordered_multimap<ColumnRefLookupKey, std::reference_wrapper<ColumnRestriction>, ColumnRefLookupKeyHasher>
        column_restrictions_by_catalog_entry;

    /// Traverse the name scopes for a given ast node id
    void FollowPathUpwards(uint32_t ast_node_id, std::vector<uint32_t>& ast_node_path,
                           std::vector<std::reference_wrapper<AnalyzedScript::NameScope>>& scopes) const;

   public:
    /// Constructor
    AnalyzedScript(std::shared_ptr<ParsedScript> parsed, Catalog& catalog);

    /// Helper to add an expression
    template <typename Inner> Expression& AddExpression(size_t node_id, Location location, Inner&& inner) {
        auto& n = expressions.PushBack(AnalyzedScript::Expression());
        n.buffer_index = expressions.GetSize() - 1;
        n.expression_id = static_cast<uint32_t>(expressions.GetSize() - 1);
        n.ast_node_id = node_id;
        n.ast_statement_id = std::nullopt;
        n.location = location;
        n.is_constant_expression = false;
        n.is_column_transform = false;
        n.is_column_restriction = false;
        n.inner = std::move(inner);
        return n;
    }

    /// Describe the catalog entry
    virtual flatbuffers::Offset<buffers::catalog::CatalogEntry> DescribeEntry(
        flatbuffers::FlatBufferBuilder& builder) const override;
    /// Get the name search index
    const CatalogEntry::NameSearchIndex& GetNameSearchIndex() override;
    /// Build the program
    flatbuffers::Offset<buffers::analyzer::AnalyzedScript> Pack(flatbuffers::FlatBufferBuilder& builder);
};

class Script;

struct ScriptCursor {
    /// Cursor is pointing at a table reference
    struct TableRefContext {
        /// The table ref that the cursor is pointing into
        uint32_t table_reference_id;
    };
    /// Cursor is pointing at a column reference
    struct ColumnRefContext {
        /// The table ref that the cursor is pointing into
        uint32_t expression_id;
    };

    /// The script
    const Script& script;
    /// The text offset
    size_t text_offset = 0;
    /// The text offset
    std::string_view text;
    /// The current scanner location (if any)
    std::optional<ScannedScript::LocationInfo> scanner_location;
    /// The current statement id (if any)
    std::optional<uint32_t> statement_id;
    /// The current ast node id (if any)
    std::optional<uint32_t> ast_node_id;
    /// The ast node path to the root
    std::vector<uint32_t> ast_path_to_root;
    /// The name scopes of that the cursor is in (if any).
    /// Left-to-right == innermost-to-outermost
    std::vector<std::reference_wrapper<AnalyzedScript::NameScope>> name_scopes;
    /// The inner cursor type based on what we're pointing at
    std::variant<std::monostate, TableRefContext, ColumnRefContext> context;

    /// Move the cursor to a script at a position
    ScriptCursor(const Script& script, size_t text_offset);
    /// Pack the cursor info
    flatbuffers::Offset<buffers::cursor::ScriptCursor> Pack(flatbuffers::FlatBufferBuilder& builder) const;

    /// Create a script cursor
    static std::pair<std::unique_ptr<ScriptCursor>, buffers::status::StatusCode> Place(const Script& script,
                                                                                       size_t text_offset);
};

class Script {
   public:
    /// The catalog
    Catalog& catalog;
    /// The catalog entry id
    const CatalogEntryID catalog_entry_id;

    /// The underlying rope
    rope::Rope text;

    /// The last scanned script
    std::shared_ptr<ScannedScript> scanned_script;
    /// The last parsed script
    std::shared_ptr<ParsedScript> parsed_script;
    /// The last analyzed script
    std::shared_ptr<AnalyzedScript> analyzed_script;

    /// The last cursor
    std::unique_ptr<ScriptCursor> cursor;

    /// The memory statistics
    buffers::statistics::ScriptProcessingTimings timing_statistics;
    /// Get memory statisics
    std::unique_ptr<buffers::statistics::ScriptMemoryStatistics> GetMemoryStatistics();

   public:
    /// Constructor
    Script(Catalog& catalog, CatalogEntryID external_id = 1);
    /// Destructor
    ~Script();
    /// Scripts must not be copied
    Script(const Script& other) = delete;
    /// Scripts must not be copy-assigned
    Script& operator=(const Script& other) = delete;

    /// Get the catalog entry id
    auto GetCatalogEntryId() const { return catalog_entry_id; }
    /// Get the catalog
    auto& GetCatalog() const { return catalog; }

    /// Insert a unicode codepoint at an offset
    void InsertCharAt(size_t offset, uint32_t unicode);
    /// Insert a text at an offset
    void InsertTextAt(size_t offset, std::string_view text);
    /// Erase a text range
    void EraseTextRange(size_t offset, size_t count);
    /// Replace the entire text
    void ReplaceText(std::string_view text);
    /// Print a script as string
    std::string ToString();
    /// Returns the pretty-printed string for this script
    std::string Format();

    /// Parse the latest scanned script
    std::pair<ScannedScript*, buffers::status::StatusCode> Scan();
    /// Parse the latest scanned script
    std::pair<ParsedScript*, buffers::status::StatusCode> Parse();
    /// Analyze the latest parsed script
    std::pair<AnalyzedScript*, buffers::status::StatusCode> Analyze();

    /// Move the cursor
    std::pair<const ScriptCursor*, buffers::status::StatusCode> MoveCursor(size_t text_offset);
    /// Complete at the cursor
    std::pair<std::unique_ptr<Completion>, buffers::status::StatusCode> CompleteAtCursor(size_t limit = 10) const;
    /// Get statisics
    std::unique_ptr<buffers::statistics::ScriptStatisticsT> GetStatistics();
};

}  // namespace dashql
