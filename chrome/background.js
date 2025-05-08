// Global variables
let currentTabId = null;
let isNavigating = false;
let playbackTabId = null;
let tabHistory = new Map(); // Track tab relationships

// Set up message handling
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // For non-async responses
  if (request.command === 'ping') {
    sendResponse({ status: 'ok' });
    return;
  }

  if (request.command === 'getCurrentTab') {
    sendResponse({ tabId: sender.tab.id });
    return;
  }
  
  // For async operations, use this pattern in MV3
  const handleAsyncMessage = async () => {
    switch (request.command) {
      case 'startRecording':
        await startRecording();
        break;
      case 'stopRecording':
        await stopRecording();
        break;
      case 'playActions':
        try {
          const result = await playRecordedActions();
          sendResponse(result);
        } catch (error) {
          sendResponse({ status: 'error', message: error.message });
        }
        break;
      case 'recordAction':
        const { isRecording } = await chrome.storage.local.get(['isRecording']);
        if (isRecording) {
          await recordAction(request.action);
        }
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
  };

  // Handle async operations for commands that need it
  if (['playActions', 'startRecording', 'stopRecording', 'recordAction'].includes(request.command)) {
    handleAsyncMessage().catch(console.error);
    return true; // Will respond asynchronously
  }
});

// Track tab creation
chrome.tabs.onCreated.addListener((tab) => {
  if (!isRecording) return;
  
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

// Track tab focus changes
chrome.tabs.onActivated.addListener((activeInfo) => {
  if (!isRecording) return;
  
  chrome.tabs.sendMessage(activeInfo.tabId, {
    type: 'tabFocused',
    tabId: activeInfo.tabId
  }).catch(() => {}); // Ignore errors if content script isn't ready
});

// Start recording mode
async function startRecording() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs.length > 0) {
    currentTabId = tabs[0].id;
    await chrome.storage.local.set({ isRecording: true, actions: [] });
    console.log('Recording started');
    await chrome.tabs.sendMessage(currentTabId, { command: 'startRecording' });
  }
}

// Stop recording mode
async function stopRecording() {
  const { actions } = await chrome.storage.local.get(['actions']);
  const script = (actions || []).map((action, index) => 
    `${index + 1}. ${generateActionScript(action)}`
  ).join('\n');
  
  await chrome.storage.local.set({ 
    isRecording: false, 
    recordingScript: script 
  });
  
  if (currentTabId) {
    await chrome.tabs.sendMessage(currentTabId, { command: 'stopRecording' });
    console.log('Recording stopped');
  }
}

// Record a single action
async function recordAction(action) {
  action.timestamp = Date.now();
  
  const tab = await chrome.tabs.get(currentTabId);
  action.url = tab.url;
  
  const { actions = [] } = await chrome.storage.local.get(['actions']);
  
  if (actions.length === 0) {
    await chrome.storage.local.set({ recordingStartTime: action.preciseTimestamp });
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
  await chrome.storage.local.set({ actions });
  console.log('Action recorded:', action);
}

// Play recorded actions
async function playRecordedActions() {
  try {
    const { actions = [] } = await chrome.storage.local.get(['actions']);
    
    if (actions.length === 0) {
      console.log('No actions to play');
      return { status: 'complete', message: 'No actions to play' };
    }

    console.log('Starting playback of', actions.length, 'actions');
    
    // Create a new tab for playback
    const initialUrl = actions[0].url;
    let currentTab = await createOrUpdateTab(initialUrl);
    playbackTabId = currentTab.id;
    
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
    playbackTabId = null;
    return { status: 'complete' };
  } catch (error) {
    console.error('Playback error:', error);
    playbackTabId = null;
    return { status: 'error', message: error.message };
  }
}

// Wait for content script to be ready in a tab
async function waitForContentScript(tabId, maxWaitTime = 5000) {
  const startTime = Date.now();
  const checkInterval = 100;
  
  while (Date.now() - startTime < maxWaitTime) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { command: 'isContentScriptReady' });
      if (response?.ready) {
        return;
      }
    } catch (error) {
      // Ignore error and continue waiting
    }
    await new Promise(resolve => setTimeout(resolve, checkInterval));
  }
  throw new Error('Content script initialization timeout');
}

// Create a new tab or update existing one with the given URL
async function createOrUpdateTab(url) {
  if (playbackTabId) {
    try {
      // Update existing playback tab
      const tab = await chrome.tabs.update(playbackTabId, { url });
      await waitForTabLoad(tab.id);
      await waitForContentScript(tab.id);
      return tab;
    } catch (error) {
      // If update fails, create new tab
      const newTab = await chrome.tabs.create({ url });
      playbackTabId = newTab.id;
      await waitForTabLoad(newTab.id);
      await waitForContentScript(newTab.id);
      return newTab;
    }
  } else {
    // Create new tab if none exists
    const tab = await chrome.tabs.create({ url });
    playbackTabId = tab.id;
    await waitForTabLoad(tab.id);
    await waitForContentScript(tab.id);
    return tab;
  }
}

// Wait for a tab to complete loading
async function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    function listener(updatedTabId, changeInfo) {
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
  // Handle tab-specific actions first
  if (action.type === 'tabCreate') {
    const tab = await chrome.tabs.create({ 
      url: action.url,
      active: true
    });
    playbackTabId = tab.id;
    await waitForTabLoad(tab.id);
    await waitForContentScript(tab.id);
    return { status: 'success' };
  }

  if (action.type === 'tabFocus') {
    await chrome.tabs.update(action.tabId, { active: true });
    await waitForContentScript(action.tabId);
    return { status: 'success' };
  }

  // For other actions, proceed with normal execution
  const timeoutPromise = new Promise((_, reject) => 
    setTimeout(() => reject(new Error('Action execution timed out')), 30000)
  );

  // Wait for any ongoing navigation to complete
  if (isNavigating) {
    await waitForTabLoad(tabId);
    await waitForContentScript(tabId);
  }

  const actionPromise = chrome.tabs.sendMessage(tabId, {
    command: 'playActions',
    actions: [action]
  });

  try {
    const response = await Promise.race([actionPromise, timeoutPromise]);
    if (response?.error) {
      throw new Error(response.error);
    }
    return response;
  } catch (error) {
    throw error;
  }
}

// Generate readable script
function generateActionScript(action) {
  switch (action.type) {
    case 'tabCreate':
      return `Create new tab${action.url ? ` and navigate to "${action.url}"` : ''}`;
    case 'tabFocus':
      return `Switch to tab ${action.tabId}`;
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
    default:
      return `Perform ${action.type} action`;
  }
}