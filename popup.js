// popup.js

// --- Default State Structure ---
function getDefaultPopupState() {
    return {
        originalArticleText: '',
        conversationHistory: [],
        initialSummaryHtml: '',
        isChatVisible: false,
        isProcessing: false, // Still track if background *should* be busy
        currentAccumulator: ''
    };
}

// --- Global Non-Persistent State ---
let port = null; // Null when disconnected
let currentTabId = null;
let currentAssistantChatBubbleElement = null;
let isConnectingOnClick = false; // Flag for user-initiated connection attempt

// --- Current State (Loaded/Saved) ---
let popupState = getDefaultPopupState();

// --- DOM Elements ---
let containerElement;
let initialSummaryDisplayElement;
let chatBubblesAreaElement;
let chatInputAreaElement;
let chatInputElement;
let sendChatBtnElement;
let chatToggleBtnElement;
let summarizeBtnElement;
let explainBtnElement;
let copyBtnElement;
let languageSelectElement;
let statusIndicatorElement = null;

// --- Initialize Showdown ---
const markdownConverter = new showdown.Converter({
    ghCompatibleHeaderId: true,
    simpleLineBreaks: true
});

// --- Utility Functions ---
function disableButtons(disabled) {
    // Disable based on active processing or connection attempt
    const isBusy = popupState.isProcessing || isConnectingOnClick;
    if (summarizeBtnElement) summarizeBtnElement.disabled = disabled || isBusy;
    if (explainBtnElement) explainBtnElement.disabled = disabled || isBusy;
    if (copyBtnElement) copyBtnElement.disabled = disabled; // Keep copy enabled?
    if (languageSelectElement) languageSelectElement.disabled = disabled || isBusy;
    if (sendChatBtnElement) sendChatBtnElement.disabled = disabled || isBusy;
    if (chatInputElement) chatInputElement.disabled = disabled || isBusy;
    if (chatToggleBtnElement) chatToggleBtnElement.disabled = disabled || !popupState.originalArticleText || isBusy;
}

// Consolidated disable logic - depends ONLY on popupState.isProcessing and isConnectingOnClick
function updateButtonStates() {
    const isBusy = popupState.isProcessing || isConnectingOnClick;

    if (summarizeBtnElement) summarizeBtnElement.disabled = isBusy;
    if (explainBtnElement) explainBtnElement.disabled = isBusy;
    if (copyBtnElement) copyBtnElement.disabled = false; // Generally keep copy enabled
    if (languageSelectElement) languageSelectElement.disabled = isBusy;
    if (sendChatBtnElement) sendChatBtnElement.disabled = isBusy;
    if (chatInputElement) chatInputElement.disabled = isBusy;
    // Chat toggle depends on context AND not being busy
    if (chatToggleBtnElement) {
         chatToggleBtnElement.disabled = isBusy || !popupState.originalArticleText;
         // Also ensure visibility reflects context existence
         chatToggleBtnElement.style.display = popupState.originalArticleText ? 'inline-block' : 'none';
    }
}

function scrollChatToBottom() {
    if (chatBubblesAreaElement) {
        chatBubblesAreaElement.scrollTop = chatBubblesAreaElement.scrollHeight;
    }
}


function showStatus(message = "", isError = false) {
    // Create if doesn't exist
    if (!statusIndicatorElement && containerElement) {
        statusIndicatorElement = document.createElement('div');
        statusIndicatorElement.style.position = 'absolute'; statusIndicatorElement.style.bottom = '45px';
        statusIndicatorElement.style.left = '10px'; statusIndicatorElement.style.padding = '2px 5px';
        statusIndicatorElement.style.fontSize = '10px'; statusIndicatorElement.style.borderRadius = '3px';
        statusIndicatorElement.style.zIndex = '10'; statusIndicatorElement.style.maxWidth = 'calc(100% - 20px)';
        statusIndicatorElement.style.overflow = 'hidden'; statusIndicatorElement.style.textOverflow = 'ellipsis';
        statusIndicatorElement.style.whiteSpace = 'nowrap';
        containerElement.appendChild(statusIndicatorElement);
    }
    // Update content and style
    if (statusIndicatorElement) {
        if (message) {
            statusIndicatorElement.textContent = message; statusIndicatorElement.setAttribute('title', message);
            statusIndicatorElement.style.backgroundColor = isError ? '#f8d7da' : '#cfe2ff';
            statusIndicatorElement.style.color = isError ? '#842029' : '#052c65';
            statusIndicatorElement.style.display = 'block';
        } else {
            statusIndicatorElement.style.display = 'none'; statusIndicatorElement.removeAttribute('title');
        }
    }
}

// --- State Management Functions ---
async function saveState() {
    if (!currentTabId) return;
    const key = `tabState_${currentTabId}`;
    try {
        await chrome.storage.session.set({ [key]: { ...popupState } }); // Save a clone
    } catch (error) { console.error("Popup: Error saving state:", error); }
}

async function loadState(tabId) {
    const key = `tabState_${tabId}`;
    try {
        const result = await chrome.storage.session.get(key);
        if (result && result[key]) {
            popupState = result[key];
            return true;
        }
    } catch (error) { console.error("Popup: Error loading state:", error); }
    popupState = getDefaultPopupState(); // Use default if not found or on error
    return false;
}

async function resetState() {
    console.log("Popup: Resetting state.");
    popupState = getDefaultPopupState(); // Reset state object (sets isProcessing=false)
    isConnectingOnClick = false; // Reset non-persistent flags
    currentAssistantChatBubbleElement = null;

    // Clear storage for this tab
    if (currentTabId) {
        const key = `tabState_${currentTabId}`;
        try { await chrome.storage.session.remove(key); }
        catch (error) { console.error(`Popup: Error clearing state for tab ${currentTabId}:`, error); }
    }

    showStatus(""); // Clear any status message
    await saveState();
}

// --- UI Rendering Functions ---
function renderInitialSummary() {
    if (!initialSummaryDisplayElement) return;
    // Show loader ONLY if processing initial summary AND no previous summary exists
    if (popupState.isProcessing && !popupState.initialSummaryHtml && !popupState.conversationHistory.length) {
         initialSummaryDisplayElement.innerHTML = '<div class="loader"></div> Processing...';
    } else if (popupState.initialSummaryHtml) {
        initialSummaryDisplayElement.innerHTML = popupState.initialSummaryHtml;
    } else {
        initialSummaryDisplayElement.innerHTML = 'Summary/Explanation will appear here...';
    }
}

async function renderChatBubbles() {
    if (!chatBubblesAreaElement) return;
    chatBubblesAreaElement.innerHTML = '';
    popupState.conversationHistory.forEach(message => addChatBubble(message.role, message.content, false));
    await saveState();
    // If reloading while processing a *chat* message, add the placeholder back
    if (popupState.isProcessing && popupState.conversationHistory.length > 0 && popupState.conversationHistory[popupState.conversationHistory.length - 1].role === 'user') {
         console.log("renderChatBubbles: Adding placeholder for ongoing chat response.");
         addChatBubble('assistant', '', true);

         await saveState();
    }
    if (popupState.isChatVisible) { setTimeout(scrollChatToBottom, 50); }
}

function addChatBubble(role, content = "", isStreamingPlaceholder = false) {
     if (!chatBubblesAreaElement) return null;
     const messageDiv = document.createElement('div');
     messageDiv.classList.add(role === 'user' ? 'user-message' : 'assistant-message');
     if (isStreamingPlaceholder && role === 'assistant') {
         messageDiv.innerHTML = '<div class="loader"></div>';
         currentAssistantChatBubbleElement = messageDiv;
         popupState.currentAccumulator = '';
     } else if (role === 'user') { messageDiv.innerText = content; }
     else { try { messageDiv.innerHTML = markdownConverter.makeHtml(content); } catch (e) { messageDiv.innerText = content; } }
     chatBubblesAreaElement.appendChild(messageDiv);
     if (role === 'user' || isStreamingPlaceholder) { scrollChatToBottom(); }
     return messageDiv;
}

// Apply UI state based on loaded/current popupState
async function applyStateToUI() {
     renderInitialSummary();
     await renderChatBubbles();
     // Update container class and chat area visibility based on state
     if (containerElement) { containerElement.classList.toggle('chat-active', popupState.isChatVisible); }
     if (chatBubblesAreaElement) { chatBubblesAreaElement.style.display = popupState.isChatVisible ? 'block' : 'none'; }
     if (chatInputAreaElement) { chatInputAreaElement.style.display = popupState.isChatVisible ? 'flex' : 'none'; }
     // Update button states (visibility and disabled)
     updateButtonStates();
     // console.log("Applied state to UI, isProcessing:", popupState.isProcessing, "isChatVisible:", popupState.isChatVisible); // DEBUG
}

// --- Interaction Functions ---
async function toggleChatInput() {
    popupState.isChatVisible = !popupState.isChatVisible; // Update state
    // Apply UI changes immediately
    if (containerElement) { containerElement.classList.toggle('chat-active', popupState.isChatVisible); }
    if (chatBubblesAreaElement) { chatBubblesAreaElement.style.display = popupState.isChatVisible ? 'block' : 'none'; }
    if (chatInputAreaElement) { chatInputAreaElement.style.display = popupState.isChatVisible ? 'flex' : 'none'; }
    if (popupState.isChatVisible && chatInputElement) {
        chatInputElement.focus();
        setTimeout(scrollChatToBottom, 50);
    }
    await saveState(); // Save the toggled state
}



// --- NEW: Function to Connect Port (called on demand) ---
// --- Connect Port Function ---
function connectPort() {
    return new Promise((resolve, reject) => {
        if (port) { resolve(port); return; }
        if (isConnectingOnClick) { reject(new Error("Connection attempt in progress.")); return; }
        isConnectingOnClick = true; showStatus("Connecting..."); updateButtonStates(); // Disable buttons

        try {
            const newPort = chrome.runtime.connect({ name: "popup" });
            newPort.onMessage.addListener(handleBackgroundMessage);
            newPort.onDisconnect.addListener(() => handleDisconnect(newPort));
            port = newPort; isConnectingOnClick = false;
            showStatus("Connected.", false); setTimeout(() => showStatus(""), 1500);
            // Don't update buttons here, let the caller do it after resolving
            resolve(port);
        } catch (error) {
            port = null; isConnectingOnClick = false;
            showStatus("Connection failed. Click action to retry.", true);
            updateButtonStates(); // Re-enable buttons on failure
            reject(error);
        }
    });
}


// --- Modified: sendCommand to use connectPort ---
// --- Send Command/Chat Functions ---
async function sendCommand(commandType) {
    if (popupState.isProcessing || isConnectingOnClick) {
        console.warn("Popup: Cannot send command. Processing or connecting.");
        showStatus(popupState.isProcessing ? "Processing..." : "Connecting...");
        return;
    }

    try {
        await connectPort(); // Ensure connection
        // --- Connection successful, proceed ---
        await resetState(); // Reset state object only
        popupState.isProcessing = true;
        await saveState(); // Mark processing, save state FIRST
        // --- Update UI ---
        await applyStateToUI(); // Show loader, hide chat, disable buttons based on new state
        // --- End UI Update ---

        const selectedLanguage = languageSelectElement.value;
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id || tab.id !== currentTabId) throw new Error("Tab context changed or invalid.");

        chrome.scripting.executeScript({ target: { tabId: currentTabId }, func: () => window.getSelection().toString() }, async (selection) => {
            try { // Add try block inside callback for error handling
                 if (chrome.runtime.lastError) throw new Error(chrome.runtime.lastError.message || "Script execution failed.");

                 const selectedText = selection?.[0]?.result?.trim();
                 let message = { language: selectedLanguage, command: '', text: '' };
                 let shouldSendMessage = true;

                  if (selectedText) {
                        message.command = commandType === 'summarize' ? "summarizeSelectedText" : "explainSelectedText";
                        message.text = selectedText;
                        popupState.originalArticleText = selectedText;
                        await saveState(); // Store context & save
                  } else if (tab.url && !tab.url.startsWith('http') && !tab.url.startsWith('file')) {
                        popupState.isProcessing = false;
                        shouldSendMessage = false;
                        await saveState(); // Undo processing state
                        showStatus("Cannot process this page type.", true);
                  } else if (tab.url && tab.url.toLowerCase().endsWith(".pdf")) {
                        shouldSendMessage = false;
                        popupState.originalArticleText = ''; // PDF needs context later
                        // Keep isProcessing = true for PDF background task
                        console.log("Popup: Storing PDF request info and injecting script.");
                        chrome.storage.local.set({ pdfProcessingInfo: { language: selectedLanguage, mode: commandType } })
                            .then(() => chrome.scripting.executeScript({ target: { tabId: currentTabId }, files: ["getContentScript.js"] }))
                            .catch(err => { throw new Error(`PDF init failed: ${err.message}`); }); // Propagate error
                  } else { // Full page
                        message.command = commandType === 'summarize' ? "summarize" : "explain";
                        popupState.originalArticleText = ''; // Wait for context message
                  }

                  await applyStateToUI();

                  if (shouldSendMessage && port) { // Check port is still valid before sending
                      try { port.postMessage(message); }
                      catch(e) {
                           // If postMessage fails, port is likely invalid, trigger disconnect
                           console.error("Popup: postMessage failed, likely disconnected.", e);
                           handleDisconnect(port); // Pass the (now invalid) port reference
                      }
                  }
            } catch (error) { // Catch errors originating *inside* the callback
                console.error("Popup: Error inside executeScript callback:", error);
                popupState.isProcessing = false; saveState(); // Correct state
                showStatus(`Error: ${error.message}`, true);
                await applyStateToUI(); // Re-render UI in non-processing state
            }
         }); // End executeScript callback
    } catch(error) { // Catch errors from connectPort, tab query, executeScript, PDF init
         console.error("Popup: Error during command processing:", error);
         popupState.isProcessing = false;
         await saveState(); // Ensure processing is false on error
         showStatus(`Error: ${error.message}`, true);
         await applyStateToUI(); // Re-render UI in non-processing state
    } // End outer try/catch
}

// --- Modified: sendChatMessage to use connectPort ---

async function sendChatMessage() {
     if (popupState.isProcessing || isConnectingOnClick || !chatInputElement || !popupState.originalArticleText) { return; }
     const question = chatInputElement.value.trim(); if (!question) return;

     try {
        await connectPort(); // Ensure connection

        // --- Connection successful, proceed ---
        popupState.isProcessing = true;
        await saveState(); // Mark processing

        // Add user question to LIVE state history and display
        popupState.conversationHistory.push({ role: 'user', content: question });
        addChatBubble('user', question);
        await saveState(); // Save history with user msg

        chatInputElement.value = '';
        updateButtonStates(); // Disable buttons now processing
        addChatBubble('assistant', "", true); // Add placeholder
        await saveState();

        const messageToSend = {
            command: "chatWithContext", context: popupState.originalArticleText,
            history: popupState.conversationHistory, // Send current history including latest user question
            language: languageSelectElement.value
        };
        try { port.postMessage(messageToSend); } catch(e) { handleDisconnect(port); }

     } catch (connectError) { console.error("Popup: Failed to connect before sending chat:", connectError); }
}
// --- Connection & Message Handling ---
async function handleDisconnect(disconnectedPort) {
    if (!port || port !== disconnectedPort) return;
    console.warn("Popup: Disconnected from background.");
    port = null;

    // Reset processing/connecting state
    const wasProcessing = popupState.isProcessing; // Check before resetting state obj
    popupState.isProcessing = false;
    popupState.currentAccumulator = '';
    isConnectingOnClick = false;
    await saveState();

    showStatus("Disconnected. Click action to reconnect.", true);
    updateButtonStates(); // Enable buttons now disconnected

    // Update UI if a stream was interrupted
    if (wasProcessing) {
        if (currentAssistantChatBubbleElement) { currentAssistantChatBubbleElement.innerText = "(Disconnected)"; currentAssistantChatBubbleElement = null; }
        else if (initialSummaryDisplayElement && initialSummaryDisplayElement.innerHTML.includes("loader")) {
             renderInitialSummary(); // Re-render (will show placeholder or last summary)
             if (initialSummaryDisplayElement) initialSummaryDisplayElement.innerHTML += "<br><small>(Disconnected)</small>";
        }
    }
    // currentAccumulator = '';
}


async function handleBackgroundMessage(message) {
    // If connecting onClick, ignore messages until connected (shouldn't happen often)
    if (isConnectingOnClick && message.action !== 'error') return;

    // --- Normal Message Processing ---
    // Clear processing/retry indicators (if any exist)
    const isProcessing = (message.action === "update" || message.action === "context") && initialSummaryDisplayElement && initialSummaryDisplayElement.innerHTML.includes("loader");

    const isRetrying = message.action === "update" && currentAssistantChatBubbleElement && currentAssistantChatBubbleElement.innerText.includes("Retrying...");
     if (isProcessing) {
         initialSummaryDisplayElement.innerHTML = "";
     }
     if (isRetrying) {
         currentAssistantChatBubbleElement.innerText = "";
     }

     if (isProcessing || isRetrying){
         popupState.currentAccumulator = '';
         await saveState();
     }

    switch (message.action) {
        case "update":
            popupState.currentAccumulator += message.summary;
            await saveState();
            if (currentAssistantChatBubbleElement) {
                currentAssistantChatBubbleElement.innerText = popupState.currentAccumulator;
                scrollChatToBottom();
            }
            else if (initialSummaryDisplayElement){
                initialSummaryDisplayElement.innerText = popupState.currentAccumulator;
            }
            // Still processing, state doesn't change
            break;

        case "complete":
            const completedText = message.summary || popupState.currentAccumulator || "";
            popupState.currentAccumulator = '';
            popupState.isProcessing = false; // Processing finished

            if (currentAssistantChatBubbleElement) { // Completing CHAT
                 try { currentAssistantChatBubbleElement.innerHTML = markdownConverter.makeHtml(completedText); } catch (e) { currentAssistantChatBubbleElement.innerText = completedText; }
                 popupState.conversationHistory.push({ role: 'assistant', content: completedText });
                 currentAssistantChatBubbleElement = null;
            } else if (initialSummaryDisplayElement) { // Completing INITIAL summary
                try { popupState.initialSummaryHtml = markdownConverter.makeHtml(completedText); } catch (e) { popupState.initialSummaryHtml = `<p>${completedText.replace(/\n/g, '<br>')}</p>`; }
                renderInitialSummary();
                popupState.conversationHistory = []; // Reset chat history
                if (!popupState.originalArticleText) { console.warn("Popup: Initial complete, originalArticleText missing!"); }
                // Update chat toggle state (visibility handled by applyStateToUI)
            }
            await saveState(); // Save final state
            await applyStateToUI(); // Update UI (enables buttons)
            scrollChatToBottom(); // Ensure scrolled down
            break;

        case "context":
             popupState.originalArticleText = message.content;
             await saveState(); // Save received context
             // Update chat toggle state implicitly via applyStateToUI later? Or here?
             updateButtonStates(); // Update button states now context exists
             break;

        case "error":
             console.error("Popup: Received error from background:", message.message);
             popupState.isProcessing = false;
             popupState.currentAccumulator = '';
             await saveState();
             isConnectingOnClick = false; // Ensure flags are reset
             showStatus(`Error: ${message.message}`, true);
             if (currentAssistantChatBubbleElement) { currentAssistantChatBubbleElement.innerText = `Error: ${message.message}`; currentAssistantChatBubbleElement = null; }
             else if (initialSummaryDisplayElement) { initialSummaryDisplayElement.innerText = `Error: ${message.message}`; }
             updateButtonStates(); // Re-enable buttons
             break;

        case "aborted":
             popupState.isProcessing = false;
             popupState.currentAccumulator = '';
             await saveState();
             const abortMsg = "Operation cancelled.";
             if (currentAssistantChatBubbleElement) {
                 currentAssistantChatBubbleElement.innerText = abortMsg;
                 currentAssistantChatBubbleElement = null;
             } else if (initialSummaryDisplayElement) {
                 initialSummaryDisplayElement.innerText = abortMsg;
             }
             updateButtonStates(); // Re-enable buttons
             break;
        default:
            console.warn("Popup: Received unknown message action:", message.action);
            break;
    }
}

// --- Initialize on Load ---
document.addEventListener('DOMContentLoaded', async () => {
     // Cache DOM elements
    containerElement = document.querySelector('.container');
    initialSummaryDisplayElement = document.getElementById('initialSummaryDisplay');
    chatBubblesAreaElement = document.getElementById('chatBubblesArea');
    chatInputAreaElement = document.getElementById('chatInputArea');
    chatInputElement = document.getElementById('chatInput');
    sendChatBtnElement = document.getElementById('sendChatBtn');
    chatToggleBtnElement = document.getElementById('chatToggleBtn');
    summarizeBtnElement = document.getElementById('summarizeBtn');
    explainBtnElement = document.getElementById('explainBtn');
    copyBtnElement = document.getElementById('copyBtn');
    languageSelectElement = document.getElementById('languageSelect');

    // Get Tab ID
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
        showStatus("Error: Could not identify current tab.", true);
        disableButtons(true);
        return;
    }
    currentTabId = tab.id;

    // Load state
    await loadState(currentTabId);

    if (popupState.isProcessing){
        if (popupState.initialSummaryHtml?.length > 0){
            popupState.isProcessing = false;
        } else {
            popupState = getDefaultPopupState();
        }
    }
    await saveState();
    // Apply loaded state to UI
    await applyStateToUI();

    // --- Attach Event Listeners ---
    summarizeBtnElement.addEventListener('click', () => sendCommand('summarize'));
    explainBtnElement.addEventListener('click', () => sendCommand('explain'));
    chatToggleBtnElement.addEventListener('click', toggleChatInput);
    sendChatBtnElement.addEventListener('click', sendChatMessage);
    chatInputElement.addEventListener('keypress', function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); } });
    copyBtnElement.addEventListener('click', async function () {
        let textToCopy = "";
        if(initialSummaryDisplayElement) textToCopy += initialSummaryDisplayElement.innerText;
        if(chatBubblesAreaElement && chatBubblesAreaElement.innerText.trim()) {
            textToCopy += (textToCopy ? "\n\n--- Chat ---\n" : "") + chatBubblesAreaElement.innerText;
        }
        if (textToCopy && textToCopy !== "Summary/Explanation will appear here...") {
            await navigator.clipboard.writeText(textToCopy);
        }
    });
    // --- Attempt Initial Connection (but don't block UI if fails) ---
    try {
        await connectPort(); // Await the promise returned by connectPort
        updateButtonStates();
    } catch (error) {
        console.warn("Popup: Initial connection failed or background was inactive.");
    }
});