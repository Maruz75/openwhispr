# Product help (desktop)

Support → OpenWhispr Help provides official-documentation excerpts and a read-only view of relevant settings without an account, subscription, transcription allowance or configured AI model. Eight bundled English essentials remain available when offline or when an organisation restricts lookup. The UI labels are localized in all eleven app locales; published documentation and bundled source text remain English.

The existing conversational assistant also receives three read-only tools: `search_openwhispr_help`, `read_openwhispr_help`, and `get_openwhispr_context`. They use the shared chat/assistant tool loop and keep their turn's answer in the assistant surface instead of pasting at an external caret. Dictation routing is unchanged. Small local models still receive no tools; their capability guidance points to the Help view.

## Data boundary

The Electron main process owns the fixed `https://docs.openwhispr.com/mcp` adapter. Only eight fixed public product-topic queries leave the app; the model cannot supply arbitrary search text, chat history, settings or note content. Article reads accept strict paths from bundled topics or prior search results, construct `head -160 <path>.mdx` internally and never accept shell commands. Only search and read are exposed; upstream feedback submission and discovery cannot add writers.

No OpenWhispr account credential or session cookie is attached to docs requests. Redirects fail closed. Responses are bounded to 128 KiB, four search excerpts (3,000 characters each), or a 12,000-character article. Lookup has a 12-second deadline, cancellation per renderer request, four concurrent requests per renderer and twelve requests per minute per application process. Nothing is cached to disk or logged by this feature.

Signed-out users can retrieve public docs. Signed-in users resolve the existing main-process workspace policy before contacting docs. Unresolved policy, a minimum-version restriction, disabled web search or an organisation allowing only local/self-hosted/enterprise processing uses bundled help. The current conservative policy requires an allowed OpenWhispr/BYOK processing mode for online docs lookup; it does not infer approval from a local model configuration. Ordinary assistant inference retains its existing provider, account and policy checks. There is no new hosted free-form model endpoint or general Cloud entitlement bypass.

Settings projection includes only topic-relevant shortcuts, microphone choice, known permission state, per-activity transcription modes/engines, language-model routes, language choices, backup status and calendar-connection booleans. It excludes keys/tokens, provider URLs, custom model/deployment names, file paths, notes, vocabulary, calendar events and account identifiers. In the Help view the snapshot stays on device. In an ordinary assistant conversation, requested settings become tool context for the user's existing chosen model. This is not a separate private chat mode: that conversation retains its existing note/memory behavior.

Permission values describe known state, not an operational device test. System-audio permission is the cached macOS verdict; other platforms return unknown. Settings describe configured choices and explicitly flag that organisation policy may constrain them.

## Validation and remaining acceptance

Implemented from desktop main `95fb3758c61fc36f33a68da470bb71d9396f44c2`. The related documentation audit used released v1.10.2 (`1c123e8739f87c0a72d0b252bc9cff14e684b7f4`); docs draft PR #44 is separate.

- Focused helper tests cover fixed egress, invalid paths/commands, response and rate bounds, malformed results, offline/policy fallback, cancellation, window ownership, minimum-version policy and secret-free context projection.
- Renderer tool integration tests exercise Cloud Free registration, signed-out tools, read-only context, citation payloads, held delivery, and existing shared tool-loop/provider behavior. Network/model responses in those tests are fixtures.
- Live unauthenticated MCP search/read succeeded; hotkey search took about 1.5 seconds in one local measurement (not a latency guarantee).
- Real Help/Support React components were browser-rendered with an Electron boundary fixture: Support entry, live excerpts, offline and policy fallback, topic changes, current settings, and 700px-wide layout were checked. No horizontal overflow. This is renderer evidence, not a packaged desktop run.
- Type checking, lint, locale-key checks and production renderer build were exercised; test/check totals are recorded in the PR.

Still needed before product release: packaged macOS/Windows/Linux acceptance, actual Cloud/BYOK/local model answers and source selection, enterprise-account acceptance, translation/content review, and long-term docs accuracy. Mobile has no implementation in this desktop-first PR. The UI offers articles/essentials directly when no permitted model can answer; it does not provide a new unlimited Cloud help chat.

No merge or deployment is part of this change. The implementation worktree can be retired after its branch is pushed and review artifacts saved.
