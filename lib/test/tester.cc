// Copyright (c) 2020 The DashQL Authors

#include "dashql/parser/parser_driver.h"
#include "dashql/test/analyzer_tests.h"
#include "dashql/test/grammar_tests.h"
#include "gtest/gtest.h"
#include "gflags/gflags.h"
#include "pugixml.hpp"
#include <string_view>

using namespace dashql;
using namespace dashql::test;

DEFINE_string(source_dir, "", "Source directory");

namespace dashql {
namespace test {

std::filesystem::path SOURCE_DIR;

}
}

int main(int argc, char* argv[]) {
    gflags::AllowCommandLineReparsing();
    gflags::SetUsageMessage("Usage: ./tester --source_dir <dir>");
    gflags::ParseCommandLineFlags(&argc, &argv, false);

    if (std::filesystem::exists(FLAGS_source_dir)) {
        SOURCE_DIR = std::filesystem::path{FLAGS_source_dir};
        GrammarTest::LoadTests(SOURCE_DIR);
        AnalyzerTest::LoadTests(SOURCE_DIR);
    }

    testing::InitGoogleTest(&argc, argv);
    return RUN_ALL_TESTS();
}
