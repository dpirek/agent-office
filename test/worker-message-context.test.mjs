import test from 'node:test';
import assert from 'node:assert/strict';
import { workerMessageContext, formatWorkerMessageContext } from '../lib/worker-message-context.js';
import { SubAgentManager } from '../lib/sub-agents.js';
import { projectMcpTools, callProjectTool } from '../lib/project-mcp.js';

const state = {
 requireProject: id => ({ id, name: 'Launch website' }),
 getOfficeTasks: ({projectId}) => projectId === 'alpha' ? [{ id: 'office-task', title: 'Fix sign-in', messageId: 'assignment', workerTaskId: 'worker-task' }] : [],
};
test('direct messages carry project and task context in metadata and model-visible text', () => {
 const sent=[];
 const manager=new SubAgentManager({getMessageContext:message=>workerMessageContext(state,message)});
 manager.registerWorker({name:'Builder',url:'ws://worker'}, {connectionId:'one',send:message=>sent.push(message)});
 manager.sendDirectMessage({agent:'Builder',projectId:'alpha',officeTaskId:'office-task',text:'What is the blocker?'});
 const message=sent.at(-1);
 assert.equal(message.context.project.id,'alpha');
 assert.equal(message.context.task.id,'office-task');
 assert.equal(message.officeTaskId,'office-task');
 assert.match(message.message.parts[0].text,/Launch website \(alpha\)/);
 assert.match(message.message.parts[0].text,/Fix sign-in \(office-task\)/);
 assert.match(message.message.parts[0].text,/projectId=alpha/);
 manager.sendDirectMessage({agent:'Builder',projectId:'alpha',text:'Hello'});
 assert.equal(sent.at(-1).context.task,null);
 assert.match(sent.at(-1).message.parts[0].text,/no specific task assigned/);
 assert.throws(()=>manager.sendDirectMessage({agent:'Builder',projectId:'beta',officeTaskId:'office-task',text:'Wrong project'}),/does not belong/);
});
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

test('queued assignments preserve explicit Office task identity before delivery', async () => {
 const sent=[];
 const manager=new SubAgentManager({getMessageContext:message=>workerMessageContext(state,message),prepareTask:async record=>record.task});
 manager.registerWorker({name:'Builder',url:'ws://worker'}, {connectionId:'one',send:message=>sent.push(message)});
 const queued=manager.queue({agent:'Builder',projectId:'alpha',officeTaskId:'office-task',title:'Fix sign-in',task:'Fix it'});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(sent.at(-1).officeTaskId,'office-task');
 assert.equal(sent.at(-1).context.task.title,'Fix sign-in');
 assert.equal(sent.at(-1).context.project.id,'alpha');
 manager.cancelTask({messageId:queued.task.messageId});
 await queued.completion;
});
