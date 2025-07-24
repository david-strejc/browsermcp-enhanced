document.addEventListener('DOMContentLoaded', () => {
  const statusDiv = document.getElementById('status');
  const connectButton = document.getElementById('connect');
  
  // Check connection status
  chrome.runtime.sendMessage({ type: 'getStatus' }, (response) => {
    updateStatus(response?.connected || false);
  });
  
  connectButton.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'connect' }, (response) => {
      updateStatus(response?.connected || false);
    });
  });
  
  function updateStatus(connected) {
    if (connected) {
      statusDiv.textContent = 'Connected to MCP server';
      statusDiv.className = 'status connected';
      connectButton.textContent = 'Reconnect';
    } else {
      statusDiv.textContent = 'Disconnected';
      statusDiv.className = 'status disconnected';
      connectButton.textContent = 'Connect';
    }
  }
});