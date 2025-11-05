#pragma once

#include "dashql/analyzer/analysis_state.h"
#include "dashql/analyzer/pass_manager.h"
#include "dashql/buffers/index_generated.h"
#include "dashql/catalog.h"
#include "dashql/script.h"

namespace dashql {

struct NameResolutionPass;
struct ConstantPropagationPass;
struct IdentifyColumnFiltersPass;
struct IdentifyColumnComputationsPass;
struct IdentifyFunctionCallsPass;
class ScannedScript;
class ParsedScript;

struct Analyzer {
    friend class AnalyzedScript;

   protected:
    /// The shared analysis state
    AnalysisState state;

    /// The pass manager
    PassManager pass_manager;
    /// The name resolution pass
    std::unique_ptr<NameResolutionPass> name_resolution;
    /// The pass to identify function calls
    std::unique_ptr<IdentifyFunctionCallsPass> identify_function_calls;
    /// The pass to propagate constant expressions
    std::unique_ptr<ConstantPropagationPass> identify_constants;
    /// The pass to identify projections
    std::unique_ptr<IdentifyColumnComputationsPass> identify_projections;
    /// The pass to identify filters
    std::unique_ptr<IdentifyColumnFiltersPass> identify_filters;

   public:
    /// Constructor
    Analyzer(std::shared_ptr<ParsedScript> parsed, Catalog& catalog);
    /// Run the analyzer
    std::pair<std::shared_ptr<AnalyzedScript>, buffers::status::StatusCode> Execute();

    /// Analyze a program
    static std::pair<std::shared_ptr<AnalyzedScript>, buffers::status::StatusCode> Analyze(
        std::shared_ptr<ParsedScript> parsed, Catalog& catalog);
};

}  // namespace dashql
