// Does the readline hazard actually bite? U+2028 is legal unescaped inside a
// JSON string, and file contents in tool results routinely carry it.
//   node spikes/pi/framing-check.mjs
import * as readline from 'node:readline';
import { PassThrough } from 'node:stream';
import { attachJsonlLineReader } from './jsonl.mjs';

const record = { type: 'tool_result', content: 'line one line two' };
const payload = JSON.stringify(record) + '\n';

const a = new PassThrough();
const viaReadline = [];
readline.createInterface({ input: a }).on('line', (l) => viaReadline.push(l));

const b = new PassThrough();
const viaJsonl = [];
attachJsonlLineReader(b, (m) => viaJsonl.push(m));

a.end(payload);
b.end(payload);

setTimeout(() => {
  console.log('readline produced', viaReadline.length, 'lines (expected 1)');
  for (const l of viaReadline) {
    try { JSON.parse(l); console.log('  parsed ok'); }
    catch (e) { console.log('  PARSE FAILED:', String(e).slice(0, 80)); }
  }
  console.log('jsonl reader produced', viaJsonl.length, 'records (expected 1)');
  console.log('  content intact:', viaJsonl[0]?.content === record.content);
}, 100);
