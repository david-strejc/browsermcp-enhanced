// BrowserMCP Enhanced Firefox Background (Protocol v2)
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

let ws = null;
let reconnectTimer = null;
let keepAliveTimer = null;
let connectAttempts = 0;
const MAX_STARTUP_ATTEMPTS = 3;

const tabForSession = new Map();
const lastFocusedTabForSession = new Map();

let extensionConfig = { unsafeMode: false, serverBase: 'ws://localhost:8765', instanceId: null };

function uuidv4() { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random()*16|0, v=c==='x'?r:(r&0x3|0x8); return v.toString(16); }); }

async function loadConfig() {
  const res = await browserAPI.storage.local.get(['unsafeMode','serverUrl','browsermcp_instance_id']);
  if (typeof res.unsafeMode === 'boolean') extensionConfig.unsafeMode = res.unsafeMode;
  if (res.serverUrl) extensionConfig.serverBase = res.serverUrl.replace(/\/$/, '');
  if (res.browsermcp_instance_id) extensionConfig.instanceId = res.browsermcp_instance_id; else {
    extensionConfig.instanceId = uuidv4();
    await browserAPI.storage.local.set({ browsermcp_instance_id: extensionConfig.instanceId });
  }
}

function updateIcon(connected) {
  const iconPath = connected ? { '16':'icon-16-connected.png','48':'icon-48-connected.png','128':'icon-128-connected.png' } : { '16':'icon-16-disconnected.png','48':'icon-48-disconnected.png','128':'icon-128-disconnected.png' };
  browserAPI.browserAction.setIcon({ path: iconPath });
  browserAPI.browserAction.setBadgeText({ text: connected ? '' : '!' });
  browserAPI.browserAction.setBadgeBackgroundColor({ color: connected ? '#4CAF50' : '#f44336' });
}

function sessionWsUrl() { return `${extensionConfig.serverBase}/session/${extensionConfig.instanceId}`; }

function recordSessionTab(sessionId, tabId) {
  if (typeof tabId !== 'number') return;
  let list = tabForSession.get(sessionId); if (!list) { list = []; tabForSession.set(sessionId, list);} 
  if (!list.includes(tabId)) list.push(tabId);
  lastFocusedTabForSession.set(sessionId, tabId);
}

async function ensureSessionTab(sessionId, preferredTabId) {
  if (typeof preferredTabId === 'number') { try { await browserAPI.tabs.get(preferredTabId); recordSessionTab(sessionId, preferredTabId); return preferredTabId; } catch {} }
  const last = lastFocusedTabForSession.get(sessionId);
  if (typeof last === 'number') { try { await browserAPI.tabs.get(last); recordSessionTab(sessionId, last); return last; } catch {} }
  const created = await browserAPI.tabs.create({ url: 'about:blank', active: true }); recordSessionTab(sessionId, created.id); return created.id;
}

async function connectToMCP() {
  await loadConfig();
  if (ws && ws.readyState === WebSocket.OPEN) return;
  if (ws && ws.readyState === WebSocket.CONNECTING) return;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  const url = sessionWsUrl();
  ws = new WebSocket(url);
  ws.onopen = () => { updateIcon(true); connectAttempts = 0; if (keepAliveTimer) clearInterval(keepAliveTimer); keepAliveTimer = setInterval(()=>{ if (ws && ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({type:'ping',timestamp:Date.now()})); },30000); };
  ws.onmessage = async (evt) => {
    let wireId = null;
    try {
      const env = JSON.parse(evt.data);
      if (env.type === 'ping') { if (ws && ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({type:'pong',timestamp:Date.now()})); return; }
      if (env.type !== 'command') return;
      const sessionId = env.sessionId; wireId = env.wireId; const name = env.name||env.type; const payload = env.payload||{}; const targetTabId = typeof env.tabId==='number'?env.tabId:undefined;
      const tabId = await ensureSessionTab(sessionId, targetTabId); recordSessionTab(sessionId, tabId);
      const result = await executeInTab(tabId, name, payload);
      const data = result && typeof result==='object' ? { ...result, tabId: (result.tabId ?? tabId) } : { tabId };
      if (ws && ws.readyState===WebSocket.OPEN) {
        ws.send(JSON.stringify({ wireId, sessionId, type:'response', data }));
        const tabs = tabForSession.get(sessionId) || [];
        ws.send(JSON.stringify({ type:'event', sessionId, name:'debug', payload:{ where:'ff-background', action:name, resolvedTabId:tabId, tabs:[...tabs], lastFocused:lastFocusedTabForSession.get(sessionId) } }));
      }
    } catch (e) { if (ws && ws.readyState===WebSocket.OPEN && wireId) ws.send(JSON.stringify({wireId, type:'response', data:{ success:false, error:String(e) }})); }
  };
  ws.onerror = () => { updateIcon(false); };
  ws.onclose = () => { updateIcon(false); if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer=null; } if (reconnectTimer) clearTimeout(reconnectTimer); const d = connectAttempts<MAX_STARTUP_ATTEMPTS?2000:Math.min(30000,2000*Math.pow(2,connectAttempts-MAX_STARTUP_ATTEMPTS)); connectAttempts++; reconnectTimer = setTimeout(connectToMCP, d); };
}

async function executeInTab(tabId, name, payload) {
  switch (name) {
    case 'browser_navigate': return await handleNavigate(tabId, payload);
    case 'browser_go_back': return await handleGoBack(tabId);
    case 'browser_go_forward': return await handleGoForward(tabId);
    case 'dom.click': return await handleClick(tabId, payload);
    case 'dom.hover': return await handleHover(tabId, payload);
    case 'dom.type': return await handleType(tabId, payload);
    case 'dom.select': return await handleSelectOption(tabId, payload);
    case 'browser_wait': return await handleWait(payload);
    case 'browser_screenshot': return await handleScreenshot(tabId);
    case 'screenshot.capture': return await handleScreenshot(tabId);
    case 'browser_get_console_logs': return await handleGetConsoleLogs(tabId);
    case 'console.get': return await handleGetConsoleLogs(tabId);
    case 'snapshot.accessibility': return await handleSnapshot(tabId, payload);
    case 'tabs.list': return await handleTabList();
    case 'tabs.select': return await handleTabSelect(payload);
    case 'tabs.new': return await handleTabNew(payload);
    case 'tabs.close': return await handleTabClose(payload);
    case 'js.execute': return await handleExecuteJS(tabId, payload);
    default: return { success:false, error:`Unhandled command: ${name}` };
  }
}

async function handleNavigate(tabId, { url }) { try { if (typeof tabId==='number') { await browserAPI.tabs.update(tabId, {url}); return { success:true, tabId }; } const t=await browserAPI.tabs.create({ url }); return { success:true, tabId:t.id }; } catch(e){ return { success:false, error:String(e) }; } }
async function handleGoBack(tabId) { try { if (typeof tabId!=='number') return { success:false, error:'No active tab' }; if (typeof browserAPI.tabs.goBack==='function') await browserAPI.tabs.goBack(tabId); else await browserAPI.tabs.executeScript(tabId, { code:'window.history.back();' }); return { success:true }; } catch(e){ return { success:false, error:String(e) }; } }
async function handleGoForward(tabId) { try { if (typeof tabId!=='number') return { success:false, error:'No active tab' }; if (typeof browserAPI.tabs.goForward==='function') await browserAPI.tabs.goForward(tabId); else await browserAPI.tabs.executeScript(tabId, { code:'window.history.forward();' }); return { success:true }; } catch(e){ return { success:false, error:String(e) }; } }
async function handleClick(tabId, { ref, element }) { try { if (typeof tabId!=='number') return { success:false, error:'No active tab' }; const check = await browserAPI.tabs.sendMessage(tabId, { action:'checkClickType', ref }); if (check && check.needsTrustedClick) return await handleTrustedClickFirefox(tabId, ref, element, check); return await browserAPI.tabs.sendMessage(tabId, { action:'click', ref, element }); } catch(e){ return { success:false, error:String(e) }; } }
async function handleTrustedClickFirefox(tabId, ref, element, check) { try { if (check.isOAuth||check.opensNewWindow) { const urlRes = await browserAPI.tabs.sendMessage(tabId, { action:'getElementUrl', ref }); if (urlRes && urlRes.url) { const nt = await browserAPI.tabs.create({ url:urlRes.url, active:true }); return { success:true, tabId:nt.id, message:'Opened in new tab for secure interaction' }; } } return await browserAPI.tabs.sendMessage(tabId, { action:'trustedClick', ref, element }); } catch(e){ return await browserAPI.tabs.sendMessage(tabId, { action:'click', ref, element }); } }
async function handleType(tabId, { ref, element, text, submit=false }) { try { if (typeof tabId!=='number') return { success:false, error:'No active tab' }; return await browserAPI.tabs.sendMessage(tabId, { action:'type', ref, element, text, submit }); } catch(e){ return { success:false, error:String(e) }; } }
async function handleHover(tabId, { ref, element }) { try { if (typeof tabId!=='number') return { success:false, error:'No active tab' }; return await browserAPI.tabs.sendMessage(tabId, { action:'hover', ref, element }); } catch(e){ return { success:false, error:String(e) }; } }
async function handleSelectOption(tabId, { ref, element, values }) { try { if (typeof tabId!=='number') return { success:false, error:'No active tab' }; return await browserAPI.tabs.sendMessage(tabId, { action:'selectOption', ref, element, values }); } catch(e){ return { success:false, error:String(e) }; } }
async function handlePressKey(tabId, { key }) { try { if (typeof tabId!=='number') return { success:false, error:'No active tab' }; return await browserAPI.tabs.sendMessage(tabId, { action:'pressKey', key }); } catch(e){ return { success:false, error:String(e) }; } }
async function handleWait({ time=1000 }) { try { await new Promise(r=>setTimeout(r,time)); return { success:true }; } catch(e){ return { success:false, error:String(e) }; } }
async function handleScreenshot(tabId) { try { if (typeof tabId!=='number') return { success:false, error:'No active tab' }; return await new Promise((resolve)=>{ const opts={ format:'png' }; if (browserAPI.tabs.captureVisibleTab.length===2) { browserAPI.tabs.captureVisibleTab(null,opts).then(d=>resolve({success:true,data:d}),err=>resolve({success:false,error:err.message})); } else { browserAPI.tabs.captureVisibleTab(null,opts,(d)=>{ if (browserAPI.runtime.lastError) resolve({success:false,error:browserAPI.runtime.lastError.message}); else resolve({success:true,data:d}); }); } }); } catch(e){ return { success:false, error:String(e) }; } }
async function handleGetConsoleLogs(tabId) { try { if (typeof tabId!=='number') return { success:false, error:'No active tab' }; return await browserAPI.tabs.sendMessage(tabId, { action:'getConsoleLogs' }); } catch(e){ return { success:false, error:String(e) }; } }
async function handleSnapshot(tabId, { viewportOnly=true, fullPage=false, mode='normal' }) { try { if (typeof tabId!=='number') return { success:false, error:'No active tab' }; await injectSnapshotScripts(tabId); const res = await browserAPI.tabs.sendMessage(tabId, { action:'snapshot', viewportOnly, fullPage, mode }); return { ...res, tabId }; } catch(e){ return { success:false, error:String(e) }; } }
async function injectSnapshotScripts(tabId) { try { for (const f of ['accessibility-utils.js','minimal-enhanced.js','scaffold-enhanced.js']) { await browserAPI.tabs.executeScript(tabId, { file:f, allFrames:false }); } } catch(e){ /* ignore */ } }
async function handleExecuteJS(tabId, payload) {
  try {
    if (typeof tabId !== 'number') return { success: false, error: 'No active tab' };
    const { code, timeout, unsafe = false, method, args = [] } = payload || {};
    if (typeof method === 'string') {
      // Safe-mode operation routed to content script
      return await browserAPI.tabs.sendMessage(tabId, { action: 'executeSafeOperation', method, args, timeout });
    }
    if (unsafe && !extensionConfig.unsafeMode) return { success: false, error: 'Unsafe mode not enabled' };
    return await browserAPI.tabs.sendMessage(tabId, { action: 'executeCode', code, timeout });
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
async function handleCommonOperation(tabId, { operation, options={} }) { try { if (typeof tabId!=='number') return { success:false, error:'No active tab' }; return await browserAPI.tabs.sendMessage(tabId, { action:'commonOperation', operation, options }); } catch(e){ return { success:false, error:String(e) }; } }
async function handleTabList() { try { const tabs=await browserAPI.tabs.query({}); return { success:true, tabs:tabs.map(t=>({ id:t.id,title:t.title,url:t.url,active:t.active,index:t.index })) }; } catch(e){ return { success:false, error:String(e) }; } }
async function handleTabSelect({ index }) { try { const tabs=await browserAPI.tabs.query({ index }); if (tabs.length>0) { await browserAPI.tabs.update(tabs[0].id,{ active:true }); return { success:true, tabId:tabs[0].id }; } return { success:false, error:'Tab not found at index' }; } catch(e){ return { success:false, error:String(e) }; } }
async function handleTabNew({ url }) { try { const tab=await browserAPI.tabs.create({ url:url||'about:blank', active:true }); return { success:true, tabId:tab.id }; } catch(e){ return { success:false, error:String(e) }; } }
async function handleTabClose({ index }) { try { if (typeof index==='number') { const tabs=await browserAPI.tabs.query({ index }); if (tabs.length>0) await browserAPI.tabs.remove(tabs[0].id); } else { const tabs=await browserAPI.tabs.query({ active:true, currentWindow:true }); if (tabs[0]) await browserAPI.tabs.remove(tabs[0].id); } return { success:true }; } catch(e){ return { success:false, error:String(e) }; } }

browserAPI.runtime.onStartup.addListener(()=>{ connectToMCP(); });
// Initialize periodic reconnect alarm (once installed/updated)
browserAPI.runtime.onInstalled.addListener(() => {
  try {
    if (browserAPI.alarms) {
      // Create or reset a 1-minute periodic alarm to ensure background wakes and reconnects
      browserAPI.alarms.clear('browsermcp-reconnect');
      browserAPI.alarms.create('browsermcp-reconnect', { periodInMinutes: 1 });
    }
  } catch (e) {
    // ignore
  }
  connectToMCP();
});

// Reconnect on alarm if socket is not open
if (browserAPI.alarms && browserAPI.alarms.onAlarm) {
  browserAPI.alarms.onAlarm.addListener((alarm) => {
    if (alarm && alarm.name === 'browsermcp-reconnect') {
      if (!(ws && ws.readyState === WebSocket.OPEN)) {
        connectToMCP();
      }
    }
  });
}

// Reconnect when network comes back online
try {
  addEventListener('online', () => { if (!(ws && ws.readyState === WebSocket.OPEN)) connectToMCP(); });
} catch (e) {
  // ignore if not supported
}
connectToMCP();
console.log('BrowserMCP Enhanced Firefox background (v2) loaded');
