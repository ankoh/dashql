#include "dashql/text/names.h"

namespace dashql {

/// Compute the script signature
size_t ComputeScriptSignature(std::string_view text, std::span<const buffers::parser::Node> ast,
                              const NameRegistry& names, bool skip_names_and_literals);

}  // namespace dashql
