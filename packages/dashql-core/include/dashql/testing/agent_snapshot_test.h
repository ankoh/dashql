#pragma once

#include <filesystem>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "dashql/buffers/index_generated.h"
#include "gtest/gtest.h"
#include "ryml.hpp"

namespace dashql::testing {

struct AgentSnapshotEvent {
    enum class Type { kCompleteModel, kCompleteContext, kCompleteApply, kCancel };

    Type type = Type::kCompleteModel;
    std::string value;
    std::vector<std::string> errors;
};

struct AgentSnapshotTest {
    struct TestPrinter {
        std::string operator()(const ::testing::TestParamInfo<const AgentSnapshotTest*>& info) const {
            return info.param->name;
        }
    };

    std::string name;
    std::string prompt;
    buffers::agent::AgentIntent intent = buffers::agent::AgentIntent::UNKNOWN;
    uint32_t max_attempts = 3;
    std::string script;
    std::vector<AgentSnapshotEvent> events;
    buffers::formatting::FormattingMode formatting_mode = buffers::formatting::FormattingMode::PRETTY;
    uint32_t formatting_max_width = 120;
    uint32_t formatting_indentation_width = 2;
    c4::yml::Tree* tree = nullptr;
    c4::yml::id_type node_id = c4::yml::NONE;

    static void EncodeExpected(c4::yml::NodeRef root, const AgentSnapshotTest& test);
    static AgentSnapshotTest Parse(c4::yml::ConstNodeRef node, bool require_expected = false);
    static void LoadTests(const std::filesystem::path& snapshots_dir);
    static std::vector<const AgentSnapshotTest*> GetTests(std::string_view filename);
};

void operator<<(std::ostream& out, const AgentSnapshotTest& test);

}  // namespace dashql::testing
