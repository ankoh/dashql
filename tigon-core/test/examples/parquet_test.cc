//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#include "arrow/buffer.h"
#include "arrow/io/memory.h"
#include <filesystem>

namespace {

inline std::string resolvePath(const std::string &relPath)
{
    auto baseDir = std::filesystem::current_path();
    while (baseDir.has_parent_path()) {
        auto combinePath = baseDir / relPath;
        if (std::filesystem::exists(combinePath)) {
            return combinePath.string();
        }
        baseDir = baseDir.parent_path();
    }
    throw std::runtime_error("File not found!");
}


}

