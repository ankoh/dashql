// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_ANALYZER_ACTION_PLANNER_H_
#define INCLUDE_DASHQL_ANALYZER_ACTION_PLANNER_H_

#include <unordered_map>

#include "dashql/analyzer/program_instance.h"
#include "dashql/analyzer/program_matcher.h"
#include "dashql/common/expected.h"
#include "dashql/proto_generated.h"

namespace dashql {

/// The action planner
class ActionPlanner {
   protected:
    /// The next program
    const ProgramInstance& next_program_;
    /// The previous program
    const ProgramInstance* prev_program_;
    /// The previous action graph
    const proto::action::ActionGraphT* prev_action_graph_;

    /// The diff between the programs
    std::vector<ProgramMatcher::DiffOp> diff_;
    /// The reverse action mapping.
    /// Maps an action to the corresponding previous action if the diff was either KEEP, MOVE or UPDATE.
    /// We use this to figure out, whether the set of dependencies changed.
    std::vector<std::optional<size_t>> reverse_action_mapping_;
    /// The applicability of actions in the previous action graph.
    /// An action is applicable iff:
    ///  1) The diff is either KEEP or MOVE
    ///  2) The action is not affected by a parmeter update
    ///  3) The dependency set stayed the same
    ///  4) All dependencies are applicable
    std::vector<bool> action_applicability_;
    /// The new action graph
    std::unique_ptr<proto::action::ActionGraphT> action_graph_;

    /// Diff the two programs
    Signal DiffPrograms();
    /// Translate statements canonically
    Signal TranslateStatements();
    /// Identify applicable actions in the previous action graph
    Signal IdentifyApplicableActions();
    /// Migrate the previous action graph
    Signal MigrateActionGraph();

   public:
    /// Constructor
    ActionPlanner(const ProgramInstance& next_program, const ProgramInstance* prev_program = nullptr,
                  const proto::action::ActionGraphT* prev_action_graph = nullptr);

    /// Plan the new action graph
    void PlanActionGraph();
    /// Get the action graph
    std::unique_ptr<proto::action::ActionGraphT> Finish();
};

}  // namespace dashql

#endif  // INCLUDE_DASHQL_ANALYZER_ACTION_PLANNER_H_
