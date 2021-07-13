// Copyright (c) 2020 The DashQL Authors

#include <string_view>

#include "dashql/parser/parser_driver.h"
#include "dashql/test/analyzer_tests.h"
#include "dashql/test/grammar_tests.h"
#include "gflags/gflags.h"
#include "gtest/gtest.h"
#include "pugixml.hpp"

using namespace dashql;
using namespace dashql::test;

DEFINE_string(source_dir, "", "Source directory");

namespace dashql {
namespace test {

std::filesystem::path SOURCE_DIR;

}
}  // namespace dashql

int main(int argc, char* argv[]) {
    gflags::AllowCommandLineReparsing();
    gflags::SetUsageMessage("Usage: ./tester --source_dir <dir>");
    gflags::ParseCommandLineFlags(&argc, &argv, false);

    if (std::filesystem::exists(FLAGS_source_dir)) {
        SOURCE_DIR = std::filesystem::path{FLAGS_source_dir};
        if (auto status = GrammarTest::LoadTests(SOURCE_DIR); !status.ok()) {
            std::cout << "Error while loading grammar tests: " << status.message() << std::endl;
        }
        if (auto status = AnalyzerTest::LoadTests(SOURCE_DIR); !status.ok()) {
            std::cout << "Error while loading analyzer tests: " << status.message() << std::endl;
        }
    }

    testing::InitGoogleTest(&argc, argv);
    return RUN_ALL_TESTS();
}
