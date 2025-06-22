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
            auto [attr_star, attr_all, attr_distinct, attr_variadic, attr_over, attr_within_group, attr_name,
                  attr_args] =
                state.GetAttributes<AttributeKey::SQL_FUNCTION_ARGUMENTS_STAR, AttributeKey::SQL_FUNCTION_ALL,
                                    AttributeKey::SQL_FUNCTION_DISTINCT, AttributeKey::SQL_FUNCTION_VARIADIC,
                                    AttributeKey::SQL_FUNCTION_OVER, AttributeKey::SQL_FUNCTION_WITHIN_GROUP,
                                    AttributeKey::SQL_FUNCTION_NAME, AttributeKey::SQL_FUNCTION_ARGUMENTS>(node);

            AnalyzedScript::Expression::FunctionCallExpression func_call{
                .function_name = buffers::parser::KnownFunction::CURRENT_TIME,
                .function_call_modifiers = 0,
                .arguments = {},
            };

            // Check type modifers
            func_call.function_call_modifiers |=
                (attr_star) ? static_cast<uint8_t>(buffers::algebra::FunctionCallModifier::ARGS_STAR) : 0;
            func_call.function_call_modifiers |=
                (attr_all) ? static_cast<uint8_t>(buffers::algebra::FunctionCallModifier::ARGS_ALL) : 0;
            func_call.function_call_modifiers |=
                (attr_distinct) ? static_cast<uint8_t>(buffers::algebra::FunctionCallModifier::ARGS_DISTINCT) : 0;
            func_call.function_call_modifiers |=
                (attr_variadic) ? static_cast<uint8_t>(buffers::algebra::FunctionCallModifier::VARIADIC) : 0;
            func_call.function_call_modifiers |=
                (attr_over) ? static_cast<uint8_t>(buffers::algebra::FunctionCallModifier::OVER) : 0;
            func_call.function_call_modifiers |=
                (attr_within_group) ? static_cast<uint8_t>(buffers::algebra::FunctionCallModifier::WITHIN_GROUP) : 0;

            // Must have a function name, read it
            assert(attr_name != nullptr);
            auto func_name_node_id = static_cast<uint32_t>(attr_name - state.parsed.nodes.data());
            switch (attr_name->node_type()) {
                // Is a known function?
                case buffers::parser::NodeType::ENUM_SQL_KNOWN_FUNCTION: {
                    func_call.function_name =
                        static_cast<buffers::parser::KnownFunction>(attr_name->children_begin_or_value());
                    break;
                }
                // Is a qualified function name?
                case buffers::parser::NodeType::ARRAY: {
                    auto func_name = state.ReadQualifiedFunctionName(attr_name);
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
            if (attr_args) {
                assert(attr_args->node_type() == sx::parser::NodeType::ARRAY);
                auto args = state.analyzed->function_arguments.EmplaceBackN(attr_args->children_count());

                // Unpack the function arguments
                for (size_t i = 0; i < attr_args->children_count(); ++i) {
                    auto func_arg_node_id = attr_args->children_begin_or_value() + i;
                    args[i].ast_node_id = func_arg_node_id;

                    // Get function arguments
                    auto& func_arg_node = state.ast[func_arg_node_id];
                    assert(func_arg_node.node_type() == sx::parser::NodeType::OBJECT_SQL_FUNCTION_ARG);
                    auto [arg_value, arg_name] =
                        state.GetAttributes<AttributeKey::SQL_FUNCTION_ARG_VALUE, AttributeKey::SQL_FUNCTION_ARG_NAME>(
                            func_arg_node);

                    // Always has a value, read it
                    assert(arg_value != nullptr);
                    args[i].value_ast_node_id = arg_value - state.ast.data();

                    // Has a name?
                    if (arg_name) {
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
