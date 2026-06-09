#!/usr/bin/env node
/**
 * TokenSlayer Eval Harness — Signal Preservation
 *
 * For each (file, question) pair, checks two things:
 *   1. How many tokens does the compacted skeleton save vs. raw?
 *   2. Are all the substrings needed to answer the question still present?
 *
 * "Signal preservation" is a deterministic proxy for "would an LLM still
 * answer correctly from the compacted version?" — without needing an API key.
 *
 * Run: npm run eval
 *      npm run eval -- --json     # machine-readable output
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeFile } from '../build/parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures');
const QUESTIONS = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf-8')
).questions;

// ANSI helpers
const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m',
};

function tokenEstimate(s) {
  return Math.ceil(s.length / 4);
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}
function padLeft(s, n) {
  s = String(s);
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}

function evalQuestion(q) {
  const filePath = path.join(FIXTURES, q.file);
  if (!fs.existsSync(filePath)) {
    return { id: q.id, file: q.file, error: `fixture missing: ${filePath}` };
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  const result = analyzeFile(filePath);
  if (result.error) {
    return { id: q.id, file: q.file, error: result.error };
  }

  const rawTokens = tokenEstimate(raw);
  const compactedTokens = tokenEstimate(result.skeleton);
  const reductionPercent = rawTokens > 0
    ? Math.round(((rawTokens - compactedTokens) / rawTokens) * 100)
    : 0;

  const skeleton = result.skeleton;
  const missing = q.signals.filter(sig => !skeleton.includes(sig));
  const preserved = q.signals.length - missing.length;

  return {
    id: q.id,
    file: q.file,
    question: q.question,
    rawTokens,
    compactedTokens,
    reductionPercent,
    totalSignals: q.signals.length,
    preserved,
    missing,
    ok: missing.length === 0,
    knownLimitation: q.knownLimitation,
  };
}

function runAll() {
  return QUESTIONS.map(evalQuestion);
}

function summarize(results) {
  const byFile = new Map();
  let totalRaw = 0, totalCompacted = 0;
  let totalSignals = 0, totalPreserved = 0;
  let questionsPassed = 0, questionsFailed = 0, questionsKnown = 0;

  for (const r of results) {
    if (r.error) {
      questionsFailed++;
      continue;
    }
    if (r.ok) {
      questionsPassed++;
    } else if (r.knownLimitation) {
      questionsKnown++;
    } else {
      questionsFailed++;
    }
    totalSignals += r.totalSignals;
    totalPreserved += r.preserved;
    if (!byFile.has(r.file)) {
      byFile.set(r.file, { raw: r.rawTokens, compacted: r.compactedTokens, reduction: r.reductionPercent, questions: 0, preserved: 0, signals: 0 });
    }
    const f = byFile.get(r.file);
    f.questions++;
    f.preserved += r.preserved;
    f.signals += r.totalSignals;
  }
  for (const f of byFile.values()) {
    totalRaw += f.raw;
    totalCompacted += f.compacted;
  }
  return {
    byFile,
    totalRaw,
    totalCompacted,
    reductionPercent: totalRaw > 0 ? Math.round(((totalRaw - totalCompacted) / totalRaw) * 100) : 0,
    totalSignals,
    totalPreserved,
    fidelityPercent: totalSignals > 0 ? Math.round((totalPreserved / totalSignals) * 100) : 0,
    questionsPassed,
    questionsFailed,
    questionsKnown,
    totalQuestions: results.length,
  };
}

function printTextReport(results, summary) {
  const line = (s = '') => console.log(s);
  const bar = '━'.repeat(82);

  line('');
  line(c.cyan + bar + c.reset);
  line(c.cyan + c.bold + '  ⚡ TokenSlayer Eval — Signal Preservation' + c.reset);
  line(c.cyan + bar + c.reset);
  line('');
  line(c.bold + '  Per-file token savings' + c.reset);
  line(c.dim + '  ' + '─'.repeat(80) + c.reset);
  line('  ' + pad(c.bold + 'File' + c.reset, 40) +
    padLeft(c.bold + 'Raw' + c.reset, 12) +
    padLeft(c.bold + 'Compacted' + c.reset, 14) +
    padLeft(c.bold + 'Reduction' + c.reset, 14));
  for (const [file, f] of summary.byFile.entries()) {
    line('  ' + pad(file, 40) +
      padLeft(String(f.raw), 8) +
      padLeft(String(f.compacted), 10) +
      padLeft(c.green + f.reduction + '%' + c.reset, 14));
  }
  line(c.dim + '  ' + '─'.repeat(80) + c.reset);
  line('  ' + pad(c.bold + 'TOTAL' + c.reset, 40) +
    padLeft(String(summary.totalRaw), 8) +
    padLeft(String(summary.totalCompacted), 10) +
    padLeft(c.green + c.bold + summary.reductionPercent + '%' + c.reset, 14));

  line('');
  line(c.bold + '  Question fidelity (signal preservation)' + c.reset);
  line(c.dim + '  ' + '─'.repeat(80) + c.reset);
  line('  ' + pad(c.bold + 'ID' + c.reset, 8) +
    pad(c.bold + 'Question' + c.reset, 50) +
    padLeft(c.bold + 'Signals' + c.reset, 12) +
    padLeft(c.bold + 'Status' + c.reset, 12));
  for (const r of results) {
    if (r.error) {
      line('  ' + pad(r.id, 6) + pad(r.question || r.file, 50) + padLeft('—', 8) + padLeft(c.red + 'ERROR' + c.reset, 12));
      continue;
    }
    let status;
    if (r.ok) status = c.green + 'PASS' + c.reset;
    else if (r.knownLimitation) status = c.yellow + 'KNOWN' + c.reset;
    else status = c.red + 'FAIL' + c.reset;
    const sig = `${r.preserved}/${r.totalSignals}`;
    line('  ' + pad(r.id, 6) + pad(r.question.slice(0, 48), 50) +
      padLeft(sig, 8) + padLeft(status, 12));
    if (!r.ok && r.missing.length > 0) {
      for (const m of r.missing) {
        line('  ' + c.dim + '       missing signal: ' + JSON.stringify(m).slice(0, 70) + c.reset);
      }
      if (r.knownLimitation) {
        line('  ' + c.dim + '       known limitation: ' + r.knownLimitation.slice(0, 90) + c.reset);
      }
    }
  }

  line('');
  line(c.cyan + bar + c.reset);
  line(c.bold + '  Summary' + c.reset);
  line('  ' + pad('Files analyzed', 28) + summary.byFile.size);
  line('  ' + pad('Total raw tokens', 28) + summary.totalRaw.toLocaleString());
  line('  ' + pad('Total compacted tokens', 28) + summary.totalCompacted.toLocaleString());
  line('  ' + pad('Token reduction', 28) + c.green + c.bold + summary.reductionPercent + '%' + c.reset);
  line('  ' + pad('Questions passed', 28) +
    (summary.questionsFailed === 0 ? c.green : c.yellow) +
    summary.questionsPassed + '/' + summary.totalQuestions + c.reset);
  if (summary.questionsKnown > 0) {
    line('  ' + pad('Known limitations', 28) + c.yellow + summary.questionsKnown + c.reset);
  }
  if (summary.questionsFailed > 0) {
    line('  ' + pad('Unexpected failures', 28) + c.red + c.bold + summary.questionsFailed + c.reset);
  }
  line('  ' + pad('Signal fidelity', 28) +
    (summary.fidelityPercent === 100 ? c.green + c.bold : c.yellow) +
    summary.fidelityPercent + '%' + c.reset +
    c.dim + '  (' + summary.totalPreserved + '/' + summary.totalSignals + ' signals preserved)' + c.reset);
  line(c.cyan + bar + c.reset);
  line('');

  if (summary.questionsFailed === 0 && summary.questionsKnown === 0) {
    line(c.green + c.bold +
      `  ✓ Saved ${summary.reductionPercent}% of tokens while preserving 100% of the ` +
      `information needed to answer ${summary.totalQuestions} realistic dev questions.` +
      c.reset);
  } else if (summary.questionsFailed === 0) {
    line(c.green +
      `  ✓ Saved ${summary.reductionPercent}% of tokens with ${summary.fidelityPercent}% signal fidelity ` +
      `(${summary.questionsKnown} documented limitation${summary.questionsKnown === 1 ? '' : 's'}).` +
      c.reset);
  } else {
    line(c.red +
      `  ✗ ${summary.questionsFailed} unexpected failure${summary.questionsFailed === 1 ? '' : 's'} — see FAIL rows above.` +
      c.reset);
  }
  line('');
}

function main() {
  const wantJson = process.argv.includes('--json');
  const results = runAll();
  const summary = summarize(results);

  if (wantJson) {
    console.log(JSON.stringify({
      results,
      summary: {
        ...summary,
        byFile: Object.fromEntries(summary.byFile),
      },
    }, null, 2));
    return;
  }

  printTextReport(results, summary);
  // Exit 0 if no unexpected failures (known limitations are not failures).
  process.exit(summary.questionsFailed === 0 ? 0 : 1);
}

main();
