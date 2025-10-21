#pragma once

#include <filesystem>
#include <string>

#include "dashql/view/plan_view_model.h"
#include "gtest/gtest.h"
#include "pugixml.hpp"

namespace dashql::testing {

struct PlanViewModelSnapshotTest {
    /// Printer test name
    struct TestPrinter {
        std::string operator()(const ::testing::TestParamInfo<const PlanViewModelSnapshotTest*>& info) const {
            return std::string{info.param->name};
        }
    };

    /// The name
    std::string name;
    /// The input
    std::string input;
    /// The expected operators
    pugi::xml_document expected_operators;

    /// Encode a plan view model
    static void EncodePlanViewModel(pugi::xml_node root, const PlanViewModel& plan_view_model);
    /// Get the plan viewmodel tests
    static void LoadTests(const std::filesystem::path& project_root, std::string group);
    /// Get the plan viewmodel tests
    static std::vector<const PlanViewModelSnapshotTest*> GetTests(std::string_view group, std::string_view filename);
};

extern void operator<<(std::ostream& out, const PlanViewModelSnapshotTest& p);

}  // namespace dashql::testing
