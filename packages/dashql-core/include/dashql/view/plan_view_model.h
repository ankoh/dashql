#pragma once

#include <memory>

#include "dashql/buffers/index_generated.h"

namespace dashql {

class PlanViewModel {
    /// Constructor
    PlanViewModel();

    /// Parse a hyper plan
    static std::pair<std::unique_ptr<PlanViewModel>, buffers::status::StatusCode> ParseHyperPlan(std::string plan);
};

}  // namespace dashql
