// Runfiles root resolution for cc_test binaries.
// When run via Bazel with data = //snapshots:snapshot_tests, finds the snapshot
// root from RUNFILES_DIR (Unix) or RUNFILES_MANIFEST_FILE (Windows). Main repo
// may be _main or the workspace name under RUNFILES_DIR.
#include "dashql/testing/runfiles_dir.h"

#include <cstdlib>
#include <fstream>
#include <sstream>
#include <string>

namespace dashql {
namespace testing {

std::filesystem::path GetRunfilesSnapshotRoot() {
    // Unix: RUNFILES_DIR is set by Bazel. Main repo can be _main (Bzlmod) or
    // workspace name. Try known names first, then scan for any dir containing snapshots/.
    const char* runfiles_dir = std::getenv("RUNFILES_DIR");
    if (runfiles_dir != nullptr && runfiles_dir[0] != '\0') {
        auto base = std::filesystem::path(runfiles_dir);
        for (const char* candidate : {"_main", "dashql"}) {
            auto root = base / candidate;
            if (std::filesystem::exists(root / "snapshots")) {
                return root;
            }
        }
        // cc_test may use a different layout: scan RUNFILES_DIR for a subdir with snapshots/
        if (std::filesystem::is_directory(base)) {
            std::error_code ec;
            for (const auto& entry : std::filesystem::directory_iterator(base, ec)) {
                if (!ec && entry.is_directory()) {
                    auto root = entry.path();
                    if (std::filesystem::exists(root / "snapshots")) {
                        return root;
                    }
                }
            }
        }
    }

    // Windows (or when RUNFILES_DIR is not set): use runfiles manifest if present.
    const char* manifest_file = std::getenv("RUNFILES_MANIFEST_FILE");
    if (manifest_file != nullptr && std::filesystem::exists(manifest_file)) {
        std::ifstream f(manifest_file);
        std::string line;
        while (std::getline(f, line)) {
            // Look for any runfiles path containing "snapshots/" (e.g. _main/snapshots/ or dashql/snapshots/)
            auto idx = line.find("/snapshots/");
            if (idx == std::string::npos) continue;
            auto tab = line.find('\t');
            if (tab == std::string::npos) continue;
            std::string absolute = line.substr(tab + 1);
            auto p = std::filesystem::path(absolute);
            // p is .../snapshots/parser/foo.yaml; parent 2x -> repo root
            if (p.has_parent_path()) p = p.parent_path();  // .../snapshots/parser
            if (p.has_parent_path()) p = p.parent_path();  // .../snapshots
            if (p.has_parent_path()) p = p.parent_path();  // repo root
            if (std::filesystem::exists(p / "snapshots")) {
                return p;
            }
        }
    }

    return {};
}

}  // namespace testing
}  // namespace dashql
