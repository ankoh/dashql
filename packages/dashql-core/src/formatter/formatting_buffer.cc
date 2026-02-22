#include <stack>

#include "dashql/formatter/formatting_target.h"

namespace dashql {

void FormattingBuffer::WriteText(std::string& output) const {
    std::stack<FormattingEntry<FormattingBuffer>> pending;
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
                } else if constexpr (std::is_same_v<T, Indent>) {
                    output.append(v.GetSize(), ' ');
                } else if constexpr (std::is_same_v<T, LineBreakTag>) {
                    output += '\n';
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
