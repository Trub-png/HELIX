'use strict';

// Deterministic syntax-only suggestions. This module has no filesystem, process, or network access.
const OPEN_TO_CLOSE = Object.freeze({ '(': ')', '[': ']', '{': '}' });
const CLOSERS = new Set(Object.values(OPEN_TO_CLOSE));

function diagnosticText(diagnostic) {
  if (typeof diagnostic === 'string') return diagnostic;
  if (!diagnostic || typeof diagnostic !== 'object') return '';
  return [diagnostic.message, diagnostic.stderr, diagnostic.stdout, diagnostic.error]
    .filter((part) => typeof part === 'string').join('\n');
}

function syntaxEofDiagnostic(language, diagnostic) {
  const message = diagnosticText(diagnostic);
  if (!message) return false;
  const lang = String(language || '').toLowerCase();
  if (['javascript', 'js', 'node', 'typescript', 'ts'].includes(lang)) {
    return /unexpected end of input|unexpected eof|end of file while parsing|expected ['"`]?\}?['"`]?\s*$|missing ['"`]?\}['"`]? at end/i.test(message);
  }
  if (['java'].includes(lang)) return /reached end of file while parsing|premature eof|unexpected end of file/i.test(message);
  if (['c', 'c++', 'cpp'].includes(lang)) return /expected .+ at end of input|expected .+ before end of input|unexpected end of file/i.test(message);
  if (['go', 'golang'].includes(lang)) return /unexpected eof|unexpected end of file|expected .+ at end of file/i.test(message);
  return false;
}

function scanUnclosed(text, language) {
  const lang = String(language || '').toLowerCase();
  const isGo = ['go', 'golang'].includes(lang);
  const isC = ['c', 'c++', 'cpp'].includes(lang);
  const stack = [];
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const n = text[i + 1];
    if (lineComment) { if (c === '\n') lineComment = false; continue; }
    if (blockComment) {
      if (c === '*' && n === '/') { blockComment = false; i += 1; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = null;
      continue;
    }

    if (isGo && c === '`') return null; // Raw strings need Go-aware parsing.
    if (isC && c === '#' && (i === 0 || text[i - 1] === '\n')) {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (!isC && c === '/' && n === '/') { lineComment = true; i += 1; continue; }
    if (!isC && c === '/' && n === '*') { blockComment = true; i += 1; continue; }
    if (isC && c === '/' && n === '/') { lineComment = true; i += 1; continue; }
    if (isC && c === '/' && n === '*') { blockComment = true; i += 1; continue; }

    if (c === '"' || c === "'" || (['javascript', 'js', 'node', 'typescript', 'ts'].includes(lang) && c === '`')) {
      // Template literals and C++ raw strings are intentionally not guessed.
      if (c === '`' || (isC && c === '"' && text.slice(i, i + 3) === 'R"(')) return null;
      quote = c;
      continue;
    }
    if (Object.hasOwn(OPEN_TO_CLOSE, c)) stack.push(c);
    else if (CLOSERS.has(c)) {
      if (!stack.length || OPEN_TO_CLOSE[stack[stack.length - 1]] !== c) return null;
      stack.pop();
    }
  }
  if (quote || blockComment || stack.length === 0 || stack.length > 3) return null;
  const replacement = stack.reverse().map((open) => OPEN_TO_CLOSE[open]).join('');
  return { start: text.length, end: text.length, expectedText: '', replacement,
    rule: 'close-delimiter', explanation: `El analizador señaló un cierre al final del archivo; se propone agregar ${replacement}.` };
}

function pythonColonSuggestion(text, diagnostic) {
  if (!/expected\s+['"]?:['"]?/i.test(diagnosticText(diagnostic))) return null;
  const header = /^(\s*)(?:(?:async\s+)?def|class|if|elif|else|for|while|try|except|finally|with|match|case)\b.*$/;
  const lines = text.split('\n');
  // Use a diagnostic line when present. Python commonly reports "line N" or ".py:N".
  const found = diagnosticText(diagnostic).match(/(?:line\s+|\.py:)(\d+)/i);
  const indexes = found ? [Number(found[1]) - 1] : lines.map((_, index) => index);
  for (const index of indexes) {
    if (index < 0 || index >= lines.length) continue;
    const line = lines[index];
    if (!header.test(line) || /:\s*(?:#.*)?$/.test(line)) continue;
    const end = index < lines.length - 1 ? text.split('\n').slice(0, index + 1).join('\n').length : text.length;
    const insertion = line.trimEnd().length;
    const start = end - line.length + insertion;
    return { start, end: start, expectedText: '', replacement: ':', rule: 'python-header-colon',
      explanation: `La línea ${index + 1} parece un encabezado Python que requiere dos puntos.` };
  }
  return null;
}

function validatePatch(text, patch) {
  if (typeof text !== 'string' || !patch || !Number.isInteger(patch.start) ||
      !Number.isInteger(patch.end) || patch.start < 0 || patch.end < patch.start ||
      patch.end > text.length || typeof patch.expectedText !== 'string' ||
      typeof patch.replacement !== 'string') return false;
  return text.slice(patch.start, patch.end) === patch.expectedText;
}

function createRepairEngine() {
  const sessions = new Map();
  let nextId = 1;
  function stateFor(sessionId) {
    const key = String(sessionId || 'default');
    if (!sessions.has(key)) sessions.set(key, { proposed: false, executed: false });
    return sessions.get(key);
  }
  return Object.freeze({
    analyze({ text, language, syntaxDiagnostic, error, sessionId } = {}) {
      if (typeof text !== 'string') return [];
      const state = stateFor(sessionId);
      if (state.proposed || state.executed) return [];
      const diagnostic = syntaxDiagnostic ?? error;
      const lang = String(language || '').toLowerCase();
      let patch = null;
      if (['python', 'py'].includes(lang)) patch = pythonColonSuggestion(text, diagnostic);
      else if (syntaxEofDiagnostic(lang, diagnostic)) patch = scanUnclosed(text, lang);
      if (!patch || !validatePatch(text, patch)) return [];
      state.proposed = true;
      return [{ id: `repair-${nextId++}`, language: lang, ...patch }];
    },
    validate(text, patch) { return validatePatch(text, patch); },
    // Records the one approved application; caller owns confirmation and file I/O.
    recordExecution(sessionId, patch, currentText) {
      const state = stateFor(sessionId);
      if (state.executed || !validatePatch(currentText, patch)) return false;
      state.executed = true;
      return true;
    },
    clearSession(sessionId) { sessions.delete(String(sessionId || 'default')); }
  });
}

module.exports = { createRepairEngine, validatePatch };
