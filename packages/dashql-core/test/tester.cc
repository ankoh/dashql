#include <string_view>

#include "dashql/parser/parser.h"
#include "dashql/testing/analyzer_snapshot_test.h"
#include "dashql/testing/completion_snapshot_test.h"
#include "dashql/testing/formatter_snapshot_test.h"
#include "dashql/testing/parser_snapshot_test.h"
#include "dashql/testing/plan_view_model_snapshot_test.h"
#include "dashql/testing/registry_snapshot_test.h"
#include "dashql/testing/runfiles_dir.h"
#include "gflags/gflags.h"
#include "gtest/gtest.h"

using namespace dashql;
using namespace dashql::testing;

std::filesystem::path source_dir;
bool update_expecteds;

DEFINE_bool(update_expecteds, false, "Update the test expectations");
DEFINE_string(source_dir, "", "Root dir containing snapshots/ (omit when run via 'bazel run')");

int main(int argc, char* argv[]) {
    gflags::AllowCommandLineReparsing();
    gflags::SetUsageMessage("Usage: ./tester [--source_dir <dir>]");
    gflags::ParseCommandLineFlags(&argc, &argv, false);

    if (!FLAGS_source_dir.empty()) {
        source_dir = std::filesystem::path(FLAGS_source_dir);
    } else {
        auto runfiles_root = GetRunfilesSnapshotRoot();
        source_dir = runfiles_root.empty() ? std::filesystem::path(".") : runfiles_root;
    }

    if (!std::filesystem::exists(source_dir)) {
        std::cout << "Invalid source directory: " << source_dir << std::endl;
    }
    update_expecteds = FLAGS_update_expecteds;
    ParserSnapshotTest::LoadTests(source_dir / "snapshots" / "parser");
    AnalyzerSnapshotTest::LoadTests(source_dir / "snapshots" / "analyzer");
    CompletionSnapshotTest::LoadTests(source_dir / "snapshots" / "completion");
    RegistrySnapshotTest::LoadTests(source_dir / "snapshots" / "registry");
    PlanViewModelSnapshotTest::LoadTests(source_dir / "snapshots" / "plans" / "hyper" / "tests", "hyper");
    FormatterSnapshotTest::LoadTests(source_dir / "snapshots" / "formatter");

    ::testing::InitGoogleTest(&argc, argv);
    return RUN_ALL_TESTS();
}
