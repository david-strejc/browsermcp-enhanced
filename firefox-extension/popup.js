// Firefox-compatible popup script
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

document.addEventListener('DOMContentLoaded', () => {
  const statusDiv = document.getElementById('status');
  const connectButton = document.getElementById('connect');
  const serverUrlInput = document.getElementById('serverUrl');
  const saveSettingsButton = document.getElementById('saveSettings');

  // Load current settings
  browserAPI.storage.local.get(['serverUrl']).then((result) => {
    if (result.serverUrl) {
      serverUrlInput.value = result.serverUrl;
    }
  });

  // Check connection status
  browserAPI.runtime.sendMessage({ action: 'getConnectionStatus' }).then((response) => {
    updateStatus(response?.connected || false, response?.serverUrl);
  }).catch((error) => {
    console.error('Error getting status:', error);
    updateStatus(false);
  });

  connectButton.addEventListener('click', () => {
    browserAPI.runtime.sendMessage({ action: 'reconnect' }).then((response) => {
      updateStatus(true);
    }).catch((error) => {
      console.error('Error reconnecting:', error);
      updateStatus(false);
    });
  });

  if (saveSettingsButton) {
    saveSettingsButton.addEventListener('click', () => {
      const newServerUrl = serverUrlInput.value.trim();
      if (newServerUrl) {
        browserAPI.runtime.sendMessage({
          action: 'updateConfig',
          config: { serverUrl: newServerUrl }
        }).then(() => {
          showMessage('Settings saved. Reconnecting...');
          browserAPI.runtime.sendMessage({ action: 'reconnect' });
        });
      }
    });
  }

  function updateStatus(connected, serverUrl) {
    if (connected) {
      statusDiv.textContent = `Connected to MCP server${serverUrl ? ' at ' + serverUrl : ''}`;
      statusDiv.className = 'status connected';
      connectButton.textContent = 'Reconnect';
    } else {
      statusDiv.textContent = 'Disconnected from MCP server';
      statusDiv.className = 'status disconnected';
      connectButton.textContent = 'Connect';
    }
  }

  function showMessage(message) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message';
    messageDiv.textContent = message;
    document.body.appendChild(messageDiv);

    setTimeout(() => {
      messageDiv.remove();
    }, 3000);
  }
});