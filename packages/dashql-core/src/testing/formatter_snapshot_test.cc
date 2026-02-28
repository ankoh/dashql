#include "dashql/testing/formatter_snapshot_test.h"

#include <fstream>
#include <iostream>

#include "dashql/testing/xml_tests.h"
#include "dashql/utils/string_trimming.h"
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

        // Read tests: one test per snapshot (per input), with multiple config/expected from <formatted> tags
        std::vector<FormatterSnapshotTest> tests;
        for (auto snapshot : root.children()) {
            if (snapshot.type() != pugi::node_element) continue;
            FormatterSnapshotTest t;
            t.name = snapshot.attribute("name").as_string();
            t.input = std::string{trim_view(snapshot.child("input").last_child().value(), is_no_space)};
            for (auto formatted_node : snapshot.children("formatted")) {
                FormatterExpectation exp;
                exp.config.mode = ParseFormattingMode(formatted_node.attribute("mode").as_string("compact"));
                exp.config.indentation_width =
                    formatted_node.attribute("indent").as_uint(FORMATTING_DEFAULT_INDENTATION_WIDTH);
                exp.formatted = UnindentXMLTextValue(std::string{formatted_node.last_child().value()}, 2);
                exp.formatted = trim_view(exp.formatted, is_no_space);
                t.expectations.push_back(std::move(exp));
            }
            if (!t.expectations.empty()) {
                tests.push_back(std::move(t));
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
