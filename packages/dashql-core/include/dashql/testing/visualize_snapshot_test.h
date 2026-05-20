#pragma once

#include <filesystem>
#include <string>
#include <vector>

#include "gtest/gtest.h"
#include "ryml.hpp"

namespace dashql::testing {

struct VisualizeSnapshotTest {
    struct TestPrinter {
        std::string operator()(const ::testing::TestParamInfo<const VisualizeSnapshotTest*>& info) const {
            return std::string{info.param->name};
        }
    };

    std::string name;
    std::string catalog_input;
    std::string script_input;

    c4::yml::Tree* tree = nullptr;
    c4::yml::id_type node_id = c4::yml::NONE;

    static void LoadTests(const std::filesystem::path& snapshots_dir);
    static std::vector<const VisualizeSnapshotTest*> GetTests(std::string_view filename);
};

extern void operator<<(std::ostream& out, const VisualizeSnapshotTest& p);

}  // namespace dashql::testing
