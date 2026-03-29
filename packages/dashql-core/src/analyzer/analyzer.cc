#include "dashql/analyzer/analyzer.h"

#include "dashql/analyzer/constant_propagation_pass.h"
#include "dashql/analyzer/identify_column_computations_pass.h"
#include "dashql/analyzer/identify_column_filters_pass.h"
#include "dashql/analyzer/identify_function_calls_pass.h"
#include "dashql/analyzer/name_resolution_pass.h"
#include "dashql/analyzer/pass_manager.h"
#include "dashql/buffers/index_generated.h"
#include "dashql/catalog.h"
#include "dashql/exception.h"
#include "dashql/script.h"

namespace dashql {

Analyzer::Analyzer(std::shared_ptr<ParsedScript> parsed, Catalog& catalog)
    : state(parsed, catalog),
      pass_manager(),
      name_resolution(std::make_unique<NameResolutionPass>(state)),
      identify_function_calls(std::make_unique<IdentifyFunctionCallsPass>(state)),
      identify_constants(std::make_unique<ConstantPropagationPass>(state)),
      identify_projections(std::make_unique<IdentifyColumnComputationsPass>(state)),
      identify_filters(std::make_unique<IdentifyColumnFiltersPass>(state)) {}

std::shared_ptr<AnalyzedScript> Analyzer::Execute() {
    std::initializer_list<std::reference_wrapper<PassManager::LTRPass>> scan1{
        *name_resolution, *identify_function_calls, *identify_constants, *identify_projections, *identify_filters,
    };
    pass_manager.Execute(state, scan1);
    return state.analyzed;
}

std::shared_ptr<AnalyzedScript> Analyzer::Analyze(std::shared_ptr<ParsedScript> parsed, Catalog& catalog) {
    if (parsed == nullptr) {
        throw Exception(buffers::status::StatusCode::SCRIPT_NOT_PARSED);
    }
    Analyzer az{parsed, catalog};
    return az.Execute();
}

}  // namespace dashql
