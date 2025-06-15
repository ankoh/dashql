#pragma once

#include "dashql/analyzer/pass_manager.h"
#include "dashql/buffers/index_generated.h"
#include "dashql/catalog.h"
#include "dashql/utils/attribute_index.h"

namespace dashql {

struct NameResolutionPass;
struct IdentifyConstExprsPass;
struct IdentifyProjectionsPass;
struct IdentifyRestrictionsPass;
class AnalyzedScript;

struct Analyzer {
    friend class AnalyzedScript;

   protected:
    /// The catalog
    Catalog& catalog;
    /// The parsed program
    const std::shared_ptr<ParsedScript> parsed;
    /// The parsed program
    std::shared_ptr<AnalyzedScript> analyzed;
    /// The attribute index
    AttributeIndex attribute_index;
    /// The pass manager
    PassManager pass_manager;
    /// The name resolution pass
    std::unique_ptr<NameResolutionPass> name_resolution;
    /// The pass to identify constant expressions
    std::unique_ptr<IdentifyConstExprsPass> identify_constants;
    /// The pass to identify projections
    std::unique_ptr<IdentifyProjectionsPass> identify_projections;
    /// The pass to identify restrictions
    std::unique_ptr<IdentifyRestrictionsPass> identify_restrictions;

   public:
    /// Constructor
    Analyzer(std::shared_ptr<ParsedScript> parsed, Catalog& catalog);

    /// Analyze a program
    static std::pair<std::shared_ptr<AnalyzedScript>, buffers::status::StatusCode> Analyze(
        std::shared_ptr<ParsedScript> parsed, Catalog& catalog);
};

}  // namespace dashql
