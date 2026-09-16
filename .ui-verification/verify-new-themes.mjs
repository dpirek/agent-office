import fs from 'node:fs';
import assert from 'node:assert/strict';
const targets = await (await fetch('http://127.0.0.1:9337/json')).json();
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pending = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(m.error) : p.resolve(m.result); } };
const send = (method, params={}) => new Promise((resolve,reject) => { pending.set(++id,{resolve,reject}); ws.send(JSON.stringify({id,method,params})); });
const evaluate = async expression => { const r = await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true}); if(r.exceptionDetails) throw Error(r.exceptionDetails.text); return r.result.value; };
const pause = () => new Promise(r => setTimeout(r,700));
await send('Page.enable');
await send('Page.addScriptToEvaluateOnNewDocument',{source:`history.replaceState(null,'','/settings'); const originalFetch = window.fetch.bind(window); window.fetch = (url, options) => String(url).startsWith('/api/') ? Promise.resolve(new Response(JSON.stringify({user:{id:'preview',name:'Preview',role:'admin'},projects:[{id:'central-office',name:'Central Office'}],prompts:[],skills:[],tasks:[],operations:[],workers:[],messages:[],entries:[],logs:[],tree:[],toolPermissions:{},mcpConfig:{},providerSettings:{}}),{headers:{'Content-Type':'application/json'}})) : originalFetch(url,options);`});
await send('Emulation.setDeviceMetricsOverride',{width:1440,height:960,deviceScaleFactor:1,mobile:false});
await send('Page.navigate',{url:'http://127.0.0.1:8129/index.html'}); await pause();

for (const theme of ['matrix','sakura','teams','terminal']) {
  await evaluate(`document.querySelector('[data-section="settings"]').click(); document.querySelector('[data-settings-tab="appearance"]').click(); document.querySelector('input[value="${theme}"]').click()`);
  assert.equal(await evaluate(`document.documentElement.dataset.theme`),theme);
  await send('Page.navigate',{url:'http://127.0.0.1:8129/index.html'}); await pause();
  assert.equal(await evaluate(`document.documentElement.dataset.theme`),theme);
  if (['matrix','sakura'].includes(theme)) {
    await evaluate(`document.querySelector('[data-section="dashboard"]').click()`); await pause();
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.theme-banner')).display`),'flex');
    let shot=await send('Page.captureScreenshot',{format:'png'}); fs.writeFileSync(`screenshots/${theme}-dashboard.png`,Buffer.from(shot.data,'base64'));
    assert.equal(await evaluate(`document.querySelector('.dashboard-tasks-panel').getBoundingClientRect().bottom <= innerHeight`),true);
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await evaluate(`document.querySelector('[data-section="settings"]').click(); document.querySelector('[data-settings-tab="appearance"]').click()`); await pause();
    assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`),true);
    shot=await send('Page.captureScreenshot',{format:'png'}); fs.writeFileSync(`screenshots/${theme}-mobile.png`,Buffer.from(shot.data,'base64'));
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:960,deviceScaleFactor:1,mobile:false});
  }
}
console.log('PASS: all four themes switch and persist, both new dashboards fit, mobile settings have no horizontal overflow.');
await send('Browser.close'); ws.close();
