#ifndef DASHQL_TESTING_RUNFILES_DIR_H_
#define DASHQL_TESTING_RUNFILES_DIR_H_

#include <filesystem>

namespace dashql {
namespace testing {

/// Returns the runfiles root (directory containing "snapshots/") when the binary
/// is run under Bazel with data = //snapshots:snapshot_tests. Uses
/// RUNFILES_DIR (Unix) or RUNFILES_MANIFEST_FILE (Windows). Returns empty path
/// if not in a runfiles environment.
std::filesystem::path GetRunfilesSnapshotRoot();

}  // namespace testing
}  // namespace dashql

#endif  // DASHQL_TESTING_RUNFILES_DIR_H_
