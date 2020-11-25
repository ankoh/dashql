// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_ACTION_PLANNER_H_
#define INCLUDE_DASHQL_ACTION_PLANNER_H_

#include <unordered_map>
#include "dashql/program_diff.h"
#include "dashql/proto/session_generated.h"
#include "dashql/proto/action_generated.h"
#include "dashql/proto/syntax_generated.h"

namespace dashql {

/// The action planner
class ActionPlanner {
   protected:
    /// The next program text
    const std::string_view next_program_text_;
    /// The next program
    const sx::Program& next_program_;
    /// The previous plan (if any)
    const std::string_view prev_program_text_;
    /// The previous plan (if any)
    const proto::session::Plan* prev_plan_;
    /// The previous action status
    const std::unordered_map<uint32_t, proto::action::ActionStatus>& prev_action_status_;

    /// The diff between the programs
    std::vector<ProgramMatcher::DiffOp> diff_;
    /// The updated action graph
    proto::action::ActionGraphT action_graph_;

    /// Diff the two programs
    void DiffPrograms();
    /// Translate program canonically
    void TranslateProgramCanconically();
    /// Map the completed actions
    void MapCompletedActions();
    /// Invalidate the updates through the graph
    void PropagateUpdates();

  public:
    /// Constructor
    ActionPlanner(std::string_view next_program_text, const sx::Program& next_program, std::string_view prev_program_text, const proto::session::Plan* prev_plan, const std::unordered_map<uint32_t, proto::action::ActionStatus>& prev_status);

    /// Plan the new action graph
    void PlanActionGraph();
    /// Encode action graph
    flatbuffers::Offset<proto::action::ActionGraph> EncodeActionGraph(flatbuffers::FlatBufferBuilder& builder);
};

}  // namespace dashql

#endif  // INCLUDE_DASHQL_ACTION_PLANNER_H_
