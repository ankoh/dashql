#pragma once

#include <cstdint>
#include <string>

namespace dashql {

class Script;

/// Stable numeric states exposed by the C ABI.
enum class AsyncAnalysisJobState : uint32_t {
    QUEUED = 1,
    ANALYZING = 2,
    READY = 3,
    FAILED = 4,
    CANCELLED = 5,
};

class AsyncAnalysisJobs {
   public:
    static uint32_t Submit(Script& script, bool parse_if_outdated);
    static AsyncAnalysisJobState Poll(uint32_t job_id);
    static uint32_t GetErrorCode(uint32_t job_id);
    static std::string GetErrorMessage(uint32_t job_id);
    static bool Cancel(uint32_t job_id);
    static void Release(uint32_t job_id);
};

}  // namespace dashql
