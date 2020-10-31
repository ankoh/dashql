// Copyright (c) 2020 The DashQL Authors

#include <gtest/gtest.h>
#include <string_view>
#include <filesystem>

int main(int argc, char* argv[]) {
    testing::InitGoogleTest(&argc, argv);

    if (argc < 3 || std::string_view{argv[1]} != "--grammar_tests") {
        std::cout << "Usage: ./tester --grammar_tests <dir>" << std::endl;
        exit(1);
    }

    if (!argv[2] || !std::filesystem::exists(argv[2])) {
        std::cout << "Invalid directory: " << argv[2] << std::endl;
        exit(1);
    }

    std::cout << "[   INFO   ] Grammar Tests: " << argv[2] << std::endl;
    return RUN_ALL_TESTS();
}

