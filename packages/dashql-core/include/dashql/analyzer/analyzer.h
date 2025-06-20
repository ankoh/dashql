#pragma once

#include "dashql/analyzer/analysis_state.h"
#include "dashql/analyzer/pass_manager.h"
#include "dashql/buffers/index_generated.h"
#include "dashql/catalog.h"
#include "dashql/script.h"

namespace dashql {

struct NameResolutionPass;
struct IdentifyColumnRestrictionsPass;
struct IdentifyColumnTransformsPass;
struct IdentifyConstantExpressionsPass;
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
    /// The pass to identify constant expressions
    std::unique_ptr<IdentifyConstantExpressionsPass> identify_constants;
    /// The pass to identify projections
    std::unique_ptr<IdentifyColumnTransformsPass> identify_projections;
    /// The pass to identify restrictions
    std::unique_ptr<IdentifyColumnRestrictionsPass> identify_restrictions;

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
