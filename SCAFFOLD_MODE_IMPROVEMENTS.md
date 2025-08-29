# Scaffold Mode Improvements Plan

## Executive Summary

Our current scaffold mode is too minimal for complex automation scenarios, particularly OAuth/authentication flows. This document outlines comprehensive improvements to make scaffold mode more informative while maintaining token efficiency.

## Problem Analysis

### Current Issues Observed in OAuth Flow

1. **Missing Element State Information**
   - Shows "Accept" button exists but not if it's:
     - Actually clickable/enabled
     - Has loading state
     - Has JavaScript events bound
     - Part of a multi-step flow

2. **No Page Readiness Detection**
   - Cannot determine if page is still loading
   - No detection of blocking overlays
   - No awareness of pending XHR/fetch requests

3. **Missing Critical Context**
   - Form validation states
   - Error messages
   - Loading indicators
   - Button disabled states
   - Progress indicators in multi-step flows

4. **No OAuth/Auth Flow Awareness**
   - Treats authentication pages like any other page
   - Doesn't recognize consent screens
   - Misses multi-step wizard patterns

## Proposed Solution Architecture

### 1. Minimal State Flags System

Add compact state flags to elements, shown only when non-ideal:

```javascript
// Format: [e/d, l/n, c/nc, v/h]
// Only shown when state is problematic

button:submit [ref=ref16] "Accept" [form]        // Normal (no flags)
button:submit [ref=ref16] "Accept" [form] [d,h]  // Disabled & hidden
button:submit [ref=ref17] "Cancel" [form] [e,l]  // Enabled but loading
```

**Flag Definitions:**
- **Enabled Flag** (e/d/u): enabled | disabled | unknown
- **Loading Flag** (l/n/u): loading | not-loading | unknown  
- **Clickable Flag** (c/nc/u): has click handler | no handler | unknown
- **Visible Flag** (v/h/u): visible | hidden | unknown

**Implementation:**
```javascript
function getElementFlags(element) {
  const flags = [];
  
  // Only add non-ideal states
  if (element.disabled || element.ariaDisabled) flags.push('d');
  if (element.matches('.loading,[aria-busy="true"]')) flags.push('l');
  if (!element.offsetParent || getComputedStyle(element).visibility === 'hidden') flags.push('h');
  if (!hasClickHandler(element)) flags.push('nc');
  
  return flags.length > 0 ? ` [${flags.join(',')}]` : '';
}
```

### 2. Problems Detection Section

Add a dedicated section that only appears when issues are detected:

```
[Problems Detected]
- Loading overlay blocks interaction (ref=ref42)
- Form validation error: "Please accept terms" (ref=ref9)
- Button ref16 disabled by parent form
- Network requests still pending (3 active)
```

**Detection Logic:**

```javascript
function detectProblems() {
  const problems = [];
  
  // A. Loading overlay detection
  const overlay = findBlockingOverlay();
  if (overlay) {
    problems.push({
      type: 'overlay',
      ref: getRef(overlay),
      msg: 'Loading overlay blocks interaction'
    });
  }
  
  // B. Error/alert messages
  document.querySelectorAll('[role="alert"],.error,.alert-danger')
    .forEach(el => {
      if (isVisible(el)) {
        problems.push({
          type: 'error',
          ref: getRef(el),
          msg: truncate(el.innerText, 80)
        });
      }
    });
  
  // C. Form validation
  document.forms.forEach(form => {
    if (!form.checkValidity()) {
      const invalid = [...form.elements].filter(e => !e.checkValidity());
      problems.push({
        type: 'form_invalid',
        ref: getRef(form),
        fields: invalid.slice(0, 3).map(e => e.name || e.id)
      });
    }
  });
  
  return problems;
}
```

### 3. OAuth/Auth Flow Detection

Automatically detect and report authentication flows:

```
[OAuth Flow Detected]
Provider: Microsoft
Type: consent
Step: 2 of 3
Ready: false (loading)
URL params: client_id, redirect_uri, scope
```

**Detection Heuristics:**

```javascript
function detectAuthFlow() {
  const flow = {};
  
  // URL patterns
  const url = window.location.href;
  if (/(auth|oauth|signin|login|consent)/i.test(url)) {
    flow.detected = true;
  }
  
  // Known providers
  const providers = {
    'accounts.google.com': 'Google',
    'login.microsoftonline.com': 'Microsoft',
    'github.com/login': 'GitHub',
    'auth0.com': 'Auth0'
  };
  
  for (const [pattern, provider] of Object.entries(providers)) {
    if (url.includes(pattern)) {
      flow.provider = provider;
      break;
    }
  }
  
  // Step detection
  const stepIndicators = document.querySelectorAll(
    '[data-step],[aria-step],.step-indicator,.wizard-step'
  );
  if (stepIndicators.length > 0) {
    flow.step = getCurrentStep(stepIndicators);
    flow.totalSteps = getTotalSteps(stepIndicators);
  }
  
  // OAuth parameters
  const params = new URLSearchParams(window.location.search);
  flow.oauthParams = ['client_id', 'redirect_uri', 'scope', 'state']
    .filter(p => params.has(p));
  
  return flow;
}
```

### 4. Click Handler Detection (Browser-Safe)

Since `getEventListeners()` is DevTools-only, we need alternative approaches:

```javascript
// Early injection in content script
(function() {
  const clickHandlers = new WeakSet();
  const originalAdd = EventTarget.prototype.addEventListener;
  
  EventTarget.prototype.addEventListener = function(type, fn, opts) {
    if (type === 'click') clickHandlers.add(this);
    return originalAdd.call(this, type, fn, opts);
  };
  
  window.__clickHandlerSet = clickHandlers;
})();

// Detection function
function hasClickHandler(element) {
  // 1. Check inline handler
  if (element.hasAttribute('onclick')) return true;
  
  // 2. Check native interactive elements
  const interactiveTags = ['A', 'BUTTON', 'INPUT', 'SUMMARY', 'LABEL'];
  if (interactiveTags.includes(element.tagName) && !element.disabled) return true;
  
  // 3. Check cursor style and role
  const style = getComputedStyle(element);
  if (style.cursor === 'pointer') return true;
  if (element.getAttribute('role') === 'button') return true;
  
  // 4. Check our tracked handlers
  if (window.__clickHandlerSet?.has(element)) return true;
  
  return false;
}
```

### 5. Page Ready Detection

Add top-level readiness signal:

```javascript
function getPageReadiness() {
  const checks = {
    documentReady: document.readyState === 'complete',
    noSpinners: !document.querySelector('.spinner,[aria-busy="true"]'),
    noOverlays: !findBlockingOverlay(),
    networkIdle: !hasPendingRequests()
  };
  
  const ready = Object.values(checks).every(v => v);
  const reason = ready ? 'ready' : Object.entries(checks)
    .find(([k, v]) => !v)?.[0] || 'unknown';
  
  return { ready, reason };
}
```

## Implementation Timeline

### Phase 1: Core Infrastructure (Priority: HIGH)
1. **Problems Detection** (~50 LOC)
   - Blocking overlay detection
   - Error message detection
   - Form validation state

2. **Page Ready Signal** (~30 LOC)
   - Document ready state
   - Network activity monitoring
   - Loading indicator detection

### Phase 2: OAuth Awareness (Priority: HIGH)
1. **Flow Detection** (~40 LOC)
   - URL pattern matching
   - Provider identification
   - Step/wizard detection

2. **OAuth-Specific Elements** (~20 LOC)
   - Consent checkboxes
   - Permission lists
   - Account selectors

### Phase 3: Element State Flags (Priority: MEDIUM)
1. **Click Handler Detection** (~30 LOC)
   - EventListener injection
   - Heuristic detection
   - Framework detection

2. **State Flag System** (~40 LOC)
   - Enabled/disabled detection
   - Visibility detection
   - Loading state detection

### Phase 4: Optimization (Priority: LOW)
1. **Token Efficiency**
   - Smart deduplication
   - Conditional sections
   - Compression strategies

2. **Performance Tuning**
   - 50ms budget enforcement
   - Early termination logic
   - Caching strategies

## Token Budget Analysis

### Current State
- Base scaffold: 500-1000 tokens
- No state information
- No problem detection

### With Improvements
- Base scaffold: 500-1000 tokens
- Problems section: 0-100 tokens (only when issues exist)
- OAuth flow block: 0-50 tokens (only on auth pages)
- State flags: 50-150 tokens (only non-ideal states)
- **Total: 600-1300 tokens** (worst case)

### Optimization Strategies
1. Only show flags when non-ideal
2. Deduplicate similar elements
3. Truncate long text content
4. Skip hidden regions entirely
5. Use compact notation

## Success Metrics

1. **OAuth Success Rate**
   - Target: 95% successful automation
   - Current: ~60% (fails on consent screens)

2. **Token Efficiency**
   - Target: <1500 tokens max
   - Average: 800-1000 tokens

3. **Performance**
   - Target: <50ms execution time
   - Current: ~35ms

4. **Problem Detection**
   - Target: Catch 90% of blocking conditions
   - Types: Overlays, errors, validation, loading

## Testing Strategy

### Test Sites
1. **OAuth Providers**
   - Google Sign-In
   - Microsoft OAuth
   - GitHub Authorization
   - Auth0 Universal Login

2. **Complex Forms**
   - Multi-step wizards
   - Validation-heavy forms
   - Dynamic loading content

3. **Edge Cases**
   - Slow-loading pages
   - Error states
   - Popup/modal dialogs
   - CAPTCHA challenges

### Validation Process
1. Compare token counts before/after
2. Measure automation success rate
3. Profile performance impact
4. Test across different browsers

## Rollback Plan

If improvements cause issues:
1. Feature flag for new detection
2. Gradual rollout (10% → 50% → 100%)
3. A/B testing on success rates
4. Quick revert via environment variable

## Code Location

- Main implementation: `/chrome-extension/scaffold-enhanced.js`
- Test suite: `/tests/test-scaffold.js`
- Configuration: `/src/utils/aria-snapshot.ts`

## Next Steps

1. **Immediate Actions**
   - Implement Problems Detection (2 hours)
   - Add OAuth flow detection (1 hour)
   - Test on Microsoft OAuth flow (30 min)

2. **This Week**
   - Complete Phase 1 & 2
   - Run full test suite
   - Measure token impact

3. **Next Sprint**
   - Phase 3 implementation
   - Performance optimization
   - Production rollout

## Appendix: Sample Output Comparison

### Before (Current)
```
Page: Sign in to your account
URL: https://login.microsoftonline.com/...
[Enhanced Scaffold: 2 regions, 16 elements found]

main [ref=ref17]
  input:submit [ref=ref16] "Accept" [form]
  input:button [ref=ref15] "Cancel" [form]
```

### After (With Improvements)
```
Page: Sign in to your account
URL: https://login.microsoftonline.com/...
[Enhanced Scaffold: 2 regions, 16 elements found]

[OAuth Flow Detected]
Provider: Microsoft
Type: consent
Step: 2 of 3
Ready: false (network_active)

main [ref=ref17]
  input:submit [ref=ref16] "Accept" [form]
  input:button [ref=ref15] "Cancel" [form]

[Problems Detected]
- Form ref17 waiting for user consent
- 2 network requests pending
```

This provides the critical context needed for successful automation while maintaining token efficiency.