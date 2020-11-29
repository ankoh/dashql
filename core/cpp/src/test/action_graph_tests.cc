#include "dashql/test/action_graph_tests.h"

#include <cstdint>
#include <iostream>
#include <regex>
#include <sstream>
#include <stack>
#include <unordered_set>

#include "dashql/proto/action_generated.h"
#include "dashql/proto/syntax_dashql_generated.h"
#include "dashql/proto/syntax_generated.h"
#include "dashql/proto/syntax_sql_generated.h"

namespace dashql {
namespace test {

void EncodeActionTest(pugi::xml_node& root, const ProgramInstance& program, const proto::action::ActionGraphT& graph) {
    auto setup_action_type_tt = proto::action::SetupActionTypeTypeTable();
    auto program_action_type_tt = proto::action::ProgramActionTypeTypeTable();
    auto action_status_tt = proto::action::ActionStatusTypeTable();

    std::string program_text{program.program_text()};
    root.append_child("text").last_child().set_value(program_text.c_str());

    auto setup_actions = root.append_child("setup");
    for (auto& action : graph.setup_actions) {
        auto s = setup_actions.append_child();
        s.append_attribute("action_type") = setup_action_type_tt->names[static_cast<uint16_t>(action->action_type)];
        s.append_attribute("action_status") =
            action_status_tt->names[static_cast<uint16_t>(action->action_status->status_code())];
        s.append_attribute("target_id") = action->target_id;
        s.append_attribute("target_name_qualified") = action->target_name_qualified.c_str();
        s.append_attribute("target_name_short") = action->target_name_short.c_str();
    }

    auto program_actions = root.append_child("program");
    for (auto& action : graph.program_actions) {
        auto p = program_actions.append_child();
        p.append_attribute("action_type") = program_action_type_tt->names[static_cast<uint16_t>(action->action_type)];
        p.append_attribute("action_status") =
            action_status_tt->names[static_cast<uint16_t>(action->action_status->status_code())];
        auto depends_on = p.append_child("depends_on");
        for (auto v : action->depends_on) {
            depends_on.append_child("dep").append_attribute("id").set_value(v);
        }
        auto required_for = p.append_child("required_for");
        for (auto v : action->required_for) {
            depends_on.append_child("req").append_attribute("id").set_value(v);
        }
        p.append_attribute("origin_statement") = action->origin_statement;
        p.append_attribute("target_id") = action->target_id;
        p.append_attribute("target_name_qualified") = action->target_name_qualified.c_str();
        p.append_attribute("target_name_short") = action->target_name_short.c_str();
        p.append_child("script").last_child().set_value(action->script.c_str());
    }
}

}  // namespace test
}  // namespace dashql
