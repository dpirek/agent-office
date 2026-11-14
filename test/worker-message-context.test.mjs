import test from 'node:test';
import assert from 'node:assert/strict';
import { workerMessageContext, formatWorkerMessageContext } from '../lib/worker-message-context.js';
import { SubAgentManager } from '../lib/sub-agents.js';
import { projectMcpTools, callProjectTool } from '../lib/project-mcp.js';

const state = {
 requireProject: id => ({ id, name: 'Launch website' }),
 getOfficeTasks: ({projectId}) => projectId === 'alpha' ? [{ id: 'office-task', title: 'Fix sign-in', messageId: 'assignment', workerTaskId: 'worker-task' }] : [],
};
test('assigned worker message IDs resolve to Office task identity', () => {
 const context=workerMessageContext(state,{projectId:'alpha',messageId:'assignment'});
 assert.equal(context.task.id,'office-task');
 assert.match(formatWorkerMessageContext(context,'Continue'),/Worker|Fix sign-in/);
});
test('MCP advertises projectId in payloads and rejects mismatched project arguments', async () => {
 const tools=projectMcpTools('alpha');
 for(const tool of tools) {
  assert.equal(tool.inputSchema.properties.projectId.const,'alpha');
  assert.ok(tool.inputSchema.required.includes('projectId'));
 }
 const options={uiStateStore:state};
 const context=await callProjectTool(options,'alpha','project_get_context',{projectId:'alpha'});
 assert.equal(context.project.id,'alpha');
 await assert.rejects(callProjectTool(options,'alpha','project_get_context',{projectId:'beta'}),/does not match/);
});
