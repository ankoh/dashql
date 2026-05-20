#pragma once

#include <string>

#include "dashql/script.h"

namespace dashql::visualize {

/// Generate a pretty-printed Vega-Lite JSON specification from an analyzed VisualizationSpec.
std::string GenerateVegaLiteSpec(const VisualizationSpec& spec, const AnalyzedScript& script);

/// Parse a Vega-Lite JSON spec and produce a pretty-printed VISUALIZE statement.
std::string ParseVegaLiteToVisualize(const std::string& vegalite_json);

}  // namespace dashql::visualize
