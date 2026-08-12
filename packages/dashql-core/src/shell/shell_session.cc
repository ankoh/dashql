#include "dashql/shell/shell_session.h"

#include <algorithm>
#include <cstring>
#include <exception>
#include <limits>
#include <stdexcept>
#include <unordered_set>
#include <utility>

#include "dashql/analyzer/completion.h"
#include "dashql/script_compiler.h"
#include "dashql/shell/vt100.h"
#include "utf8proc/utf8proc_wrapper.hpp"

namespace dashql::shell {
namespace {

using ScannerTokenType = buffers::parser::ScannerTokenType;

constexpr uint32_t EFFECT_ENVELOPE_VERSION = 1;
constexpr size_t EFFECT_ENVELOPE_HEADER_SIZE = 16;
constexpr size_t HISTORY_LIMIT = 1000;
constexpr size_t TERMINAL_COMPLETION_ROWS = 10;

std::string_view TokenStyle(ScannerTokenType type) {
    switch (type) {
        case ScannerTokenType::KEYWORD:
            return vt100::kBoldForegroundPink;
        case ScannerTokenType::KEYWORD_VIS:
            return vt100::kItalicForegroundTeal;
        case ScannerTokenType::LITERAL_INTEGER:
        case ScannerTokenType::LITERAL_FLOAT:
        case ScannerTokenType::LITERAL_BINARY:
        case ScannerTokenType::LITERAL_HEX:
        case ScannerTokenType::LITERAL_BOOLEAN:
            return vt100::kForegroundPurple;
        case ScannerTokenType::LITERAL_STRING:
            return vt100::kForegroundCoral;
        case ScannerTokenType::OPERATOR:
            return vt100::kForegroundPink;
        case ScannerTokenType::IDENTIFIER:
            return vt100::kForegroundTeal;
        case ScannerTokenType::COMMENT:
            return vt100::kForegroundGray;
        default:
            return {};
    }
}

void AppendCursorMove(std::string& output, size_t count, std::string_view command) {
    if (count == 0) return;
    output.append(vt100::kControlSequenceIntroducer);
    output.append(std::to_string(count));
    output.append(command);
}

size_t CountLines(std::string_view text) {
    return 1 + static_cast<size_t>(std::count(text.begin(), text.end(), '\n'));
}

size_t DisplayWidth(std::string_view text) {
    if (!utf8::Utf8Proc::IsValid(text)) return text.size();
    size_t width = 0;
    for (size_t offset = 0; offset < text.size();) {
        width += utf8::Utf8Proc::RenderWidth(text, offset);
        const auto next = utf8::Utf8Proc::NextGraphemeCluster(text, offset);
        offset = next > offset ? next : offset + 1;
    }
    return width;
}

std::string EscapeTerminalText(std::string_view text) {
    std::string output;
    output.reserve(text.size());
    constexpr char HEX[] = "0123456789abcdef";
    for (const auto byte : text) {
        const auto value = static_cast<uint8_t>(byte);
        if (value == '\t') {
            output.append("    ");
        } else if (value < 0x20 || value == 0x7f) {
            output.append("\\x");
            output.push_back(HEX[value >> 4]);
            output.push_back(HEX[value & 0x0f]);
        } else {
            output.push_back(byte);
        }
    }
    return output;
}

void AppendU32(std::string& output, uint32_t value) {
    for (size_t i = 0; i < sizeof(value); ++i) {
        output.push_back(static_cast<char>((value >> (i * 8)) & 0xff));
    }
}

void AppendU64(std::string& output, uint64_t value) {
    for (size_t i = 0; i < sizeof(value); ++i) {
        output.push_back(static_cast<char>((value >> (i * 8)) & 0xff));
    }
}

std::string NormalizeError(std::span<const uint8_t> data) {
    std::string message{reinterpret_cast<const char*>(data.data()), data.size()};
    if (message.empty()) {
        return "query failed";
    }
    return message;
}

}  // namespace

struct TerminalCompletionOverlay {
    std::vector<CompletionCandidate> candidates;
    size_t selection = 0;
    size_t variant_selection = 0;
    size_t window_begin = 0;
    size_t rows = 0;
    size_t cursor_row = 0;
    size_t anchor_column = 0;
    size_t content_width = 0;
    size_t hint_prefix_width = 0;
    size_t hint_suffix_width = 0;
    size_t hint_current_width = 0;
    bool hint_only = false;
};

thread_local std::unordered_map<ShellSession*, TerminalCompletionOverlay> terminal_completion_overlays;

ShellSession::ShellSession(Catalog& catalog, uint32_t terminal_columns)
    : catalog_{catalog}, prompt_{catalog}, renderer_{terminal_columns} {}

ShellSession::~ShellSession() {
    terminal_completion_overlays.erase(this);
    DestroyPendingEffects();
}

void ShellSession::Resize(uint32_t terminal_columns) {
    renderer_.Resize(terminal_columns);
}

PromptSnapshot ShellSession::SetPrompt(std::string_view text) {
    if (!prompt_.SetText(text)) {
        return SnapshotPrompt(ShellStatus::kInvalidArgument, "prompt must contain valid UTF-8");
    }
    ResetHistoryCursor();
    return SnapshotPrompt();
}

PromptSnapshot ShellSession::InsertPrompt(std::string_view text) {
    if (!prompt_.Insert(text)) {
        return SnapshotPrompt(ShellStatus::kInvalidArgument, "prompt insertion must contain valid non-empty UTF-8");
    }
    ResetHistoryCursor();
    return SnapshotPrompt();
}

PromptSnapshot ShellSession::MovePromptLeft() {
    prompt_.MoveLeft();
    return SnapshotPrompt();
}

PromptSnapshot ShellSession::MovePromptRight() {
    prompt_.MoveRight();
    return SnapshotPrompt();
}

PromptSnapshot ShellSession::DeletePromptBackward() {
    prompt_.DeleteBackward();
    return SnapshotPrompt();
}

PromptSnapshot ShellSession::DeletePromptForward() {
    prompt_.DeleteForward();
    return SnapshotPrompt();
}

std::vector<CompletionCandidate> ShellSession::CompletePrompt(size_t limit) {
    prompt_.script().Analyze();
    prompt_.script().MoveCursor(prompt_.cursor_byte_offset());
    const auto completion = prompt_.script().CompleteAtCursor(limit);
    std::vector<CompletionCandidate> candidates;
    candidates.reserve(completion->GetResultCandidates().size());
    for (const auto& candidate : completion->GetResultCandidates()) {
        std::string quoted;
        const auto completion_text = candidate.completion_text_is_verbatim
                                         ? candidate.completion_text
                                         : quote_anyupper_fuzzy(candidate.completion_text, quoted);
        std::vector<std::string> qualification_texts;
        for (const auto& object : candidate.catalog_objects) {
            if (object.prefer_qualified && !object.qualified_name.empty()) {
                std::string qualification_text;
                for (size_t i = 0; i < object.qualified_name.size(); ++i) {
                    if (i > 0) qualification_text.push_back('.');
                    qualification_text.append(object.qualified_name[i]);
                }
                qualification_texts.push_back(std::move(qualification_text));
            }
        }
        candidates.push_back({
            .display_text = std::string{candidate.completion_text},
            .completion_text = std::string{completion_text},
            .continuation_text = std::string{candidate.keyword_continuation},
            .qualification_texts = std::move(qualification_texts),
            .target_offset = candidate.target_location.offset(),
            .target_length = candidate.target_location.length(),
            .qualification_target_offset = candidate.target_location_qualified.offset(),
            .qualification_target_length = candidate.target_location_qualified.length(),
        });
    }
    return candidates;
}

PromptSnapshot ShellSession::ApplyCompletion(const CompletionCandidate& candidate) {
    if (!prompt_.ReplaceByteRange(candidate.target_offset, candidate.target_length, candidate.completion_text)) {
        return SnapshotPrompt(ShellStatus::kInvalidArgument, "completion target is not on prompt boundaries");
    }
    return SnapshotPrompt();
}

PromptSnapshot ShellSession::ConsumePromptInput(PromptInputKey key, std::string_view text) {
    PromptInputAction action = PromptInputAction::kNone;
    switch (key) {
        case PromptInputKey::kText:
            if (!prompt_.Insert(text)) {
                return SnapshotPrompt(ShellStatus::kInvalidArgument, "prompt input must contain valid non-empty UTF-8");
            }
            ResetHistoryCursor();
            break;
        case PromptInputKey::kEnter:
            if (PromptIsComplete()) {
                action = PromptInputAction::kSubmit;
            } else {
                prompt_.Insert("\n");
                ResetHistoryCursor();
            }
            break;
        case PromptInputKey::kForceSubmit:
            if (!prompt_.Text().empty()) action = PromptInputAction::kSubmit;
            break;
        case PromptInputKey::kTab:
            action = PromptInputAction::kComplete;
            break;
        case PromptInputKey::kBackspace:
            prompt_.DeleteBackward();
            ResetHistoryCursor();
            break;
        case PromptInputKey::kDelete:
            prompt_.DeleteForward();
            ResetHistoryCursor();
            break;
        case PromptInputKey::kLeft:
            prompt_.MoveLeft();
            break;
        case PromptInputKey::kRight:
            prompt_.MoveRight();
            break;
        case PromptInputKey::kHistoryPrevious:
            if (!history_.empty() && history_cursor_ > 0) {
                if (history_cursor_ == history_.size()) history_draft_ = prompt_.Text();
                --history_cursor_;
                prompt_.SetText(history_[history_cursor_]);
            }
            break;
        case PromptInputKey::kHistoryNext:
            if (history_cursor_ < history_.size()) {
                ++history_cursor_;
                prompt_.SetText(history_cursor_ < history_.size() ? history_[history_cursor_] : history_draft_);
            }
            break;
        case PromptInputKey::kCancel:
            prompt_.SetText("");
            ResetHistoryCursor();
            break;
        case PromptInputKey::kEscape:
            break;
    }
    auto snapshot = SnapshotPrompt();
    snapshot.action = static_cast<uint32_t>(action);
    return snapshot;
}

ShellOperation ShellSession::OpenTerminal(std::string_view prompt, bool welcome) {
    terminal_action_ = PromptInputAction::kNone;
    terminal_completion_overlays.erase(this);
    if (!utf8::Utf8Proc::IsValid(prompt)) {
        return {ShellStatus::kInvalidArgument, "terminal prompt must contain valid UTF-8"};
    }
    if (prompt.size() > terminal_prompt_storage_.size()) {
        return {ShellStatus::kInvalidArgument, "terminal prompt is too long"};
    }
    std::copy(prompt.begin(), prompt.end(), terminal_prompt_storage_.begin());
    terminal_prompt_length_ = prompt.size();
    terminal_prompt_rows_ = 1;
    std::string output;
    if (welcome) {
        output.append(vt100::kBold);
        output.append("DashQL Shell");
        output.append(vt100::kResetAttributes);
        output.append(vt100::kNewLine);
        output.append("Terminate SQL with \";\". Tab completes. Ctrl+C cancels. Escape returns to the notebook.");
        output.append(vt100::kNewLine);
    }
    output.append(RenderTerminalPrompt());
    return {ShellStatus::kOk, std::move(output)};
}

ShellOperation ShellSession::ConsumeTerminalInput(PromptInputKey key, std::string_view text) {
    terminal_action_ = PromptInputAction::kNone;
    if (terminal_completion_overlays.contains(this)) {
        const auto& overlay = terminal_completion_overlays.at(this);
        if (!overlay.hint_only) {
            const auto variant_count = overlay.candidates[overlay.selection].qualification_texts.size();
            if (key == PromptInputKey::kHistoryPrevious) return MoveTerminalCompletion(-1);
            if (key == PromptInputKey::kHistoryNext) return MoveTerminalCompletion(1);
            if (variant_count > 1 && key == PromptInputKey::kLeft) return MoveTerminalCompletionVariant(-1);
            if (variant_count > 1 && key == PromptInputKey::kRight) return MoveTerminalCompletionVariant(1);
        }
        if (key == PromptInputKey::kTab) return AcceptTerminalCompletion();
        if (key == PromptInputKey::kEscape) {
            auto output = ClearTerminalCompletionOverlay();
            terminal_completion_overlays.erase(this);
            output.append(RenderTerminalPrompt());
            return {ShellStatus::kOk, std::move(output)};
        }
    }
    if (key == PromptInputKey::kEscape) {
        terminal_action_ = PromptInputAction::kExit;
        return {ShellStatus::kOk, {}};
    }
    std::string output_prefix;
    if (terminal_completion_overlays.contains(this)) {
        output_prefix = ClearTerminalCompletionOverlay();
        terminal_completion_overlays.erase(this);
    }
    auto snapshot = ConsumePromptInput(key, text);
    if (snapshot.status != ShellStatus::kOk) {
        return {snapshot.status, std::move(snapshot.message)};
    }
    const auto action = static_cast<PromptInputAction>(snapshot.action);
    if (action == PromptInputAction::kSubmit) {
        terminal_action_ = action;
        terminal_prompt_rows_ = 1;
        output_prefix.append(vt100::kNewLine);
        return {ShellStatus::kOk, std::move(output_prefix)};
    }
    if (action == PromptInputAction::kComplete) {
        auto candidates = CompletePrompt(50);
        if (candidates.size() == 1) {
            snapshot = ApplyCompletion(candidates.front());
            if (snapshot.status != ShellStatus::kOk) {
                return {snapshot.status, std::move(snapshot.message)};
            }
            output_prefix.append(RenderTerminalPrompt());
            output_prefix.append(RefreshTerminalCompletionOverlay());
            return {ShellStatus::kOk, std::move(output_prefix)};
        }
        if (candidates.size() > 1) {
            output_prefix.append(OpenTerminalCompletionOverlay(std::move(candidates)));
            return {ShellStatus::kOk, std::move(output_prefix)};
        }
    }
    if (key == PromptInputKey::kCancel) {
        terminal_prompt_rows_ = 1;
        std::string output{std::move(output_prefix)};
        output.append("^C");
        output.append(vt100::kNewLine);
        output.append(RenderTerminalPrompt());
        return {ShellStatus::kOk, std::move(output)};
    }
    output_prefix.append(RenderTerminalPrompt());
    if (key != PromptInputKey::kForceSubmit && key != PromptInputKey::kTab) {
        output_prefix.append(RefreshTerminalCompletionOverlay());
    }
    return {ShellStatus::kOk, std::move(output_prefix)};
}

ShellOperation ShellSession::FinishTerminalQuery(std::string_view output, bool error) {
    terminal_action_ = PromptInputAction::kNone;
    std::string rendered = ClearTerminalCompletionOverlay();
    terminal_completion_overlays.erase(this);
    if (error) rendered.append(vt100::kForegroundRed);
    rendered.append(output);
    if (error) rendered.append(vt100::kResetAttributes);
    rendered.append(vt100::kNewLine);
    prompt_.SetText("");
    terminal_prompt_rows_ = 1;
    rendered.append(RenderTerminalPrompt());
    return {ShellStatus::kOk, std::move(rendered)};
}

ShellOperation ShellSession::RenderTerminalStatus(std::string_view message) {
    terminal_action_ = PromptInputAction::kNone;
    std::string output = ClearTerminalCompletionOverlay();
    terminal_completion_overlays.erase(this);
    output.append(vt100::kNewLine);
    output.append(vt100::kForegroundBrightBlack);
    output.append(message);
    output.append(vt100::kResetAttributes);
    output.append(vt100::kNewLine);
    terminal_prompt_rows_ = 1;
    output.append(RenderTerminalPrompt());
    return {ShellStatus::kOk, std::move(output)};
}

ShellOperation ShellSession::SubmitPrompt() {
    const auto query = prompt_.Text();
    if (query.empty()) {
        return {ShellStatus::kInvalidArgument, "query must not be empty"};
    }
    RememberPrompt(query);
    auto query_end = query.find_last_not_of(" \t\r\n");
    if (query_end != std::string::npos && query[query_end] == ';') {
        return StartQuery(std::string_view{query}.substr(0, query_end));
    }
    return StartQuery(query);
}

bool ShellSession::PromptIsComplete() {
    const auto text = prompt_.Text();
    if (text.find_first_not_of(" \t\r\n") == std::string::npos) return false;
    prompt_.script().Parse();
    const auto& parsed = prompt_.script().GetParsedScript();
    if (!parsed || !parsed->errors.empty() || !parsed->scanned_script->errors.empty() || parsed->statements.size() != 1) {
        return false;
    }
    auto end = text.find_last_not_of(" \t\r\n");
    return end != std::string::npos && text[end] == ';';
}

void ShellSession::ResetHistoryCursor() {
    history_cursor_ = history_.size();
    history_draft_.clear();
}

void ShellSession::RememberPrompt(std::string_view query) {
    if (history_.empty() || history_.back() != query) history_.emplace_back(query);
    while (history_.size() > HISTORY_LIMIT) history_.pop_front();
    ResetHistoryCursor();
}

std::string ShellSession::ExportHistory() const {
    std::string output;
    for (const auto& entry : history_) {
        const auto size = static_cast<uint32_t>(entry.size());
        AppendU32(output, size);
        output.append(entry);
    }
    return output;
}

ShellStatus ShellSession::ImportHistory(std::span<const uint8_t> data) {
    std::deque<std::string> history;
    size_t offset = 0;
    while (offset < data.size()) {
        if (data.size() - offset < sizeof(uint32_t)) return ShellStatus::kInvalidArgument;
        uint32_t size = 0;
        for (size_t i = 0; i < sizeof(uint32_t); ++i) size |= static_cast<uint32_t>(data[offset + i]) << (i * 8);
        offset += sizeof(uint32_t);
        if (size > data.size() - offset) return ShellStatus::kInvalidArgument;
        std::string entry{reinterpret_cast<const char*>(data.data() + offset), size};
        if (!utf8::Utf8Proc::IsValid(entry)) return ShellStatus::kInvalidArgument;
        history.push_back(std::move(entry));
        offset += size;
    }
    while (history.size() > HISTORY_LIMIT) history.pop_front();
    history_ = std::move(history);
    ResetHistoryCursor();
    return ShellStatus::kOk;
}

ShellOperation ShellSession::RenderArrowIPC(std::span<const uint8_t> data) const {
    auto rendered = renderer_.RenderIPC(data);
    if (!rendered.ok()) {
        return {ShellStatus::kArrowError, rendered.status().ToString()};
    }
    return {ShellStatus::kOk, std::move(rendered).ValueUnsafe()};
}

ShellOperation ShellSession::StartQuery(std::string_view query) {
    if (!pending_effects_.empty()) {
        return {ShellStatus::kBusy, "the shell already has an active operation"};
    }
    if (query.empty()) {
        return {ShellStatus::kInvalidArgument, "query must not be empty"};
    }

    Script script{catalog_};
    script.InsertTextAt(0, query);
    buffers::formatting::FormattingConfigT config;
    auto compiled = script.CompileQuery(config, {.allow_extensions = false});
    if (!compiled.errors.empty()) {
        return {ShellStatus::kInvalidArgument, compiled.errors.front().message};
    }

    outgoing_effect_.reset();
    completed_operation_.reset();
    auto task = ExecuteQuery(std::move(compiled.sql));
    return Resume(task.Release());
}

ShellOperation ShellSession::CompleteEffect(uint64_t effect_id,
                                            EffectCompletionStatus status,
                                            std::span<const uint8_t> data) {
    auto pending = pending_effects_.find(effect_id);
    if (pending == pending_effects_.end()) {
        return {ShellStatus::kStaleEffect, "effect is no longer pending"};
    }

    outgoing_effect_.reset();
    completed_operation_.reset();
    auto effect = std::move(pending->second);
    pending_effects_.erase(pending);
    effect.state->completion = EffectCompletion{status, std::vector<uint8_t>{data.begin(), data.end()}};
    return Resume(effect.coroutine);
}

ShellOperation ShellSession::CancelEffect(uint64_t effect_id) {
    return CompleteEffect(effect_id, EffectCompletionStatus::kCancelled, {});
}

ShellSession::EffectAwaiter::EffectAwaiter(ShellSession& session, EffectType type, std::string payload)
    : session_{session}, type_{type}, payload_{std::move(payload)}, state_{std::make_shared<EffectState>()} {}

void ShellSession::EffectAwaiter::await_suspend(Task::Handle coroutine) {
    session_.SuspendEffect(type_, std::move(payload_), coroutine, state_);
}

EffectCompletion ShellSession::EffectAwaiter::await_resume() {
    if (!state_->completion.has_value()) {
        throw std::logic_error{"effect resumed without a completion"};
    }
    return std::move(*state_->completion);
}

Task ShellSession::ExecuteQuery(std::string query) {
    auto completion = co_await EffectAwaiter{*this, EffectType::kExecuteQuery, std::move(query)};
    switch (completion.status) {
        case EffectCompletionStatus::kSuccess:
            completed_operation_ = RenderArrowIPC(completion.data);
            break;
        case EffectCompletionStatus::kError:
            completed_operation_ = ShellOperation{ShellStatus::kOk, NormalizeError(completion.data)};
            break;
        case EffectCompletionStatus::kCancelled:
            completed_operation_ = ShellOperation{ShellStatus::kOk, "Cancelled"};
            break;
    }
}

void ShellSession::SuspendEffect(EffectType type,
                                 std::string payload,
                                 Task::Handle coroutine,
                                 std::shared_ptr<EffectState> state) {
    if (outgoing_effect_.has_value()) {
        throw std::logic_error{"invalid concurrent shell effect"};
    }
    const auto effect_id = next_effect_id_++;
    auto [_, inserted] = pending_effects_.emplace(effect_id, PendingEffect{type, coroutine, std::move(state)});
    if (!inserted) {
        throw std::logic_error{"invalid concurrent shell effect"};
    }
    outgoing_effect_ = OutgoingEffect{effect_id, type, std::move(payload)};
}

ShellOperation ShellSession::Resume(Task::Handle coroutine) {
    if (!coroutine || coroutine.done()) {
        if (coroutine) {
            coroutine.destroy();
        }
        return {ShellStatus::kInternalError, "invalid shell coroutine"};
    }
    coroutine.resume();
    return CollectOperation(coroutine);
}

ShellOperation ShellSession::CollectOperation(Task::Handle coroutine) {
    if (!coroutine.done()) {
        if (!outgoing_effect_.has_value()) {
            coroutine.destroy();
            return {ShellStatus::kInternalError, "shell coroutine suspended without an effect"};
        }
        return EncodeOutgoingEffect();
    }

    auto exception = coroutine.promise().exception;
    coroutine.destroy();
    if (exception) {
        try {
            std::rethrow_exception(exception);
        } catch (const std::exception& error) {
            return {ShellStatus::kInternalError, error.what()};
        } catch (...) {
            return {ShellStatus::kInternalError, "unknown shell coroutine error"};
        }
    }
    if (!completed_operation_.has_value()) {
        return {ShellStatus::kInternalError, "shell coroutine completed without output"};
    }
    return std::move(*completed_operation_);
}

ShellOperation ShellSession::EncodeOutgoingEffect() {
    auto effect = std::move(*outgoing_effect_);
    outgoing_effect_.reset();

    std::string encoded;
    encoded.reserve(EFFECT_ENVELOPE_HEADER_SIZE + effect.payload.size());
    AppendU32(encoded, EFFECT_ENVELOPE_VERSION);
    AppendU32(encoded, static_cast<uint32_t>(effect.type));
    AppendU64(encoded, effect.id);
    encoded.append(effect.payload);
    return {ShellStatus::kPending, std::move(encoded)};
}

PromptSnapshot ShellSession::SnapshotPrompt(ShellStatus status, std::string message) {
    return {
        .status = status,
        .revision = prompt_.revision(),
        .cursor_byte_offset = static_cast<uint32_t>(prompt_.cursor_byte_offset()),
        .text = prompt_.Text(),
        .message = std::move(message),
        .action = static_cast<uint32_t>(PromptInputAction::kNone),
    };
}

std::string ShellSession::RenderTerminalPrompt() {
    const auto text = prompt_.Text();
    const auto terminal_prompt = terminal_prompt_length_ == 0
                                     ? std::string_view{"dashql> "}
                                     : std::string_view{terminal_prompt_storage_.data(), terminal_prompt_length_};
    prompt_.script().Parse();
    auto parsed = prompt_.script().GetParsedScript();
    auto packed = parsed->PackTokens();
    const auto& comments = parsed->scanned_script->comments;

    std::string highlighted;
    highlighted.reserve(text.size() + (packed->token_offsets.size() + comments.size()) * 16);
    size_t offset = 0;
    size_t token_idx = 0;
    size_t comment_idx = 0;
    while (token_idx < packed->token_offsets.size() || comment_idx < comments.size()) {
        const auto token_begin = token_idx < packed->token_offsets.size()
                                     ? static_cast<size_t>(packed->token_offsets[token_idx])
                                     : std::numeric_limits<size_t>::max();
        const auto comment_begin = comment_idx < comments.size()
                                       ? static_cast<size_t>(comments[comment_idx].offset())
                                       : std::numeric_limits<size_t>::max();
        const bool is_comment = comment_begin < token_begin;
        const auto begin = is_comment ? comment_begin : token_begin;
        const auto length = is_comment ? comments[comment_idx].length() : packed->token_lengths[token_idx];
        const auto type = is_comment ? ScannerTokenType::COMMENT : packed->token_types[token_idx];
        const auto end = begin + length;
        if (begin > offset) highlighted.append(text.substr(offset, begin - offset));
        const auto style = TokenStyle(type);
        if (!style.empty()) highlighted.append(style);
        highlighted.append(text.substr(begin, end - begin));
        if (!style.empty()) highlighted.append(vt100::kResetAttributes);
        offset = end;
        if (is_comment) {
            ++comment_idx;
        } else {
            ++token_idx;
        }
    }
    highlighted.append(text.substr(offset));

    std::string output;
    for (size_t i = 0; i < terminal_prompt_rows_; ++i) {
        output.append(vt100::kCarriageReturn);
        output.append(vt100::kEraseEntireLine);
        if (i + 1 < terminal_prompt_rows_) output.append(vt100::kCursorUpOne);
    }

    size_t line_begin = 0;
    size_t line = 0;
    while (line_begin <= highlighted.size()) {
        const auto line_end = highlighted.find('\n', line_begin);
        output.append(line == 0 ? terminal_prompt : terminal_continuation_);
        output.append(highlighted.substr(line_begin, line_end - line_begin));
        if (line_end == std::string::npos) break;
        output.append(vt100::kNewLine);
        line_begin = line_end + 1;
        ++line;
    }
    terminal_prompt_rows_ = CountLines(text);

    const auto cursor = prompt_.cursor_byte_offset();
    const auto cursor_line = static_cast<size_t>(std::count(text.begin(), text.begin() + cursor, '\n'));
    const auto cursor_line_begin = cursor_line == 0 ? 0 : text.rfind('\n', cursor - 1) + 1;
    const auto cursor_prefix = cursor_line == 0 ? terminal_prompt : terminal_continuation_;
    const auto cursor_column = utf8::Utf8Proc::RenderWidth(std::string{cursor_prefix}) +
                               utf8::Utf8Proc::RenderWidth(text.substr(cursor_line_begin, cursor - cursor_line_begin));
    const auto rows_up = terminal_prompt_rows_ - cursor_line - 1;
    if (auto overlay = terminal_completion_overlays.find(this); overlay != terminal_completion_overlays.end()) {
        overlay->second.cursor_row = cursor_line;
    }
    output.append(vt100::kCarriageReturn);
    AppendCursorMove(output, rows_up, vt100::kCursorUpCommand);
    AppendCursorMove(output, cursor_column, vt100::kCursorForwardCommand);
    return output;
}

std::string ShellSession::OpenTerminalCompletionOverlay(std::vector<CompletionCandidate> candidates) {
    auto& overlay = terminal_completion_overlays[this];
    overlay = {};
    overlay.candidates = std::move(candidates);
    overlay.hint_only = overlay.candidates.front().target_length == 0;
    for (auto& candidate : overlay.candidates) {
        candidate.display_text = EscapeTerminalText(candidate.display_text);
        overlay.content_width = std::max(overlay.content_width, DisplayWidth(candidate.display_text));
    }

    const auto text = prompt_.Text();
    const auto target = std::min<size_t>(overlay.candidates.front().target_offset, text.size());
    const auto target_line = static_cast<size_t>(std::count(text.begin(), text.begin() + target, '\n'));
    const auto target_line_begin = target_line == 0 ? 0 : text.rfind('\n', target - 1) + 1;
    const auto terminal_prompt = terminal_prompt_length_ == 0
                                     ? std::string_view{"dashql> "}
                                     : std::string_view{terminal_prompt_storage_.data(), terminal_prompt_length_};
    const auto target_prefix = target_line == 0 ? terminal_prompt : terminal_continuation_;
    overlay.cursor_row = static_cast<size_t>(std::count(text.begin(), text.begin() + prompt_.cursor_byte_offset(), '\n'));
    overlay.anchor_column = utf8::Utf8Proc::RenderWidth(std::string{target_prefix}) +
                            utf8::Utf8Proc::RenderWidth(text.substr(target_line_begin, target - target_line_begin));
    return RenderTerminalCompletionOverlay();
}

std::string ShellSession::RefreshTerminalCompletionOverlay() {
    auto candidates = CompletePrompt(50);
    if (candidates.empty()) {
        terminal_completion_overlays.erase(this);
        return {};
    }
    return OpenTerminalCompletionOverlay(std::move(candidates));
}

std::string ShellSession::RenderTerminalCompletionOverlay() {
    std::string output = ClearTerminalCompletionOverlay();
    auto found = terminal_completion_overlays.find(this);
    if (found == terminal_completion_overlays.end()) return output;
    auto& overlay = found->second;
    output.append(RenderTerminalCompletionHint());
    if (overlay.hint_only) return output;

    const auto window_end = std::min(overlay.window_begin + TERMINAL_COMPLETION_ROWS, overlay.candidates.size());
    const auto candidate_rows = window_end - overlay.window_begin;
    std::string horizontal;
    horizontal.reserve((overlay.content_width + 2) * std::string_view{"─"}.size());
    for (size_t i = 0; i < overlay.content_width + 2; ++i) horizontal.append("─");
    output.append(vt100::kSaveCursor);
    output.append(vt100::kCarriageReturn);
    AppendCursorMove(output, 1, vt100::kCursorDownCommand);
    AppendCursorMove(output, overlay.anchor_column, vt100::kCursorForwardCommand);
    output.append(vt100::kEraseEntireLine);
    output.append(vt100::kForegroundBrightBlack);
    output.append("╭");
    output.append(horizontal);
    output.append("╮");
    output.append(vt100::kResetAttributes);
    output.append(vt100::kNewLine);
    for (size_t i = overlay.window_begin; i < window_end; ++i) {
        AppendCursorMove(output, overlay.anchor_column, vt100::kCursorForwardCommand);
        output.append(vt100::kEraseEntireLine);
        output.append(vt100::kForegroundBrightBlack);
        output.append("│");
        output.append(vt100::kResetAttributes);
        output.push_back(' ');
        if (i == overlay.selection) output.append(vt100::kReverseVideo);
        output.append(overlay.candidates[i].display_text);
        output.append(overlay.content_width - DisplayWidth(overlay.candidates[i].display_text), ' ');
        if (i == overlay.selection) output.append(vt100::kResetAttributes);
        output.push_back(' ');
        output.append(vt100::kForegroundBrightBlack);
        output.append("│");
        output.append(vt100::kResetAttributes);
        output.append(vt100::kNewLine);
    }
    AppendCursorMove(output, overlay.anchor_column, vt100::kCursorForwardCommand);
    output.append(vt100::kEraseEntireLine);
    output.append(vt100::kForegroundBrightBlack);
    output.append("╰");
    output.append(horizontal);
    output.append("╯");
    output.append(vt100::kResetAttributes);
    overlay.rows = candidate_rows + 2;
    output.append(vt100::kRestoreCursor);
    return output;
}

std::string ShellSession::ClearTerminalCompletionOverlay() {
    auto found = terminal_completion_overlays.find(this);
    if (found == terminal_completion_overlays.end()) return {};
    auto& overlay = found->second;

    std::string output;
    if (overlay.hint_suffix_width > 0) {
        output.append(overlay.hint_suffix_width, ' ');
        AppendCursorMove(output, overlay.hint_suffix_width, vt100::kCursorBackwardCommand);
        overlay.hint_suffix_width = 0;
    }
    if (overlay.hint_prefix_width > 0) {
        AppendCursorMove(output, overlay.hint_current_width + overlay.hint_prefix_width,
                         vt100::kCursorBackwardCommand);
        AppendCursorMove(output, overlay.hint_prefix_width, vt100::kDeleteCharacterCommand);
        AppendCursorMove(output, overlay.hint_current_width, vt100::kCursorForwardCommand);
        overlay.hint_prefix_width = 0;
        overlay.hint_current_width = 0;
    }
    if (overlay.rows == 0) return output;
    output.append(vt100::kSaveCursor);
    output.append(vt100::kCarriageReturn);
    AppendCursorMove(output, 1, vt100::kCursorDownCommand);
    for (size_t i = 0; i < overlay.rows; ++i) {
        AppendCursorMove(output, overlay.anchor_column, vt100::kCursorForwardCommand);
        output.append(vt100::kEraseEntireLine);
        if (i + 1 < overlay.rows) {
            AppendCursorMove(output, 1, vt100::kCursorDownCommand);
            output.append(vt100::kCarriageReturn);
        }
    }
    output.append(vt100::kRestoreCursor);
    overlay.rows = 0;
    return output;
}

std::string ShellSession::RenderTerminalCompletionHint() {
    auto found = terminal_completion_overlays.find(this);
    if (found == terminal_completion_overlays.end()) return {};
    auto& overlay = found->second;
    const auto& candidate = overlay.candidates[overlay.selection];
    const auto text = prompt_.Text();
    const auto target_end = static_cast<size_t>(candidate.target_offset) + candidate.target_length;
    if (target_end != prompt_.cursor_byte_offset() || target_end != text.size()) return {};

    const auto current = std::string_view{text}.substr(candidate.target_offset, candidate.target_length);
    std::string prefix;
    std::string suffix;
    if (overlay.hint_only) {
        const auto desired = std::string_view{candidate.completion_text};
        const auto completion = desired.find(current);
        if (completion != std::string_view::npos) {
            prefix = desired.substr(0, completion);
            suffix = desired.substr(completion + current.size());
        } else {
            suffix = desired;
        }
    } else if (!candidate.qualification_texts.empty()) {
        const auto variant = std::min(overlay.variant_selection, candidate.qualification_texts.size() - 1);
        const auto qualified = std::string_view{candidate.qualification_texts[variant]};
        const auto completion = qualified.find(candidate.completion_text);
        if (completion != std::string_view::npos && std::string_view{candidate.completion_text}.starts_with(current)) {
            prefix = qualified.substr(0, completion);
            suffix = std::string{candidate.completion_text}.substr(current.size());
            suffix.append(qualified.substr(completion + candidate.completion_text.size()));
        }
    } else if (candidate.completion_text == current && !candidate.continuation_text.empty()) {
        suffix = " " + candidate.continuation_text;
    } else if (std::string_view{candidate.completion_text}.starts_with(current)) {
        suffix = std::string_view{candidate.completion_text}.substr(current.size());
    }
    if (prefix.empty() && suffix.empty() && !candidate.continuation_text.empty()) {
        suffix = " " + candidate.continuation_text;
    }
    if (prefix.empty() && suffix.empty()) return {};

    overlay.hint_prefix_width = DisplayWidth(prefix);
    overlay.hint_suffix_width = DisplayWidth(suffix);
    overlay.hint_current_width = DisplayWidth(current);
    std::string output;
    if (!prefix.empty()) {
        AppendCursorMove(output, overlay.hint_current_width, vt100::kCursorBackwardCommand);
        AppendCursorMove(output, overlay.hint_prefix_width, vt100::kInsertCharacterCommand);
        output.append(vt100::kForegroundBrightBlack);
        output.append(prefix);
        output.append(vt100::kResetAttributes);
        AppendCursorMove(output, overlay.hint_current_width, vt100::kCursorForwardCommand);
    }
    if (!suffix.empty()) {
        output.append(vt100::kForegroundBrightBlack);
        output.append(suffix);
        output.append(vt100::kResetAttributes);
        AppendCursorMove(output, overlay.hint_suffix_width, vt100::kCursorBackwardCommand);
    }
    return output;
}

ShellOperation ShellSession::AcceptTerminalCompletion() {
    auto output = ClearTerminalCompletionOverlay();
    auto& overlay = terminal_completion_overlays.at(this);
    const auto variant_selection = overlay.variant_selection;
    auto candidate = std::move(overlay.candidates[overlay.selection]);
    terminal_completion_overlays.erase(this);
    const auto continuation = candidate.continuation_text;
    const auto qualification = candidate.qualification_texts.empty()
                                   ? std::string{}
                                   : candidate.qualification_texts[std::min(variant_selection,
                                                                           candidate.qualification_texts.size() - 1)];
    const auto snapshot = ApplyCompletion(candidate);
    if (snapshot.status != ShellStatus::kOk) return {snapshot.status, std::move(snapshot.message)};
    output.append(RenderTerminalPrompt());
    if (!qualification.empty() && qualification != candidate.completion_text) {
        auto& next = terminal_completion_overlays[this];
        next = {};
        next.hint_only = true;
        const auto prompt_text = prompt_.Text();
        next.cursor_row = static_cast<size_t>(
            std::count(prompt_text.begin(), prompt_text.begin() + prompt_.cursor_byte_offset(), '\n'));
        next.candidates.push_back({
            .display_text = candidate.completion_text,
            .completion_text = qualification,
            .continuation_text = continuation,
            .qualification_texts = {},
            .target_offset = candidate.qualification_target_offset,
            .target_length = static_cast<uint32_t>(candidate.completion_text.size()),
            .qualification_target_offset = candidate.qualification_target_offset,
            .qualification_target_length = static_cast<uint32_t>(candidate.completion_text.size()),
        });
        output.append(RenderTerminalCompletionHint());
    } else if (!continuation.empty()) {
        auto& next = terminal_completion_overlays[this];
        next = {};
        next.hint_only = true;
        const auto prompt_text = prompt_.Text();
        next.cursor_row = static_cast<size_t>(
            std::count(prompt_text.begin(), prompt_text.begin() + prompt_.cursor_byte_offset(), '\n'));
        next.candidates.push_back({
            .display_text = continuation,
            .completion_text = " " + continuation,
            .continuation_text = {},
            .qualification_texts = {},
            .target_offset = static_cast<uint32_t>(prompt_.cursor_byte_offset()),
            .target_length = 0,
            .qualification_target_offset = static_cast<uint32_t>(prompt_.cursor_byte_offset()),
            .qualification_target_length = 0,
        });
        output.append(RenderTerminalCompletionHint());
    } else {
        output.append(RefreshTerminalCompletionOverlay());
    }
    return {ShellStatus::kOk, std::move(output)};
}

ShellOperation ShellSession::MoveTerminalCompletion(int direction) {
    auto& overlay = terminal_completion_overlays.at(this);
    const auto count = overlay.candidates.size();
    if (direction < 0) {
        overlay.selection = overlay.selection == 0 ? count - 1 : overlay.selection - 1;
    } else {
        overlay.selection = (overlay.selection + 1) % count;
    }
    overlay.variant_selection = 0;
    if (overlay.selection < overlay.window_begin) {
        overlay.window_begin = overlay.selection;
    } else if (overlay.selection >= overlay.window_begin + TERMINAL_COMPLETION_ROWS) {
        overlay.window_begin = overlay.selection - TERMINAL_COMPLETION_ROWS + 1;
    }
    return {ShellStatus::kOk, RenderTerminalCompletionOverlay()};
}

ShellOperation ShellSession::MoveTerminalCompletionVariant(int direction) {
    auto& overlay = terminal_completion_overlays.at(this);
    const auto count = overlay.candidates[overlay.selection].qualification_texts.size();
    if (count < 2) return {ShellStatus::kOk, {}};
    if (direction < 0) {
        overlay.variant_selection = overlay.variant_selection == 0 ? count - 1 : overlay.variant_selection - 1;
    } else {
        overlay.variant_selection = (overlay.variant_selection + 1) % count;
    }
    return {ShellStatus::kOk, RenderTerminalCompletionOverlay()};
}

void ShellSession::DestroyPendingEffects() {
    std::unordered_set<void*> destroyed;
    for (auto& [_, effect] : pending_effects_) {
        if (effect.coroutine && destroyed.insert(effect.coroutine.address()).second) {
            effect.coroutine.destroy();
        }
    }
    pending_effects_.clear();
    outgoing_effect_.reset();
    completed_operation_.reset();
}

}  // namespace dashql::shell
