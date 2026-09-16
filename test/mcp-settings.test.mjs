import test from 'node:test';
import assert from 'node:assert/strict';
import { readMcpForm, writeMcpForm, validateMcpServer } from '../public/lib/mcp-form.mjs';
import { testMcpServer } from '../lib/mcp.js';
import { createSettingsApiHandlers } from '../api/settings.js';

const server = { server_label: 'gmail', server_url: 'https://gmail.example/mcp', headers: { Authorization: 'Bearer secret' } };

test('MCP form preserves config options and local/connector entries while editing HTTP servers', () => {
  const source = { mcp: { auto_approve: true, servers: [{ ...server, allowed_tools: ['search'] }, { server_label: 'connector', connector_id: 'one' }] }, mcp_servers: { local: { command: 'node', args: ['server.js'] } } };
  const { config, servers } = readMcpForm(JSON.stringify(source));
  servers[0].server_url = 'https://new.example/mcp';
  const saved = JSON.parse(writeMcpForm(config, servers));
  assert.equal(saved.mcp.servers[0].server_url, 'https://new.example/mcp');
  assert.deepEqual(saved.mcp.servers[0].allowed_tools, ['search']);
  assert.deepEqual(saved.mcp_servers, source.mcp_servers);
  assert.equal(saved.mcp.auto_approve, true);
  assert.deepEqual(saved.mcp.servers[1], source.mcp.servers[1]);
  assert.deepEqual(JSON.parse(writeMcpForm([], [server])), [server]);
  assert.deepEqual(JSON.parse(writeMcpForm({ servers: [] }, [server])), { servers: [server] });
  assert.throws(() => readMcpForm('{broken'), SyntaxError);
});
test('MCP connection form validates URL, names, and HTTP headers', () => {
  assert.equal(validateMcpServer(server), server);
  for (const server_url of ['invalid', 'file:///etc/passwd', 'https://user:secret@example.com/mcp']) assert.throws(() => validateMcpServer({ ...server, server_url }));
  assert.throws(() => validateMcpServer({ ...server, server_label: 'bad name' }));
  assert.throws(() => validateMcpServer({ ...server, headers: { Authorization: 'secret\r\nX-Injected: yes' } }));
});
test('Test discovers paginated tools without invoking them or saving, and redacts header secrets', async () => {
  const methods=[];
  const tools = await testMcpServer(server, { fetchImpl: async (url, options) => {
    assert.equal(url, server.server_url);
    assert.equal(options.headers.get('authorization'), 'Bearer secret');
    assert.equal(options.redirect, 'error');
    const request=JSON.parse(options.body); methods.push(request.method);
    const result=request.params.cursor ? {tools:[{name:'second',description:'secret',inputSchema:{type:'object'}}]} : {tools:[{name:'first',description:'First method'}],nextCursor:'page-two'};
    return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result}),{headers:{'content-type':'application/json'}});
  } });
  assert.deepEqual(methods,['tools/list','tools/list']);
  assert.deepEqual(tools.map(tool=>tool.name),['first','second']);
  assert.equal(tools[1].description,'[redacted]');
});
test('Test supports initialization and cleans up sessions without calling tools', async () => {
  const methods=[];
  const tools=await testMcpServer(server,{fetchImpl:async(_url,options)=>{
    if(options.method==='DELETE'){methods.push('DELETE');return new Response(null,{status:204});}
    const req=JSON.parse(options.body);methods.push(req.method);
    if(methods.length===1)return new Response(JSON.stringify({error:'not initialized'}),{status:400});
    if(req.method==='notifications/initialized')return new Response(null,{status:202});
    return new Response(JSON.stringify({jsonrpc:'2.0',id:req.id,result:req.method==='initialize'?{protocolVersion:'2025-06-18'}:{tools:[]}}),{headers:{'mcp-session-id':'session-one'}});
  }});
  assert.deepEqual(tools,[]);
  assert.deepEqual(methods,['tools/list','initialize','notifications/initialized','tools/list','DELETE']);
});
test('Test errors do not expose returned credentials and test API is admin-only', async () => {
  await assert.rejects(testMcpServer(server,{fetchImpl:async()=>new Response('Bearer secret',{status:401})}),error=>!error.message.includes('secret')&&error.message.includes('401'));
  const handler=createSettingsApiHandlers({})['/api/mcp/test'];
  const result={};
  await handler({method:'POST',user:{role:'member'}},{writeHead(status){result.status=status;},end(body){result.body=JSON.parse(body);}});
  assert.equal(result.status,403);
});

test('MCP form JSON survives SQLite save and loads into the Office Manager', async t => {
  const { loadMcpTools } = await import('../lib/mcp.js');
  const { createUiStateStore } = await import('../lib/ui-state.js');
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { Readable } = await import('node:stream');
  const directory = await mkdtemp(join(tmpdir(), 'office-mcp-config-'));
  const store = createUiStateStore(join(directory, 'state.sqlite'));
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  const content = writeMcpForm({ mcp: { auto_approve: true } }, [server]);
  const req = Readable.from([Buffer.from(JSON.stringify({ content }))]); req.method = 'PUT';
  const res = { writeHead(status) { this.status = status; }, end() {} };
  await createSettingsApiHandlers({ uiStateStore: store })['/api/config'](req, res);
  assert.equal(res.status, 200);
  const tools = await loadMcpTools({ configContent: store.getMcpConfig(), env: {} });
  assert.equal(tools.length, 1);
  assert.equal(tools[0].server_url, server.server_url);
  assert.equal(tools[0].headers.Authorization, server.headers.Authorization);
  assert.equal(tools[0].require_approval, 'never');
});

test('stored MCP config supports legacy TOML, JSON arrays, whitespace and empty settings', async () => {
  const { loadMcpTools } = await import('../lib/mcp.js');
  const toml = '[mcp]\nauto_approve = true\n[[mcp.servers]]\nserver_label = "gmail"\nserver_url = "https://gmail.example/mcp"\n';
  for (const configContent of [toml, JSON.stringify([server]), '\uFEFF \n' + JSON.stringify({ servers: [server] })]) {
    const tools = await loadMcpTools({ configContent, env: {} });
    assert.equal(tools[0].server_label, 'gmail');
    assert.equal(tools[0].server_url, server.server_url);
  }
  for (const configContent of ['', '{}', '[]']) assert.deepEqual(await loadMcpTools({ configContent, env: {} }), []);
  await assert.rejects(loadMcpTools({ configContent: '{broken', env: {} }), /Invalid MCP config JSON/);
});
