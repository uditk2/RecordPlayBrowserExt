// Global variables
let currentTabId = null;
let isNavigating = false;
let playbackTabId = null;
let tabHistory = new Map(); // Track tab relationships

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  switch (request.command) {
    case 'ping':
      sendResponse({ status: 'ok' });
      break;
    case 'getCurrentTab':
      sendResponse({ tabId: sender.tab.id });
      break;
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
    case 'contentScriptStatus':
      if (sender.tab) {
        console.log('Content script ready in tab:', sender.tab.id);
      }
      break;
  }
});

// Track tab creation
chrome.tabs.onCreated.addListener((tab) => {
  chrome.storage.local.get(['isRecording'], function(result) {
    if (!result.isRecording) return;
    
    // Record new tab action
    recordAction({
      type: 'tabCreate',
      tabId: tab.id,
      openerTabId: tab.openerTabId,
      url: tab.url || 'about:blank'
    });
    
    // Track relationship between tabs
    if (tab.openerTabId) {
      tabHistory.set(tab.id, tab.openerTabId);
    }
  });
});

// Track tab focus changes
chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.storage.local.get(['isRecording'], function(result) {
    if (!result.isRecording) return;
    
    chrome.tabs.sendMessage(activeInfo.tabId, {
      type: 'tabFocused',
      tabId: activeInfo.tabId
    }).catch(() => {}); // Ignore errors if content script isn't ready
  });
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
  chrome.storage.local.get(['actions'], function(result) {
    const actions = result.actions || [];
    const script = actions.map((action, index) => 
      `${index + 1}. ${generateActionScript(action)}`
    ).join('\n');
    
    chrome.storage.local.set({ 
      isRecording: false, 
      recordingScript: script 
    }, function() {
      if (currentTabId) {
        chrome.tabs.sendMessage(currentTabId, { command: 'stopRecording' });
        console.log('Recording stopped');
      }
    });
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
      
      // Clean up parent context before storing
      if (action.parentContext) {
        action.parentContext = action.parentContext.map(context => ({
          ...context,
          // Remove DOM-specific properties that can't be serialized
          element: undefined,
          parentElement: undefined,
          children: undefined
        }));
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
    
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      console.log('Executing action:', action);
      
      // Send progress update
      chrome.runtime.sendMessage({
        type: 'playbackProgress',
        current: i + 1,
        total: actions.length,
        percentage: Math.round(((i + 1) / actions.length) * 100)
      });
      
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
async function waitForContentScript(tabId, maxWaitTime = 5000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const checkInterval = 100;
    
    function checkContentScript() {
      if (Date.now() - startTime >= maxWaitTime) {
        reject(new Error('Content script initialization timeout'));
        return;
      }
      
      chrome.tabs.sendMessage(tabId, { command: 'isContentScriptReady' }, response => {
        if (chrome.runtime.lastError || !response?.ready) {
          setTimeout(checkContentScript, checkInterval);
        } else {
          resolve();
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
  const maxRetries = 3;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      return await attemptExecuteAction(tabId, action);
    } catch (error) {
      retryCount++;
      if (retryCount === maxRetries) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
      try {
        await waitForContentScript(tabId);
      } catch (e) {
        console.warn('Content script not ready during retry:', e);
      }
    }
  }
}

async function attemptExecuteAction(tabId, action) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Action execution timed out'));
    }, 30000);

    // Handle tab-specific actions first
    if (action.type === 'tabCreate') {
      chrome.tabs.create({ 
        url: action.url,
        active: true
      }, async (tab) => {
        clearTimeout(timeout);
        playbackTabId = tab.id;
        try {
          await waitForTabLoad(tab.id);
          await waitForContentScript(tab.id);
          resolve({ status: 'success' });
        } catch (error) {
          reject(error);
        }
      });
      return;
    }

    if (action.type === 'tabFocus') {
      chrome.tabs.update(action.tabId, { active: true }, async () => {
        clearTimeout(timeout);
        try {
          await waitForContentScript(action.tabId);
          resolve({ status: 'success' });
        } catch (error) {
          reject(error);
        }
      });
      return;
    }

    // For other actions, proceed with normal execution
    // Wait for any ongoing navigation to complete
    if (isNavigating) {
      waitForTabLoad(tabId)
        .then(() => waitForContentScript(tabId))
        .then(() => sendActionMessage())
        .catch(error => {
          clearTimeout(timeout);
          reject(error);
        });
    } else {
      sendActionMessage();
    }

    function sendActionMessage() {
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
    }
  });
}

// Add new function to generate readable script
function generateActionScript(action) {
  switch (action.type) {
    case 'scroll':
      return `Scroll to position (${Math.round(action.x)}, ${Math.round(action.y)})`;
    case 'click':
      let clickDesc = `Click on ${action.tagName}`;
      if (action.id) {
        clickDesc += ` with ID "${action.id}"`;
      }
      if (action.parentContext && action.parentContext.length > 0) {
        const parent = action.parentContext[0];
        if (parent.listContext) {
          clickDesc += ` in ${parent.listContext.listType.toLowerCase()} list with ${parent.listContext.itemCount} items`;
        } else if (parent.tableContext) {
          clickDesc += ` in table with ${parent.tableContext.rows} rows and ${parent.tableContext.cols} columns`;
        } else if (parent.id) {
          clickDesc += ` within ${parent.tagName} with ID "${parent.id}"`;
        }
      }
      return clickDesc;
    case 'input':
      return `Type "${action.value}" into ${action.tagName}${action.id ? ` with ID "${action.id}"` : ''}`;
    case 'change':
      if (action.elementType === 'checkbox' || action.elementType === 'radio') {
        return `Set ${action.tagName} to ${action.value ? 'checked' : 'unchecked'}`;
      }
      return `Change ${action.tagName} value to "${action.value}"`;
    case 'navigation':
      return `Navigate to "${action.url}"`;
    case 'formSubmit':
      return `Submit form`;
    case 'tabCreate':
      return `Create new tab${action.url ? ` and navigate to "${action.url}"` : ''}`;
    case 'tabFocus':
      return `Switch to tab ${action.tabId}`;
    default:
      return `Perform ${action.type} action`;
  }
}