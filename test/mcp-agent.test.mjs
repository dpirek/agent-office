import test from 'node:test';
import assert from 'node:assert/strict';
import { loadMcpTools } from '../lib/mcp.js';
import { CodingAgent } from '../lib/agent.js';
import { createModelClient } from '../lib/openai.js';

const server = {
  server_label: 'gmail', server_url: 'https://gmail.example/mcp',
  authorization: 'test-token', allowed_tools: ['search'],
};

test('remote MCP tools reach a custom provider and execute with configured authentication', async () => {
  const requests = [];
  const tools = await loadMcpTools({
    configContent: JSON.stringify([server]), env: {}, autoApprove: true,
    discoverRemoteTools: true, supportsNativeMcp: false,
    fetchImpl: async (url, options) => {
      assert.equal(url, server.server_url);
      assert.equal(options.headers.get('authorization'), 'Bearer test-token');
      const request = JSON.parse(options.body);
      requests.push(request);
      let result;
      if (request.method === 'tools/list') {
        result = request.params.cursor
          ? { tools: [{ name: 'search', description: 'Search Gmail', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } }] }
          : { tools: [{ name: 'send' }], nextCursor: 'next' };
      } else {
        assert.equal(request.method, 'tools/call');
        assert.equal(request.params.name, 'search');
        assert.deepEqual(request.params.arguments, { query: 'in:inbox' });
        result = { content: [{ type: 'text', text: 'Mock search result' }] };
      }
      return Response.json({ jsonrpc: '2.0', id: request.id, result });
    },
  });
  assert.deepEqual(tools.map(tool => tool.name), ['gmail__search']);
  let turns = 0;
  const model = createModelClient({
    provider: 'custom', baseUrl: 'https://model.example/v1', apiKey: 'mock',
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.deepEqual(body.tools.map(tool => tool.function.name), ['gmail__search']);
      assert.equal(body.tools[0].type, 'function');
      assert.equal(body.tools[0].function.source, undefined);
      turns++;
      if (turns === 1) return Response.json({ id: 'first', choices: [{ message: {
        role: 'assistant', content: null, tool_calls: [{ id: 'search-call', type: 'function', function: { name: 'gmail__search', arguments: '{"query":"in:inbox"}' } }],
      } }] });
      const output = body.messages.find(message => message.role === 'tool');
      assert.match(output.content, /Mock search result/);
      return Response.json({ id: 'second', choices: [{ message: { role: 'assistant', content: 'Search completed.' } }] });
    },
  });
  const agent = new CodingAgent({
    client: { createResponse: body => model.createResponse(body) },
    tools: [...tools, { name: 'workspace_tool' }], root: process.cwd(), model: 'test',
  });
  assert.equal(await agent.run('Search Gmail', { disabledSteps: ['tools'] }), 'Search completed.');
  assert.equal(turns, 2);
  assert.deepEqual(requests.map(request => request.method), ['tools/list', 'tools/list', 'tools/call']);

  agent.client = { async createResponse(body) {
    assert.deepEqual(body.tools.map(tool => tool.name), ['workspace_tool']);
    return { id: 'disabled', output_text: 'MCP disabled.' };
  } };
  await agent.run('Check available tools', { disabledSteps: ['mcp'] });
});

test('unsupported native connectors fail explicitly instead of silently disappearing', async () => {
  await assert.rejects(loadMcpTools({
    configContent: JSON.stringify([{ server_label: 'gmail', connector_id: 'connector_gmail' }]),
    env: {}, discoverRemoteTools: true, supportsNativeMcp: false,
  }), /gmail requires native MCP support/);
});

test('failed remote authentication cannot be presented as a loaded server', async () => {
  const messages = [];
  await assert.rejects(loadMcpTools({
    configContent: JSON.stringify([server]), env: {}, discoverRemoteTools: true,
    onInfo: message => messages.push(message),
    fetchImpl: async () => Response.json({ error: { message: 'Unauthorized' } }, { status: 401 }),
  }), /HTTP 401/);
  assert.equal(messages.some(message => message.startsWith('Loaded')), false);
});
