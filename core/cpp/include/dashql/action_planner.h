// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_ACTION_PLANNER_H_
#define INCLUDE_DASHQL_ACTION_PLANNER_H_

#include <unordered_map>

#include "dashql/common/expected.h"
#include "dashql/program_diff.h"
#include "dashql/proto/action_generated.h"
#include "dashql/proto/session_generated.h"
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
    /// The parameter mapping (qualified name -> value)
    const std::unordered_map<std::string_view, std::string_view>& parameter_values_;

    /// The diff between the programs
    std::vector<ProgramMatcher::DiffOp> diff_;
    /// The setup actions
    std::vector<proto::action::ActionT> setup_actions_;
    /// The graph actions
    std::vector<proto::action::ActionT> graph_actions_;

    /// Diff the two programs
    Signal DiffPrograms();
    /// Collect all root options as list
    Signal EvaluateOptions(const sx::Node& node);
    /// Render the statement text (substitute parameters)
    Expected<std::string> RenderStatementText(size_t stmt_id);
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
    ActionPlanner(std::string_view next_program_text, const sx::Program& next_program,
                  std::string_view prev_program_text, const proto::session::Plan* prev_plan,
                  const std::unordered_map<uint32_t, proto::action::ActionStatus>& prev_status,
                  const std::unordered_map<std::string_view, std::string_view>& parameter_values);

    /// Plan the new action graph
    void PlanActionGraph();
    /// Encode action graph
    flatbuffers::Offset<proto::action::ActionGraph> EncodeActionGraph(flatbuffers::FlatBufferBuilder& builder);
};

}  // namespace dashql

#endif  // INCLUDE_DASHQL_ACTION_PLANNER_H_
