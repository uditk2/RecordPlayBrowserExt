document.addEventListener('DOMContentLoaded', function() {
  const recordBtn = document.getElementById('recordBtn');
  const playBtn = document.getElementById('playBtn');
  const statusText = document.getElementById('statusText');
  const progressContainer = document.getElementById('progressContainer');
  const progressBar = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');
  const scriptContainer = document.getElementById('scriptContainer');
  
  // Error handling function
  function handleError(error) {
    console.error('Extension error:', error);
    statusText.textContent = 'Error: ' + (error.message || 'Unknown error occurred');
    recordBtn.disabled = false;
    playBtn.disabled = false;
    progressContainer.style.display = 'none';
  }

  // Check if background page is responsive
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

  // Check initial recording state
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

      // Show script if available
      if (result.recordingScript) {
        scriptContainer.textContent = result.recordingScript;
        scriptContainer.style.display = 'block';
      }
    }
  });
  
  // Record button click handler
  recordBtn.addEventListener('click', function() {
    try {
      chrome.storage.local.get(['isRecording'], function(result) {
        if (chrome.runtime.lastError) {
          handleError(chrome.runtime.lastError);
          return;
        }
        
        const isRecording = !result.isRecording;
        
        if (isRecording) {
          // Start recording
          chrome.storage.local.set({ actions: [], isRecording: true }, function() {
            if (chrome.runtime.lastError) {
              handleError(chrome.runtime.lastError);
              return;
            }

            recordBtn.textContent = 'Stop Recording';
            recordBtn.classList.add('recording');
            statusText.textContent = 'Recording...';
            playBtn.disabled = true;
            playBtn.classList.remove('enabled');
            scriptContainer.style.display = 'none';
            
            // Tell background script to start recording
            chrome.runtime.sendMessage({ command: 'startRecording' });
          });
        } else {
          // Stop recording
          chrome.storage.local.set({ isRecording: false }, function() {
            if (chrome.runtime.lastError) {
              handleError(chrome.runtime.lastError);
              return;
            }

            recordBtn.textContent = 'Record';
            recordBtn.classList.remove('recording');
            
            // Get the recorded actions and update status
            chrome.storage.local.get(['actions', 'recordingScript'], function(result) {
              if (chrome.runtime.lastError) {
                handleError(chrome.runtime.lastError);
                return;
              }

              if (result.actions && result.actions.length > 0) {
                statusText.textContent = `${result.actions.length} actions recorded`;
                playBtn.disabled = false;
                playBtn.classList.add('enabled');
                
                // Show the script
                if (result.recordingScript) {
                  scriptContainer.textContent = result.recordingScript;
                  scriptContainer.style.display = 'block';
                }
              } else {
                statusText.textContent = 'No actions recorded';
                scriptContainer.style.display = 'none';
              }
            });
            
            // Tell background script to stop recording
            chrome.runtime.sendMessage({ command: 'stopRecording' });
          });
        }
      });
    } catch (error) {
      handleError(error);
    }
  });
  
  // Listen for progress updates with error handling
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
  
  // Play button click handler with improved error handling
  playBtn.addEventListener('click', function() {
    statusText.textContent = 'Playing...';
    playBtn.disabled = true;
    recordBtn.disabled = true;
    scriptContainer.style.display = 'none';
    
    progressContainer.style.display = 'block';
    progressBar.value = 0;
    
    try {
      chrome.storage.local.get(['actions'], function(result) {
        if (chrome.runtime.lastError) {
          handleError(chrome.runtime.lastError);
          return;
        }

        if (result.actions) {
          progressText.textContent = `0/${result.actions.length}`;
          progressBar.max = 100;
          
          let port;
          try {
            port = chrome.runtime.connect({ name: 'keepAlive' });
            
            port.onDisconnect.addListener(function() {
              if (chrome.runtime.lastError) {
                handleError(chrome.runtime.lastError);
              }
            });
          } catch (error) {
            handleError(error);
            return;
          }
          
          chrome.runtime.sendMessage({ command: 'playActions' }, function(response) {
            if (chrome.runtime.lastError) {
              handleError(chrome.runtime.lastError);
              if (port) port.disconnect();
              return;
            }
            
            if (response && response.status === 'complete') {
              statusText.textContent = 'Playback complete';
            } else if (response && response.status === 'error') {
              statusText.textContent = 'Error: ' + response.message;
            }
            
            setTimeout(() => {
              progressContainer.style.display = 'none';
              scriptContainer.style.display = 'block';
            }, 3000);
            
            playBtn.disabled = false;
            recordBtn.disabled = false;
            
            if (port) port.disconnect();
          });
        } else {
          statusText.textContent = 'No actions to play';
          playBtn.disabled = false;
          recordBtn.disabled = false;
        }
      });
    } catch (error) {
      handleError(error);
    }
  });
  
  // Keep popup active while it's open with improved connection handling
  let keepAlivePort;
  try {
    keepAlivePort = chrome.runtime.connect({ name: 'keepAlive' });
    keepAlivePort.onDisconnect.addListener(function() {
      if (chrome.runtime.lastError) {
        handleError(chrome.runtime.lastError);
      }
    });
  } catch (error) {
    handleError(error);
  }

  window.addEventListener('unload', () => {
    if (keepAlivePort) {
      try {
        keepAlivePort.disconnect();
      } catch (error) {
        console.error('Error disconnecting port:', error);
      }
    }
  });
});