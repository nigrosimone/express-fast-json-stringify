'use strict';

// After warmup the serialization path neither deoptimizes nor leaves TurboFan. A shape that
// changes late, or a hot function that stops optimizing, is a regression a benchmark sees only
// as noise.

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

// node 20 is end of life, and its tiering leaves res.fastJson below TurboFan on this load
const skip = Number(process.versions.node.split('.')[0]) < 22 && 'needs node 22 or newer';

test('the serialization path does not deoptimize in steady state, and its hot functions stay in TurboFan', { skip }, (t) => {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  delete env.NODE_V8_COVERAGE;
  const output = execFileSync(process.execPath, ['--allow-natives-syntax', path.join(__dirname, 'v8-steady-state-probe.cjs')], {
    encoding: 'utf8',
    timeout: 120000,
    env,
    maxBuffer: 64 * 1024 * 1024,
  });
  const lines = output.split('\n');
  const report = JSON.parse(lines.find((line) => line.startsWith('{"type":"report"')));
  // a deopt in this package, by the file name --trace-file-names puts in the line
  const source = path.resolve(__dirname, '../../src');
  const deopts = lines.filter((line) => line.startsWith('[bailout') && line.includes(source)).map((line) => line.replace(/0x[0-9a-f]+/g, '').slice(0, 300));
  t.diagnostic(JSON.stringify({ ...report, deopts }));
  assert.ok(report.turbofanBit > 0, 'the TurboFan bit could not be read off a probe function');
  assert.deepEqual(deopts, [], 'a deopt in src after warmup');
  for (const [name, optimized] of Object.entries(report.optimized)) {
    assert.ok(optimized, `${name} is not TurboFan code after warmup`);
  }
});
