// Copyright (c) 2020 The DashQL Authors

#include "dashql/parser/parser_driver.h"
#include "dashql/test/grammar_tests.h"
#include "gtest/gtest.h"
#include "pugixml.hpp"

using namespace dashql;
using namespace dashql::test;

int main(int argc, char* argv[]) {
    if (argc < 2) {
        std::cout << "Usage: ./tester <dir>" << std::endl;
        return 1;
    }
    if (!argv[1] || !std::filesystem::exists(argv[1])) {
        std::cout << "Invalid directory: " << argv[1] << std::endl;
        return 1;
    }
    auto source_dir = std::filesystem::path{argv[1]};

    // Load the grammar tests
    GrammarTest::LoadTests(source_dir);

    testing::InitGoogleTest(&argc, argv);
    return RUN_ALL_TESTS();
}

