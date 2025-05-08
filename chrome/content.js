// Global variables and utility functions
let isRecording = false;
let eventListenersAttached = false;
let lastUrl = window.location.href;
let contentScriptReady = false;
let lastScrollPosition = { x: 0, y: 0 };
let scrollTimeout = null;
let lastInputValues = new Map(); // Track last input value for each element
let currentTabId = null; // Add tracking for current tab

// Utility: Sleep function
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Notify background script when content script is ready
function notifyContentScriptReady() {
  // Send message immediately if document is already interactive or complete
  if (document.readyState === 'interactive' || document.readyState === 'complete') {
    chrome.runtime.sendMessage({ type: 'contentScriptReady', status: 'ready' });
    console.log('Document already loaded, sent ready message immediately');
    contentScriptReady = true;
    init();
  } else {
    // Otherwise, wait for the DOMContentLoaded event
    document.addEventListener('DOMContentLoaded', () => {
      chrome.runtime.sendMessage({ type: 'contentScriptReady', status: 'ready' });
      console.log('Document loaded, sent ready message');
      contentScriptReady = true;
      init();
    });
  }
}

// Initialize content script
function init() {
  // Only attach event listeners once
  if (!eventListenersAttached) {
    attachEventListeners();
    eventListenersAttached = true;
  }
  
  // Get current tab ID
  chrome.runtime.sendMessage({ command: 'getCurrentTab' }, function(response) {
    if (response && response.tabId) {
      currentTabId = response.tabId;
    }
  });
  
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
      executeAction(request.actions[0])
        .then(() => sendResponse({ status: 'success' }))
        .catch(error => sendResponse({ error: error.message }));
      return true; // Required for async sendResponse
    case 'isContentScriptReady':
      sendResponse({ ready: contentScriptReady });
      return true;
  }
}

// Attach event listeners to capture user actions
function attachEventListeners() {
  // Scroll event detection with debouncing
  window.addEventListener('scroll', function() {
    if (!isRecording) return;
    
    // Clear existing timeout
    if (scrollTimeout) {
      clearTimeout(scrollTimeout);
    }
    
    // Set new timeout to record scroll position after scrolling stops
    scrollTimeout = setTimeout(() => {
      const newPosition = {
        x: window.pageXOffset,
        y: window.pageYOffset
      };
      
      // Only record if position changed significantly (more than 50px)
      if (Math.abs(newPosition.y - lastScrollPosition.y) > 50 ||
          Math.abs(newPosition.x - lastScrollPosition.x) > 50) {
        recordAction({
          type: 'scroll',
          x: newPosition.x,
          y: newPosition.y
        });
        lastScrollPosition = newPosition;
      }
    }, 150); // Debounce for 150ms
  }, true);

  // URL change detection
  let lastUrl = window.location.href;
  new MutationObserver(() => {
    if (lastUrl !== window.location.href) {
      if (isRecording) {
        recordNavigation(window.location.href, lastUrl);
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

  // Enhance click events with parent context
  document.addEventListener('click', function(event) {
    if (!isRecording) return;
    
    const element = event.target;
    const xpath = getXPath(element);
    const parentContext = getParentContext(element);
    
    // Record click action with enhanced context
    recordAction({
      type: 'click',
      xpath: xpath,
      tagName: element.tagName.toLowerCase(),
      elementType: element.type || null,
      id: element.id || null,
      className: element.className || null,
      parentContext: parentContext
    });
  }, true);
  
  // Input events (for text fields)
  document.addEventListener('input', function(event) {
    if (!isRecording) return;
    
    const element = event.target;
    // Only record for input elements that accept text
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
      const xpath = getXPath(element);
      const currentValue = element.value;
      const lastValue = lastInputValues.get(xpath) || '';
      
      // Determine what changed
      let inputType = '';
      let inputData = '';
      
      if (currentValue.length > lastValue.length) {
        // Text was added
        inputType = 'insertion';
        inputData = currentValue.slice(lastValue.length);
      } else if (currentValue.length < lastValue.length) {
        // Text was removed
        inputType = 'deletion';
        const deleteCount = lastValue.length - currentValue.length;
        if (currentValue === lastValue.slice(0, -deleteCount)) {
          // Backspace from end
          inputType = 'backspace';
          inputData = deleteCount.toString();
        } else {
          // Other deletion (like selection delete)
          inputData = lastValue;
        }
      }
      
      // Record the input action with more detailed information
      recordAction({
        type: 'input',
        xpath: xpath,
        tagName: element.tagName.toLowerCase(),
        elementType: element.type || null,
        id: element.id || null,
        className: element.className || null,
        inputType: inputType,
        data: inputData,
        cursorPosition: element.selectionStart
      });
      
      // Update the last known value
      lastInputValues.set(xpath, currentValue);
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
    
    recordNavigation(window.location.href, lastUrl);
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

// Enhance the navigation recording
function recordNavigation(url, fromUrl, newTab = false, tabId = null) {
  recordAction({
    type: 'navigation',
    url: url,
    fromUrl: fromUrl,
    newTab: newTab,
    tabId: tabId || currentTabId
  });
}

// Handle tab focus changes
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'tabFocused' && isRecording) {
    recordAction({
      type: 'tabFocus',
      tabId: message.tabId,
      fromTabId: currentTabId
    });
    currentTabId = message.tabId;
  }
});

// Execute a single action
async function executeAction(action) {
  console.log('Executing action:', action);
  
  try {
    switch (action.type) {
      case 'scroll':
        return await handleScrollAction(action);
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
  
  // Focus the element
  element.focus();
  
  // Get current value and cursor position
  let currentValue = element.value;
  let cursorPos = action.cursorPosition || element.value.length;
  
  // Handle different input types
  switch (action.inputType) {
    case 'insertion':
      // Insert the new text at the cursor position
      currentValue = currentValue.slice(0, cursorPos) + 
                    action.data + 
                    currentValue.slice(cursorPos);
      cursorPos += action.data.length;
      break;
      
    case 'backspace':
      // Remove characters before cursor position
      const deleteCount = parseInt(action.data, 10);
      currentValue = currentValue.slice(0, cursorPos - deleteCount) + 
                    currentValue.slice(cursorPos);
      cursorPos -= deleteCount;
      break;
      
    case 'deletion':
      // Handle other types of deletion (like selection delete)
      // In this case we restore the last known value and replay from there
      currentValue = action.data;
      cursorPos = action.cursorPosition;
      break;
  }
  
  // Update element value
  element.value = currentValue;
  element.setSelectionRange(cursorPos, cursorPos);
  
  // Dispatch input event
  const inputEvent = new Event('input', {
    bubbles: true,
    cancelable: true
  });
  element.dispatchEvent(inputEvent);
  
  // Small delay for natural typing feel
  await sleep(50);
  
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

// Handle scroll actions
async function handleScrollAction(action) {
  window.scrollTo({
    left: action.x,
    top: action.y,
    behavior: 'smooth'
  });
  
  // Wait for scroll to complete
  await sleep(500);
  return true;
}

// Handle navigation actions
async function handleNavigationAction(action) {
  // Navigation is handled by the background script, just wait for it
  await sleep(1000);
  return true;
}

// Handle form submit actions
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

// Get parent context
function getParentContext(element) {
  const context = [];
  let parent = element.parentElement;
  let depth = 0;
  
  // Get context from up to 3 levels of parent elements
  while (parent && depth < 3) {
    const contextInfo = {
      tagName: parent.tagName.toLowerCase(),
      id: parent.id || null,
      className: parent.className || null,
      index: getElementIndex(parent)
    };
    
    // If parent is a list or table, add specific context
    if (parent.tagName === 'UL' || parent.tagName === 'OL') {
      contextInfo.listContext = {
        itemCount: parent.children.length,
        listType: parent.tagName
      };
    } else if (parent.tagName === 'TABLE') {
      contextInfo.tableContext = {
        rows: parent.rows.length,
        cols: parent.rows[0]?.cells.length
      };
    }
    
    context.push(contextInfo);
    parent = parent.parentElement;
    depth++;
  }
  
  return context;
}

// Get element's index among siblings
function getElementIndex(element) {
  let index = 0;
  let sibling = element;
  
  while (sibling = sibling.previousElementSibling) {
    if (sibling.tagName === element.tagName) {
      index++;
    }
  }
  
  return index;
}

// Update element selection to use parent context
function getElementBySelector(action) {
  // Try by ID first
  if (action.id) {
    const element = document.getElementById(action.id);
    if (element) return element;
  }
  
  // If we have parent context, use it to narrow down the search
  if (action.parentContext && action.parentContext.length > 0) {
    let possibleElements = [];
    
    // Get all elements matching the target's tag and class
    if (action.className) {
      possibleElements = Array.from(document.getElementsByClassName(action.className))
        .filter(el => el.tagName.toLowerCase() === action.tagName.toLowerCase());
    } else {
      possibleElements = Array.from(document.getElementsByTagName(action.tagName));
    }
    
    // Filter elements based on parent context
    for (const element of possibleElements) {
      if (matchesParentContext(element, action.parentContext)) {
        return element;
      }
    }
  }
  
  // Fallback to existing methods
  return getElementByFallbackMethods(action);
}

// Match parent context
function matchesParentContext(element, parentContext) {
  let currentElement = element.parentElement;
  let contextIndex = 0;
  
  while (currentElement && contextIndex < parentContext.length) {
    const context = parentContext[contextIndex];
    
    // Check if current parent matches context
    if (
      currentElement.tagName.toLowerCase() !== context.tagName ||
      (context.id && currentElement.id !== context.id) ||
      (context.className && currentElement.className !== context.className) ||
      getElementIndex(currentElement) !== context.index
    ) {
      return false;
    }
    
    currentElement = currentElement.parentElement;
    contextIndex++;
  }
  
  return true;
}

// Fallback methods for element selection
function getElementByFallbackMethods(action) {
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

// Start initialization by notifying readiness
notifyContentScriptReady();