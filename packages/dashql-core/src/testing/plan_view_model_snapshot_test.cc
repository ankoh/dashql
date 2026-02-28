#include "dashql/testing/plan_view_model_snapshot_test.h"

#include <flatbuffers/flatbuffer_builder.h>

#include <cstdint>
#include <format>
#include <fstream>
#include <iostream>
#include <limits>
#include <sstream>

#include "c4/yml/std/std.hpp"
#include "dashql/buffers/index_generated.h"
#include "dashql/parser/grammar/enums.h"
#include "dashql/utils/hash.h"
#include "ryml.hpp"

namespace dashql::testing {

/// Encode a plan view model to YAML
/// Use << key() << value for every map keyval so each child has KEY set (required by rapidyaml emitter).
void PlanViewModelSnapshotTest::EncodePlanViewModel(c4::yml::NodeRef root, const PlanViewModel& view_model) {
    flatbuffers::FlatBufferBuilder fb;
    fb.Finish(view_model.Pack(fb));
    auto* vm = flatbuffers::GetRoot<buffers::view::PlanViewModel>(fb.GetBufferPointer());

    auto* tree = root.tree();
    auto ops = vm->operators();
    auto roots = vm->root_operators();
    auto strings = vm->string_dictionary();
    auto edges = vm->operator_edges();
    auto pipelines = vm->pipelines();
    auto pipeline_edges = vm->pipeline_edges();

    auto out_ops = root.append_child(
        c4::yml::NodeInit(c4::yml::KEYSEQ, c4::to_csubstr("operators")));
    std::vector<std::pair<size_t, c4::yml::NodeRef>> pending;
    pending.reserve(roots->size());
    for (auto iter = roots->rbegin(); iter != roots->rend(); ++iter) {
        pending.push_back({*iter, out_ops});
    }
    while (!pending.empty()) {
        auto [oid, parent] = pending.back();
        pending.pop_back();
        auto* op = ops->Get(oid);
        auto self = parent.append_child();
        self.set_type(c4::yml::MAP);
        self.append_child() << c4::yml::key("id") << static_cast<uint64_t>(op->operator_id());
        std::string_view parent_path = strings->Get(op->parent_path())->string_view();
        if (!parent_path.empty()) {
            std::string path_str(parent_path);
            self.append_child() << c4::yml::key("path")
                               << tree->to_arena(c4::to_csubstr(path_str));
        }
        std::string_view op_type = strings->Get(op->operator_type_name())->string_view();
        std::string type_str(op_type);
        self.append_child() << c4::yml::key("type")
                           << tree->to_arena(c4::to_csubstr(type_str));
        if (op->operator_label() != std::numeric_limits<uint32_t>::max()) {
            std::string_view operator_label = strings->Get(op->operator_label())->string_view();
            if (!operator_label.empty()) {
                std::string label_str(operator_label);
                self.append_child() << c4::yml::key("label")
                                   << tree->to_arena(c4::to_csubstr(label_str));
            }
        }
        if (op->source_location().length() > 0) {
            std::string loc = std::format("{}..{}", op->source_location().offset(),
                                          op->source_location().offset() + op->source_location().length());
            self.append_child() << c4::yml::key("loc")
                               << tree->to_arena(c4::to_csubstr(loc));
        }
        if (op->parent_operator_id() != std::numeric_limits<uint32_t>::max()) {
            self.append_child() << c4::yml::key("parent")
                               << static_cast<uint64_t>(op->parent_operator_id());
        }
        self.append_child() << c4::yml::key("fragment")
                           << static_cast<uint64_t>(op->fragment_id());
        self.append_child() << c4::yml::key("x")
                           << static_cast<double>(op->layout_rect().x());
        self.append_child() << c4::yml::key("y")
                           << static_cast<double>(op->layout_rect().y());
        for (auto i = op->children_count(); i > 0; --i) {
            pending.push_back({op->children_begin() + i - 1, self});
        }
    }

    auto out_edges = root.append_child(
        c4::yml::NodeInit(c4::yml::KEYSEQ, c4::to_csubstr("operator-edges")));
    for (size_t i = 0; i < edges->size(); ++i) {
        auto* edge = edges->Get(i);
        auto out_edge = out_edges.append_child();
        out_edge.set_type(c4::yml::MAP);
        out_edge.append_child() << c4::yml::key("id")
                                << static_cast<uint64_t>(edge->edge_id());
        out_edge.append_child() << c4::yml::key("child")
                                << static_cast<uint64_t>(edge->child_operator());
        out_edge.append_child() << c4::yml::key("parent")
                                << static_cast<uint64_t>(edge->parent_operator());
        out_edge.append_child() << c4::yml::key("port_index")
                                << static_cast<uint64_t>(edge->parent_operator_port_index());
        out_edge.append_child() << c4::yml::key("port_count")
                                << static_cast<uint64_t>(edge->parent_operator_port_count());
    }

    auto out_pipelines = root.append_child(
        c4::yml::NodeInit(c4::yml::KEYSEQ, c4::to_csubstr("pipelines")));
    for (size_t i = 0; i < pipelines->size(); ++i) {
        auto* pipeline = pipelines->Get(i);
        auto out_pipeline = out_pipelines.append_child();
        out_pipeline.set_type(c4::yml::MAP);
        out_pipeline.append_child() << c4::yml::key("id")
                                   << static_cast<uint64_t>(pipeline->pipeline_id());
        auto edges_seq = out_pipeline.append_child(
            c4::yml::NodeInit(c4::yml::KEYSEQ, c4::to_csubstr("edges")));
        for (auto j = 0; j < pipeline->edge_count(); ++j) {
            auto* edge = pipeline_edges->Get(pipeline->edges_begin() + j);
            auto out_edge = edges_seq.append_child();
            out_edge.set_type(c4::yml::MAP);
            out_edge.append_child() << c4::yml::key("id")
                                   << static_cast<uint64_t>(edge->edge_id());
            out_edge.append_child() << c4::yml::key("pipeline")
                                   << static_cast<uint64_t>(edge->pipeline_id());
            out_edge.append_child() << c4::yml::key("child")
                                   << static_cast<uint64_t>(edge->child_operator());
            out_edge.append_child() << c4::yml::key("parent")
                                   << static_cast<uint64_t>(edge->parent_operator());
            out_edge.append_child() << c4::yml::key("parent_breaks")
                                   << (edge->parent_breaks_pipeline() == 1 ? "true" : "false");
        }
    }
}

void operator<<(std::ostream& out, const PlanViewModelSnapshotTest& p) { out << p.name; }

struct PlanSnapshotFile {
    std::string content;
    c4::yml::Tree tree;
    std::vector<PlanViewModelSnapshotTest> tests;
};
static std::unordered_map<std::tuple<std::string, std::string>, PlanSnapshotFile, TupleHasher> TEST_FILES;

void PlanViewModelSnapshotTest::LoadTests(const std::filesystem::path& snapshots_dir, std::string group) {
    std::cout << "Loading plan viewmodel tests at: " << snapshots_dir << std::endl;

    for (auto& p : std::filesystem::directory_iterator(snapshots_dir)) {
        auto filename = p.path().filename().string();
        if (p.path().extension().string() != ".yaml") continue;
        if (filename.find(".tpl.") != std::string::npos) continue;

        std::ifstream in(p.path(), std::ios::in | std::ios::binary);
        if (!in) {
            std::cout << "[ SETUP    ] failed to read test file: " << group << "/" << filename << std::endl;
            continue;
        }
        std::stringstream buf;
        buf << in.rdbuf();
        std::string content = buf.str();

        PlanSnapshotFile file;
        file.content = std::move(content);
        c4::yml::parse_in_arena(c4::to_csubstr(file.content), &file.tree);

        auto root = file.tree.rootref();
        if (!root.has_child("plan-snapshots")) {
            std::cout << "[ SETUP    ] " << group << "/" << filename << ": no plan-snapshots key" << std::endl;
            continue;
        }
        auto snapshots = root["plan-snapshots"];
        for (auto test_node : snapshots.children()) {
            file.tests.emplace_back();
            auto& t = file.tests.back();
            if (test_node.has_child("name")) {
                c4::csubstr v = test_node["name"].val();
                t.name = v.str ? std::string(v.str, v.len) : std::string();
            }
            if (test_node.has_child("input")) {
                c4::csubstr v = test_node["input"].val();
                t.input = v.str ? std::string(v.str, v.len) : std::string();
            }
            if (test_node.has_child("operators")) {
                t.expected_operators_node_id = test_node["operators"].id();
            }
            if (test_node.has_child("operator-edges")) {
                t.expected_edges_node_id = test_node["operator-edges"].id();
            }
        }

        std::cout << "[ SETUP    ] " << group << "/" << filename << ": " << file.tests.size() << " tests" << std::endl;
        auto it = TEST_FILES.insert({std::make_tuple(group, filename), std::move(file)}).first;
        for (auto& t : it->second.tests) {
            t.expected_operators_tree = &it->second.tree;
            t.expected_edges_tree = &it->second.tree;
        }
    }
}

std::vector<const PlanViewModelSnapshotTest*> PlanViewModelSnapshotTest::GetTests(std::string_view group,
                                                                                  std::string_view filename) {
    auto iter = TEST_FILES.find(std::make_tuple(std::string(group), std::string(filename)));
    if (iter == TEST_FILES.end()) {
        return {};
    }
    std::vector<const PlanViewModelSnapshotTest*> tests;
    for (auto& test : iter->second.tests) {
        tests.emplace_back(&test);
    }
    return tests;
}

}  // namespace dashql::testing
