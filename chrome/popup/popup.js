document.addEventListener('DOMContentLoaded', function() {
  const recordBtn = document.getElementById('recordBtn');
  const playBtn = document.getElementById('playBtn');
  const statusText = document.getElementById('statusText');
  const progressContainer = document.getElementById('progressContainer');
  const progressBar = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');
  const scriptContainer = document.getElementById('scriptContainer');
  
  function handleError(error) {
    console.error('Extension error:', error);
    statusText.textContent = 'Error: ' + (error.message || 'Unknown error occurred');
    recordBtn.disabled = false;
    playBtn.disabled = false;
    progressContainer.style.display = 'none';
  }

  // Check if service worker is responsive
  try {
    chrome.runtime.sendMessage({ command: 'ping' }, function(response) {
      if (chrome.runtime.lastError) {
        handleError(chrome.runtime.lastError);
        return;
      }
    });
  } catch (error) {
    handleError(error);
  }

  // Initialize UI state from storage
  chrome.storage.local.get(['isRecording', 'actions', 'recordingScript'], function(result) {
    if (chrome.runtime.lastError) {
      handleError(chrome.runtime.lastError);
      return;
    }

    if (result.isRecording) {
      recordBtn.textContent = 'Stop Recording';
      recordBtn.classList.add('recording');
      statusText.textContent = 'Recording...';
      playBtn.disabled = true;
      playBtn.classList.remove('enabled');
      scriptContainer.style.display = 'none';
    } else if (result.actions && result.actions.length > 0) {
      playBtn.disabled = false;
      playBtn.classList.add('enabled');
      
      if (result.actions[0].preciseTimestamp && result.actions[result.actions.length-1].preciseTimestamp) {
        const durationMs = result.actions[result.actions.length-1].preciseTimestamp - result.actions[0].preciseTimestamp;
        const durationSec = (durationMs / 1000).toFixed(1);
        statusText.textContent = `${result.actions.length} actions recorded over ${durationSec}s`;
      } else {
        statusText.textContent = `${result.actions.length} actions recorded`;
      }

      if (result.recordingScript) {
        scriptContainer.textContent = result.recordingScript;
        scriptContainer.style.display = 'block';
      }
    }
  });
  
  // Record button click handler
  recordBtn.addEventListener('click', async function() {
    try {
      const { isRecording } = await chrome.storage.local.get(['isRecording']);
      const newState = !isRecording;
      
      if (newState) {
        // Start recording
        await chrome.storage.local.set({ actions: [], isRecording: true });
        recordBtn.textContent = 'Stop Recording';
        recordBtn.classList.add('recording');
        statusText.textContent = 'Recording...';
        playBtn.disabled = true;
        playBtn.classList.remove('enabled');
        scriptContainer.style.display = 'none';
        
        // Tell service worker to start recording
        chrome.runtime.sendMessage({ command: 'startRecording' });
      } else {
        // Stop recording
        await chrome.storage.local.set({ isRecording: false });
        recordBtn.textContent = 'Record';
        recordBtn.classList.remove('recording');
        
        const { actions, recordingScript } = await chrome.storage.local.get(['actions', 'recordingScript']);
        if (actions && actions.length > 0) {
          statusText.textContent = `${actions.length} actions recorded`;
          playBtn.disabled = false;
          playBtn.classList.add('enabled');
          
          if (recordingScript) {
            scriptContainer.textContent = recordingScript;
            scriptContainer.style.display = 'block';
          }
        } else {
          statusText.textContent = 'No actions recorded';
          scriptContainer.style.display = 'none';
        }
        
        // Tell service worker to stop recording
        chrome.runtime.sendMessage({ command: 'stopRecording' });
      }
    } catch (error) {
      handleError(error);
    }
  });
  
  // Listen for progress updates
  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    try {
      if (request.type === 'playbackProgress') {
        progressContainer.style.display = 'block';
        progressBar.value = request.percentage;
        progressText.textContent = `${request.current}/${request.total}`;
      }
    } catch (error) {
      handleError(error);
    }
  });
  
  // Play button click handler
  playBtn.addEventListener('click', async function() {
    try {
      statusText.textContent = 'Playing...';
      playBtn.disabled = true;
      recordBtn.disabled = true;
      scriptContainer.style.display = 'none';
      
      progressContainer.style.display = 'block';
      progressBar.value = 0;
      
      const { actions } = await chrome.storage.local.get(['actions']);
      if (actions) {
        progressText.textContent = `0/${actions.length}`;
        progressBar.max = 100;
        
        const response = await chrome.runtime.sendMessage({ command: 'playActions' });
        
        if (response.status === 'complete') {
          statusText.textContent = 'Playback complete';
        } else if (response.status === 'error') {
          statusText.textContent = 'Error: ' + response.message;
        }
        
        setTimeout(() => {
          progressContainer.style.display = 'none';
          scriptContainer.style.display = 'block';
        }, 3000);
      } else {
        statusText.textContent = 'No actions to play';
      }
      
      playBtn.disabled = false;
      recordBtn.disabled = false;
    } catch (error) {
      handleError(error);
    }
  });
});