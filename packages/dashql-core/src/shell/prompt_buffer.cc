#include "dashql/shell/prompt_buffer.h"

#include <algorithm>

#include "utf8proc/utf8proc_wrapper.hpp"

namespace dashql::shell {
namespace {

bool IsWordGrapheme(std::string_view grapheme) {
    if (grapheme.empty()) return false;
    const auto byte = static_cast<unsigned char>(grapheme.front());
    if (byte >= 0x80) return true;
    return (byte >= 'a' && byte <= 'z') || (byte >= 'A' && byte <= 'Z') || (byte >= '0' && byte <= '9') ||
           byte == '_';
}

size_t PreviousGrapheme(std::string_view text, size_t offset) {
    return utf8::Utf8Proc::PreviousGraphemeCluster(text, offset);
}

size_t NextGrapheme(std::string_view text, size_t offset) {
    const auto next = utf8::Utf8Proc::NextGraphemeCluster(text, offset);
    return next > offset ? next : offset + 1;
}

}  // namespace

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

bool PromptBuffer::MoveToLineStart() {
    const auto text = script_.text.ToString();
    const auto cursor = cursor_byte_offset();
    const auto line_break = cursor == 0 ? std::string::npos : text.rfind('\n', cursor - 1);
    return MoveToByteOffset(line_break == std::string::npos ? 0 : line_break + 1);
}

bool PromptBuffer::MoveToLineEnd() {
    const auto text = script_.text.ToString();
    const auto line_break = text.find('\n', cursor_byte_offset());
    return MoveToByteOffset(line_break == std::string::npos ? text.size() : line_break);
}

bool PromptBuffer::MoveWordLeft() {
    const auto text = script_.text.ToString();
    auto cursor = cursor_byte_offset();
    const auto original = cursor;
    while (cursor > 0) {
        const auto previous = PreviousGrapheme(text, cursor);
        if (IsWordGrapheme(std::string_view{text}.substr(previous, cursor - previous))) break;
        cursor = previous;
    }
    while (cursor > 0) {
        const auto previous = PreviousGrapheme(text, cursor);
        if (!IsWordGrapheme(std::string_view{text}.substr(previous, cursor - previous))) break;
        cursor = previous;
    }
    return cursor != original && MoveToByteOffset(cursor);
}

bool PromptBuffer::MoveWordRight() {
    const auto text = script_.text.ToString();
    auto cursor = cursor_byte_offset();
    const auto original = cursor;
    while (cursor < text.size() &&
           !IsWordGrapheme(std::string_view{text}.substr(cursor, NextGrapheme(text, cursor) - cursor))) {
        cursor = NextGrapheme(text, cursor);
    }
    while (cursor < text.size() &&
           IsWordGrapheme(std::string_view{text}.substr(cursor, NextGrapheme(text, cursor) - cursor))) {
        cursor = NextGrapheme(text, cursor);
    }
    return cursor != original && MoveToByteOffset(cursor);
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

bool PromptBuffer::DeleteToLineStart(std::string* deleted) {
    const auto text = script_.text.ToString();
    const auto end = cursor_byte_offset();
    const auto line_break = end == 0 ? std::string::npos : text.rfind('\n', end - 1);
    const auto begin = line_break == std::string::npos ? 0 : line_break + 1;
    if (begin == end) return false;
    if (deleted != nullptr) deleted->assign(text, begin, end - begin);
    return ReplaceByteRange(begin, end - begin, {});
}

bool PromptBuffer::DeleteToLineEnd(std::string* deleted) {
    const auto text = script_.text.ToString();
    const auto begin = cursor_byte_offset();
    const auto line_break = text.find('\n', begin);
    const auto end = line_break == begin ? line_break + 1 : line_break == std::string::npos ? text.size() : line_break;
    if (begin == end) return false;
    if (deleted != nullptr) deleted->assign(text, begin, end - begin);
    return ReplaceByteRange(begin, end - begin, {});
}

bool PromptBuffer::DeleteWordBackward(std::string* deleted) {
    const auto end = cursor_byte_offset();
    if (!MoveWordLeft()) return false;
    const auto begin = cursor_byte_offset();
    const auto text = script_.text.ToString();
    if (deleted != nullptr) deleted->assign(text, begin, end - begin);
    return ReplaceByteRange(begin, end - begin, {});
}

bool PromptBuffer::DeleteWordForward(std::string* deleted) {
    const auto begin = cursor_byte_offset();
    if (!MoveWordRight()) return false;
    const auto end = cursor_byte_offset();
    const auto text = script_.text.ToString();
    if (deleted != nullptr) deleted->assign(text, begin, end - begin);
    return ReplaceByteRange(begin, end - begin, {});
}

bool PromptBuffer::TransposeCharacters() {
    const auto count = grapheme_count();
    if (count < 2 || cursor_grapheme_offset_ == 0) return false;
    const auto left_index = cursor_grapheme_offset_ == count ? count - 2 : cursor_grapheme_offset_ - 1;
    const auto right_index = left_index + 1;
    const auto begin = script_.text.ResolveGrapheme(left_index).text_bytes;
    const auto middle = script_.text.ResolveGrapheme(right_index).text_bytes;
    const auto end = script_.text.ResolveGrapheme(right_index + 1).text_bytes;
    const auto text = script_.text.ToString();
    std::string replacement{text.substr(middle, end - middle)};
    replacement.append(text, begin, middle - begin);
    return ReplaceByteRange(begin, end - begin, replacement);
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
