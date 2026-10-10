#pragma once

#include <flatbuffers/detached_buffer.h>

#include <cstdint>
#include <span>

namespace dashql {

/// Borrows the request, returns owned bytes. Invalid request/context throws.
/// Inputs share only descriptor context, never publish declarations to each other.
flatbuffers::DetachedBuffer ProcessBatch(std::span<const uint8_t> request);

}  // namespace dashql
