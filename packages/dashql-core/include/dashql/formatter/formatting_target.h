#pragma once

#include <algorithm>
#include <cassert>
#include <cstddef>
#include <functional>
#include <optional>
#include <string>
#include <string_view>
#include <tuple>
#include <variant>

#include "dashql/buffers/index_generated.h"
#include "dashql/utils/small_vector.h"

namespace dashql {

constexpr size_t FORMATTING_DEFAULT_INDENTATION_WIDTH = 2;
constexpr size_t FORMATTING_DEFAULT_HANGING_INDENTATION_WIDTH = 2;
constexpr size_t FORMATTING_DEFAULT_MAX_WIDTH = 120;

/// Parse formatting mode from string
inline constexpr buffers::formatting::FormattingMode ParseFormattingMode(std::string_view value) {
    if (value == "inline") return buffers::formatting::FormattingMode::INLINE;
    if (value == "compact") return buffers::formatting::FormattingMode::COMPACT;
    if (value == "pretty") return buffers::formatting::FormattingMode::PRETTY;
    return buffers::formatting::FormattingMode::COMPACT;
}

/// Return the string name for a formatting mode
inline constexpr std::string_view FormattingModeToString(buffers::formatting::FormattingMode mode) {
    switch (mode) {
        case buffers::formatting::FormattingMode::INLINE:
            return "inline";
        case buffers::formatting::FormattingMode::COMPACT:
            return "compact";
        case buffers::formatting::FormattingMode::PRETTY:
            return "pretty";
    }
    return "compact";
}

/// Parse formatting dialect from string
inline constexpr buffers::formatting::FormattingDialect ParseFormattingDialect(std::string_view value) {
    if (value == "duckdb") return buffers::formatting::FormattingDialect::DUCKDB;
    return buffers::formatting::FormattingDialect::DUCKDB;
}

/// Return the string name for a formatting dialect
inline constexpr std::string_view FormattingDialectToString(buffers::formatting::FormattingDialect dialect) {
    switch (dialect) {
        case buffers::formatting::FormattingDialect::DUCKDB:
            return "duckdb";
    }
    return "duckdb";
}

/// A line break
enum LineBreakTag { LineBreak };
/// A indentation
struct Indent {
    /// The level
    size_t level = 0;
    /// The indentation width
    size_t indentation_width = 0;
    /// Constructor
    explicit Indent(size_t level = 0, size_t indentation_width = FORMATTING_DEFAULT_INDENTATION_WIDTH)
        : level(level), indentation_width(indentation_width) {}
    /// Constructor
    explicit Indent(const buffers::formatting::FormattingConfigT& config)
        : level(0), indentation_width(config.indentation_width) {}
    /// Get the size
    size_t GetSize() const { return level * indentation_width; }
    /// Arithmentic to bump the level
    Indent operator+(size_t n) const { return Indent{level + n, indentation_width}; }
};
/// A line break followed by an indentation.
struct BreakIndentTag {
    Indent indent;
};
struct FormattingBuffer;
/// A formatting entry that does not reference another buffer.
using FormattingAtomEntry = std::variant<std::string_view, Indent, LineBreakTag, BreakIndentTag>;
inline size_t GetFormattingAtomSize(const FormattingAtomEntry& entry) {
    return std::visit(
        [](const auto& v) -> size_t {
            using T = std::decay_t<decltype(v)>;
            if constexpr (std::is_same_v<T, std::string_view>) {
                return v.size();
            } else if constexpr (std::is_same_v<T, Indent>) {
                return v.GetSize();
            } else if constexpr (std::is_same_v<T, LineBreakTag>) {
                return 1;
            } else if constexpr (std::is_same_v<T, BreakIndentTag>) {
                return 1 + v.indent.GetSize();
            }
        },
        entry);
}
/// A runtime layout selector between two structural branches.
struct Select {
    size_t inline_width = 0;
    std::optional<FormattingAtomEntry> inline_entry;
    std::optional<FormattingAtomEntry> break_entry;
};

/// A formatting entry
using FormattingEntry =
    std::variant<std::string_view, Indent, LineBreakTag, BreakIndentTag, Select,
                 std::reference_wrapper<const FormattingBuffer>>;

/// A formatting buffer that collects output
struct FormattingBuffer {
    /// The entries
    SmallVector<FormattingEntry, 3> entries;
    /// The selected mode
    buffers::formatting::FormattingMode mode = buffers::formatting::FormattingMode::INLINE;
    /// The indentation of this component
    Indent indent;
    /// The current offset. (if specified)
    /// By default, we don't know.
    std::optional<size_t> offset = std::nullopt;
    /// The current line width.
    /// By default, we know it's 0.
    size_t line_width = 0;
    /// Emit debug comments before line breaks.
    bool debug_mode = false;
    /// The number of line breaks.
    size_t line_breaks = 0;
    /// Whether this buffer contains runtime layout choices.
    bool has_runtime_choices = false;
    /// The number of characters that this node contributed.
    /// Not counting characters by referenced child buffers.
    size_t contributed_chars = 0;

    /// Configure the buffer
    FormattingBuffer& Configure(buffers::formatting::FormattingMode m, Indent i, std::optional<size_t> ofs) {
        mode = m;
        indent = i;
        offset = ofs;
        return *this;
    }
    /// Get the indentation
    Indent GetIndent() const { return indent; }
    /// Get the current line width
    size_t GetEnd() const { return (line_breaks == 0) ? (offset.value_or(0) + line_width) : line_width; }
    /// Get the tracked width
    size_t GetWidth() const { return line_width; }
    /// Append a string view
    FormattingBuffer& operator<<(std::string_view s) {
        line_width += s.size();
        contributed_chars += s.size();
        entries.push_back(s);
        return *this;
    }
    /// Append an indentation
    FormattingBuffer& operator<<(Indent i) {
        line_width += i.GetSize();
        contributed_chars += i.GetSize();
        entries.push_back(i);
        return *this;
    }
    /// Append an indentation
    FormattingBuffer& operator<<(LineBreakTag lb) {
        line_width = 0;
        line_breaks += 1;
        contributed_chars += 1;
        entries.push_back(lb);
        return *this;
    }
    /// Append a line break with indentation
    FormattingBuffer& operator<<(BreakIndentTag bi) {
        line_width = bi.indent.GetSize();
        line_breaks += 1;
        contributed_chars += 1 + bi.indent.GetSize();
        entries.push_back(bi);
        return *this;
    }
    /// Append a runtime layout choice
    FormattingBuffer& operator<<(Select choice) {
        has_runtime_choices = true;
        contributed_chars += std::max(choice.inline_entry ? GetFormattingAtomSize(*choice.inline_entry) : 0,
                                      choice.break_entry ? GetFormattingAtomSize(*choice.break_entry) : 0);
        entries.push_back(std::move(choice));
        return *this;
    }
    /// Append another formatting buffer
    FormattingBuffer& operator<<(std::reference_wrapper<const FormattingBuffer> other) {
        if (!other.get().has_runtime_choices && other.get().line_breaks == 0) {
            // No line breaks in child: the current line continues, so we can track width.
            line_width += other.get().line_width;
        } else if (!other.get().has_runtime_choices) {
            // Child has line breaks: adopt the child state
            line_width = other.get().line_width;
            line_breaks += other.get().line_breaks;
        } else {
            has_runtime_choices = true;
        }
        contributed_chars += other.get().contributed_chars;
        entries.push_back(other);
        return *this;
    }
    /// Append another formatting buffer by direct reference
    FormattingBuffer& operator<<(const FormattingBuffer& other) { return *this << std::cref(other); }
    /// Apply an optional value
    template <typename V> FormattingBuffer& operator<<(std::optional<V> v) {
        if (v.has_value()) {
            return *this << v;
        }
        return *this;
    }
    /// Apply a parameter pack
    template <typename... Vs> FormattingBuffer& operator<<(std::tuple<Vs...> v) {
        std::apply([this](auto&&... args) { ((*this) << ... << args); }, v);
        return *this;
    }
    /// Write the formatted text from entries into output
    void WriteText(std::string& output, size_t max_width, size_t& current_line_width, bool debug_mode) const;
};

}  // namespace dashql
