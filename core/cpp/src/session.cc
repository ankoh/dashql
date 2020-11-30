#include "dashql/session.h"

#include "dashql/action_planner.h"
#include "dashql/parser/parser_driver.h"
#include "dashql/proto/session_generated.h"
#include "dashql/proto/syntax_generated.h"

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
    // Store the old program instance
    auto prev_program = planned_program_.get();
    auto prev_graph = planned_graph_.get();

    // Build the new program instance
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

    // Encode the plan result
    // XXX
    return ErrorCode::NOT_IMPLEMENTED;
}

}  // namespace dashql
