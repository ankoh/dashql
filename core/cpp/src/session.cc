#include "dashql/session.h"

#include "dashql/action_planner.h"
#include "dashql/parser/parser_driver.h"
#include "dashql/proto_generated.h"

using namespace dashql;
namespace fb = flatbuffers;
namespace sx = proto::syntax;

namespace dashql {

static constexpr size_t PLANNER_LOG_SIZE = 64;
static constexpr size_t PLANNER_LOG_MASK = PLANNER_LOG_SIZE - 1;
static_assert((PLANNER_LOG_SIZE & PLANNER_LOG_MASK) == 0, "PLANNER_LOG_SIZE must be a power of 2");

/// Constructor
Session::Session() : database_(), database_connection_(), volatile_program_text_(), volatile_program_(), planned_program_(), planned_graph_(), planner_log_(), planner_log_writer_() {
    database_connection_ = database_.Connect();

    planner_log_.reserve(PLANNER_LOG_SIZE);
    for (unsigned i = 0; i < PLANNER_LOG_SIZE; ++i)
        planner_log_.push_back(nullptr);
}

/// Evaluate a program
ExpectedBuffer<proto::syntax::Program> Session::ParseProgram(std::string_view text) {
    // Parse the program
    volatile_program_text_ = std::make_shared<std::string>(text);
    volatile_program_ = parser::ParserDriver::Parse(text);

    // Encode the program
    flatbuffers::FlatBufferBuilder builder{text.size()};
    auto program_ofs = sx::Program::Pack(builder, volatile_program_.get());
    builder.Finish(program_ofs);
    return builder.Release();
}

/// Evaluate a program
ExpectedBuffer<proto::session::Plan> Session::PlanProgram() {
    // Get previous and next program
    auto prev_program = planned_program_.get();
    auto prev_graph = planned_graph_.get();
    auto next_program = std::make_unique<ProgramInstance>(std::move(volatile_program_text_), std::move(volatile_program_));

    // Evaluate partially
    if (auto ok = next_program->EvaluatePartially(database_); !ok) {
        return ok.ReleaseError();
    }

    // Plan the action graph
    ActionPlanner action_planner{*next_program, prev_program, prev_graph};
    action_planner.PlanActionGraph();
    auto next_graph = action_planner.Finish();

    // If successfull, replace currently planned program & graph
    planner_log_[(planner_log_writer_++) & PLANNER_LOG_MASK] = std::move(planned_program_);
    planned_program_ = move(next_program);
    planned_graph_ = move(next_graph);

    // Pack action graph
    flatbuffers::FlatBufferBuilder builder;
    auto graph = proto::action::ActionGraph::Pack(builder, planned_graph_.get());

    // Pack parameters
    std::vector<flatbuffers::Offset<proto::session::ParameterValue>> param_offsets;
    param_offsets.reserve(planned_program_->parameter_values().size());
    for (auto& param: planned_program_->parameter_values()) {
        auto ofs = proto::session::ParameterValue::Pack(builder, param.get());
        param_offsets.push_back(ofs);
    }
    auto param_vec = builder.CreateVector(param_offsets);

    // Pack patch
    auto& patch = planned_program_->patch();
    auto patch_ofs = proto::syntax::ProgramPatch::Pack(builder, patch.get());

    // Encode the plan result
    proto::session::PlanBuilder plan{builder};
    plan.add_action_graph(graph);
    plan.add_parameters(param_vec);
    plan.add_program_evaluation(patch_ofs);
    auto plan_ofs = plan.Finish();
    builder.Finish(plan_ofs);
    return builder.Release();
}

}  // namespace dashql
