// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_ACTION_PLANNER_H_
#define INCLUDE_DASHQL_ACTION_PLANNER_H_

#include <unordered_map>

#include "dashql/common/expected.h"
#include "dashql/program_instance.h"
#include "dashql/program_matcher.h"
#include "dashql/proto/action_generated.h"
#include "dashql/proto/session_generated.h"
#include "dashql/proto/syntax_generated.h"

namespace dashql {

/// The action planner
class ActionPlanner {
   protected:
    /// The next global target id
    static size_t global_target_counter_;
    /// The next program
    const ProgramInstance& next_program_;
    /// The previous program
    const ProgramInstance* prev_program_;
    /// The previous action graph
    const proto::action::ActionGraph* prev_action_graph_;
    /// The previous action status
    const std::unordered_map<uint32_t, proto::action::ActionStatus>& prev_action_status_;

    /// The diff between the programs
    std::vector<ProgramMatcher::DiffOp> diff_;
    /// The setup actions
    std::vector<proto::action::ActionT> setup_actions_;
    /// The graph actions
    std::vector<proto::action::ActionT> graph_actions_;
    /// The next action status
    std::vector<proto::action::ActionStatusCode> graph_action_status_;

    /// Diff the two programs
    Signal DiffPrograms();
    /// Translate single statement canonically
    Expected<proto::action::ActionT> TranslateStatement(size_t stmt_id);
    /// Translate statements canonically
    Signal TranslateStatements();
    /// Map any previously completed actions
    Signal MapPreviousActions();
    /// Propagate the updates through the graph
    Signal PropagateUpdates();

   public:
    /// Constructor
    ActionPlanner(const ProgramInstance& next_program,
                  const ProgramInstance* prev_program,
                  const proto::action::ActionGraph* prev_action_graph,
                  const std::unordered_map<uint32_t, proto::action::ActionStatus>& prev_action_status);

    /// Plan the new action graph
    void PlanActionGraph();
    /// Get the action graph
    flatbuffers::Offset<proto::action::ActionGraph> Encode(flatbuffers::FlatBufferBuilder& builder);
};

}  // namespace dashql

#endif  // INCLUDE_DASHQL_ACTION_PLANNER_H_
