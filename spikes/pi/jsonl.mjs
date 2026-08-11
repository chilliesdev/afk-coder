// LF-only JSONL framing, ported from pi's modes/rpc/jsonl.ts.
// Deliberately NOT readline: readline also splits on U+2028/U+2029, which are
// valid unescaped inside JSON strings and would corrupt the stream.
import { StringDecoder } from 'node:string_decoder';

export function attachJsonlLineReader(stream, onLine) {
  const decoder = new StringDecoder('utf8');
  let buffer = '';

  stream.on('data', (chunk) => {
    buffer += decoder.write(chunk);
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      let line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line.length === 0) continue;
      try {
        onLine(JSON.parse(line));
      } catch (err) {
        onLine({ __parseError: String(err), raw: line });
      }
    }
  });
}

export const serializeJsonLine = (v) => JSON.stringify(v) + '\n';
