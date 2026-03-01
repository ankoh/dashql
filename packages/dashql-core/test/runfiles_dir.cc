// Platform-independent runfiles root resolution for the tester.
// When the binary is run via Bazel (data = //snapshots:snapshot_tests), we find
// the snapshot root from RUNFILES_DIR (Unix) or RUNFILES_MANIFEST_FILE (Windows).
#include "dashql/testing/runfiles_dir.h"

#include <cstdlib>
#include <fstream>
#include <sstream>
#include <string>

namespace dashql {
namespace testing {

std::filesystem::path GetRunfilesSnapshotRoot() {
    // Unix: RUNFILES_DIR is set by Bazel; main repo is under _main with Bzlmod.
    const char* runfiles_dir = std::getenv("RUNFILES_DIR");
    if (runfiles_dir != nullptr && runfiles_dir[0] != '\0') {
        auto root = std::filesystem::path(runfiles_dir) / "_main";
        if (std::filesystem::exists(root / "snapshots")) {
            return root;
        }
    }

    // Windows (or when RUNFILES_DIR is not set): use runfiles manifest if present.
    const char* manifest_file = std::getenv("RUNFILES_MANIFEST_FILE");
    if (manifest_file != nullptr && std::filesystem::exists(manifest_file)) {
        std::ifstream f(manifest_file);
        std::string line;
        const std::string prefix = "_main/snapshots/";
        while (std::getline(f, line)) {
            if (line.compare(0, prefix.size(), prefix) != 0) continue;
            // Manifest format: "runfiles_path<TAB>absolute_path"
            auto tab = line.find('\t');
            if (tab == std::string::npos) continue;
            std::string absolute = line.substr(tab + 1);
            auto p = std::filesystem::path(absolute);
            // p is .../snapshots/parser/foo.yaml or similar; parent 3x -> repo root
            if (p.has_parent_path()) p = p.parent_path();  // .../snapshots/parser
            if (p.has_parent_path()) p = p.parent_path();  // .../snapshots
            if (p.has_parent_path()) p = p.parent_path();  // ... (_main root)
            if (std::filesystem::exists(p / "snapshots")) {
                return p;
            }
        }
    }

    return {};
}

}  // namespace testing
}  // namespace dashql
