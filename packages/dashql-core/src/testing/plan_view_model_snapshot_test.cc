#include "dashql/testing/plan_view_model_snapshot_test.h"

#include <flatbuffers/flatbuffer_builder.h>

#include <cstdint>
#include <fstream>
#include <iostream>
#include <limits>

#include "dashql/buffers/index_generated.h"
#include "dashql/parser/grammar/enums.h"
#include "dashql/testing/xml_tests.h"
#include "dashql/utils/hash.h"
#include "pugixml.hpp"

namespace dashql::testing {

/// Encode a plan view model
void PlanViewModelSnapshotTest::EncodePlanViewModel(pugi::xml_node root, const PlanViewModel& view_model) {
    flatbuffers::FlatBufferBuilder fb;
    fb.Finish(view_model.Pack(fb));
    auto* vm = flatbuffers::GetRoot<buffers::view::PlanViewModel>(fb.GetBufferPointer());

    // The output
    auto out_ops = root.append_child("operators");

    // The input
    auto ops = vm->operators();
    auto roots = vm->root_operators();
    auto strings = vm->string_dictionary();

    // Prepare the DFS
    std::vector<std::pair<size_t, pugi::xml_node>> pending;
    pending.reserve(roots->size());
    for (auto iter = roots->rbegin(); iter != roots->rend(); ++iter) {
        pending.push_back({*iter, out_ops});
    }

    // Pre-order traversal is enough
    while (!pending.empty()) {
        auto [oid, parent] = pending.back();
        pending.pop_back();
        auto* op = ops->Get(oid);
        auto self = parent.append_child("operator");
        self.append_attribute("id").set_value(op->operator_id());
        std::string_view parent_path = strings->Get(op->parent_path())->string_view();
        if (!parent_path.empty()) {
            self.append_attribute("path").set_value(parent_path.data(), parent_path.size());
        }
        std::string_view op_type = strings->Get(op->operator_type_name())->string_view();
        self.append_attribute("type").set_value(op_type.data(), op_type.size());
        if (op->parent_operator_id() != std::numeric_limits<uint32_t>::max()) {
            self.append_attribute("parent").set_value(op->parent_operator_id());
        }
        self.append_attribute("stage").set_value(op->stage_id());

        for (auto i = op->children_count(); i > 0; --i) {
            pending.push_back({op->children_begin() + i - 1, self});
        }
    }
}

void operator<<(std::ostream& out, const PlanViewModelSnapshotTest& p) { out << p.name; }

// The files
static std::unordered_map<std::tuple<std::string, std::string>, std::vector<PlanViewModelSnapshotTest>, TupleHasher>
    TEST_FILES;

// Load the tests
void PlanViewModelSnapshotTest::LoadTests(const std::filesystem::path& snapshots_dir, std::string group) {
    std::cout << "Loading plan viewmodel tests at: " << snapshots_dir << std::endl;

    for (auto& p : std::filesystem::directory_iterator(snapshots_dir)) {
        auto filename = p.path().filename().string();
        if (p.path().extension().string() != ".xml") continue;

        // Make sure that it's no template
        auto tpl = p.path();
        tpl.replace_extension();
        if (tpl.extension() == ".tpl") continue;

        // Open input stream
        std::ifstream in(p.path(), std::ios::in | std::ios::binary);
        if (!in) {
            std::cout << "[ SETUP    ] failed to read test file: " << group << "/" << filename << std::endl;
            continue;
        }

        // Parse xml document
        pugi::xml_document doc;
        doc.load(in);
        auto root = doc.child("plan-snapshots");

        // Read tests
        std::vector<PlanViewModelSnapshotTest> tests;
        for (auto test : root.children()) {
            // Create test
            tests.emplace_back();
            auto& t = tests.back();
            t.name = test.attribute("name").as_string();
            t.input = test.child("input").last_child().value();

            pugi::xml_document expected_operators;
            expected_operators.append_copy(test.child("operators"));

            t.expected_operators = std::move(expected_operators);
        }

        std::cout << "[ SETUP    ] " << group << "/" << filename << ": " << tests.size() << " tests" << std::endl;

        // Register test
        TEST_FILES.insert({std::make_pair(group, std::move(filename)), std::move(tests)});
    }
}

// Get the tests
std::vector<const PlanViewModelSnapshotTest*> PlanViewModelSnapshotTest::GetTests(std::string_view group,
                                                                                  std::string_view filename) {
    auto iter = TEST_FILES.find(std::pair<std::string, std::string>{group, filename});
    if (iter == TEST_FILES.end()) {
        return {};
    }
    std::vector<const PlanViewModelSnapshotTest*> tests;
    for (auto& test : iter->second) {
        tests.emplace_back(&test);
    }
    return tests;
}

}  // namespace dashql::testing
