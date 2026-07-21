#pragma once

#include <string>

#include "dashql/script.h"

namespace dashql::visualize {

/// Generate a pretty-printed Vega-Lite JSON specification from an analyzed VisualizationSpec.
std::string GenerateVegaLiteSpec(const VisualizationSpec& spec, const AnalyzedScript& script);

/// Generate the umap projection spec as pretty-printed JSON:
/// `{vectorColumn, categoryColumn?, labelColumn?, projection:{method, neighbors, minDist, metric}}`.
/// The 2D projection itself runs client-side; this records only column names + params.
std::string GenerateUmapSpec(const VisualizationSpec& spec, const AnalyzedScript& script);

/// Parse a Vega-Lite JSON spec and produce a pretty-printed VISUALIZE statement.
std::string ParseVegaLiteToVisualize(const std::string& vegalite_json);

}  // namespace dashql::visualize
