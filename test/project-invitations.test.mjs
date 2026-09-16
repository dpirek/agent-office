import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { createUserStore } from '../lib/users.js';
import { createUiStateStore } from '../lib/ui-state.js';
import { createAuthService } from '../api/auth.js';
import { createApiRouter } from '../api/index.js';

async function setup(t) {
 const dir=await mkdtemp(path.join(tmpdir(),'office-invitations-'));
 let clock=Date.now();
 const usersFile=path.join(dir,'users.sqlite'), stateFile=path.join(dir,'state.sqlite');
 const users=createUserStore(usersFile,{now:()=>clock}), state=createUiStateStore(stateFile);
 t.after(async()=>{users.close();state.close();await rm(dir,{recursive:true,force:true});});
 const auth=createAuthService({userStore:users,getProjects:()=>state.getProjects()});
 const router=createApiRouter({userStore:users,uiStateStore:state,sharedWorkspaceRoot:path.join(dir,'files'),subAgentManager:{listWorkers:()=>[],listTasks:()=>[]}});
 const request=async(url,{method='GET',body,token}={})=>{
  const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);req.method=method;req.socket={remoteAddress:'test'};
  req.headers={'content-type':'application/json',cookie:token?`office_session=${token}`:''};
  const result={};const res={setHeader(){},writeHead(status){result.status=status},end(value){result.body=value?JSON.parse(value):null}};
  const parsed=new URL(url,'http://office.test');
  if(!await auth.handle(req,res,parsed))await router(req,res,parsed);
  return result;
 };
 const register=async(email,role='member')=>{
  const user=await users.register({email,name:email.split('@')[0],password:'pass'});
  if(user.role!=='admin')users.update(user.id,{role});
  return {user:users.list().find(row=>row.id===user.id),token:(await users.login({email,password:'pass'})).token};
 };
 return {users,state,usersFile,stateFile,request,register,advance:()=>{clock+=8*86400_000;}};
}

test('private projects grant selected users; invitation registration is email-bound, single-use, and auto-approved',async t=>{
 const {users,state,usersFile,stateFile,request,register}=await setup(t);
 await register('admin@example.com');
 const owner=await register('owner@example.com'), chosen=await register('chosen@example.com'), outsider=await register('outsider@example.com');
 const created=await request('/api/projects',{method:'POST',token:owner.token,body:{name:'Private launch',memberIds:[chosen.user.id],inviteEmails:['New@Example.com']}});
 assert.equal(created.status,201);
 const {project,invitations}=created.body, invite=invitations[0];
 assert.equal(project.isPublic,false);assert.equal(project.ownerId,owner.user.id);
 assert.match(invite.path,/^\/register\?invite=[A-Za-z0-9_-]{43}$/);
 assert.equal((await request('/api/projects',{token:chosen.token})).body.projects.some(p=>p.id===project.id),true);
 assert.equal((await request('/api/projects',{token:outsider.token})).body.projects.some(p=>p.id===project.id),false);
 assert.equal((await request(`/api/tasks?projectId=${project.id}`,{token:outsider.token})).status,403);
 const info=await request(`/api/auth/invitation?code=${invite.code}`);
 assert.equal(info.body.invitation.email,'new@example.com');
 const db=new DatabaseSync(usersFile);const saved=db.prepare('SELECT token_hash FROM project_invitations').get();db.close();
 assert.match(saved.token_hash,/^[a-f0-9]{64}$/);assert.notEqual(saved.token_hash,invite.code);
 const body={email:'wrong@example.com',name:'New person',password:'pass',invitation:invite.code,role:'admin'};
 assert.equal((await request('/api/auth/register',{method:'POST',body})).status,403);
 assert.equal(users.list().some(user=>user.email===body.email),false);
 body.email='new@example.com';
 const joined=await request('/api/auth/register',{method:'POST',body});
 assert.equal(joined.status,201);assert.equal(joined.body.user.role,'member');assert.deepEqual(joined.body.user.projectIds,[project.id]);
 assert.equal((await request(`/api/auth/invitation?code=${invite.code}`)).status,400);
 assert.equal((await request('/api/auth/register',{method:'POST',body:{...body,email:'second@example.com'}})).status,400);
 const reopened=createUiStateStore(stateFile);assert.equal(reopened.requireProject(project.id).isPublic,false);assert.equal(reopened.requireProject(project.id).ownerId,owner.user.id);reopened.close();
 const published=await request('/api/projects',{method:'POST',token:owner.token,body:{name:'Public launch',isPublic:true}});
 assert.equal(published.body.project.isPublic,true);
 assert.equal((await request(`/api/tasks?projectId=${published.body.project.id}`,{token:outsider.token})).status,200);
 assert.equal((await request('/api/projects',{token:outsider.token})).body.projects.some(p=>p.id===published.body.project.id),true);
});

test('existing and pending invitees can join, expired and invalid invitations fail, and invalid member input creates nothing',async t=>{
 const {users,state,request,register,advance}=await setup(t);
 const admin=await register('admin@example.com'), pending=await register('pending@example.com','pending'), existing=await register('existing@example.com');
 const created=await request('/api/projects',{method:'POST',token:admin.token,body:{name:'Invites',inviteEmails:[pending.user.email,existing.user.email,'expired@example.com']}});
 const [pendingInvite,existingInvite,expired]=created.body.invitations;
 const accepted=await request('/api/auth/accept-invitation',{method:'POST',token:pending.token,body:{invitation:pendingInvite.code}});
 assert.equal(accepted.status,200);assert.equal(accepted.body.user.role,'member');assert.deepEqual(users.session(pending.token).projectIds,[created.body.project.id]);
 assert.equal((await request('/api/auth/login',{method:'POST',body:{email:existing.user.email,password:'pass',invitation:existingInvite.code}})).status,200);
 assert.ok(users.list().find(u=>u.id===existing.user.id).projectIds.includes(created.body.project.id));
 assert.equal((await request('/api/auth/invitation?code=invalid')).status,400);
 const before=state.getProjects().length;
 assert.equal((await request('/api/projects',{method:'POST',token:admin.token,body:{name:'Bad',memberIds:['missing']}})).status,400);
 assert.equal((await request('/api/projects',{method:'POST',token:admin.token,body:{name:'Bad',inviteEmails:['invalid']}})).status,400);
 assert.equal(state.getProjects().length,before);
 advance();
 assert.equal((await request(`/api/auth/invitation?code=${expired.code}`)).status,400);
 assert.equal((await request('/api/auth/register',{method:'POST',body:{email:'expired@example.com',name:'Expired',password:'pass',invitation:expired.code}})).status,400);
 assert.equal(users.list().some(user=>user.email==='expired@example.com'),false);
});

test('existing project invitations require access and grant the invited person that project', async t => {
 const {request,register,state}=await setup(t);
 await register('admin@example.com');
 const owner=await register('owner@example.com'), outsider=await register('outsider@example.com');
 const created=await request('/api/projects',{method:'POST',token:owner.token,body:{name:'Existing project'}});
 const projectId=created.body.project.id;
 const body={projectId,email:'chat-invite@example.com'};
 const count=state.getProjects().length;
 assert.equal((await request('/api/project-invitations',{method:'POST',body})).status,401);
 assert.equal((await request('/api/project-invitations',{method:'POST',token:outsider.token,body})).status,403);
 assert.equal((await request('/api/project-invitations',{method:'POST',token:owner.token,body:{...body,email:'invalid'}})).status,400);
 const result=await request('/api/project-invitations',{method:'POST',token:owner.token,body});
 assert.equal(result.status,201);
 assert.equal(state.getProjects().length,count);
 const joined=await request('/api/auth/register',{method:'POST',body:{email:body.email,name:'Chat member',password:'pass',invitation:result.body.invitation.code}});
 assert.equal(joined.status,201);
 assert.equal(joined.body.user.role,'member');
 assert.deepEqual(joined.body.user.projectIds,[projectId]);
 assert.equal((await request('/api/worker-token',{method:'POST',token:owner.token,body:{name:'Forbidden'}})).status,403);
});


test('new members immediately create a project and access only their permitted projects', async t => {
 const {request,register}=await setup(t);
 const admin=await register('admin@example.com');
 const privateProject=await request('/api/projects',{method:'POST',token:admin.token,body:{name:'Private admin project'}});
 const created=await request('/api/auth/register',{method:'POST',body:{email:'new-member@example.com',name:'New member',password:'pass',role:'admin',projectIds:null}});
 assert.equal(created.status,201);
 assert.equal(created.body.user.role,'member');
 assert.deepEqual(created.body.user.projectIds,[]);
 const member=await register('second-member@example.com');
 assert.equal((await request('/api/projects',{token:member.token})).body.projects.length,0);
 assert.equal((await request(`/api/tasks?projectId=${privateProject.body.project.id}`,{token:member.token})).status,403);
 const own=await request('/api/projects',{method:'POST',token:member.token,body:{name:'My first project'}});
 assert.equal(own.status,201);
 assert.equal(own.body.project.ownerId,member.user.id);
 assert.equal((await request(`/api/tasks?projectId=${own.body.project.id}`,{token:member.token})).status,200);
 assert.deepEqual((await request('/api/auth/session',{token:member.token})).body.user.projectIds,[own.body.project.id]);
});
