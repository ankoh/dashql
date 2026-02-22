#pragma once

#include <cassert>
#include <cstddef>
#include <string>
#include <string_view>
#include <variant>
#include <vector>

namespace dashql {

constexpr size_t FORMATTING_DEFAULT_INDENTATION_WIDTH = 2;
constexpr size_t FORMATTING_DEFAULT_HANGING_INDENTATION_WIDTH = 2;
constexpr size_t FORMATTING_DEFAULT_MAX_WIDTH = 128;

/// A formatting config
struct FormattingConfig {
    /// What's our max-width that we want to render
    size_t max_width = FORMATTING_DEFAULT_MAX_WIDTH;
    /// How many characters are used for an indentation level?
    size_t indentation_width = FORMATTING_DEFAULT_INDENTATION_WIDTH;
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
    explicit Indent(FormattingConfig config) : level(0), indentation_width(config.indentation_width) {}
    /// Get the size
    size_t GetSize() const { return level * indentation_width; }
};

/// A formatting entry
template <typename T>
using FormattingEntry = std::variant<std::string_view, Indent, LineBreakTag, std::reference_wrapper<const T>>;
/// A formatting target base concept
template <typename T>
concept FormattingTarget =
    requires(T t, const T ct, Indent i, std::string_view s, LineBreakTag lb, std::reference_wrapper<const T> x) {
        { t << s } -> std::same_as<T&>;
        { t << lb } -> std::same_as<T&>;
        { t << i } -> std::same_as<T&>;
        { t << x } -> std::same_as<T&>;
        { t << std::tuple{i, s, lb, x} } -> std::same_as<T&>;

        { ct.GetLineBreaks() } -> std::convertible_to<size_t>;
        { ct.GetLineWidth() } -> std::convertible_to<size_t>;
    };

/// A formatting buffer that collects output
struct FormattingBuffer {
    /// The entries
    std::vector<FormattingEntry<FormattingBuffer>> entries;
    /// The current line width
    size_t line_width = 0;
    /// The number of line breaks
    size_t line_breaks = 0;

    /// Get the number of line breaks
    size_t GetLineBreaks() const { return line_breaks; }
    /// Get the current line width
    size_t GetLineWidth() const { return line_width; }

    /// Append a string view
    FormattingBuffer& operator<<(std::string_view s) {
        line_width += s.size();
        entries.push_back(s);
        return *this;
    }
    /// Append an indentation
    FormattingBuffer& operator<<(Indent i) {
        line_width += i.GetSize();
        entries.push_back(i);
        return *this;
    }
    /// Append an indentation
    FormattingBuffer& operator<<(LineBreakTag lb) {
        line_width = 0;
        entries.push_back(lb);
        return *this;
    }
    /// Append another formatting buffer
    FormattingBuffer& operator<<(std::reference_wrapper<const FormattingBuffer> other) {
        auto& other_inner = other.get();
        if (other_inner.line_breaks == 0) {
            line_width += other_inner.line_width;
        } else {
            line_width = other_inner.line_width;
            line_breaks = 0;
        }
        line_width = 0;
        ++line_breaks;
        entries.push_back(other);
        return *this;
    }
    /// Apply a parameter pack
    template <typename... Vs> FormattingBuffer& operator<<(std::tuple<Vs...> v) {
        std::apply([this](auto&&... args) { ((*this) << ... << args); }, v);
        return *this;
    }
    /// Write the formatted text from entries into output
    void WriteText(std::string& output) const;
};
static_assert(FormattingTarget<FormattingBuffer>);

/// A simulating formatting target to compute the inline width
struct SimulatedInlineFormatter {
   protected:
    /// The current inline width
    size_t inline_width = 0;

   public:
    /// Get the number of line breaks
    size_t GetLineBreaks() const { return 0; }
    /// Get the current line width
    size_t GetLineWidth() const { return inline_width; }

    /// Write a text
    SimulatedInlineFormatter& operator<<(std::string_view s) {
        inline_width += s.size();
        return *this;
    }
    /// Write an indentation
    SimulatedInlineFormatter& operator<<(Indent i) {
        inline_width += i.GetSize();
        return *this;
    }
    /// Write a line break
    SimulatedInlineFormatter& operator<<(LineBreakTag lb) {
        assert(false);
        return *this;
    }
    /// Write a formatting target
    SimulatedInlineFormatter& operator<<(std::reference_wrapper<const SimulatedInlineFormatter> other) {
        inline_width += other.get().inline_width;
        return *this;
    }
    /// Apply a parameter pack
    template <typename... Vs> SimulatedInlineFormatter& operator<<(std::tuple<Vs...> v) {
        std::apply([this](auto&&... args) { ((*this) << ... << args); }, v);
        return *this;
    }
};
static_assert(FormattingTarget<SimulatedInlineFormatter>);

}  // namespace dashql
