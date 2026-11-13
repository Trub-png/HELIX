# Repair engine

`repair-engine.js` exports `createRepairEngine()` and `validatePatch(text, patch)`. It is a deterministic, offline suggestion engine; it does not access the filesystem, spawn processes, make network requests, or execute project code. Session state exists only in memory and can be discarded with `clearSession(sessionId)`.

## Integration contract

- Call `engine.analyze({ text, language, syntaxDiagnostic, error, sessionId })`. The language may be `javascript`/`js`, `java`, `c`, `go`, or `python`/`py`; pass a parser or compiler diagnostic in `syntaxDiagnostic` (`error` is a compatibility fallback). It returns zero or one proposal.
- A proposal contains `id`, `rule`, `explanation`, and a replacement span: `start`, `end`, `expectedText`, `replacement`. Offsets are JavaScript string offsets.
- Show the proposal to the user and obtain visible approval before applying it. The caller must revalidate against the current text with `engine.validate(text, proposal)` immediately before applying.
- After approval and successful application, call `recordExecution(sessionId, proposal, currentText)` at most once per session. This records an execution only; the engine never applies patches. The caller remains responsible for confirmation, workspace/path checks, and file writes.
- A session produces at most one proposal and records at most one execution. Use distinct session IDs for separate repair sessions.

## Rules and limits

Only syntax-related rules are enabled. JavaScript, Java, C, and Go delimiter repairs require an EOF/closing-delimiter diagnostic from that language's parser/compiler and a matching unclosed delimiter in the source. The scanner rejects mismatched delimiters, more than three missing closers, unclosed quotes/comments, and Go raw strings; it does not fully parse JavaScript regular expressions/templates, C++ raw strings, or language grammar. Python supports only a missing `:` on a recognized compound-statement header, and only when the diagnostic explicitly says `expected ':'`. Runtime errors, unresolved names, type errors, method spelling, unsupported languages, and ambiguous diagnostics yield no proposal. A proposal is a conservative heuristic, not a full language parser; the caller should validate it with a syntax-only compiler/parser in a temporary copy before offering application.
