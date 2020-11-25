#include "dashql/action_planner.h"
#include "dashql/proto/syntax_dashql_generated.h"

namespace dashql {

namespace sxd = dashql::proto::syntax_dashql;
using ActionType = proto::action::ActionType;

namespace {

const sx::Node* FindAttribute(const sx::Program& program, const sx::Node& origin, sx::AttributeKey key) {
    auto children_begin = origin.children_begin_or_value();
    auto children_count = origin.children_count();
    auto lb = children_begin;
    auto c = children_count;
    while (c > 0) {
        auto step = c / 2;
        auto iter = lb + step;
        auto n = program.nodes()->Get(iter);
        if (n->attribute_key() < key) {
            lb = iter + 1;
            c -= step + 1;
        } else {
            c = step;
        }
    }
    if (lb >= children_begin + children_count) {
        return nullptr;
    }
    auto n = program.nodes()->Get(lb);
    return (n->attribute_key() == key) ? n : nullptr;
}

template <typename F> void IterateChildren(const sx::Program& program, const sx::Node& origin, F fn) {
    auto children_begin = origin.children_begin_or_value();
    auto children_count = origin.children_count();
    auto nodes = program.nodes();
    for (unsigned i = 0; i < children_count; ++i) {
        auto node_id = children_begin + i;
        fn(i, node_id, *nodes->Get(node_id));
    }
}

}  // namespace

using ActionObj = proto::action::ActionT;

// Constructor
ActionPlanner::ActionPlanner(std::string_view next_program_text, const sx::Program& next_program,
                             std::string_view prev_program_text, const proto::session::Plan* prev_plan,
                             const std::unordered_map<uint32_t, proto::action::ActionStatus>& prev_status)
    : next_program_text_(next_program_text),
      next_program_(next_program),
      prev_program_text_(prev_program_text),
      prev_plan_(prev_plan),
      prev_action_status_(prev_status),
      diff_(),
      setup_actions_(),
      graph_actions_() {}

// // Translate a load statement
// ActionObj ActionPlanner::TranslateLoad(const sx::Statement& stmt) {
//     ActionObj action;
//     auto& root = *next_program_.nodes()->Get(stmt.root());
//     IterateChildren(next_program_, root, [&](size_t i, size_t node_id, const sx::Node& node) {
//         auto k = node.attribute_key();
//         if (k == sx::AttributeKey::DASHQL_STATEMENT_NAME) {
//             
//         } else if (k == sx::AttributeKey::DASHQL_LOAD_METHOD) {
//             switch (static_cast<sxd::LoadMethodType>(node.children_begin_or_value())) {
//                 case sxd::LoadMethodType::FILE:
//                     action.action_type = ActionType::LOAD_FILE;
//                     break;
//                 default:
//                     action.action_type = ActionType::LOAD_HTTP;
//                     break;
//             }
//             action.action_type = proto::action::ActionType::LOAD_DROP;
//         } else 
//     });
// }

// Diff programs
void ActionPlanner::DiffPrograms() {
    // No previous plan?
    // Then we emit all new statements as INSERT
    if (!prev_plan_) {
        for (unsigned i = 0; i < next_program_.statements()->size(); ++i) {
            diff_.emplace_back(DiffOpCode::INSERT, std::nullopt, i);
        }
        return;
    }

    // Compute the patience diff
    auto& prev_program = *prev_plan_->program();
    ProgramMatcher matcher{prev_program_text_, next_program_text_, prev_program, next_program_};
    diff_ = matcher.ComputeDiff();
}

/// Collect the statement options
std::string ActionPlanner::RenderStatementText(const sx::Statement& stmt) {
    // XXX Render the statement text
}

/// Collect the statement options
std::optional<proto::option::OptionListT> ActionPlanner::CollectOptions(const sx::Node& node) {
    // XXX Build option list
}

// Translate single statement
void ActionPlanner::TranslateStatement(size_t stmt_id) {
    auto& stmts = *next_program_.statements();
    auto& stmt = *stmts.Get(stmt_id);
    auto& stmt_root = *next_program_.nodes()->Get(stmt.root());

    auto& action = graph_actions_[stmt_id];
    action.origin_statement = stmt_id;

    switch (next_program_.nodes()->Get(stmt.root())->node_type()) {
        case sx::NodeType::OBJECT_DASHQL_VIZ:
            break;
        case sx::NodeType::OBJECT_DASHQL_LOAD:
            if (auto m = FindAttribute(next_program_, stmt_root, sx::AttributeKey::DASHQL_LOAD_METHOD)) {
                switch (m->node_type()) {
                    
                }
            }
            break;
        case sx::NodeType::OBJECT_DASHQL_EXTRACT:
            if (auto m = FindAttribute(next_program_, stmt_root, sx::AttributeKey::DASHQL_EXTRACT_METHOD)) {
            }
            break;
        case sx::NodeType::OBJECT_DASHQL_PARAMETER:
            if (auto m = FindAttribute(next_program_, stmt_root, sx::AttributeKey::DASHQL_PARAMETER_TYPE)) {
            }
            break;
        case sx::NodeType::OBJECT_DASHQL_QUERY:
        default:
            // Failed to map the root node of a statement to an action
            assert(false);
    }
}

// Translate statements
void ActionPlanner::TranslateStatements() {
    auto& stmts = *next_program_.statements();
    graph_actions_.resize(stmts.size());

    // Translate statements to actions as if there all statements were new
    for (unsigned stmt_id = 0; stmt_id < stmts.size(); ++stmt_id) {
        TranslateStatement(stmt_id);
    }

    // Store dependencies
    auto& deps = *next_program_.dependencies();
    for (unsigned dep_id = 0; dep_id < deps.size(); ++dep_id) {
        auto& dep = *deps.Get(dep_id);
        graph_actions_[dep.source_statement()].required_for.push_back(dep.target_statement());
        graph_actions_[dep.target_statement()].depends_on.push_back(dep.source_statement());
    }
}

void ActionPlanner::MapPreviousActions() {
    // TODO
}

void ActionPlanner::PropagateUpdates() {
    // TODO
}

// Plan the new action graph
void ActionPlanner::PlanActionGraph() {
    DiffPrograms();
    TranslateStatements();
    MapPreviousActions();
    PropagateUpdates();
}

// Encode action graph
flatbuffers::Offset<proto::action::ActionGraph> ActionPlanner::EncodeActionGraph(
    flatbuffers::FlatBufferBuilder& builder) {
    // Pack setup actions
    std::vector<flatbuffers::Offset<proto::action::Action>> setup_actions;
    for (auto& a : setup_actions_) {
        setup_actions.push_back(proto::action::Action::Pack(builder, &a));
    }
    // Pack the graph actions
    auto setup_actions_vec = builder.CreateVector(setup_actions);
    std::vector<flatbuffers::Offset<proto::action::Action>> graph_actions;
    for (auto& a : graph_actions_) {
        graph_actions.push_back(proto::action::Action::Pack(builder, &a));
    }
    auto graph_actions_vec = builder.CreateVector(graph_actions);
    // Build the graph
    proto::action::ActionGraphBuilder graph{builder};
    graph.add_setup(setup_actions_vec);
    graph.add_actions(graph_actions_vec);
    return graph.Finish();
}

}  // namespace dashql
