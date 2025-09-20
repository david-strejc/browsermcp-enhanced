// Firefox-compatible options script
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

document.addEventListener('DOMContentLoaded', () => {
  const unsafeModeCheckbox = document.getElementById('unsafeMode');
  const serverUrlInput = document.getElementById('serverUrl');
  const saveButton = document.getElementById('save');
  const statusDiv = document.getElementById('status');

  // Load saved settings
  browserAPI.storage.local.get(['unsafeMode', 'serverUrl']).then((result) => {
    if (result.unsafeMode !== undefined) {
      unsafeModeCheckbox.checked = result.unsafeMode;
    }
    if (result.serverUrl) {
      serverUrlInput.value = result.serverUrl;
    }
  });

  // Save settings
  saveButton.addEventListener('click', () => {
    const settings = {
      unsafeMode: unsafeModeCheckbox.checked,
      serverUrl: serverUrlInput.value.trim() || 'ws://localhost:8765'
    };

    browserAPI.storage.local.set(settings).then(() => {
      // Update background script config
      browserAPI.runtime.sendMessage({
        action: 'updateConfig',
        config: settings
      });

      // Show save confirmation
      statusDiv.textContent = 'Settings saved successfully!';
      statusDiv.style.display = 'block';
      statusDiv.className = 'status success';

      setTimeout(() => {
        statusDiv.style.display = 'none';
      }, 3000);
    }).catch((error) => {
      statusDiv.textContent = 'Error saving settings: ' + error.message;
      statusDiv.style.display = 'block';
      statusDiv.className = 'status error';
    });
  });

  // Add warning when enabling unsafe mode
  unsafeModeCheckbox.addEventListener('change', (e) => {
    if (e.target.checked) {
      const confirmed = confirm(
        'Warning: Unsafe mode allows execution of arbitrary JavaScript code. ' +
        'This can be dangerous if you execute untrusted code. ' +
        'Only enable this if you understand the risks.\n\n' +
        'Do you want to continue?'
      );

      if (!confirmed) {
        e.target.checked = false;
      }
    }
  });
});