// Message types for WebSocket communication
export interface TabInfo {
  id: string;
  url: string;
  title: string;
  index: number;
  active: boolean;
}

export interface NetworkRequest {
  id: string;
  url: string;
  method: string;
  status?: number;
  type?: string;
  timestamp: number;
}

export interface SocketMessageMap {
  // Existing messages
  'snapshot.query': { 
    request: { selector: string; all?: boolean };
    response: { ref: string; element: string }[] | { ref: string; element: string };
  };
  'snapshot.accessibility': {
    request: {};
    response: { snapshot: string };
  };
  'dom.click': {
    request: { ref: string };
    response: {};
  };
  'dom.hover': {
    request: { ref: string };
    response: {};
  };
  'dom.type': {
    request: { ref: string; text: string; submit: boolean };
    response: {};
  };
  'dom.select': {
    request: { ref: string; values: string[] };
    response: {};
  };
  'keyboard.press': {
    request: { key: string };
    response: {};
  };
  'console.get': {
    request: {};
    response: { logs: any[] };
  };
  'screenshot.capture': {
    request: {};
    response: { data: string };
  };
  'page.navigate': {
    request: { url: string };
    response: {};
  };
  'page.goBack': {
    request: {};
    response: {};
  };
  'page.goForward': {
    request: {};
    response: {};
  };
  'page.wait': {
    request: { time: number };
    response: {};
  };
  'dom.drag': {
    request: { ref: string; targetRef: string };
    response: {};
  };
  
  // New tab management messages
  'tabs.list': { 
    request: {}; 
    response: { tabs: TabInfo[] };
  };
  'tabs.select': { 
    request: { index: number }; 
    response: { success: boolean };
  };
  'tabs.new': { 
    request: { url?: string }; 
    response: { tabId: string; index: number };
  };
  'tabs.close': { 
    request: { index?: number }; 
    response: { success: boolean };
  };
  
  // JavaScript execution
  'js.evaluate': { 
    request: { 
      expression: string; 
      elementRef?: string;
      tabId?: string;
    }; 
    response: { result: any; error?: string };
  };
  
  // Dialog handling
  'dialog.handle': { 
    request: { 
      accept: boolean; 
      promptText?: string;
      tabId?: string;
    }; 
    response: { success: boolean };
  };
  
  // Network monitoring
  'network.getRequests': { 
    request: { tabId?: string }; 
    response: { requests: NetworkRequest[] };
  };
  
  // Debugger operations
  'debugger.attach': {
    request: { domains?: string[] };
    response: { success: boolean; error?: string };
  };
  'debugger.detach': {
    request: {};
    response: { success: boolean; error?: string };
  };
  'debugger.getData': {
    request: { 
      type: 'console' | 'network' | 'performance' | 'errors';
      limit?: number;
      filter?: string;
    };
    response: { data: any };
  };
}

export type MessageType<T> = keyof T;
export type MessagePayload<TMap, TType extends keyof TMap> = TMap[TType] extends { request: infer R } ? R : never;
export type MessageResponse<TMap, TType extends keyof TMap> = TMap[TType] extends { response: infer R } ? R : never;