#pragma once

#include <string_view>

namespace dashql::shell::vt100 {

inline constexpr std::string_view kControlSequenceIntroducer = "\x1b[";
inline constexpr std::string_view kCarriageReturn = "\r";
inline constexpr std::string_view kNewLine = "\r\n";

inline constexpr std::string_view kCursorUpCommand = "A";
inline constexpr std::string_view kCursorDownCommand = "B";
inline constexpr std::string_view kCursorForwardCommand = "C";
inline constexpr std::string_view kCursorBackwardCommand = "D";
inline constexpr std::string_view kInsertCharacterCommand = "@";
inline constexpr std::string_view kDeleteCharacterCommand = "P";
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
