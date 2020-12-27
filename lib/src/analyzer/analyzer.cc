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
    auto next_program = std::make_unique<ProgramInstance>(std::move(volatile_program_text_), std::move(volatile_program_), move(params.values));

    // XXX Analyze the program semantics and evaluate partially with parameters

    // If semantics are ok, replace current program instance
    program_log_[(program_log_writer_++) & PLANNER_LOG_MASK] = std::move(program_instance_);
    program_instance_ = move(next_program);
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
