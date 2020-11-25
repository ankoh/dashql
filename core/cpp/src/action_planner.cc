#include "dashql/action_planner.h"

namespace dashql {

// Constructor
ActionPlanner::ActionPlanner(std::string_view next_program_text, const sx::Program& next_program, std::string_view prev_program_text, const proto::session::Plan* prev_plan, const std::unordered_map<uint32_t, proto::action::ActionStatus>& prev_status)
    : next_program_text_(next_program_text), next_program_(next_program), prev_program_text_(prev_program_text), prev_plan_(prev_plan), prev_action_status_(prev_status), diff_(), action_graph_() {}

// Diff programs
void ActionPlanner::DiffPrograms() {
    // No previous plan?
    // Then we emit all new statements as DiffOp::CREATE
    if (!prev_plan_) {
        for (unsigned i = 0; i < next_program_.statements()->size(); ++i) {
            diff_.emplace_back(DiffOpCode::INSERT, std::nullopt, i);
        }
        return;
    }

    // Compute the diff
    auto& prev_program = *prev_plan_->program();
    ProgramMatcher matcher{prev_program_text_, next_program_text_, prev_program, next_program_};
    diff_ = matcher.ComputeDiff();
}

// Translate program canonically
void ActionPlanner::TranslateProgramCanconically() {
    // TODO
}

void ActionPlanner::MapCompletedActions() {
    // TODO
}

void ActionPlanner::PropagateUpdates() {
    // TODO
}


// Plan the new action graph
void ActionPlanner::PlanActionGraph() {
    DiffPrograms();
    TranslateProgramCanconically();
    MapCompletedActions();
    PropagateUpdates();
}

// Encode action graph
flatbuffers::Offset<proto::action::ActionGraph> ActionPlanner::EncodeActionGraph(flatbuffers::FlatBufferBuilder& builder) {
    return proto::action::ActionGraph::Pack(builder, &action_graph_);
}

}
