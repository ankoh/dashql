#include <stack>

#include "dashql/formatter/formatting_target.h"

namespace dashql {

void FormattingBuffer::WriteText(std::string& output) const {
    std::stack<FormattingEntry<FormattingBuffer>> pending;
    size_t current_line_width = 0;
    for (auto it = entries.rbegin(); it != entries.rend(); ++it) {
        pending.push(*it);
    }
    while (!pending.empty()) {
        auto entry = pending.top();
        pending.pop();
        std::visit(
            [&](const auto& v) {
                using T = std::decay_t<decltype(v)>;
                if constexpr (std::is_same_v<T, std::string_view>) {
                    output += v;
                    current_line_width += v.size();
                } else if constexpr (std::is_same_v<T, Indent>) {
                    output.append(v.GetSize(), ' ');
                    current_line_width += v.GetSize();
                } else if constexpr (std::is_same_v<T, LineBreakTag>) {
                    output += '\n';
                    current_line_width = 0;
                } else if constexpr (std::is_same_v<T, DebugLineWidthTag>) {
                    output += " /*";
                    output += std::to_string(current_line_width);
                    output += "*/";
                } else if constexpr (std::is_same_v<T, std::reference_wrapper<const FormattingBuffer>>) {
                    for (auto it = v.get().entries.rbegin(); it != v.get().entries.rend(); ++it) {
                        pending.push(*it);
                    }
                }
            },
            entry);
    }
}

}  // namespace dashql
