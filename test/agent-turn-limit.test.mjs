import test from 'node:test';
import assert from 'node:assert/strict';
import { CodingAgent, resolveAgentMaxTurns } from '../lib/agent.js';

test('agent turn limit defaults to 60 and accepts a positive environment override', () => {
  for (const env of [{}, { AI_HARNESS_MAX_TURNS: '' }, { AI_HARNESS_MAX_TURNS: '  ' }]) {
    assert.equal(resolveAgentMaxTurns(env), 60);
  }
  assert.equal(resolveAgentMaxTurns({ AI_HARNESS_MAX_TURNS: '120' }), 120);
  assert.equal(resolveAgentMaxTurns({ AI_HARNESS_MAX_TURNS: ' 1 ' }), 1);
  for (const value of ['0', '-1', '1.5', 'invalid', 'Infinity', 'NaN', '9007199254740992']) {
    assert.throws(() => resolveAgentMaxTurns({ AI_HARNESS_MAX_TURNS: value }), /must be a positive integer/);
  }
});

for (const configured of [undefined, resolveAgentMaxTurns({ AI_HARNESS_MAX_TURNS: '3' })]) {
  test(`agent stops at ${configured ?? 60} turns and permits a final answer on the last turn`, async () => {
    const limit = configured ?? 60;
    let turns = 0, finish = false;
    const agent = new CodingAgent({
      maxTurns: configured, tools: [], root: process.cwd(), model: 'test',
      client: { async createResponse() {
        turns++;
        return finish && turns === limit
          ? { id: String(turns), output_text: 'Finished.' }
          : { id: String(turns), output: [{ type: 'function_call', name: 'unavailable', call_id: String(turns), arguments: '{}' }] };
      } },
    });
    await assert.rejects(agent.run('Work'), new RegExp(`Agent exceeded the ${limit}-turn limit`));
    assert.equal(turns, limit);
    turns = 0; finish = true;
    assert.equal(await agent.run('Work'), 'Finished.');
    assert.equal(turns, limit);
  });
}
