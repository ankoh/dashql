#include "dashql/test/analyzer_tests.h"

#include <cstdint>
#include <fstream>
#include <iostream>
#include <regex>
#include <sstream>
#include <stack>
#include <unordered_set>

#include "arrow/result.h"
#include "arrow/type.h"
#include "arrow/type_fwd.h"
#include "dashql/analyzer/stmt/viz_stmt.h"
#include "dashql/proto_generated.h"
#include "dashql/test/grammar_tests.h"

namespace dashql {
namespace test {

void AnalyzerTest::EncodePlan(pugi::xml_node root, const ProgramInstance& instance,
                              const proto::task::TaskGraphT& graph) {
    auto& nodes = instance.program().nodes;
    auto& text = instance.program_text();

    auto add_raw_attr = [&](pugi::xml_node node, const char* attr, size_t node_id) {
        if (node_id < INVALID_NODE_ID) {
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

    auto setup_task_type_tt = proto::task::SetupTaskTypeTypeTable();
    auto program_task_type_tt = proto::task::ProgramTaskTypeTypeTable();
    auto task_status_tt = proto::task::TaskStatusCodeTypeTable();
    auto input_type_tt = proto::sql::SQLTypeIDTypeTable();
    auto viz_component_type_tt = proto::syntax::VizComponentTypeTypeTable();

    std::string program_text{instance.program_text()};
    root.append_child("text").text().set(program_text.c_str());

    auto params = root.append_child("inputs");
    for (auto& param : instance.input_values()) {
        auto type_str = param.value->type->ToString();
        auto value_str = param.value->ToString();
        auto p = params.append_child("input");
        p.append_attribute("statement").set_value(param.statement_id);
        p.append_attribute("type").set_value(type_str.c_str());
        p.append_attribute("value").set_value(value_str.c_str());
    }

    auto patch = root.append_child("evaluations");
    instance.evaluated_nodes().IterateValues([&](size_t /*node_id*/, const ProgramInstance::NodeValue& node_value) {
        auto e = patch.append_child("eval");
        auto t = node_value.value->type->ToString();
        auto v = PrintScalar(*node_value.value);
        e.append_attribute("type").set_value(t.c_str());
        e.append_attribute("value").set_value(v.c_str());
        EncodeLocation(e, instance.program().nodes[node_value.root_node_id].location(), instance.program_text());
    });

    auto cards = root.append_child("cards");
    for (auto& in : instance.input_statements()) {
        auto i = cards.append_child("input");
        std::string name{in->GetStatementName()};
        i.append_attribute("name").set_value(name.c_str());
        if (auto& comp = in->component_type(); comp.has_value()) {
            auto comp_name = sx::InputComponentTypeTypeTable()->names[static_cast<size_t>(comp.value())];
            i.append_attribute("component").set_value(comp_name);
        }
        if (auto& title = in->title(); title.has_value()) {
            std::string copy{*title};
            i.append_attribute("title").set_value(copy.c_str());
        }
        if (auto pos = in->specified_position()) {
            auto p = i.append_child("position");
            p.append_attribute("row") = pos->row();
            p.append_attribute("column") = pos->column();
            p.append_attribute("width") = pos->width();
            p.append_attribute("height") = pos->height();
        }
    }
    for (auto& viz : instance.viz_statements()) {
        auto v = cards.append_child("visualization");
        auto target = viz->target().ToString();
        v.append_attribute("target").set_value(target.c_str());
        if (auto& title = viz->title(); title.has_value()) {
            std::string copy{*title};
            v.append_attribute("title").set_value(copy.c_str());
        }
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
            std::stringstream options;
            vizc->PrintOptionsAsJSON(options);
            auto optionsstr = options.str();
            vc.text().set(optionsstr.c_str());
        }
    }

    auto g = root.append_child("graph");
    g.append_attribute("next_object_id").set_value(graph.next_object_id);
    auto setup_tasks = g.append_child("setup");
    for (auto& task : graph.setup_tasks) {
        auto s = setup_tasks.append_child("task");
        s.append_attribute("type") = setup_task_type_tt->names[static_cast<uint16_t>(task->task_type)];
        s.append_attribute("status") = task_status_tt->names[static_cast<uint16_t>(task->task_status_code)];
        s.append_attribute("object_id") = task->object_id;
        if (task->name_qualified != "") {
            auto t = s.append_child("output");
            t.append_attribute("name") = task->name_qualified.c_str();
        }
    }

    auto program_tasks = g.append_child("program");
    for (auto& task : graph.program_tasks) {
        auto p = program_tasks.append_child("task");
        p.append_attribute("type") = program_task_type_tt->names[static_cast<uint16_t>(task->task_type)];
        p.append_attribute("status") = task_status_tt->names[static_cast<uint16_t>(task->task_status_code)];
        p.append_attribute("object_id") = task->object_id;
        p.append_attribute("statement") = task->origin_statement;
        if (task->name_qualified != "") {
            auto t = p.append_child("output");
            t.append_attribute("name") = task->name_qualified.c_str();
        }
        if (!task->depends_on.empty()) {
            auto depends_on = p.append_child("depends_on");
            for (auto v : task->depends_on) {
                depends_on.append_child("ref").append_attribute("task").set_value(v);
            }
        }
        if (!task->required_for.empty()) {
            auto required_for = p.append_child("required_for");
            for (auto v : task->required_for) {
                required_for.append_child("ref").append_attribute("task").set_value(v);
            }
        }
        if (!task->script.empty()) {
            p.append_child("script").text().set(task->script.c_str());
        }
    }
}

// Read an task status
proto::task::TaskStatusCode AnalyzerTest::GetTaskStatus(std::string_view type) {
    auto tt = proto::task::TaskStatusCodeTypeTable();
    auto& names = tt->names;
    auto& num_elems = tt->num_elems;
    for (unsigned i = 0; i < num_elems; ++i) {
        if (type == std::string_view{names[i]}) return static_cast<proto::task::TaskStatusCode>(i);
    }
    return proto::task::TaskStatusCode::PENDING;
}

// Read a input type
proto::syntax::InputComponentType AnalyzerTest::GetInputType(std::string_view type) {
    auto tt = proto::syntax::InputComponentTypeTypeTable();
    auto& names = tt->names;
    auto& num_elems = tt->num_elems;
    for (unsigned i = 0; i < num_elems; ++i) {
        if (type == std::string_view{names[i]}) return static_cast<proto::syntax::InputComponentType>(i);
    }
    return proto::syntax::InputComponentType::TEXT;
}

// Read a input
arrow::Result<InputValue> AnalyzerTest::GetInputValue(const pugi::xml_node& node) {
    auto stmt = node.attribute("statement").as_int();
    auto value = node.attribute("value").as_string();
    auto type = node.attribute("type").as_string();
    static std::unordered_map<std::string_view, std::shared_ptr<arrow::DataType>> TYPE_NAMES = {
        {"na", arrow::null()},
        {"null", arrow::null()},
        {"boolean", arrow::boolean()},
        {"int64", arrow::int64()},
        {"timestamp", arrow::timestamp(arrow::TimeUnit::NANO)},
        {"date32", arrow::date32()},
        {"time", arrow::time64(arrow::TimeUnit::NANO)},
        {"float64", arrow::float64()},
        {"string", arrow::utf8()},
    };
    auto iter = TYPE_NAMES.find(type);
    if (iter == TYPE_NAMES.end()) return arrow::Status::Invalid("unknown type: ", type);
    ARROW_ASSIGN_OR_RAISE(auto v, arrow::Scalar::Parse(iter->second, value));
    return InputValue{static_cast<size_t>(stmt), v};
}

// The files
static std::unordered_map<std::string, std::vector<AnalyzerTest>> TEST_FILES;

/// Get the grammar tests
arrow::Status AnalyzerTest::LoadTests(std::filesystem::path& source_dir) {
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
        auto root = doc.child("tests");

        // Read tests
        std::vector<AnalyzerTest> tests;
        for (auto test : root.children("test")) {
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
                // Read input
                auto inputs = step.child("inputs");
                for (auto& input : inputs.children()) {
                    ARROW_ASSIGN_OR_RAISE(auto v, AnalyzerTest::GetInputValue(input));
                    s.input_values.push_back(v);
                }
                // Read full expected analyzer output
                pugi::xml_document expected;
                for (auto c : step.children()) {
                    expected.append_copy(c);
                }
                s.expected_output = std::move(expected);
                // Read setup task status codes
                for (auto p : step.child("graph").child("setup").children()) {
                    auto status_str = p.attribute("status").as_string();
                    auto status = AnalyzerTest::GetTaskStatus(status_str);
                    s.setupTaskStatusCodes.push_back(status);
                }
                // Read program task status codes
                for (auto p : step.child("graph").child("program").children()) {
                    auto status_str = p.attribute("status").as_string();
                    auto status = AnalyzerTest::GetTaskStatus(status_str);
                    s.programTaskStatusCodes.push_back(status);
                }
            }
        }

        std::cout << "[ SETUP    ] " << filename << ": " << tests.size() << " tests" << std::endl;

        // Register test
        TEST_FILES.insert({filename, move(tests)});
    }
    return arrow::Status::OK();
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
