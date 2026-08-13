#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>

#include "dashql/script.h"

namespace dashql::shell {

class PromptBuffer {
   public:
    static_assert(sizeof(Script) >= sizeof(void*) * 8);
    explicit PromptBuffer(Catalog& catalog);

    bool SetText(std::string_view text);
    bool Insert(std::string_view text);
    bool MoveLeft();
    bool MoveRight();
    bool MoveUp();
    bool MoveDown();
    bool MoveToByteOffset(size_t byte_offset);
    bool DeleteBackward();
    bool DeleteForward();
    bool ReplaceByteRange(size_t byte_offset, size_t byte_length, std::string_view text);

    std::string Text();
    Script& script() { return script_; }
    const Script& script() const { return script_; }
    size_t cursor_byte_offset() const;
    size_t cursor_codepoint_offset() const;
    size_t grapheme_count() const { return script_.text.GetStats().grapheme_clusters; }
    uint64_t revision() const { return revision_; }

   private:
    Script script_;
    size_t cursor_grapheme_offset_ = 0;
    uint64_t revision_ = 0;
};

}  // namespace dashql::shell
