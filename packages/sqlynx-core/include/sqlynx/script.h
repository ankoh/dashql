#pragma once

#include <flatbuffers/buffer.h>
#include <flatbuffers/flatbuffer_builder.h>

#include <functional>
#include <optional>
#include <string_view>
#include <tuple>

#include "ankerl/unordered_dense.h"
#include "sqlynx/catalog.h"
#include "sqlynx/external.h"
#include "sqlynx/parser/names.h"
#include "sqlynx/parser/parser.h"
#include "sqlynx/proto/proto_generated.h"
#include "sqlynx/text/rope.h"
#include "sqlynx/utils/bits.h"
#include "sqlynx/utils/btree/map.h"
#include "sqlynx/utils/hash.h"
#include "sqlynx/utils/string_pool.h"
#include "sqlynx/utils/suffix_trie.h"

namespace sqlynx {
namespace parser {
class ParseContext;
}  // namespace parser

class Analyzer;
class NameSuffixIndex;
class Completion;

using Key = proto::AttributeKey;
using Location = proto::Location;
using NameID = uint32_t;
using NodeID = uint32_t;
using StatementID = uint32_t;

class ScannedScript {
    friend class Script;

   public:
    /// The origin id
    const ExternalID external_id;
    /// The copied text buffer
    std::string text_buffer;

    /// The scanner errors
    std::vector<std::pair<proto::Location, std::string>> errors;
    /// The line breaks
    std::vector<proto::Location> line_breaks;
    /// The comments
    std::vector<proto::Location> comments;

    /// The name pool
    StringPool<1024> name_pool;
    /// The name dictionary locations
    ChunkBuffer<CatalogEntry::NameInfo, 32> names;
    /// The name infos by name id
    ankerl::unordered_dense::map<NameID, std::reference_wrapper<CatalogEntry::NameInfo>> names_by_id;
    /// The name infos by text
    ankerl::unordered_dense::map<std::string_view, std::reference_wrapper<CatalogEntry::NameInfo>> names_by_text;
    /// All symbols
    ChunkBuffer<parser::Parser::symbol_type> symbols;

   public:
    /// Constructor
    ScannedScript(const rope::Rope& text, ExternalID external_id = 1);
    /// Constructor
    ScannedScript(std::string text, ExternalID external_id = 1);

    /// Get the input
    auto& GetInput() const { return text_buffer; }
    /// Get the tokens
    auto& GetSymbols() const { return symbols; }
    /// Get the name dictionary
    auto& GetNameDictionary() const { return names; }

    /// Register a name
    NameID RegisterName(std::string_view s, sx::Location location, sx::NameTag tag = sx::NameTag::NONE);
    /// Register a keyword as name
    NameID RegisterKeywordAsName(std::string_view s, sx::Location location, sx::NameTag tag = sx::NameTag::NONE);
    /// Read a name
    CatalogEntry::NameInfo& ReadName(NameID name);
    /// Read a text at a location
    std::string_view ReadTextAtLocation(sx::Location loc) {
        return std::string_view{text_buffer}.substr(loc.offset(), loc.length());
    }

    /// A location info
    struct LocationInfo {
        using RelativePosition = sqlynx::proto::RelativeSymbolPosition;
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
    std::unique_ptr<proto::ScannerTokensT> PackTokens();
    /// Pack scanned program
    flatbuffers::Offset<proto::ScannedScript> Pack(flatbuffers::FlatBufferBuilder& builder);
};

class ParsedScript {
   public:
    /// A statement
    struct Statement {
        /// The statement type
        proto::StatementType type = proto::StatementType::NONE;
        /// The root node
        NodeID root = std::numeric_limits<uint32_t>::max();
        /// The begin of the nodes
        size_t nodes_begin = 0;
        /// The node count
        size_t node_count = 0;
        /// Get as flatbuffer object
        std::unique_ptr<proto::StatementT> Pack();
    };

    /// The origin id
    const ExternalID external_id;
    /// The scanned script
    std::shared_ptr<ScannedScript> scanned_script;
    /// The nodes
    std::vector<proto::Node> nodes;
    /// The statements
    std::vector<Statement> statements;
    /// The errors
    std::vector<std::pair<proto::Location, std::string>> errors;

   public:
    /// Constructor
    ParsedScript(std::shared_ptr<ScannedScript> scan, parser::ParseContext&& context);

    /// Get the nodes
    auto& GetNodes() const { return nodes; }
    /// Resolve statement and ast node at a text offset
    std::optional<std::pair<size_t, size_t>> FindNodeAtOffset(size_t text_offset);
    /// Build the script
    flatbuffers::Offset<proto::ParsedScript> Pack(flatbuffers::FlatBufferBuilder& builder);
};

class AnalyzedScript : public CatalogEntry {
    friend class Script;
    friend class NameResolutionPass;

   public:
    /// A table reference
    struct TableReference {
        /// The table reference id
        ExternalObjectID table_reference_id;
        /// The AST node id in the target script
        std::optional<uint32_t> ast_node_id;
        /// The AST statement id in the target script
        std::optional<uint32_t> ast_statement_id;
        /// The AST scope root in the target script
        std::optional<uint32_t> ast_scope_root;
        /// The table name, may refer to different context
        QualifiedTableName table_name;
        /// The alias name, may refer to different context
        std::string_view alias_name;
        /// The table id, may refer to different context
        ExternalObjectID resolved_table_id;

        /// Pack as FlatBuffer
        flatbuffers::Offset<proto::TableReference> Pack(flatbuffers::FlatBufferBuilder& builder) const;
    };
    /// A column reference
    struct ColumnReference {
        /// The table reference id
        ExternalObjectID column_reference_id;
        /// The AST node id in the target script
        std::optional<uint32_t> ast_node_id;
        /// The AST statement id in the target script
        std::optional<uint32_t> ast_statement_id;
        /// The AST scope root in the target script
        std::optional<uint32_t> ast_scope_root;
        /// The column name, may refer to different context
        QualifiedColumnName column_name;
        /// The resolved table reference id in the current context
        std::optional<uint32_t> resolved_table_reference_id;
        /// The resolved table id, may refer to different context
        ExternalObjectID resolved_table_id;
        /// The resolved column index
        std::optional<uint32_t> resolved_column_id;

        /// Pack as FlatBuffer
        flatbuffers::Offset<proto::ColumnReference> Pack(flatbuffers::FlatBufferBuilder& builder) const;
    };
    /// A query graph edge
    struct QueryGraphEdge {
        /// The AST node id in the target script
        std::optional<uint32_t> ast_node_id;
        /// The begin of the nodes
        uint32_t nodes_begin;
        /// The number of nodes on the left
        uint16_t node_count_left;
        /// The number of nodes on the right
        uint16_t node_count_right;
        /// The expression operator
        proto::ExpressionOperator expression_operator;
        /// Constructor
        QueryGraphEdge(std::optional<uint32_t> ast_node_id = std::nullopt, uint32_t nodes_begin = 0,
                       uint16_t node_count_left = 0, uint16_t node_count_right = 0,
                       proto::ExpressionOperator op = proto::ExpressionOperator::DEFAULT)
            : ast_node_id(ast_node_id),
              nodes_begin(nodes_begin),
              node_count_left(node_count_left),
              node_count_right(node_count_right),
              expression_operator(op) {}
        /// Create FlatBuffer
        operator proto::QueryGraphEdge() {
            return proto::QueryGraphEdge{ast_node_id.value_or(PROTO_NULL_U32), nodes_begin, node_count_left,
                                         node_count_right, expression_operator};
        }
    };
    /// A query graph edge node
    struct QueryGraphEdgeNode {
        /// The column reference id
        uint32_t column_reference_id;
        /// Constructor
        QueryGraphEdgeNode(uint32_t column_ref_id = 0) : column_reference_id(column_ref_id) {}
        /// Create FlatBuffer
        operator proto::QueryGraphEdgeNode() { return proto::QueryGraphEdgeNode{column_reference_id}; }
    };

    /// The parsed script
    std::shared_ptr<ParsedScript> parsed_script;
    /// The catalog version
    Catalog::Version catalog_version;
    /// The table references
    std::vector<TableReference> table_references;
    /// The column references
    std::vector<ColumnReference> column_references;
    /// The join edges
    std::vector<QueryGraphEdge> graph_edges;
    /// The join edge nodes
    std::vector<QueryGraphEdgeNode> graph_edge_nodes;

   public:
    /// Constructor
    AnalyzedScript(std::shared_ptr<ParsedScript> parsed, const Catalog& catalog, std::string_view database_name,
                   std::string_view schema_name);

    /// Describe the catalog entry
    virtual flatbuffers::Offset<proto::CatalogEntry> DescribeEntry(
        flatbuffers::FlatBufferBuilder& builder) const override;
    /// Get the name search index
    const CatalogEntry::NameSearchIndex& GetNameSearchIndex() override;
    /// Build the program
    flatbuffers::Offset<proto::AnalyzedScript> Pack(flatbuffers::FlatBufferBuilder& builder);
};

class Script;

struct ScriptCursor {
    /// The script
    const Script& script;
    /// The text offset
    size_t text_offset = 0;
    /// The text offset
    std::string_view text;
    /// The current scanner location (if any)
    std::optional<ScannedScript::LocationInfo> scanner_location;
    /// The current ast node id (if any)
    std::optional<size_t> ast_node_id;
    /// The current statement id (if any)
    std::optional<size_t> statement_id;
    /// The current table id (if any)
    std::optional<size_t> table_id;
    /// The current table reference_id (if any)
    std::optional<size_t> table_reference_id;
    /// The current column reference_id (if any)
    std::optional<size_t> column_reference_id;
    /// The current query edge id (if any)
    std::optional<size_t> query_edge_id;

    /// Move the cursor to a script at a position
    ScriptCursor(const Script& script, size_t text_offset);
    /// Pack the cursor info
    flatbuffers::Offset<proto::ScriptCursorInfo> Pack(flatbuffers::FlatBufferBuilder& builder) const;

    /// Create a script cursor
    static std::pair<std::unique_ptr<ScriptCursor>, proto::StatusCode> Create(const Script& script, size_t text_offset);
};

class Script {
   public:
    /// The catalog
    Catalog& catalog;
    /// The origin id
    const ExternalID external_id;
    /// The database name
    const std::string database_name;
    /// The schema name
    const std::string schema_name;

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
    proto::ScriptProcessingTimings timing_statistics;
    /// Get memory statisics
    std::unique_ptr<proto::ScriptMemoryStatistics> GetMemoryStatistics();

   public:
    /// Constructor
    Script(ExternalID external_id = 1, std::string_view database_name = "", std::string_view schema_name = "");
    /// Constructor
    Script(Catalog& catalog, ExternalID external_id = 1, std::string_view database_name = "",
           std::string_view schema_name = "");
    /// Destructor
    ~Script();
    /// Scripts must not be copied
    Script(const Script& other) = delete;
    /// Scripts must not be copy-assigned
    Script& operator=(const Script& other) = delete;

    /// Get the external id
    auto GetExternalID() const { return external_id; }
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
    std::pair<ScannedScript*, proto::StatusCode> Scan();
    /// Parse the latest scanned script
    std::pair<ParsedScript*, proto::StatusCode> Parse();
    /// Analyze the latest parsed script
    std::pair<AnalyzedScript*, proto::StatusCode> Analyze();

    /// Move the cursor
    std::pair<const ScriptCursor*, proto::StatusCode> MoveCursor(size_t text_offset);
    /// Complete at the cursor
    std::pair<std::unique_ptr<Completion>, proto::StatusCode> CompleteAtCursor(size_t limit = 10) const;
    /// Get statisics
    std::unique_ptr<proto::ScriptStatisticsT> GetStatistics();
};

}  // namespace sqlynx
