document.addEventListener('DOMContentLoaded', function() {
  const recordBtn = document.getElementById('recordBtn');
  const playBtn = document.getElementById('playBtn');
  const statusText = document.getElementById('statusText');
  
  // Check initial recording state
  chrome.storage.local.get(['isRecording', 'actions'], function(result) {
    if (result.isRecording) {
      recordBtn.textContent = 'Stop Recording';
      recordBtn.classList.add('recording');
      statusText.textContent = 'Recording...';
      playBtn.disabled = true;
      playBtn.classList.remove('enabled');
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
    }
  });
  
  // Record button click handler
  recordBtn.addEventListener('click', function() {
    chrome.storage.local.get(['isRecording'], function(result) {
      const isRecording = !result.isRecording;
      
      if (isRecording) {
        // Start recording
        chrome.storage.local.set({ actions: [], isRecording: true }, function() {
          recordBtn.textContent = 'Stop Recording';
          recordBtn.classList.add('recording');
          statusText.textContent = 'Recording...';
          playBtn.disabled = true;
          playBtn.classList.remove('enabled');
          
          // Tell background script to start recording
          chrome.runtime.sendMessage({ command: 'startRecording' });
        });
      } else {
        // Stop recording
        chrome.storage.local.set({ isRecording: false }, function() {
          recordBtn.textContent = 'Record';
          recordBtn.classList.remove('recording');
          
          // Get the recorded actions and update status
          chrome.storage.local.get(['actions'], function(result) {
            if (result.actions && result.actions.length > 0) {
              statusText.textContent = `${result.actions.length} actions recorded`;
              playBtn.disabled = false;
              playBtn.classList.add('enabled');
            } else {
              statusText.textContent = 'No actions recorded';
            }
          });
          
          // Tell background script to stop recording
          chrome.runtime.sendMessage({ command: 'stopRecording' });
        });
      }
    });
  });
  
  // Progress elements
  const progressContainer = document.getElementById('progressContainer');
  const progressBar = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');
  
  // Listen for progress updates
  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.type === 'playbackProgress') {
      progressContainer.style.display = 'block';
      progressBar.value = request.percentage;
      progressText.textContent = `${request.current}/${request.total}`;
    }
  });
  
  // Play button click handler
  playBtn.addEventListener('click', function() {
    statusText.textContent = 'Playing...';
    playBtn.disabled = true;
    recordBtn.disabled = true;
    
    // Show progress bar
    progressContainer.style.display = 'block';
    progressBar.value = 0;
    
    // Get the total number of actions
    chrome.storage.local.get(['actions'], function(result) {
      if (result.actions) {
        progressText.textContent = `0/${result.actions.length}`;
        progressBar.max = 100;
        
        // Create a persistent connection to the background script
        const port = chrome.runtime.connect({ name: 'keepAlive' });
        
        // Tell background script to play recorded actions
        chrome.runtime.sendMessage({ command: 'playActions' }, function(response) {
          if (chrome.runtime.lastError) {
            console.error('Playback error:', chrome.runtime.lastError);
            statusText.textContent = 'Error: Playback failed';
            progressContainer.style.display = 'none';
            playBtn.disabled = false;
            recordBtn.disabled = false;
            // Close the connection after error
            port.disconnect();
            return;
          }
          
          if (response && response.status === 'complete') {
            statusText.textContent = 'Playback complete';
          } else if (response && response.status === 'error') {
            statusText.textContent = 'Error: ' + response.message;
          }
          
          // Hide progress after a delay
          setTimeout(() => {
            progressContainer.style.display = 'none';
          }, 3000);
          
          playBtn.disabled = false;
          recordBtn.disabled = false;
          
          // Close the connection after successful completion
          port.disconnect();
        });
      } else {
        statusText.textContent = 'No actions to play';
        playBtn.disabled = false;
        recordBtn.disabled = false;
      }
    });
  });
  
  // Keep popup active while it's open
  const keepAlivePort = chrome.runtime.connect({ name: 'keepAlive' });
  window.addEventListener('unload', () => {
    keepAlivePort.disconnect();
  });
});