#include "dashql/test/analyzer_tests.h"

#include <cstdint>
#include <iostream>
#include <regex>
#include <sstream>
#include <stack>
#include <unordered_set>

#include "dashql/proto_generated.h"
#include "dashql/test/grammar_tests.h"

namespace dashql {
namespace test {

void AnalyzerTest::EncodePlan(pugi::xml_node& root, const ProgramInstance& instance, const proto::action::ActionGraphT& graph) {
    auto setup_action_type_tt = proto::action::SetupActionTypeTypeTable();
    auto program_action_type_tt = proto::action::ProgramActionTypeTypeTable();
    auto action_status_tt = proto::action::ActionStatusCodeTypeTable();
    auto parameter_type_tt = proto::webdb::SQLTypeIDTypeTable();

    std::string program_text{instance.program_text()};
    root.append_child("text").text().set(program_text.c_str());

    auto params = root.append_child("parameters");
    for (auto& param: instance.parameter_values()) {
        auto type_str = param.value.PrintType();
        auto value_str = param.value.PrintValue();
        auto p = params.append_child("parameter");
        p.append_attribute("statement").set_value(param.statement_id);
        p.append_attribute("type").set_value(type_str.c_str());
        p.append_attribute("value").set_value(value_str.c_str());
    }

    auto patch = root.append_child("evaluations");
    instance.evaluated_nodes().IterateValues([&](size_t k, const ProgramInstance::NodeValue& val) {
        auto e = patch.append_child("eval");
        if (!val.value) {
            e.append_attribute("value").set_value("NULL");
        } else {
            auto t = val.value->PrintType();
            auto v = val.value->PrintValue();
            e.append_attribute("type").set_value(t.c_str());
            e.append_attribute("value").set_value(v.c_str());
        }
        EncodeLocation(e, instance.program().nodes[val.node_id].location(), instance.program_text());
    });

    auto g = root.append_child("graph");
    g.append_attribute("next_object_id").set_value(graph.next_object_id);
    auto setup_actions = g.append_child("setup");
    for (auto& action : graph.setup_actions) {
        auto s = setup_actions.append_child("action");
        s.append_attribute("type") = setup_action_type_tt->names[static_cast<uint16_t>(action->action_type)];
        s.append_attribute("status") = action_status_tt->names[static_cast<uint16_t>(action->action_status_code)];
        s.append_attribute("object_id") = action->object_id;
        auto t = s.append_child("target");
        t.append_attribute("name_qualified") = action->target_name_qualified.c_str();
        t.append_attribute("name_short") = action->target_name_short.c_str();
    }

    auto program_actions = g.append_child("program");
    for (auto& action : graph.program_actions) {
        auto p = program_actions.append_child("action");
        p.append_attribute("id") = action->origin_statement;
        p.append_attribute("type") = program_action_type_tt->names[static_cast<uint16_t>(action->action_type)];
        p.append_attribute("status") = action_status_tt->names[static_cast<uint16_t>(action->action_status_code)];
        p.append_attribute("object_id") = action->object_id;
        auto t = p.append_child("target");
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
