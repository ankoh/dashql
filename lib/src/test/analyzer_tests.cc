#include "dashql/test/analyzer_tests.h"

#include <cstdint>
#include <fstream>
#include <iostream>
#include <regex>
#include <sstream>
#include <stack>
#include <unordered_set>

#include "dashql/analyzer/viz_statement.h"
#include "dashql/proto_generated.h"
#include "dashql/test/grammar_tests.h"

namespace dashql {
namespace test {

void AnalyzerTest::EncodePlan(pugi::xml_node root, const ProgramInstance& instance,
                              const proto::action::ActionGraphT& graph) {
    auto& nodes = instance.program().nodes;
    auto& text = instance.program_text();

    auto add_raw_attr = [&](pugi::xml_node node, const char* attr, size_t node_id) {
        if (node_id < viz::INVALID_NODE_ID) {
            std::string text{instance.TextAt(nodes[node_id].location())};
            node.append_attribute(attr).set_value(text.c_str());
        }
    };

    auto add_strvec_attr = [&](pugi::xml_node node, const char* attr, const std::vector<std::string>& s) {
        if (s.empty()) return;
        std::stringstream ss;
        for (unsigned i = 0; i < s.size(); ++i) {
            if (i > 0) ss << ",";
            ss << s[i] << std::endl;
        }
        auto str = ss.str();
        node.append_attribute(attr).set_value(str.c_str());
    };

    auto setup_action_type_tt = proto::action::SetupActionTypeTypeTable();
    auto program_action_type_tt = proto::action::ProgramActionTypeTypeTable();
    auto action_status_tt = proto::action::ActionStatusCodeTypeTable();
    auto parameter_type_tt = proto::webdb::SQLTypeIDTypeTable();
    auto viz_component_type_tt = proto::syntax::VizComponentTypeTypeTable();

    std::string program_text{instance.program_text()};
    root.append_child("text").text().set(program_text.c_str());

    auto params = root.append_child("parameters");
    for (auto& param : instance.parameter_values()) {
        auto type_str = param.value.PrintType();
        auto value_str = param.value.PrintValue();
        auto p = params.append_child("parameter");
        p.append_attribute("statement").set_value(param.statement_id);
        p.append_attribute("type").set_value(type_str.c_str());
        p.append_attribute("value").set_value(value_str.c_str());
    }

    auto patch = root.append_child("evaluations");
    instance.evaluated_nodes().IterateValues([&](size_t /*node_id*/, const ProgramInstance::NodeValue& node_value) {
        auto e = patch.append_child("eval");
        auto t = node_value.value.PrintType();
        auto v = node_value.value.PrintValue();
        e.append_attribute("type").set_value(t.c_str());
        e.append_attribute("value").set_value(v.c_str());
        EncodeLocation(e, instance.program().nodes[node_value.root_node_id].location(), instance.program_text());
    });

    auto vizzes = root.append_child("visualizations");
    for (auto& viz : instance.viz_statements()) {
        auto v = vizzes.append_child("visualization");
        if (auto& title = viz->title(); title.has_value()) {
            std::string copy{*title};
            v.append_attribute("title").set_value(copy.c_str());
        }
        auto target = v.append_child("target");
        EncodeLocation(target, instance.program().nodes[viz->target_node_id()].location(), instance.program_text());
        if (auto pos = viz->specified_position()) {
            auto p = v.append_child("position");
            p.append_attribute("row") = pos->row();
            p.append_attribute("column") = pos->column();
            p.append_attribute("width") = pos->width();
            p.append_attribute("height") = pos->height();
        }
        auto c = v.append_child("components");
        for (auto& vizc : viz->components()) {
            auto vc = c.append_child("component");
            vc.append_attribute("type") = viz_component_type_tt->names[static_cast<size_t>(vizc->type())];
            if (auto& data = vizc->data(); data.has_value()) {
                auto d = vc.append_child("data");
                add_strvec_attr(d, "x", data->x);
                add_strvec_attr(d, "y", data->y);
                add_strvec_attr(d, "group", data->group);
                add_strvec_attr(d, "stack", data->stack);
                add_strvec_attr(d, "order", data->order);
                d.append_attribute("samples").set_value(data->samples);
            }
        }
    }

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
        p.append_attribute("origin") = action->origin_statement;
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

// Read an action status
proto::action::ActionStatusCode AnalyzerTest::GetActionStatus(std::string_view type) {
    auto tt = proto::action::ActionStatusCodeTypeTable();
    auto& names = tt->names;
    auto& num_elems = tt->num_elems;
    for (unsigned i = 0; i < num_elems; ++i) {
        if (type == std::string_view{names[i]}) return static_cast<proto::action::ActionStatusCode>(i);
    }
    return proto::action::ActionStatusCode::NONE;
}

// Read a parameter type
proto::syntax::ParameterType AnalyzerTest::GetParameterType(std::string_view type) {
    auto tt = proto::syntax::ParameterTypeTypeTable();
    auto& names = tt->names;
    auto& num_elems = tt->num_elems;
    for (unsigned i = 0; i < num_elems; ++i) {
        if (type == std::string_view{names[i]}) return static_cast<proto::syntax::ParameterType>(i);
    }
    return proto::syntax::ParameterType::NONE;
}

// Read a parameter
ParameterValue AnalyzerTest::GetParameter(const pugi::xml_node& node) {
    auto stmt = node.attribute("statement").as_int();
    auto value = node.attribute("value").as_string();
    auto type = node.attribute("type").as_string();
    auto v = Value::Parse(type, value);
    return {static_cast<size_t>(stmt), std::move(v)};
}

// The files
static std::unordered_map<std::string, std::vector<AnalyzerTest>> TEST_FILES;

/// Get the grammar tests
void AnalyzerTest::LoadTests(std::filesystem::path& source_dir) {
    auto spec_dir = source_dir / "test" / "analyzer" / "spec";

    std::cout << "Loading analyzer tests at: " << spec_dir << std::endl;

    for (auto& p : std::filesystem::directory_iterator(spec_dir)) {
        auto filename = p.path().filename().string();
        if (p.path().extension().string() != ".xml") continue;

        // Make sure that it's no template
        auto tpl = p.path();
        tpl.replace_extension();
        if (tpl.extension() == ".tpl") continue;

        // Open input stream
        std::ifstream in(p.path(), std::ios::in | std::ios::binary);
        if (!in) {
            std::cout << "[ SETUP    ] failed to read test file: " << filename << std::endl;
            continue;
        }

        // Parse xml document
        pugi::xml_document doc;
        doc.load(in);

        // Read tests
        std::vector<AnalyzerTest> tests;
        for (auto test : doc.children("test")) {
            // Create test
            tests.emplace_back();
            auto& t = tests.back();
            t.name = test.attribute("name").as_string();

            // Read all plans
            for (auto step : test.children("step")) {
                t.steps.emplace_back();
                auto& s = t.steps.back();
                // Read program text
                s.program_text = step.child("text").last_child().value();
                // Read parameters
                auto params = step.child("parameters");
                for (auto& param : params.children()) {
                    s.parameters.push_back(AnalyzerTest::GetParameter(param));
                }
                // Read full expected analyzer output
                pugi::xml_document expected;
                for (auto c : step.children()) {
                    expected.append_copy(c);
                }
                s.expected_output = std::move(expected);
                // Read setup action status codes
                for (auto p : step.child("graph").child("setup").children()) {
                    auto status_str = p.attribute("status").as_string();
                    auto status = AnalyzerTest::GetActionStatus(status_str);
                    s.setupActionStatusCodes.push_back(status);
                }
                // Read program action status codes
                for (auto p : step.child("graph").child("program").children()) {
                    auto status_str = p.attribute("status").as_string();
                    auto status = AnalyzerTest::GetActionStatus(status_str);
                    s.programActionStatusCodes.push_back(status);
                }
            }
        }

        std::cout << "[ SETUP    ] " << filename << ": " << tests.size() << " tests" << std::endl;

        // Register test
        TEST_FILES.insert({filename, move(tests)});
    }
}

/// Get the grammar tests
std::vector<const AnalyzerTest*> AnalyzerTest::GetTests(std::string_view filename) {
    std::string name{filename};
    auto iter = TEST_FILES.find(name);
    if (iter == TEST_FILES.end()) {
        return {};
    }
    std::vector<const AnalyzerTest*> tests;
    for (auto& test : iter->second) {
        tests.emplace_back(&test);
    }
    return tests;
}

}  // namespace test
}  // namespace dashql
