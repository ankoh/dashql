#pragma once

#include <cassert>
#include <cstddef>
#include <string_view>

#include "dashql/utils/intrusive_list.h"
#include "dashql/utils/small_vector.h"

namespace dashql {

constexpr size_t FORMATTING_DEFAULT_INDENTATION_WIDTH = 4;
constexpr size_t FORMATTING_DEFAULT_MAX_WIDTH = 128;

/// A formatting config
struct FormattingConfig {
    /// How many characters are used for an indentation level?
    size_t indentation_width = FORMATTING_DEFAULT_INDENTATION_WIDTH;
    /// What's our max-width that we want to render
    size_t max_width = FORMATTING_DEFAULT_MAX_WIDTH;
};

/// A line break
enum LineBreakTag { LineBreak };
/// A indentation
struct Indent {
    /// The level
    size_t level = 0;
    /// The indentation width
    size_t indentation_width = 0;
    /// Constructor
    explicit Indent() : level(0) {}
    /// Constructor
    explicit Indent(size_t level, FormattingConfig config)
        : level(level), indentation_width(config.indentation_width) {}
    /// Get the size
    size_t GetSize() { return level * indentation_width; }
};

template <typename T>
concept FormattingTarget = requires(T t, const T ct, const T& ctr, Indent i, std::string_view s, LineBreakTag lb) {
    { t << s } -> std::same_as<T&>;
    { t << lb } -> std::same_as<T&>;
    { t << i } -> std::same_as<T&>;
    { t << ctr } -> std::same_as<T&>;

    { ct.GetLineBreaks() } -> std::convertible_to<size_t>;
    { ct.GetCurrentLineWidth() } -> std::convertible_to<size_t>;
    { ct.GetFirstLineWidth() } -> std::convertible_to<size_t>;
};

/// A formatting buffer that collects output
struct FormattingBuffer {
    /// An entry
    using Entry = std::variant<std::string_view, Indent, LineBreakTag, std::reference_wrapper<const FormattingBuffer>>;

    /// The entries
    SmallVector<Entry, 4> entries;
    /// The current line width
    size_t current_line_width = 0;
    /// The maximum line width
    size_t first_line_width = 0;
    /// The number of line breaks
    size_t line_breaks = 0;

    /// Get the number of line breaks
    size_t GetLineBreaks() const { return line_breaks; }
    /// Get the current line width
    size_t GetCurrentLineWidth() const { return current_line_width; }
    /// Get the line width of the first line
    size_t GetFirstLineWidth() const { return first_line_width; }

    /// Append a string view
    FormattingBuffer& operator<<(std::string_view s) {
        current_line_width += s.size();
        entries.push_back(s);
        return *this;
    }
    /// Append an indentation
    FormattingBuffer& operator<<(Indent i) {
        current_line_width += i.GetSize();
        entries.push_back(i);
        return *this;
    }
    /// Append an indentation
    FormattingBuffer& operator<<(LineBreakTag lb) {
        if (line_breaks == 0) {
            first_line_width = current_line_width;
        }
        current_line_width = 0;
        entries.push_back(lb);
        return *this;
    }
    /// Append another formatting buffer
    FormattingBuffer& operator<<(const FormattingBuffer& other) {
        if (other.line_breaks == 0) {
            current_line_width += other.current_line_width;
        } else {
            current_line_width = other.current_line_width;
            line_breaks = 0;
        }
        current_line_width = 0;
        ++line_breaks;
        entries.push_back(other);
        return *this;
    }
};
static_assert(FormattingTarget<FormattingBuffer>);

/// A simulating formatting target to compute the inline width
struct SimulatedFormattingBuffer {
   protected:
    /// The current inline width
    size_t inline_width = 0;

   public:
    /// Get the number of line breaks
    size_t GetLineBreaks() const { return 0; }
    /// Get the current line width
    size_t GetCurrentLineWidth() const { return inline_width; }
    /// Get the line width of the first line
    size_t GetFirstLineWidth() const { return inline_width; }

    /// Write a text
    SimulatedFormattingBuffer& operator<<(std::string_view s) {
        inline_width += s.size();
        return *this;
    }
    /// Write an indentation
    SimulatedFormattingBuffer& operator<<(Indent i) {
        inline_width += i.GetSize();
        return *this;
    }
    /// Write a line break
    SimulatedFormattingBuffer& operator<<(LineBreakTag) {
        assert(false);
        return *this;
    }
    /// Write a formatting target
    SimulatedFormattingBuffer& operator<<(const SimulatedFormattingBuffer& other) {
        inline_width += other.inline_width;
        return *this;
    }
};
static_assert(FormattingTarget<SimulatedFormattingBuffer>);

}  // namespace dashql
