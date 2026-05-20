#include "dashql/testing/visualize_snapshot_test.h"

#include <fstream>
#include <sstream>
#include <unordered_map>

#include "c4/yml/std/std.hpp"
#include "dashql/testing/runfiles_dir.h"
#include "dashql/utils/string_trimming.h"
#include "ryml.hpp"

namespace dashql::testing {

struct VisualizeSnapshotFile {
    std::string content;
    c4::yml::Tree tree;
    std::vector<VisualizeSnapshotTest> tests;
};
static std::unordered_map<std::string, VisualizeSnapshotFile> TEST_FILES;

void VisualizeSnapshotTest::LoadTests(const std::filesystem::path& snapshots_dir) {
    if (!TEST_FILES.empty()) return;
    std::cout << "Loading visualize tests at: " << snapshots_dir << std::endl;

    for (auto& p : std::filesystem::directory_iterator(snapshots_dir)) {
        auto filename = p.path().filename().string();
        if (p.path().extension().string() != ".yaml") continue;
        if (filename.find(".tpl.") != std::string::npos) continue;

        std::ifstream in(p.path(), std::ios::in | std::ios::binary);
        if (!in) {
            std::cout << "[ SETUP    ] failed to read test file: " << filename << std::endl;
            continue;
        }
        std::stringstream buf;
        buf << in.rdbuf();
        std::string content = buf.str();

        VisualizeSnapshotFile file;
        file.content = std::move(content);
        c4::yml::parse_in_arena(c4::to_csubstr(file.content), &file.tree);

        auto root = file.tree.rootref();
        if (!root.has_child("visualize-snapshots")) {
            std::cout << "[ SETUP    ] " << filename << ": no visualize-snapshots key" << std::endl;
            continue;
        }
        auto snapshots = root["visualize-snapshots"];
        for (auto test_node : snapshots.children()) {
            file.tests.emplace_back();
            auto& test = file.tests.back();
            if (test_node.has_child("name")) {
                c4::csubstr v = test_node["name"].val();
                test.name = v.str ? std::string(v.str, v.len) : std::string();
            }
            if (test_node.has_child("catalog") && test_node["catalog"].has_child("script") &&
                test_node["catalog"]["script"].has_child("input")) {
                c4::csubstr v = test_node["catalog"]["script"]["input"].val();
                if (v.str) {
                    std::string_view trimmed = trim_view(std::string_view{v.str, v.len}, is_no_space);
                    test.catalog_input.assign(trimmed.data(), trimmed.size());
                }
            }
            if (test_node.has_child("script") && test_node["script"].has_child("input")) {
                c4::csubstr v = test_node["script"]["input"].val();
                if (v.str) {
                    std::string_view trimmed = trim_view(std::string_view{v.str, v.len}, is_no_space);
                    test.script_input.assign(trimmed.data(), trimmed.size());
                }
            }
            test.tree = &file.tree;
            test.node_id = test_node.id();
        }

        std::cout << "[ SETUP    ] " << filename << ": " << file.tests.size() << " tests" << std::endl;
        auto it = TEST_FILES.insert({filename, std::move(file)}).first;
        for (auto& t : it->second.tests) {
            t.tree = &it->second.tree;
        }
    }
}

std::vector<const VisualizeSnapshotTest*> VisualizeSnapshotTest::GetTests(std::string_view filename) {
    if (TEST_FILES.empty()) {
        auto root = GetRunfilesSnapshotRoot();
        LoadTests((root.empty() ? std::filesystem::path(".") : root) / "snapshots" / "visualize");
    }
    std::string name{filename};
    auto iter = TEST_FILES.find(name);
    if (iter == TEST_FILES.end()) {
        return {};
    }
    std::vector<const VisualizeSnapshotTest*> tests;
    for (auto& test : iter->second.tests) {
        tests.emplace_back(&test);
    }
    return tests;
}

void operator<<(std::ostream& out, const VisualizeSnapshotTest& p) { out << p.name; }

}  // namespace dashql::testing
