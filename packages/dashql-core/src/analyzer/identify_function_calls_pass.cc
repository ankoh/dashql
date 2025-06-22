#include "dashql/analyzer/identify_function_calls_pass.h"

#include <variant>

#include "dashql/analyzer/analyzer.h"
#include "dashql/buffers/index_generated.h"

namespace dashql {

IdentifyFunctionCallsPass::IdentifyFunctionCallsPass(AnalysisState& state) : PassManager::LTRPass(state) {}

void IdentifyFunctionCallsPass::Prepare() {}

using AttributeKey = buffers::parser::AttributeKey;
using BinaryExpressionFunction = buffers::algebra::BinaryExpressionFunction;
using ComparisonFunction = buffers::algebra::ComparisonFunction;
using ExpressionOperator = buffers::parser::ExpressionOperator;
using LiteralType = buffers::algebra::LiteralType;
using Node = buffers::parser::Node;
using NodeType = buffers::parser::NodeType;

void IdentifyFunctionCallsPass::Visit(std::span<const buffers::parser::Node> morsel) {
    size_t morsel_offset = morsel.data() - state.ast.data();
    for (size_t i = 0; i < morsel.size(); ++i) {
        const buffers::parser::Node& node = morsel[i];
        NodeID node_id = morsel_offset + i;

        if (node.node_type() == NodeType::OBJECT_SQL_FUNCTION_EXPRESSION) {
            auto children = state.ast.subspan(node.children_begin_or_value(), node.children_count());
            auto attrs = state.attribute_index.Load(children);

            AnalyzedScript::Expression::FunctionCallExpression func_call{
                .function_name = buffers::parser::KnownFunction::CURRENT_TIME,
                .function_call_modifiers = 0,
                .arguments = {},
            };

            // Check type modifers
            func_call.function_call_modifiers |=
                (attrs[buffers::parser::AttributeKey::SQL_FUNCTION_ARGUMENTS_STAR] != nullptr)
                    ? static_cast<uint8_t>(buffers::algebra::FunctionCallModifier::ARGS_STAR)
                    : 0;
            func_call.function_call_modifiers |=
                (attrs[buffers::parser::AttributeKey::SQL_FUNCTION_ALL] != nullptr)
                    ? static_cast<uint8_t>(buffers::algebra::FunctionCallModifier::ARGS_ALL)
                    : 0;
            func_call.function_call_modifiers |=
                (attrs[buffers::parser::AttributeKey::SQL_FUNCTION_DISTINCT] != nullptr)
                    ? static_cast<uint8_t>(buffers::algebra::FunctionCallModifier::ARGS_DISTINCT)
                    : 0;
            func_call.function_call_modifiers |=
                (attrs[buffers::parser::AttributeKey::SQL_FUNCTION_VARIADIC] != nullptr)
                    ? static_cast<uint8_t>(buffers::algebra::FunctionCallModifier::VARIADIC)
                    : 0;
            func_call.function_call_modifiers |=
                (attrs[buffers::parser::AttributeKey::SQL_FUNCTION_OVER] != nullptr)
                    ? static_cast<uint8_t>(buffers::algebra::FunctionCallModifier::OVER)
                    : 0;
            func_call.function_call_modifiers |=
                (attrs[buffers::parser::AttributeKey::SQL_FUNCTION_WITHIN_GROUP] != nullptr)
                    ? static_cast<uint8_t>(buffers::algebra::FunctionCallModifier::WITHIN_GROUP)
                    : 0;

            // Must have a function name, read it
            auto func_name_node = attrs[buffers::parser::AttributeKey::SQL_FUNCTION_NAME];
            assert(func_name_node != nullptr);
            auto func_name_node_id = static_cast<uint32_t>(func_name_node - state.parsed.nodes.data());
            switch (func_name_node->node_type()) {
                // Is a known function?
                case buffers::parser::NodeType::ENUM_SQL_KNOWN_FUNCTION: {
                    func_call.function_name =
                        static_cast<buffers::parser::KnownFunction>(func_name_node->children_begin_or_value());
                    break;
                }
                // Is a qualified function name?
                case buffers::parser::NodeType::ARRAY: {
                    auto func_name = state.ReadQualifiedFunctionName(func_name_node);
                    assert(func_name.has_value());
                    func_call.function_name = func_name.value();
                    break;
                }
                default: {
                    assert(false && "unexpected name function name node");
                    break;
                }
            }

            // Are there function arguments?
            if (auto func_args_node = attrs[buffers::parser::AttributeKey::SQL_FUNCTION_ARGUMENTS]) {
                assert(func_args_node->node_type() == sx::parser::NodeType::ARRAY);
                auto args = state.analyzed->function_arguments.EmplaceBackN(func_args_node->children_count());

                // Unpack the function arguments
                for (size_t i = 0; i < func_args_node->children_count(); ++i) {
                    auto func_arg_node_id = func_args_node->children_begin_or_value() + i;
                    args[i].ast_node_id = func_arg_node_id;

                    // Get function arguments
                    auto& func_arg_node = state.ast[func_arg_node_id];
                    assert(func_arg_node.node_type() == sx::parser::NodeType::OBJECT_SQL_FUNCTION_ARG);
                    auto func_arg_attr_span =
                        state.ast.subspan(func_arg_node.children_begin_or_value(), func_arg_node.children_count());
                    auto func_arg_attrs = state.attribute_index.Load(func_arg_attr_span);

                    // Always has a value, read it
                    auto* arg_value = func_arg_attrs[buffers::parser::AttributeKey::SQL_FUNCTION_ARG_VALUE];
                    assert(arg_value != nullptr);
                    args[i].value_ast_node_id = arg_value - state.ast.data();

                    // Has a name?
                    if (auto* arg_name = func_arg_attrs[buffers::parser::AttributeKey::SQL_FUNCTION_ARG_NAME]) {
                        assert(arg_name->node_type() == buffers::parser::NodeType::NAME);
                        args[i].name = state.scanned.GetNames().At(arg_name->children_begin_or_value());
                    }
                }

                func_call.arguments = args;
            }

            auto& n = state.analyzed->AddExpression(node_id, node.location(), std::move(func_call));
            state.expression_index[node_id] = &n;
        }
    }
}

void IdentifyFunctionCallsPass::Finish() {}

}  // namespace dashql
