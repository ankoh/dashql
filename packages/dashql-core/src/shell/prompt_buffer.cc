#include "dashql/shell/prompt_buffer.h"

#include <algorithm>

#include "utf8proc/utf8proc_wrapper.hpp"

namespace dashql::shell {

PromptBuffer::PromptBuffer(Catalog& catalog) : script_{catalog} {}

bool PromptBuffer::SetText(std::string_view text) {
    if (!utf8::Utf8Proc::IsValid(text)) {
        return false;
    }
    const auto current = script_.text.ToString();
    if (text.size() == current.size() && text == current) {
        cursor_grapheme_offset_ = script_.text.GetStats().grapheme_clusters;
        return true;
    }
    script_.ReplaceText(text);
    ++revision_;
    cursor_grapheme_offset_ = script_.text.GetStats().grapheme_clusters;
    return true;
}

bool PromptBuffer::Insert(std::string_view text) {
    if (text.empty() || !utf8::Utf8Proc::IsValid(text)) {
        return false;
    }
    const auto desired_byte_offset = cursor_byte_offset() + text.size();
    script_.InsertTextAt(cursor_codepoint_offset(), text);
    ++revision_;
    cursor_grapheme_offset_ = script_.text.ResolveGraphemeBoundaryAtOrAfter(desired_byte_offset).grapheme_clusters;
    return true;
}

bool PromptBuffer::MoveLeft() {
    if (cursor_grapheme_offset_ == 0) {
        return false;
    }
    --cursor_grapheme_offset_;
    return true;
}

bool PromptBuffer::MoveRight() {
    if (cursor_grapheme_offset_ >= grapheme_count()) {
        return false;
    }
    ++cursor_grapheme_offset_;
    return true;
}

bool PromptBuffer::MoveToStart() {
    if (cursor_grapheme_offset_ == 0) {
        return false;
    }
    cursor_grapheme_offset_ = 0;
    return true;
}

bool PromptBuffer::MoveToEnd() {
    const auto end = grapheme_count();
    if (cursor_grapheme_offset_ == end) {
        return false;
    }
    cursor_grapheme_offset_ = end;
    return true;
}

bool PromptBuffer::MoveUp() {
    const auto text = script_.text.ToString();
    const auto cursor = cursor_byte_offset();
    const auto line_begin = cursor == 0 ? std::string::npos : text.rfind('\n', cursor - 1);
    if (line_begin == std::string::npos) {
        return false;
    }
    const auto previous_line_end = line_begin;
    const auto previous_line_break = previous_line_end == 0 ? std::string::npos : text.rfind('\n', previous_line_end - 1);
    const auto previous_line_begin = previous_line_break == std::string::npos ? 0 : previous_line_break + 1;
    const auto column = cursor_grapheme_offset_ - script_.text.ResolveGraphemeBoundary(line_begin + 1)->grapheme_clusters;
    const auto previous_line_column = script_.text.ResolveGraphemeBoundary(previous_line_begin)->grapheme_clusters;
    const auto previous_line_length = script_.text.ResolveGraphemeBoundary(previous_line_end)->grapheme_clusters -
                                      previous_line_column;
    cursor_grapheme_offset_ = previous_line_column + std::min(column, previous_line_length);
    return true;
}

bool PromptBuffer::MoveDown() {
    const auto text = script_.text.ToString();
    const auto cursor = cursor_byte_offset();
    const auto next_line_break = text.find('\n', cursor);
    if (next_line_break == std::string::npos) {
        return false;
    }
    const auto line_begin_break = cursor == 0 ? std::string::npos : text.rfind('\n', cursor - 1);
    const auto line_begin = line_begin_break == std::string::npos ? 0 : line_begin_break + 1;
    const auto next_line_begin = next_line_break + 1;
    const auto next_line_end = text.find('\n', next_line_begin);
    const auto column = cursor_grapheme_offset_ - script_.text.ResolveGraphemeBoundary(line_begin)->grapheme_clusters;
    const auto next_line_column = script_.text.ResolveGraphemeBoundary(next_line_begin)->grapheme_clusters;
    const auto next_line_length = script_.text.ResolveGraphemeBoundary(
        next_line_end == std::string::npos ? text.size() : next_line_end)->grapheme_clusters - next_line_column;
    cursor_grapheme_offset_ = next_line_column + std::min(column, next_line_length);
    return true;
}

bool PromptBuffer::MoveToByteOffset(size_t byte_offset) {
    const auto boundary = script_.text.ResolveGraphemeBoundary(byte_offset);
    if (!boundary.has_value()) {
        return false;
    }
    cursor_grapheme_offset_ = boundary->grapheme_clusters;
    return true;
}

bool PromptBuffer::DeleteBackward() {
    if (cursor_grapheme_offset_ == 0) {
        return false;
    }
    const auto begin = script_.text.ResolveGrapheme(cursor_grapheme_offset_ - 1);
    const auto end = script_.text.ResolveGrapheme(cursor_grapheme_offset_);
    script_.EraseTextRange(begin.utf8_codepoints, end.utf8_codepoints - begin.utf8_codepoints);
    --cursor_grapheme_offset_;
    ++revision_;
    return true;
}

bool PromptBuffer::DeleteForward() {
    if (cursor_grapheme_offset_ >= grapheme_count()) {
        return false;
    }
    const auto begin = script_.text.ResolveGrapheme(cursor_grapheme_offset_);
    const auto end = script_.text.ResolveGrapheme(cursor_grapheme_offset_ + 1);
    script_.EraseTextRange(begin.utf8_codepoints, end.utf8_codepoints - begin.utf8_codepoints);
    ++revision_;
    return true;
}

bool PromptBuffer::ReplaceByteRange(size_t byte_offset, size_t byte_length, std::string_view text) {
    if (!utf8::Utf8Proc::IsValid(text)) {
        return false;
    }
    const auto begin = script_.text.ResolveGraphemeBoundary(byte_offset);
    const auto end = script_.text.ResolveGraphemeBoundary(byte_offset + byte_length);
    if (!begin.has_value() || !end.has_value()) {
        return false;
    }
    const auto begin_codepoint = begin->utf8_codepoints;
    const auto deleted_codepoints = end->utf8_codepoints - begin->utf8_codepoints;
    if (deleted_codepoints != 0) {
        script_.EraseTextRange(begin_codepoint, deleted_codepoints);
    }
    if (!text.empty()) {
        script_.InsertTextAt(begin_codepoint, text);
    }
    ++revision_;
    cursor_grapheme_offset_ = script_.text.ResolveGraphemeBoundaryAtOrAfter(byte_offset + text.size()).grapheme_clusters;
    return true;
}

std::string PromptBuffer::Text() {
    return script_.text.ToString();
}

size_t PromptBuffer::cursor_byte_offset() const {
    return script_.text.ResolveGrapheme(cursor_grapheme_offset_).text_bytes;
}

size_t PromptBuffer::cursor_codepoint_offset() const {
    return script_.text.ResolveGrapheme(cursor_grapheme_offset_).utf8_codepoints;
}

}  // namespace dashql::shell
