// Copyright (c) 2020 The DashQL Authors

#include "dashql/action_planner.h"

#include <sstream>

#include "dashql/parser/parser_driver.h"
#include "dashql/parser/scanner.h"
#include "dashql/program_instance.h"
#include "dashql/program_matcher.h"
#include "flatbuffers/flatbuffers.h"
#include "gtest/gtest.h"

using namespace std;
using namespace dashql;
namespace fb = flatbuffers;
using ActionT = proto::action::ActionT;
using ActionType = proto::action::ActionType;

namespace {

class ActionPlannerProxy : public ActionPlanner {
   public:
    /// Constructor
    ActionPlannerProxy(const ProgramInstance& next_program, const ProgramInstance* prev_program,
                       const proto::action::ActionGraph* prev_action_graph,
                       const std::unordered_map<uint32_t, proto::action::ActionStatus>& prev_action_status)
        : ActionPlanner(next_program, prev_program, prev_action_graph, prev_action_status) {}
};

// If prev_actions is left blank, the test will generate the previous actions
struct ActionPlannerTest {
    std::string_view test_name;
    std::string_view prev_text = {};
    std::string_view next_text = {};
    std::vector<std::pair<std::string_view, proto::session::ParameterValueT>> prev_params = {};
    std::vector<std::pair<std::string_view, proto::session::ParameterValueT>> next_params = {};
    std::vector<proto::action::ActionT> prev_actions = {};
    std::vector<proto::action::ActionT> next_actions = {};

    /// Constructor
    ActionPlannerTest(const char* name)
        : test_name(name) {}

    ActionPlannerTest& WithPrevText(const char* t) { prev_text = t; return *this; }
    ActionPlannerTest& WithNextText(const char* t) { next_text = t; return *this; }
    ActionPlannerTest& WithPrevParam(const char* p, proto::session::ParameterValueT v) { prev_params.push_back({p, v}); return *this; }
    ActionPlannerTest& WithNextParam(const char* p, proto::session::ParameterValueT v) { next_params.push_back({p, v}); return *this; }
    ActionPlannerTest& WithPrevAction(proto::action::ActionT a) { prev_actions.push_back(a); return *this; }
    ActionPlannerTest& Expect(proto::action::ActionT a) { next_actions.push_back(a); return *this; }

    friend std::ostream& operator<<(std::ostream& out, const ActionPlannerTest& param) {
        return out << param.test_name;
    }

};
class ActionPlannerTestSuite: public ::testing::TestWithParam<ActionPlannerTest> {};

TEST_P(ActionPlannerTestSuite, CompareGraphs) {

}

ActionT Action(ActionType type, uint32_t origin, std::vector<uint32_t> depends_on, std::vector<uint32_t> required_for, uint32_t target_id, std::string target_name_qualified, std::string target_name_short, std::string script) {
    ActionT a;
    a.action_type = type;
    a.origin_statement = origin;
    a.depends_on = std::move(depends_on);
    a.required_for = std::move(required_for);
    a.target_id = target_id;
    a.target_name_qualified = target_name_qualified;
    a.target_name_short = target_name_short;
    a.script = script;
    return a;
}

INSTANTIATE_TEST_SUITE_P(ActionPlanner, ActionPlannerTestSuite, ::testing::Values(
    ActionPlannerTest("keep_simple")
        .WithPrevText("SELECT 1 INTO foo")
        .WithNextText("SELECT 1 INTO foo")
        .Expect(Action(ActionType::TABLE_CREATE, 0, {}, {}, 0, "global.foo", "foo", "SELECT 1 INTO foo"))
));

}  // namespace
