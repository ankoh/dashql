// Copyright (c) 2020 The DashQL Authors

#include "dashql/analyzer/analyzer.h"

#include "dashql/analyzer/action_planner.h"
#include "dashql/parser/parser_driver.h"
#include "dashql/proto_generated.h"
#include "duckdb/main/client_context.hpp"

using namespace dashql;
namespace fb = flatbuffers;
namespace sx = proto::syntax;

namespace dashql {

static constexpr size_t PLANNER_LOG_SIZE = 64;
static constexpr size_t PLANNER_LOG_MASK = PLANNER_LOG_SIZE - 1;
static_assert((PLANNER_LOG_SIZE & PLANNER_LOG_MASK) == 0, "PLANNER_LOG_SIZE must be a power of 2");

static std::unique_ptr<Analyzer> analyzer_instance = nullptr;

/// Get the static webdb instance
Analyzer& Analyzer::GetInstance() {
    if (analyzer_instance == nullptr) {
        analyzer_instance = std::make_unique<Analyzer>();
    }
    return *analyzer_instance;
}

/// Get the static webdb instance
void Analyzer::ResetInstance() {
    analyzer_instance.reset();
}

/// Constructor
Analyzer::Analyzer() : volatile_program_text_(), volatile_program_(), program_instance_(), program_log_(), program_log_writer_(), planned_program_(nullptr), planned_graph_() {
    program_log_.reserve(PLANNER_LOG_SIZE);
    for (unsigned i = 0; i < PLANNER_LOG_SIZE; ++i)
        program_log_.push_back(nullptr);
}

/// Evaluate a program
ExpectedBuffer<proto::syntax::Program> Analyzer::ParseProgram(std::string_view text) {
    // Parse the program
    volatile_program_text_ = std::make_shared<std::string>(text);
    volatile_program_ = parser::ParserDriver::Parse(text);

    // Encode the program
    flatbuffers::FlatBufferBuilder builder{text.size()};
    auto program_ofs = sx::Program::Pack(builder, volatile_program_.get());
    builder.Finish(program_ofs);
    return builder.Release();
}

/// Instantiate a program with parameters
Signal Analyzer::InstantiateProgram(proto::analyzer::ProgramParametersT& params) {
    // Create program instance
    auto next_instance = std::make_unique<ProgramInstance>(std::move(volatile_program_text_), std::move(volatile_program_), move(params.values));
    auto& program = next_instance->program();
    auto& parameter_values = next_instance->parameter_values();


    // Find all the column refs that occur in the statement
    std::unordered_set<size_t> visited_nodes;
    for (auto& dep : program.dependencies) {
        auto target = dep.target_statement();
        auto source = dep.source_statement();

        // We only interpolate column refs that refer to parameters for now
        if (dep.type() != sx::DependencyType::COLUMN_REF) continue;
        if (program.statements[source]->statement_type != sx::StatementType::PARAMETER) continue;
        if (!parameter_values[source]) continue;

        auto& target_root = program.nodes[program.statements[target]->root_node];
        auto& target_node = program.nodes[dep.target_node()];
        assert(target_node.node_type() == sx::NodeType::OBJECT_SQL_COLUMN_REF);

        // Do we have to check the parent?
        if (dep.target_node() == target_node.parent()) continue;
        if (visited_nodes.count(target_node.parent())) continue;
        visited_nodes.insert(target_node.parent());

        // Is the column ref a function argument?
        auto& parent_node = program.nodes[target_node.parent()];
        if (parent_node.attribute_key() == sx::AttributeKey::SQL_FUNCTION_ARGUMENTS)  {
            auto& func_node = program.nodes[parent_node.parent()];

            // Get function name
            auto* func_name_node = next_instance->FindAttribute(func_node, sx::AttributeKey::SQL_FUNCTION_NAME);
            assert(!!func_name_node);
            auto func_name = next_instance->GetStringValue(*func_name_node);
            assert(!!func_name);

            // Collect argument types
            auto& func_args_node = parent_node;
            std::vector<sx::NodeType> arg_types;
            arg_types.resize(func_args_node.children_count(), sx::NodeType::NONE);
            next_instance->IterateChildren(func_args_node, [&](auto idx, auto node_id, const auto& node) {
                arg_types[idx] = node.node_type();
            });

            // XXX Resolve function
            std::cout << "resolve function '" << *func_name << "' with " << arg_types.size() << " arguments";
        }
    }

    // If semantics are ok, replace current program instance
    program_log_[(program_log_writer_++) & PLANNER_LOG_MASK] = std::move(program_instance_);
    program_instance_ = move(next_instance);
    return Signal::OK();
}

/// Evaluate a program
ExpectedBuffer<proto::analyzer::Plan> Analyzer::PlanProgram() {
    // Get previous and next program
    auto prev_program = program_log_.empty() ? nullptr : program_log_.back().get();
    auto prev_graph = planned_graph_.get();
    auto next_program = program_instance_.get();

    // Plan the action graph
    ActionPlanner action_planner{*next_program, prev_program, prev_graph};
    action_planner.PlanActionGraph();
    planned_graph_ = action_planner.Finish();
    planned_program_ = next_program;

    // Pack action graph
    flatbuffers::FlatBufferBuilder builder;
    auto graph = proto::action::ActionGraph::Pack(builder, planned_graph_.get());

    // Pack parameters
    std::vector<flatbuffers::Offset<proto::analyzer::ParameterValue>> param_offsets;
    param_offsets.reserve(program_instance_->parameter_values().size());
    for (auto& param: program_instance_->parameter_values()) {
        auto ofs = proto::analyzer::ParameterValue::Pack(builder, param.get());
        param_offsets.push_back(ofs);
    }
    auto param_vec = builder.CreateVector(param_offsets);

    // Pack patch
    auto& patch = program_instance_->patch();
    auto patch_ofs = proto::syntax::ProgramPatch::Pack(builder, patch.get());

    // Encode the plan result
    proto::analyzer::PlanBuilder plan{builder};
    plan.add_action_graph(graph);
    plan.add_parameters(param_vec);
    plan.add_program_evaluation(patch_ofs);
    auto plan_ofs = plan.Finish();
    builder.Finish(plan_ofs);
    return builder.Release();
}

}  // namespace dashql
