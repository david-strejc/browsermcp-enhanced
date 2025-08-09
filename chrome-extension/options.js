// Options page script for BrowserMCP Enhanced

// Load current settings
function loadSettings() {
  chrome.storage.local.get(['unsafeMode', 'serverUrl', 'logExecutions', 'requireConfirmation'], (result) => {
    // Set checkbox states
    document.getElementById('unsafeMode').checked = result.unsafeMode || false;
    document.getElementById('logExecutions').checked = result.logExecutions !== false; // Default true
    document.getElementById('requireConfirmation').checked = result.requireConfirmation || false;
    
    // Set server URL
    document.getElementById('serverUrl').value = result.serverUrl || 'ws://localhost:8765';
    
    // Update UI based on unsafe mode
    updateUnsafeModeUI(result.unsafeMode || false);
  });
}

// Update UI when unsafe mode changes
function updateUnsafeModeUI(isUnsafe) {
  const warning = document.getElementById('unsafeWarning');
  const indicator = document.getElementById('modeIndicator');
  
  if (isUnsafe) {
    warning.classList.add('show');
    indicator.textContent = 'UNSAFE';
    indicator.className = 'mode-indicator mode-unsafe';
  } else {
    warning.classList.remove('show');
    indicator.textContent = 'SAFE';
    indicator.className = 'mode-indicator mode-safe';
  }
}

// Save settings
function saveSettings() {
  const settings = {
    unsafeMode: document.getElementById('unsafeMode').checked,
    serverUrl: document.getElementById('serverUrl').value,
    logExecutions: document.getElementById('logExecutions').checked,
    requireConfirmation: document.getElementById('requireConfirmation').checked
  };
  
  // Validate server URL
  try {
    new URL(settings.serverUrl);
  } catch (e) {
    showStatus('Invalid server URL format', 'error');
    return;
  }
  
  // Save to storage
  chrome.storage.local.set(settings, () => {
    showStatus('Settings saved successfully!', 'success');
    
    // Notify background script of changes
    chrome.runtime.sendMessage({
      type: 'settings.updated',
      settings: settings
    });
  });
}

// Reset to defaults
function resetSettings() {
  if (!confirm('Reset all settings to defaults?')) {
    return;
  }
  
  const defaults = {
    unsafeMode: false,
    serverUrl: 'ws://localhost:8765',
    logExecutions: true,
    requireConfirmation: false
  };
  
  chrome.storage.local.set(defaults, () => {
    loadSettings();
    showStatus('Settings reset to defaults', 'success');
    
    // Notify background script
    chrome.runtime.sendMessage({
      type: 'settings.updated',
      settings: defaults
    });
  });
}

// Show status message
function showStatus(message, type) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = `status ${type}`;
  
  setTimeout(() => {
    status.className = 'status';
  }, 3000);
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  
  // Unsafe mode toggle
  document.getElementById('unsafeMode').addEventListener('change', (e) => {
    updateUnsafeModeUI(e.target.checked);
    
    if (e.target.checked) {
      // Show extra confirmation for unsafe mode
      if (!confirm('⚠️ WARNING: Unsafe mode allows full access to all browser APIs and can execute any code without restrictions.\n\nThis includes access to cookies, network requests, and sensitive data.\n\nAre you sure you want to enable unsafe mode?')) {
        e.target.checked = false;
        updateUnsafeModeUI(false);
      }
    }
  });
  
  // Save button
  document.getElementById('saveBtn').addEventListener('click', saveSettings);
  
  // Reset button
  document.getElementById('resetBtn').addEventListener('click', resetSettings);
  
  // Auto-save on Enter in text fields
  document.getElementById('serverUrl').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      saveSettings();
    }
  });
});