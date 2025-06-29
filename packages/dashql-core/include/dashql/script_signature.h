#include <functional>
#include <span>
#include <string_view>

#include "dashql/buffers/index_generated.h"
#include "dashql/text/names.h"

namespace dashql {

/// Compute the script signature
size_t ComputeScriptSignature(std::string_view text, std::span<const buffers::parser::Node> ast,
                              NameResolver& name_resolver, bool skip_names_and_literals);

}  // namespace dashql
