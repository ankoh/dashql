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
    const proto::action::ActionGraphT* prev_action_graph_;

    /// The diff between the programs
    std::vector<ProgramMatcher::DiffOp> diff_;
    /// The new action graph
    std::unique_ptr<proto::action::ActionGraphT> action_graph_;

    /// Diff the two programs
    Signal DiffPrograms();
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
                  const proto::action::ActionGraphT* prev_action_graph);

    /// Plan the new action graph
    void PlanActionGraph();
    /// Get the action graph
    std::unique_ptr<proto::action::ActionGraphT> Finish();
};

}  // namespace dashql

#endif  // INCLUDE_DASHQL_ACTION_PLANNER_H_
