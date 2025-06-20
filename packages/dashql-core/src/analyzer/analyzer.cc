#include "dashql/analyzer/analyzer.h"

#include "dashql/analyzer/identify_column_restrictions_pass.h"
#include "dashql/analyzer/identify_column_transforms_pass.h"
#include "dashql/analyzer/identify_constant_expressions_pass.h"
#include "dashql/analyzer/name_resolution_pass.h"
#include "dashql/analyzer/pass_manager.h"
#include "dashql/buffers/index_generated.h"
#include "dashql/catalog.h"
#include "dashql/script.h"

namespace dashql {

Analyzer::Analyzer(std::shared_ptr<ParsedScript> parsed, Catalog& catalog)
    : state(parsed, catalog),
      pass_manager(),
      name_resolution(std::make_unique<NameResolutionPass>(state)),
      identify_constants(std::make_unique<IdentifyConstantExpressionsPass>(state)),
      identify_projections(
          std::make_unique<IdentifyColumnTransformsPass>(state, *name_resolution, *identify_constants)),
      identify_restrictions(std::make_unique<IdentifyColumnRestrictionsPass>(
          state, *name_resolution, *identify_constants, *identify_projections)) {}

std::pair<std::shared_ptr<AnalyzedScript>, buffers::status::StatusCode> Analyzer::Execute() {
    std::initializer_list<std::reference_wrapper<PassManager::LTRPass>> scan1{
        *name_resolution,
        *identify_constants,
        *identify_projections,
        *identify_restrictions,
    };
    pass_manager.Execute(state, scan1);
    return {state.analyzed, buffers::status::StatusCode::OK};
}

std::pair<std::shared_ptr<AnalyzedScript>, buffers::status::StatusCode> Analyzer::Analyze(
    std::shared_ptr<ParsedScript> parsed, Catalog& catalog) {
    if (parsed == nullptr) {
        return {nullptr, buffers::status::StatusCode::ANALYZER_INPUT_NOT_PARSED};
    }
    Analyzer az{parsed, catalog};
    return az.Execute();
}

}  // namespace dashql
