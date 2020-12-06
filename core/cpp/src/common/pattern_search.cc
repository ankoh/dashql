#include "dashql/common/pattern_search.h"

namespace dashql {

PatternShiftArray::PatternShiftArray() {}

PatternShiftArray::PatternShiftArray(std::string search_term) : length(std::min<size_t>(255, search_term.size())) {
    // Initialize the shifts array
    shifts = std::unique_ptr<uint8_t[]>(new uint8_t[length * 255]);
    memset(shifts.get(), 0, length * 255 * sizeof(uint8_t));

    // Iterate over each of the characters in the array
    for (size_t main_idx = 0; main_idx < length; main_idx++) {
        uint8_t current_char = (uint8_t)search_term[main_idx];

        // Now move over all the remaining positions
        for (size_t i = main_idx; i < length; i++) {
            bool is_match = true;

            // Check if the prefix matches at this position
            // If it does, we move to this position after encountering the current character
            for (size_t j = 0; j < main_idx; j++) {
                if (search_term[i - main_idx + j] != search_term[j]) {
                    is_match = false;
                }
            }
            if (!is_match) {
                continue;
            }
            shifts[i * 255 + current_char] = main_idx + 1;
        }
    }
}

}  // namespace dashql
