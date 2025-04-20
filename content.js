// Global variables
let isRecording = false;
let eventListenersAttached = false;
let lastUrl = window.location.href;
let contentScriptReady = false;

// Utility: Sleep function
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Initialize content script
function init() {
  // Only attach event listeners once
  if (!eventListenersAttached) {
    attachEventListeners();
    eventListenersAttached = true;
  }
  
  // Signal that content script is ready
  contentScriptReady = true;
  chrome.runtime.sendMessage({ type: 'contentScriptReady' });
  
  // Check if we were already recording
  chrome.storage.local.get(['isRecording'], function(result) {
    if (result.isRecording) {
      startRecording();
    }
  });
  
  // Listen for messages from background script
  chrome.runtime.onMessage.addListener(handleMessages);
}

// Handle messages from the background script
function handleMessages(request, sender, sendResponse) {
  switch (request.command) {
    case 'startRecording':
      startRecording();
      break;
    case 'stopRecording':
      stopRecording();
      break;
    case 'playActions':
      playActions(request.actions)
        .then(() => sendResponse({ status: 'complete' }))
        .catch(error => sendResponse({ status: 'error', message: error.message }));
      return true; // Required for async sendResponse
    case 'isContentScriptReady':
      sendResponse({ ready: contentScriptReady });
      return true;
  }
}

// Attach event listeners to capture user actions
function attachEventListeners() {
  // URL change detection
  let lastUrl = window.location.href;
  new MutationObserver(() => {
    if (lastUrl !== window.location.href) {
      if (isRecording) {
        recordAction({
          type: 'navigation',
          url: window.location.href,
          fromUrl: lastUrl
        });
      }
      lastUrl = window.location.href;
    }
  }).observe(document, {subtree: true, childList: true});

  // Handle form submissions
  document.addEventListener('submit', function(event) {
    if (!isRecording) return;
    
    const form = event.target;
    recordAction({
      type: 'formSubmit',
      xpath: getXPath(form),
      url: window.location.href
    });
  }, true);

  // Click events
  document.addEventListener('click', function(event) {
    if (!isRecording) return;
    
    const element = event.target;
    const xpath = getXPath(element);
    
    // Record click action
    recordAction({
      type: 'click',
      xpath: xpath,
      tagName: element.tagName.toLowerCase(),
      elementType: element.type || null,
      id: element.id || null,
      className: element.className || null
    });
  }, true);
  
  // Input events (for text fields)
  document.addEventListener('input', function(event) {
    if (!isRecording) return;
    
    const element = event.target;
    // Only record for input elements that accept text
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
      const xpath = getXPath(element);
      
      recordAction({
        type: 'input',
        xpath: xpath,
        tagName: element.tagName.toLowerCase(),
        elementType: element.type || null,
        id: element.id || null,
        className: element.className || null,
        value: element.value
      });
    }
  }, true);
  
  // Change events (for dropdowns, checkboxes, etc.)
  document.addEventListener('change', function(event) {
    if (!isRecording) return;
    
    const element = event.target;
    const xpath = getXPath(element);
    
    let value;
    if (element.type === 'checkbox' || element.type === 'radio') {
      value = element.checked;
    } else {
      value = element.value;
    }
    
    recordAction({
      type: 'change',
      xpath: xpath,
      tagName: element.tagName.toLowerCase(),
      elementType: element.type || null,
      id: element.id || null,
      className: element.className || null,
      value: value
    });
  }, true);
  
  // Navigation events
  window.addEventListener('beforeunload', function() {
    if (!isRecording) return;
    
    recordAction({
      type: 'navigation',
      url: window.location.href
    });
  });
}

// Start recording mode
function startRecording() {
  isRecording = true;
  console.log('Content script: Recording started');
}

// Stop recording mode
function stopRecording() {
  isRecording = false;
  console.log('Content script: Recording stopped');
}

// Record an action by sending it to background script
function recordAction(action) {
  // Add precise timestamp for accurate replay timing
  action.preciseTimestamp = performance.now();
  
  chrome.runtime.sendMessage({
    command: 'recordAction',
    action: action
  });
}

// Play a sequence of recorded actions
async function playActions(actions) {
  try {
    console.log('Content script: Playing', actions.length, 'actions');
    
    let previousActionTime = null;
    let actionsCompleted = 0;
    
    for (const action of actions) {
      // Calculate and wait for the recorded delay between actions
      if (previousActionTime && action.preciseTimestamp) {
        const delay = action.preciseTimestamp - previousActionTime;
        console.log(`Waiting ${delay}ms before next action (recorded delay)`);
        await sleep(Math.max(delay, 50)); // Minimum 50ms delay
      }
      
      // Execute the action
      await executeAction(action);
      actionsCompleted++;
      
      // Store the timestamp for next iteration
      previousActionTime = action.preciseTimestamp;
      
      // Report progress
      chrome.runtime.sendMessage({ 
        type: 'actionCompleted',
        current: actionsCompleted,
        total: actions.length,
        percentage: Math.round((actionsCompleted / actions.length) * 100)
      });
      
      // If this action causes navigation, notify background script
      if (action.type === 'navigation' || action.type === 'formSubmit') {
        chrome.runtime.sendMessage({ type: 'navigationStarted' });
      }
      
      // Wait for any pending navigation to complete
      await waitForStableState();
    }
    
    console.log('Content script: Playback complete');
    return { status: 'complete' };
  } catch (error) {
    console.error('Content script: Playback error:', error);
    return { status: 'error', error: error.message };
  }
}

// Execute a single action
async function executeAction(action) {
  console.log('Executing action:', action);
  
  try {
    switch (action.type) {
      case 'click':
        return await handleClickAction(action);
      
      case 'input':
        return await handleInputAction(action);
      
      case 'change':
        return await handleChangeAction(action);
      
      case 'navigation':
        return await handleNavigationAction(action);
      
      case 'formSubmit':
        return await handleFormSubmitAction(action);
      
      default:
        console.warn('Unknown action type:', action.type);
        return false;
    }
  } catch (error) {
    console.error('Error executing action:', error);
    throw error;
  }
}

// Handle click actions
async function handleClickAction(action) {
  const element = getElementByXPath(action.xpath) || 
                  getElementBySelector(action);
  
  if (!element) {
    throw new Error(`Element not found for click action: ${action.xpath}`);
  }
  
  // Scroll element into view
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await sleep(300);
  
  // Create and dispatch a click event
  const clickEvent = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    view: window
  });
  
  element.dispatchEvent(clickEvent);
  return true;
}

// Handle input actions (typing text)
async function handleInputAction(action) {
  const element = getElementByXPath(action.xpath) || 
                  getElementBySelector(action);
  
  if (!element) {
    throw new Error(`Element not found for input action: ${action.xpath}`);
  }
  
  // Scroll element into view
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await sleep(300);
  
  // Focus the element first
  element.focus();
  
  // Clear existing value
  element.value = '';
  
  // Type the text character by character (more realistic)
  const text = action.value || '';
  for (let i = 0; i < text.length; i++) {
    element.value += text[i];
    
    // Create and dispatch an input event
    const inputEvent = new Event('input', {
      bubbles: true,
      cancelable: true
    });
    
    element.dispatchEvent(inputEvent);
    await sleep(50); // Small delay between characters
  }
  
  return true;
}

// Handle change actions (dropdowns, checkboxes, etc.)
async function handleChangeAction(action) {
  const element = getElementByXPath(action.xpath) || 
                  getElementBySelector(action);
  
  if (!element) {
    throw new Error(`Element not found for change action: ${action.xpath}`);
  }
  
  // Scroll element into view
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await sleep(300);
  
  // Handle different element types
  if (element.type === 'checkbox' || element.type === 'radio') {
    // Set checked state
    element.checked = action.value;
  } else if (element.tagName === 'SELECT') {
    // Set select value
    element.value = action.value;
  } else {
    // Set value for other elements
    element.value = action.value;
  }
  
  // Create and dispatch a change event
  const changeEvent = new Event('change', {
    bubbles: true,
    cancelable: true
  });
  
  element.dispatchEvent(changeEvent);
  return true;
}

// Add new handler for navigation actions
async function handleNavigationAction(action) {
  // Navigation is handled by the background script, just wait for it
  await new Promise(resolve => setTimeout(resolve, 1000));
  return true;
}

// Add new handler for form submit actions
async function handleFormSubmitAction(action) {
  const form = getElementByXPath(action.xpath) ||
               getElementBySelector(action);
  
  if (!form) {
    throw new Error(`Form not found for submit action: ${action.xpath}`);
  }
  
  form.submit();
  return true;
}

// Wait for the page to be in a stable state (no navigation or loading)
async function waitForStableState() {
  return new Promise(resolve => {
    // First check if document is still loading
    if (document.readyState !== 'complete') {
      document.addEventListener('readystatechange', function listener() {
        if (document.readyState === 'complete') {
          document.removeEventListener('readystatechange', listener);
          // Add extra delay for dynamic content
          setTimeout(resolve, 500);
        }
      });
    } else {
      // Document already complete, add small delay for any dynamic updates
      setTimeout(resolve, 500);
    }
  });
}

// Utility: Get XPath for an element
function getXPath(element) {
  if (!element) return null;
  
  // If element has an ID, use that for a more reliable XPath
  if (element.id) {
    return `//*[@id="${element.id}"]`;
  }
  
  // Check if element is the document
  if (element === document) {
    return '/html';
  }
  
  // Recursive function to build XPath
  let path = '';
  while (element && element.nodeType === Node.ELEMENT_NODE) {
    let index = 0;
    let sibling = element;
    
    // Count preceding siblings with same tag name
    while (sibling) {
      if (sibling.nodeType === Node.ELEMENT_NODE && sibling.tagName === element.tagName) {
        index++;
      }
      sibling = sibling.previousSibling;
    }
    
    const tagName = element.tagName.toLowerCase();
    const pathIndex = index > 0 ? `[${index}]` : '';
    path = `/${tagName}${pathIndex}${path}`;
    
    element = element.parentNode;
  }
  
  return path;
}

// Utility: Get element by XPath
function getElementByXPath(xpath) {
  if (!xpath) return null;
  try {
    return document.evaluate(
      xpath, 
      document, 
      null, 
      XPathResult.FIRST_ORDERED_NODE_TYPE, 
      null
    ).singleNodeValue;
  } catch (e) {
    console.error('XPath evaluation error:', e);
    return null;
  }
}

// Utility: Get element by various selectors as fallback
function getElementBySelector(action) {
  // Try by ID
  if (action.id) {
    const element = document.getElementById(action.id);
    if (element) return element;
  }
  
  // Try by class name and tag
  if (action.className && action.tagName) {
    const elements = document.getElementsByClassName(action.className);
    for (const el of elements) {
      if (el.tagName.toLowerCase() === action.tagName.toLowerCase()) {
        return el;
      }
    }
  }
  
  // Try by tag name and type
  if (action.tagName) {
    const elements = document.getElementsByTagName(action.tagName);
    for (const el of elements) {
      if (action.elementType && el.type === action.elementType) {
        return el;
      }
    }
  }
  
  return null;
}

// Utility: Sleep function
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Initialize content script
init();

// Handle playback of actions
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.command === 'playActions') {
    const action = request.actions[0];
    try {
      if (action.type === 'click') {
        const element = findElementByXPath(action.xpath);
        if (element) {
          element.click();
          sendResponse({ status: 'success' });
        } else {
          sendResponse({ error: 'Element not found' });
        }
      } else if (action.type === 'input') {
        const element = findElementByXPath(action.xpath);
        if (element) {
          element.value = action.value;
          // Trigger input event to simulate user typing
          element.dispatchEvent(new Event('input', { bubbles: true }));
          sendResponse({ status: 'success' });
        } else {
          sendResponse({ error: 'Element not found' });
        }
      }
    } catch (error) {
      sendResponse({ error: error.message });
    }
    return true;
  } else if (request.command === 'isContentScriptReady') {
    sendResponse({ ready: true });
    return true;
  }
});

// Helper function to find element by XPath
function findElementByXPath(xpath) {
  return document.evaluate(
    xpath,
    document,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE,
    null
  ).singleNodeValue;
}