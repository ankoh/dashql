// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_COMMON_STRING_INDEX_H_
#define INCLUDE_DASHQL_COMMON_STRING_INDEX_H_

#include <array>
#include <string>

#include "dashql/proto_generated.h"

namespace dashql {

/// We have the following problem:
///
/// We track locations of AST nodes as offsets within the full script text.
/// When generating actions for statements, we want to copy substrings of this text and replace parts of it
/// with other strings (e.g. substitute a variable with a constant literal).
///
/// This buffer helps to do the following:
///     A) Index the extracted substring buffer with the global locations.
///     B) Maintain this index even when replacing a part of the substring with a string of different size.
///
/// We assume that the number of edits is reasonably small.
/// The runtime is quadratic in the number of edits but use a very compact edit log that can be applied branch-free.
///
class SubstringBuffer {
   protected:
    /// A location patch
    struct Patch {
        /// Every location that is >= or <= offset will be patched
        size_t offset;
        /// ... by adding or substracting adjust
        size_t adjust;
    };

    /// The location of the substring
    proto::syntax::Location substring_loc_;
    /// The string buffer
    std::string buffer_;
    /// The patches for edits that lengthened the original string
    std::vector<Patch> lengthen_;
    /// The patches for edits that shortened the original string
    std::vector<Patch> shorten_;

    /// Patch a location
    proto::syntax::Location CheckBounds(proto::syntax::Location loc) const;
    /// Patch a location
    proto::syntax::Location ApplyPatches(proto::syntax::Location loc) const;

   public:
    /// Constructor
    SubstringBuffer(std::string_view text);
    /// Constructor
    SubstringBuffer(std::string_view text, proto::syntax::Location loc);

    /// Intersect a location?
    bool Intersects(proto::syntax::Location loc) const;
    /// Replace substring
    void Replace(proto::syntax::Location loc, std::string_view value);
    /// Emit the substring
    std::string Finish() const { return buffer_; }
};

}  // namespace dashql

#endif  // INCLUDE_DASHQL_STRING_INDEX_H_
