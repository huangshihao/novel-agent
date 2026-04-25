import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(import.meta.url);

// Set temp dir before importing
const tmp = mkdtempSync(join(tmpdir(), 'test-'));
process.env['NOVEL_AGENT_DATA_DIR'] = tmp;

// Now import to pick up env
import('./packages/agent-server/src/storage/novel-index.js').then(async (m) => {
  const sample = {
    id: 'nv-1',
    title: '测试',
    status: 'uploaded',
    chapter_count: 100,
    analyzed_count: 0,
    analysis_from: 1,
    analysis_to: 100,
    analyzed_to: 0,
    error: null,
    created_at: 1000,
    updated_at: 1000,
  };

  await m.writeNovelIndex(sample);
  
  // Check file contents
  const filePath = join(tmp, 'nv-1', 'index.md');
  const content = readFileSync(filePath, 'utf8');
  console.log('File contents:');
  console.log(content);
  console.log('---');

  const got = await m.readNovelIndex('nv-1');
  console.log('\nOriginal error:', sample.error);
  console.log('Read error:', got?.error);
  console.log('Full match:', JSON.stringify(sample) === JSON.stringify(got));

  rmSync(tmp, { recursive: true, force: true });
}).catch(e => {
  console.error(e);
  process.exit(1);
});
