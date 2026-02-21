#pragma once

#include <filesystem>
#include <string>

#include "dashql/formatter/formatter.h"
#include "gtest/gtest.h"
#include "pugixml.hpp"

namespace dashql::testing {

struct FormatSnapshotTest {
    /// Printer test name
    struct TestPrinter {
        std::string operator()(const ::testing::TestParamInfo<const FormatSnapshotTest*>& info) const {
            return std::string{info.param->name};
        }
    };

    /// The name
    std::string name;
    /// The input
    std::string input;
    /// The formatted output
    std::string formatted;

    /// The formatting config
    Formatter::FormattingConfig config;

    /// Get the grammar tests
    static void LoadTests(const std::filesystem::path& project_root);
    /// Get the grammar tests
    static std::vector<const FormatSnapshotTest*> GetTests(std::string_view filename);
};

extern void operator<<(std::ostream& out, const FormatSnapshotTest& p);

}  // namespace dashql::testing
