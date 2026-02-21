#include "dashql/testing/formatter_snapshot_test.h"

#include <fstream>
#include <iostream>

#include "pugixml.hpp"

namespace dashql::testing {

void operator<<(std::ostream& out, const FormatterSnapshotTest& p) { out << p.name; }

// The files
static std::unordered_map<std::string, std::vector<FormatterSnapshotTest>> TEST_FILES;

// Load the tests
void FormatterSnapshotTest::LoadTests(const std::filesystem::path& snapshots_dir) {
    std::cout << "Loading formatting tests at: " << snapshots_dir << std::endl;

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
            std::cout << "[ SETUP    ] failed to read test file: " << filename << std::endl;
            continue;
        }

        // Parse xml document
        pugi::xml_document doc;
        doc.load(in);
        auto root = doc.child("formatter-snapshots");

        // Read tests
        std::vector<FormatterSnapshotTest> tests;
        for (auto test : root.children()) {
            // Create test
            tests.emplace_back();
            auto& t = tests.back();
            t.name = test.attribute("name").as_string();
            t.input = test.child("input").last_child().value();
            t.formatted = test.child("formatted").last_child().value();
            if (auto pagesize = test.attribute("pagesize")) {
                t.config.rope_page_size = pagesize.as_int(128);
            }
            if (auto indent = test.attribute("indent")) {
                t.config.indentation_width = indent.as_int(4);
            }
        }

        std::cout << "[ SETUP    ] " << filename << ": " << tests.size() << " tests" << std::endl;

        // Register test
        TEST_FILES.insert({filename, std::move(tests)});
    }
}

// Get the tests
std::vector<const FormatterSnapshotTest*> FormatterSnapshotTest::GetTests(std::string_view filename) {
    std::string name{filename};
    auto iter = TEST_FILES.find(name);
    if (iter == TEST_FILES.end()) {
        return {};
    }
    std::vector<const FormatterSnapshotTest*> tests;
    for (auto& test : iter->second) {
        tests.emplace_back(&test);
    }
    return tests;
}

}  // namespace dashql::testing
