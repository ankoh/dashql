#include "dashql/analyzer/analyzer.h"

#include "dashql/analyzer/identify_constants_pass.h"
#include "dashql/analyzer/identify_projections_pass.h"
#include "dashql/analyzer/identify_restrictions_pass.h"
#include "dashql/analyzer/name_resolution_pass.h"
#include "dashql/analyzer/pass_manager.h"
#include "dashql/buffers/index_generated.h"
#include "dashql/catalog.h"
#include "dashql/script.h"

namespace dashql {

Analyzer::Analyzer(std::shared_ptr<ParsedScript> parsed, Catalog& catalog)
    : parsed(parsed),
      analyzed(std::make_shared<AnalyzedScript>(parsed, catalog)),
      catalog(catalog),
      pass_manager(*parsed),
      name_resolution(std::make_unique<NameResolutionPass>(*analyzed, catalog, attribute_index)),
      identify_constants(std::make_unique<IdentifyConstExprsPass>(*analyzed, catalog, attribute_index)),
      identify_projections(std::make_unique<IdentifyProjectionsPass>(*analyzed, catalog, attribute_index,
                                                                     *name_resolution, *identify_constants)),
      identify_restrictions(std::make_unique<IdentifyRestrictionsPass>(
          *analyzed, catalog, attribute_index, *name_resolution, *identify_constants, *identify_projections)) {}

std::pair<std::shared_ptr<AnalyzedScript>, buffers::status::StatusCode> Analyzer::Analyze(
    std::shared_ptr<ParsedScript> parsed, Catalog& catalog) {
    if (parsed == nullptr) {
        return {nullptr, buffers::status::StatusCode::ANALYZER_INPUT_NOT_PARSED};
    }
    // Run analysis passes
    Analyzer az{parsed, catalog};
    az.pass_manager.Execute({
        *az.name_resolution,
        // *az.identify_constants,
        // *az.identify_projections,
        // *az.identify_restrictions,
    });

    // Build program
    return {az.analyzed, buffers::status::StatusCode::OK};
}

}  // namespace dashql
