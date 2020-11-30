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
#include "dashql/proto/syntax_dashql_generated.h"

namespace dashql {
namespace test {

void ActionGraphTest::EncodeActionGraph(pugi::xml_node& root, const ProgramInstance& program, const proto::action::ActionGraphT& graph) {
    auto setup_action_type_tt = proto::action::SetupActionTypeTypeTable();
    auto program_action_type_tt = proto::action::ProgramActionTypeTypeTable();
    auto action_status_tt = proto::action::ActionStatusCodeTypeTable();
    auto parameter_type_tt = proto::syntax_dashql::ParameterTypeTypeTable();

    std::string program_text{program.program_text()};
    root.append_child("text").text().set(program_text.c_str());

    auto params = root.append_child("parameters");
    for (auto* param: program.parameter_values()) {
        if (!param) continue;
        auto p = params.append_child("parameter");
        p.append_attribute("type").set_value(parameter_type_tt->names[static_cast<uint16_t>(param->type)]);
        p.append_attribute("statement").set_value(param->origin_statement);
        p.append_attribute("value").set_value(param->value.c_str());
    }

    auto g = root.append_child("graph");
    g.append_attribute("next_target_id").set_value(graph.next_target_id);
    auto setup_actions = g.append_child("setup");
    for (auto& action : graph.setup_actions) {
        auto s = setup_actions.append_child("action");
        s.append_attribute("type") = setup_action_type_tt->names[static_cast<uint16_t>(action->action_type)];
        if (action->action_status) {
            s.append_attribute("status") =
                action_status_tt->names[static_cast<uint16_t>(action->action_status->status_code())];
        }
        auto t = s.append_child("target");
        t.append_attribute("id") = action->target_id;
        t.append_attribute("name_qualified") = action->target_name_qualified.c_str();
        t.append_attribute("name_short") = action->target_name_short.c_str();
    }

    auto program_actions = g.append_child("program");
    for (auto& action : graph.program_actions) {
        auto p = program_actions.append_child("action");
        p.append_attribute("id") = action->origin_statement;
        p.append_attribute("type") = program_action_type_tt->names[static_cast<uint16_t>(action->action_type)];
        if (action->action_status) {
            p.append_attribute("status") =
                action_status_tt->names[static_cast<uint16_t>(action->action_status->status_code())];
        }
        auto t = p.append_child("target");
        t.append_attribute("id") = action->target_id;
        t.append_attribute("name_qualified") = action->target_name_qualified.c_str();
        t.append_attribute("name_short") = action->target_name_short.c_str();
        if (!action->depends_on.empty()) {
            auto depends_on = p.append_child("depends_on");
            for (auto v : action->depends_on) {
                depends_on.append_child("ref").append_attribute("action").set_value(v);
            }
        }
        if (!action->required_for.empty()) {
            auto required_for = p.append_child("required_for");
            for (auto v : action->required_for) {
                required_for.append_child("ref").append_attribute("action").set_value(v);
            }
        }
        if (!action->script.empty()) {
            p.append_child("script").text().set(action->script.c_str());
        }
    }
}

}  // namespace test
}  // namespace dashql
