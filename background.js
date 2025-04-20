// Global variables
let currentTabId = null;
let isNavigating = false;
let playbackTabId = null;

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  switch (request.command) {
    case 'startRecording':
      startRecording();
      break;
    case 'stopRecording':
      stopRecording();
      break;
    case 'playActions':
      playRecordedActions()
        .then(() => sendResponse({ status: 'complete' }))
        .catch(error => sendResponse({ status: 'error', message: error.message }));
      return true; // Required for async sendResponse
    case 'recordAction':
      chrome.storage.local.get(['isRecording'], function(result) {
        if (result.isRecording) {
          recordAction(request.action);
        }
      });
      break;
    case 'navigationStarted':
      isNavigating = true;
      break;
    case 'contentScriptReady':
      if (sender.tab) {
        console.log('Content script ready in tab:', sender.tab.id);
      }
      break;
  }
});

// Start recording mode
function startRecording() {
  // Get current active tab
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    if (tabs.length > 0) {
      currentTabId = tabs[0].id;
      
      // Set recording state and initialize empty actions array
      chrome.storage.local.set({ isRecording: true, actions: [] }, function() {
        console.log('Recording started');
        
        // Content script is already injected via manifest.json
        chrome.tabs.sendMessage(currentTabId, { command: 'startRecording' });
      });
    }
  });
}

// Stop recording mode
function stopRecording() {
  chrome.storage.local.set({ isRecording: false }, function() {
    if (currentTabId) {
      chrome.tabs.sendMessage(currentTabId, { command: 'stopRecording' });
      console.log('Recording stopped');
    }
  });
}

// Record a single action
function recordAction(action) {
  action.timestamp = Date.now();
  
  chrome.tabs.get(currentTabId, function(tab) {
    action.url = tab.url;
    
    chrome.storage.local.get(['actions'], function(result) {
      const actions = result.actions || [];
      
      if (actions.length === 0) {
        chrome.storage.local.set({ recordingStartTime: action.preciseTimestamp });
      }
      
      actions.push(action);
      chrome.storage.local.set({ actions: actions }, function() {
        console.log('Action recorded:', action);
      });
    });
  });
}

// Play recorded actions
async function playRecordedActions() {
  try {
    const result = await new Promise((resolve, reject) => {
      chrome.storage.local.get(['actions'], function(items) {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(items);
        }
      });
    });

    const actions = result?.actions || [];
    
    if (actions.length === 0) {
      console.log('No actions to play');
      return { status: 'complete', message: 'No actions to play' };
    }

    console.log('Starting playback of', actions.length, 'actions');
    
    // Create a new tab for playback
    const initialUrl = actions[0].url;
    let currentTab = await createOrUpdateTab(initialUrl);
    playbackTabId = currentTab.id; // Store the playback tab ID
    
    // Ensure content script is ready before proceeding
    await waitForContentScript(currentTab.id);
    
    for (const action of actions) {
      console.log('Executing action:', action);
      
      // If URL changed, update the tab
      if (action.url && action.url !== currentTab.url) {
        currentTab = await createOrUpdateTab(action.url);
        await waitForContentScript(currentTab.id);
      }
      
      // Add a small delay between actions for stability
      await new Promise(resolve => setTimeout(resolve, 500));
      
      try {
        const response = await executeActionInTab(currentTab.id, action);
        console.log('Action executed:', response);
      } catch (actionError) {
        console.error('Failed to execute action:', actionError);
        continue;
      }
    }
    
    console.log('Playback complete');
    // Keep the playback tab open but reset the playback state
    playbackTabId = null;
    return { status: 'complete' };
  } catch (error) {
    console.error('Playback error:', error);
    // Clean up in case of error
    playbackTabId = null;
    return { status: 'error', message: error.message };
  }
}

// Wait for content script to be ready in a tab
async function waitForContentScript(tabId) {
  return new Promise((resolve) => {
    function checkContentScript() {
      chrome.tabs.sendMessage(tabId, { command: 'isContentScriptReady' }, response => {
        if (chrome.runtime.lastError) {
          // Content script not ready yet, retry after delay
          setTimeout(checkContentScript, 100);
        } else if (response && response.ready) {
          resolve();
        } else {
          setTimeout(checkContentScript, 100);
        }
      });
    }
    checkContentScript();
  });
}

// Create a new tab or update existing one with the given URL
async function createOrUpdateTab(url) {
  return new Promise((resolve) => {
    if (playbackTabId) {
      // Update existing playback tab
      chrome.tabs.update(playbackTabId, { url: url }, async function(tab) {
        if (chrome.runtime.lastError) {
          // If update fails, create new tab
          chrome.tabs.create({ url: url }, async function(newTab) {
            playbackTabId = newTab.id;
            await waitForTabLoad(newTab.id);
            await waitForContentScript(newTab.id);
            resolve(newTab);
          });
        } else {
          await waitForTabLoad(tab.id);
          await waitForContentScript(tab.id);
          resolve(tab);
        }
      });
    } else {
      // Create new tab if none exists
      chrome.tabs.create({ url: url }, async function(tab) {
        playbackTabId = tab.id;
        await waitForTabLoad(tab.id);
        await waitForContentScript(tab.id);
        resolve(tab);
      });
    }
  });
}

// Wait for a tab to complete loading
async function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    function listener(updatedTabId, changeInfo, tab) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        isNavigating = false;
        // Add extra delay for dynamic content to load
        setTimeout(resolve, 1500);
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// Execute a single action in a specific tab
async function executeActionInTab(tabId, action) {
  return new Promise(async (resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Action execution timed out'));
    }, 30000);

    // Wait for any ongoing navigation to complete
    if (isNavigating) {
      await waitForTabLoad(tabId);
      await waitForContentScript(tabId);
    }
    
    chrome.tabs.sendMessage(tabId, { 
      command: 'playActions', 
      actions: [action]
    }, response => {
      clearTimeout(timeout);
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else if (response && response.error) {
        reject(new Error(response.error));
      } else {
        resolve(response);
      }
    });
  });
}