#pragma once

#include "dashql/analyzer/pass_manager.h"
#include "dashql/buffers/index_generated.h"
#include "dashql/catalog.h"
#include "dashql/script.h"
#include "dashql/text/names.h"
#include "dashql/utils/attribute_index.h"

namespace dashql {

struct NameResolutionPass;
struct IdentifyColumnRestrictionsPass;
struct IdentifyColumnTransformsPass;
struct IdentifyConstantExpressionsPass;
class ScannedScript;
class ParsedScript;

/// The state state is shared between the passes
struct AnalyzerState {
    /// Contains an entry for every ast node, storing an expression pointer if the ast node has been translated.
    using ExpressionIndex = std::vector<const AnalyzedScript::Expression*>;

    /// The scanned program (input)
    ScannedScript& scanned;
    /// The parsed program (input)
    ParsedScript& parsed;
    /// The parsed ast
    std::span<const buffers::parser::Node> ast;
    /// The analyzed program (output)
    std::shared_ptr<AnalyzedScript> analyzed;

    /// The external id of the current script
    const CatalogEntryID catalog_entry_id;
    /// The catalog
    Catalog& catalog;

    /// The attribute index
    AttributeIndex attribute_index;
    /// The expression index.
    ExpressionIndex expression_index;

    /// A dummy emtpy registered name.
    /// Used to construct qualified column and table identifiers and fill the prefix.
    RegisteredName& empty_name;

    /// Constructor
    AnalyzerState(std::shared_ptr<ParsedScript> parsed, Catalog& catalog);
};

struct Analyzer {
    friend class AnalyzedScript;

   protected:
    /// The shared analysis state
    AnalyzerState state;

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
