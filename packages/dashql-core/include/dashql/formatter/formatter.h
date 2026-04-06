#pragma once

#include <span>
#include <string>
#include <vector>

#include "dashql/buffers/index_generated.h"
#include "dashql/formatter/formatting_program.h"
#include "dashql/script.h"
#include "dashql/utils/ast_attributes.h"

namespace dashql {

enum class FormattingAssociativity { Left, Right, NonAssoc };

struct FormattingNodeState {
    size_t precedence = 0;
    FormattingAssociativity associativity = FormattingAssociativity::NonAssoc;
    bool needs_parentheses = false;
    bool is_statement_root = false;
    FmtReg reg = 0;
};

struct Formatter {
   public:
    using Associativity = FormattingAssociativity;
    using NodeState = FormattingNodeState;

   protected:
    const ScannedScript& scanned;
    const ParsedScript& parsed;
    const std::span<const buffers::parser::Node> ast;
    buffers::formatting::FormattingConfigT config;
    FormattingProgram fmt;
    std::vector<NodeState> node_states;

    NodeState& GetState(const buffers::parser::Node& node) { return node_states[&node - ast.data()]; }
    const NodeState& GetState(const buffers::parser::Node& node) const { return node_states[&node - ast.data()]; }
    FmtReg Reg(const buffers::parser::Node& node) const { return GetState(node).reg; }

    std::span<NodeState> GetArrayStates(const buffers::parser::Node& node) {
        assert(node.node_type() == buffers::parser::NodeType::ARRAY);
        return std::span{node_states}.subspan(node.children_begin_or_value(), node.children_count());
    }

    template <buffers::parser::AttributeKey... keys>
    AttributeLookupResult<keys...> GetAttributes(const buffers::parser::Node& node) const {
        assert(node.node_type() >= buffers::parser::NodeType::OBJECT_KEYS_);
        return LookupAttributes<keys...>(ast.subspan(node.children_begin_or_value(), node.children_count()));
    }

    void PreparePrecedence();
    void IdentifyParentheses(size_t node_id);
    void BuildDocs();

    FmtReg FormatNode(size_t node_id);
    FmtReg FormatArray(const buffers::parser::Node& node);
    FmtReg FormatSelect(size_t node_id);
    FmtReg FormatCreate(size_t node_id);
    FmtReg FormatResultTarget(const buffers::parser::Node& node);
    FmtReg FormatTableRef(const buffers::parser::Node& node);
    FmtReg FormatOrder(const buffers::parser::Node& node);
    FmtReg FormatOrderDirection(const buffers::parser::Node& node);
    FmtReg FormatOrderNullRule(const buffers::parser::Node& node);
    FmtReg FormatTypeName(const buffers::parser::Node& node);
    FmtReg FormatNumericType(const buffers::parser::Node& node);
    FmtReg FormatNumericTypeBase(const buffers::parser::Node& node);
    FmtReg FormatCharacterType(const buffers::parser::Node& node);
    FmtReg FormatCharacterTypeBase(const buffers::parser::Node& node);
    FmtReg FormatGenericType(const buffers::parser::Node& node);
    FmtReg FormatColumnRef(const buffers::parser::Node& node);
    FmtReg FormatSelectExpression(const buffers::parser::Node& node);
    FmtReg FormatColumnDef(const buffers::parser::Node& node);
    FmtReg FormatTableConstraintType(const buffers::parser::Node& node);
    FmtReg FormatTableConstraint(const buffers::parser::Node& node);
    FmtReg FormatKeyMatch(const buffers::parser::Node& node);
    FmtReg FormatKeyActionCommand(const buffers::parser::Node& node);
    FmtReg FormatKeyActionTrigger(const buffers::parser::Node& node);
    FmtReg FormatKeyAction(const buffers::parser::Node& node);
    FmtReg FormatColumnConstraintType(const buffers::parser::Node& node);
    FmtReg FormatColumnConstraint(const buffers::parser::Node& node);
    FmtReg FormatConstraintAttribute(const buffers::parser::Node& node);
    FmtReg FormatGenericOption(const buffers::parser::Node& node);
    FmtReg FormatExpressionOperatorType(const buffers::parser::Node& node);
    FmtReg FormatExpression(size_t node_id);
    FmtReg FormatLeaf(const buffers::parser::Node& node);
    FmtReg FormatUnimplemented(const buffers::parser::Node& node);

    FmtReg FormatCommaList(const buffers::parser::Node& node);
    FmtReg FormatQualifiedName(const buffers::parser::Node& node);

    std::string WriteOutput() const;

   public:
    explicit Formatter(ParsedScript& parsed);

    size_t EstimateFormattedSize() const;
    std::string Format(const buffers::formatting::FormattingConfigT& config);
};

}  // namespace dashql
