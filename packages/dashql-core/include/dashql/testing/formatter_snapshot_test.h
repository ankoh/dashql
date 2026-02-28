#pragma once

#include <filesystem>
#include <string>
#include <vector>

#include "dashql/formatter/formatter.h"
#include "gtest/gtest.h"

namespace dashql::testing {

/// One (config, expected output) pair for a formatter snapshot.
struct FormatterExpectation {
    FormattingConfig config;
    std::string formatted;
};

struct FormatterSnapshotTest {
    /// Printer test name
    struct TestPrinter {
        std::string operator()(const ::testing::TestParamInfo<const FormatterSnapshotTest*>& info) const {
            return std::string{info.param->name};
        }
    };

    /// The snapshot name (one test per input)
    std::string name;
    /// The input SQL
    std::string input;
    /// Multiple configs and expected outputs (one per formatted entry)
    std::vector<FormatterExpectation> expectations;

    /// Load tests from formatter snapshot directory
    static void LoadTests(const std::filesystem::path& project_root);
    /// Get tests for a snapshot file
    static std::vector<const FormatterSnapshotTest*> GetTests(std::string_view filename);
};

extern void operator<<(std::ostream& out, const FormatterSnapshotTest& p);

}  // namespace dashql::testing
