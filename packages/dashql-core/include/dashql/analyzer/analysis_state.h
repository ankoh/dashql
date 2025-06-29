#pragma once

#include "dashql/buffers/index_generated.h"
#include "dashql/catalog.h"
#include "dashql/script.h"
#include "dashql/text/names.h"
#include "dashql/utils/ast_attributes.h"

namespace dashql {

struct NameResolutionPass;
struct IdentifyColumnRestrictionsPass;
struct IdentifyColumnTransformsPass;
struct IdentifyConstantExpressionsPass;
class ScannedScript;
class ParsedScript;

/// The state state is shared between the passes
struct AnalysisState {
    /// Contains an entry for every ast node, storing an expression pointer if the ast node has been translated.
    using ExpressionIndex = std::vector<AnalyzedScript::Expression*>;

   public:
    /// The scanned program (input)
    ScannedScript& scanned;
    /// The parsed program (input)
    ParsedScript& parsed;
    /// The parsed ast
    std::span<const buffers::parser::Node> ast;
    /// The analyzed program (output)
    std::shared_ptr<AnalyzedScript> analyzed;

    /// The external id of the current script
    const CatalogEntryID catalog_entry_id;
    /// The catalog
    Catalog& catalog;

    /// A dummy emtpy registered name.
    /// Used to construct qualified column and table identifiers and fill the prefix.
    RegisteredName& empty_name;
    /// The temporary name path buffer
    std::vector<std::reference_wrapper<RegisteredName>> name_path_buffer;

   protected:
    /// The expression index.
    ExpressionIndex expression_index;

   public:
    /// Constructor
    AnalysisState(std::shared_ptr<ParsedScript> parsed, Catalog& catalog);

    /// Get the children of an object
    std::span<const buffers::parser::Node> GetChildren(const buffers::parser::Node& node) {
        assert(node.node_type() >= buffers::parser::NodeType::OBJECT_KEYS_);
        return ast.subspan(node.children_begin_or_value(), node.children_count());
    }
    /// Get the attributes of an object
    template <buffers::parser::AttributeKey... keys>
    AttributeLookupResult<keys...> GetAttributes(const buffers::parser::Node& node) {
        assert(node.node_type() >= buffers::parser::NodeType::OBJECT_KEYS_);
        return LookupAttributes<keys...>(ast.subspan(node.children_begin_or_value(), node.children_count()));
    }
    /// Get the id of a node in the ast
    uint32_t GetNodeId(const buffers::parser::Node& node) { return &node - ast.data(); }
    /// Get an expression by id
    AnalyzedScript::Expression* GetExpression(size_t expr_id) { return &analyzed->expressions[expr_id]; }
    /// Get the analyzed node (if any)
    template <typename Mapped>
    Mapped* GetDerivedForNode(const buffers::parser::Node& node)
        requires(std::is_same_v<Mapped, AnalyzedScript::Expression>)
    {
        if constexpr (std::is_same_v<Mapped, AnalyzedScript::Expression>) {
            return expression_index[GetNodeId(node)];
        }
    }
    /// Get the analyzed node (if any)
    template <typename Mapped>
    Mapped* GetDerivedForNode(uint32_t node_id)
        requires(std::is_same_v<Mapped, AnalyzedScript::Expression>)
    {
        if constexpr (std::is_same_v<Mapped, AnalyzedScript::Expression>) {
            return expression_index[node_id];
        }
    }
    /// Set the analyzed node (if any)
    template <typename Mapped>
    void SetDerivedForNode(const buffers::parser::Node& node, Mapped& mapped)
        requires(std::is_same_v<Mapped, AnalyzedScript::Expression>)
    {
        if constexpr (std::is_same_v<Mapped, AnalyzedScript::Expression>) {
            expression_index[GetNodeId(node)] = &mapped;
        }
    }
    /// Mark a node
    inline void MarkNode(const buffers::parser::Node& node, buffers::analyzer::SemanticNodeMarkerType t) {
        analyzed->node_markers[GetNodeId(node)] = t;
    }
    /// Helper to read a name path
    std::span<std::reference_wrapper<RegisteredName>> ReadNamePath(const buffers::parser::Node& node);
    /// Helper to read a qualified table name
    std::optional<AnalyzedScript::QualifiedTableName> ReadQualifiedTableName(const buffers::parser::Node* node);
    /// Helper to read a qualified column name
    std::optional<AnalyzedScript::QualifiedColumnName> ReadQualifiedColumnName(const buffers::parser::Node* column);
    /// Helper to read a qualified function name
    std::optional<AnalyzedScript::QualifiedFunctionName> ReadQualifiedFunctionName(const buffers::parser::Node* node);

    /// Helper to read expression arguments
    inline std::span<const buffers::parser::Node> ReadArgNodes(const buffers::parser::Node& args_node) {
        // Ensured by caller
        assert(args_node.attribute_key() == buffers::parser::AttributeKey::SQL_EXPRESSION_ARGS ||
               args_node.attribute_key() == buffers::parser::AttributeKey::SQL_FUNCTION_ARGUMENTS);
        // Ensured by parser
        assert(args_node.node_type() == buffers::parser::NodeType::ARRAY);
        // Return the children
        return ast.subspan(args_node.children_begin_or_value(), args_node.children_count());
    }
    /// Helper to read expression arguments
    inline std::span<const buffers::parser::Node> ReadArgNodes(const buffers::parser::Node* args_node) {
        return !args_node ? std::span<const buffers::parser::Node>{} : ReadArgNodes(*args_node);
    }

    // Helper to read a literal type
    static constexpr buffers::algebra::LiteralType GetLiteralType(buffers::parser::NodeType nodeType) {
        assert(nodeType >= buffers::parser::NodeType::LITERAL_NULL);
        assert(nodeType <= buffers::parser::NodeType::LITERAL_INTERVAL);
        return static_cast<buffers::algebra::LiteralType>(static_cast<size_t>(nodeType) - 5);
    }

    // Helper to read a binary expression function
    static constexpr buffers::algebra::BinaryExpressionFunction ReadBinaryExpressionFunction(
        buffers::parser::ExpressionOperator op) {
        switch (op) {
#define X(OP)                                     \
    case buffers::parser::ExpressionOperator::OP: \
        return buffers::algebra::BinaryExpressionFunction::OP;
            X(PLUS)
            X(MINUS)
            X(MULTIPLY)
            X(DIVIDE)
            X(MODULUS)
            X(XOR)
#undef X
            default:
                return buffers::algebra::BinaryExpressionFunction::UNKNOWN;
        }
    }

    // Helper to read a comparison function
    static constexpr buffers::algebra::ComparisonFunction ReadComparisonFunction(
        buffers::parser::ExpressionOperator op) {
        switch (op) {
#define X(OP)                                     \
    case buffers::parser::ExpressionOperator::OP: \
        return buffers::algebra::ComparisonFunction::OP;

            X(EQUAL)
            X(NOT_EQUAL)
            X(LESS_EQUAL)
            X(LESS_THAN)
            X(GREATER_EQUAL)
            X(GREATER_THAN)
#undef X
            default:
                return buffers::algebra::ComparisonFunction::UNKNOWN;
        }
    }
};

static_assert(AnalysisState::GetLiteralType(buffers::parser::NodeType::LITERAL_NULL) ==
              buffers::algebra::LiteralType::NULL_);
static_assert(AnalysisState::GetLiteralType(buffers::parser::NodeType::LITERAL_FLOAT) ==
              buffers::algebra::LiteralType::FLOAT);
static_assert(AnalysisState::GetLiteralType(buffers::parser::NodeType::LITERAL_STRING) ==
              buffers::algebra::LiteralType::STRING);
static_assert(AnalysisState::GetLiteralType(buffers::parser::NodeType::LITERAL_INTEGER) ==
              buffers::algebra::LiteralType::INTEGER);
static_assert(AnalysisState::GetLiteralType(buffers::parser::NodeType::LITERAL_INTERVAL) ==
              buffers::algebra::LiteralType::INTERVAL);

}  // namespace dashql
