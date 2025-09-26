// Popup script for BrowserMCP Enhanced

document.addEventListener('DOMContentLoaded', function() {
  const statusDiv = document.getElementById('status');
  const connectButton = document.getElementById('connect');
  const multiInstanceToggle = document.getElementById('multi-instance-toggle');
  const unsafeModeToggle = document.getElementById('unsafe-mode-toggle');
  const instancesContainer = document.getElementById('instances-container');
  const instancesList = document.getElementById('instances-list');
  const warningDiv = document.getElementById('multi-instance-warning');

  // Load current settings
  chrome.storage.local.get(['multiInstance', 'unsafeMode'], (result) => {
    multiInstanceToggle.checked = result.multiInstance === true;
    unsafeModeToggle.checked = result.unsafeMode === true;

    if (result.multiInstance) {
      checkMultiInstanceStatus();
    } else {
      checkLegacyStatus();
    }
  });

  // Check legacy connection status
  function checkLegacyStatus() {
    chrome.runtime.sendMessage({ type: 'getStatus' }, (response) => {
      if (chrome.runtime.lastError) {
        statusDiv.className = 'status disconnected';
        statusDiv.textContent = 'Extension error';
        connectButton.disabled = true;
        return;
      }

      if (response && response.connected) {
        statusDiv.className = 'status connected';
        statusDiv.textContent = `Connected to MCP server`;
        connectButton.textContent = 'Reconnect';
      } else {
        statusDiv.className = 'status disconnected';
        statusDiv.textContent = 'Disconnected from MCP server';
        connectButton.textContent = 'Connect';
      }
    });
  }

  // Check multi-instance status
  function checkMultiInstanceStatus() {
    chrome.runtime.sendMessage({ type: 'status' }, (response) => {
      if (chrome.runtime.lastError) {
        statusDiv.className = 'status disconnected';
        statusDiv.textContent = 'Extension error';
        connectButton.disabled = true;
        return;
      }

      if (response && response.instances) {
        const instanceCount = response.instances.length;

        if (instanceCount > 0) {
          statusDiv.className = 'status multi-instance';
          statusDiv.textContent = `Multi-Instance: ${instanceCount} connection${instanceCount > 1 ? 's' : ''}`;
          connectButton.textContent = 'Connect Current Tab';

          // Show instances list
          instancesContainer.style.display = 'block';
          instancesList.innerHTML = '';

          response.instances.forEach(instance => {
            const item = document.createElement('div');
            item.className = 'instance-item';
            item.innerHTML = `
              Instance: ${instance.id.substring(0, 8)}...
              <span class="port-badge">Port ${instance.port}</span>
              <br>
              <small>Connected: ${instance.connectedAt}</small>
            `;
            instancesList.appendChild(item);
          });

          // Show tab locks if any
          if (response.tabLocks && response.tabLocks.length > 0) {
            const locksHeader = document.createElement('div');
            locksHeader.innerHTML = '<strong>Tab Locks:</strong>';
            locksHeader.style.marginTop = '10px';
            instancesList.appendChild(locksHeader);

            response.tabLocks.forEach(([tabId, instanceId]) => {
              const lockItem = document.createElement('div');
              lockItem.className = 'instance-item';
              lockItem.innerHTML = `Tab ${tabId} locked by ${instanceId.substring(0, 8)}...`;
              instancesList.appendChild(lockItem);
            });
          }
        } else {
          statusDiv.className = 'status disconnected';
          statusDiv.textContent = 'No instances connected';
          connectButton.textContent = 'Waiting for connections...';
          instancesContainer.style.display = 'none';
        }
      } else if (response && response.mode === 'legacy') {
        checkLegacyStatus();
      }
    });
  }

  // Connect button handler
  connectButton.addEventListener('click', function() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.runtime.sendMessage({
          type: 'connect',
          tabId: tabs[0].id
        }, (response) => {
          if (response && response.success) {
            statusDiv.className = 'status connected';
            statusDiv.textContent = 'Connected to current tab';
            setTimeout(() => {
              if (multiInstanceToggle.checked) {
                checkMultiInstanceStatus();
              } else {
                checkLegacyStatus();
              }
            }, 1000);
          }
        });
      }
    });
  });

  // Multi-instance toggle handler
  multiInstanceToggle.addEventListener('change', function() {
    const enabled = this.checked;
    chrome.storage.local.set({ multiInstance: enabled }, () => {
      console.log('Multi-instance mode:', enabled);
      warningDiv.style.display = 'block';

      // Reload extension to apply changes
      setTimeout(() => {
        chrome.runtime.reload();
      }, 2000);
    });
  });

  // Unsafe mode toggle handler
  unsafeModeToggle.addEventListener('change', function() {
    const enabled = this.checked;
    chrome.storage.local.set({ unsafeMode: enabled }, () => {
      console.log('Unsafe mode:', enabled);
    });
  });

  // Refresh status periodically
  setInterval(() => {
    if (multiInstanceToggle.checked) {
      checkMultiInstanceStatus();
    } else {
      checkLegacyStatus();
    }
  }, 2000);
});