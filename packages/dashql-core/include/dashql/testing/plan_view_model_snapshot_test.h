#pragma once

#include <filesystem>
#include <string>

#include "dashql/view/plan_view_model.h"
#include "gtest/gtest.h"
#include "ryml.hpp"

namespace dashql::testing {

struct PlanViewModelSnapshotTest {
    /// Printer test name
    struct TestPrinter {
        std::string operator()(const ::testing::TestParamInfo<const PlanViewModelSnapshotTest*>& info) const {
            return std::string{info.param->name};
        }
    };

    std::string name;
    std::string input;
    /// Expected operators (tree not owned, node id in tree)
    c4::yml::Tree* expected_operators_tree = nullptr;
    c4::yml::id_type expected_operators_node_id = c4::yml::NONE;
    /// Expected operator-edges
    c4::yml::Tree* expected_edges_tree = nullptr;
    c4::yml::id_type expected_edges_node_id = c4::yml::NONE;

    /// Encode plan view model to YAML
    static void EncodePlanViewModel(c4::yml::NodeRef root, const PlanViewModel& plan_view_model);
    /// Get the plan viewmodel tests
    static void LoadTests(const std::filesystem::path& snapshots_dir, std::string group);
    /// Get the plan viewmodel tests
    static std::vector<const PlanViewModelSnapshotTest*> GetTests(std::string_view group,
                                                                   std::string_view filename);
};

extern void operator<<(std::ostream& out, const PlanViewModelSnapshotTest& p);

}  // namespace dashql::testing
