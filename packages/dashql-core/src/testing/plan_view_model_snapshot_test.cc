#include "dashql/testing/plan_view_model_snapshot_test.h"

#include <cstdint>
#include <fstream>
#include <iostream>

#include "dashql/buffers/index_generated.h"
#include "dashql/parser/grammar/enums.h"
#include "dashql/testing/xml_tests.h"
#include "dashql/utils/hash.h"
#include "pugixml.hpp"

namespace dashql::testing {

/// Encode a plan view model
void PlanViewModelSnapshotTest::EncodePlanViewModel(pugi::xml_node root, const PlanViewModel& view_model) {
    // XXX
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

            pugi::xml_document expected;
            for (auto s : test.child("expected").children()) {
                expected.append_copy(s);
            }
            t.expected = std::move(expected);
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
