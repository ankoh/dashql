#pragma once

#include <cstddef>
#include <string>
#include <string_view>

namespace dashql::shell::vt100 {

inline constexpr std::string_view kControlSequenceIntroducer = "\x1b[";
inline constexpr std::string_view kCarriageReturn = "\r";
inline constexpr std::string_view kNewLine = "\r\n";

enum class Command : char {
    kInsertCharacter = '@',
    kCursorUp = 'A',
    kCursorDown = 'B',
    kCursorForward = 'C',
    kCursorBackward = 'D',
    kInsertLine = 'L',
    kDeleteLine = 'M',
    kDeleteCharacter = 'P',
};

// Build parameterized CSI commands in one place so cursor/edit operations cannot accidentally
// concatenate the count and command in the wrong order.
inline void AppendSequence(std::string& output, size_t count, Command command) {
    output.append(kControlSequenceIntroducer);
    output.append(std::to_string(count));
    output.push_back(static_cast<char>(command));
}

inline std::string Sequence(size_t count, Command command) {
    std::string output;
    AppendSequence(output, count, command);
    return output;
}

inline constexpr std::string_view kCursorUpOne = "\x1b[1A";
inline constexpr std::string_view kEraseEntireLine = "\x1b[2K";
inline constexpr std::string_view kEraseLineFromCursor = "\x1b[0K";
inline constexpr std::string_view kSaveCursor = "\x1b[s";
inline constexpr std::string_view kRestoreCursor = "\x1b[u";
inline constexpr std::string_view kEnableAutoWrap = "\x1b[?7h";
inline constexpr std::string_view kDisableAutoWrap = "\x1b[?7l";

inline constexpr std::string_view kResetAttributes = "\x1b[0m";
inline constexpr std::string_view kBold = "\x1b[1m";
inline constexpr std::string_view kReverseVideo = "\x1b[7m";
inline constexpr std::string_view kForegroundRed = "\x1b[31m";
inline constexpr std::string_view kForegroundBrightBlack = "\x1b[90m";
inline constexpr std::string_view kBoldForegroundPink = "\x1b[1;38;2;255;122;178m";
inline constexpr std::string_view kItalicForegroundTeal = "\x1b[3;38;2;107;170;159m";
inline constexpr std::string_view kForegroundPurple = "\x1b[38;2;218;186;255m";
inline constexpr std::string_view kForegroundCoral = "\x1b[38;2;255;129;112m";
inline constexpr std::string_view kForegroundPink = "\x1b[38;2;255;122;178m";
inline constexpr std::string_view kForegroundTeal = "\x1b[38;2;107;170;159m";
inline constexpr std::string_view kForegroundGray = "\x1b[38;2;127;140;152m";

}  // namespace dashql::shell::vt100
