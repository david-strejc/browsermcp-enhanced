# LaskoBOT Tool Reference

Canonical tool names (Chrome & Firefox):

- Navigation
  - `browser_navigate` { action:'goto'|'back'|'forward'|'refresh', url? }
  - `browser_go_back`, `browser_go_forward`
- DOM
  - `dom.click` { ref, element }
  - `dom.type` { ref, element, text, submit? }
  - `dom.hover` { ref, element }
  - `dom.select` { ref, element, values }
- Snapshot
  - `snapshot.accessibility` { mode:'scaffold'|'minimal'|'normal', viewportOnly?, fullPage? }
- Tabs
  - `tabs.list`, `tabs.select` { index }, `tabs.new` { url? }, `tabs.close` { index? }
- Console & Screenshot
  - `console.get` { filter?, type?, limit? }
  - `screenshot.capture`
- JavaScript
  - `js.execute` { code, timeout?, unsafe? } | { method, args, timeout? }

Responses include `tabId` so the daemon can learn/enforce ownership.

