#include "dashql/view/plan_view_model.h"

#include "dashql/buffers/index_generated.h"

namespace dashql {

std::pair<std::unique_ptr<PlanViewModel>, buffers::status::StatusCode> PlanViewModel::ParseHyperPlan(std::string plan) {
    return {nullptr, buffers::status::StatusCode::OK};
}

}  // namespace dashql
