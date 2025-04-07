// popup.js
// import { defaultModel, defaultSummarizePrompt, defaultExplainPrompt } from './defaults.js'; // If needed for defaults here

// --- Global State ---
let port = null;
let originalArticleText = '';
let conversationHistory = [];
let isChatVisible = false;
let currentAssistantChatBubbleElement = null;
let currentAccumulator = ''; // Used *only* during streaming of a single message

// --- DOM Elements ---
let containerElement;
let initialSummaryDisplayElement;
let chatBubblesAreaElement;
let chatDisplayElement;
let chatInputAreaElement;
let chatInputElement;
let sendChatBtnElement;
let chatToggleBtnElement;
let summarizeBtnElement;
let explainBtnElement;
let copyBtnElement;
let languageSelectElement;

// --- Initialize Showdown ---
const markdownConverter = new showdown.Converter({
    ghCompatibleHeaderId: true,
    simpleLineBreaks: true
});

// --- Functions ---

function disableButtons(disabled) {
    if (summarizeBtnElement) summarizeBtnElement.disabled = disabled;
    if (explainBtnElement) explainBtnElement.disabled = disabled;
    if (copyBtnElement) copyBtnElement.disabled = disabled;
    if (languageSelectElement) languageSelectElement.disabled = disabled;
    // Disable chat buttons selectively
    if (sendChatBtnElement) sendChatBtnElement.disabled = disabled;
    if (chatInputElement) chatInputElement.disabled = disabled;
    // Don't disable chat toggle based on processing state, only availability
    if (chatToggleBtnElement) chatToggleBtnElement.disabled = !originalArticleText; // Only enable if context exists
}


function scrollToBottom() {
    if (chatDisplayElement) {
        chatDisplayElement.scrollTop = chatDisplayElement.scrollHeight;
    }
}

// Scrolls the CHAT BUBBLE area
function scrollChatToBottom() {
    if (chatBubblesAreaElement) {
        chatBubblesAreaElement.scrollTop = chatBubblesAreaElement.scrollHeight;
    }
}

// Renders chat history bubbles (Does NOT touch initial summary)
function renderChatBubbles() {
    if (!chatBubblesAreaElement) return;
    chatBubblesAreaElement.innerHTML = ''; // Clear previous bubbles
    conversationHistory.forEach(message => {
        addChatBubble(message.role, message.content, false); // Add existing messages
    });
    // Don't scroll here, only scroll when adding new messages dynamically
}

// Adds a bubble to the CHAT BUBBLE area. Returns the element.
function addChatBubble(role, content = "", isStreamingPlaceholder = false) {
     if (!chatBubblesAreaElement) return null;
     const messageDiv = document.createElement('div');
     messageDiv.classList.add(role === 'user' ? 'user-message' : 'assistant-message');

     if (isStreamingPlaceholder && role === 'assistant') {
         messageDiv.innerHTML = '<div class="loader"></div>';
         currentAssistantChatBubbleElement = messageDiv; // Store reference
         currentAccumulator = ''; // Reset accumulator for this stream
     } else if (role === 'user') {
         messageDiv.innerText = content;
     } else { // Render existing assistant chat message
         try {
             messageDiv.innerHTML = markdownConverter.makeHtml(content);
         } catch (e) { messageDiv.innerText = content; }
     }
     chatBubblesAreaElement.appendChild(messageDiv);
     // Scroll when adding user message or placeholder
     if (role === 'user' || isStreamingPlaceholder) {
        scrollChatToBottom();
     }
     return messageDiv;
}

function toggleChatInput() {
    isChatVisible = !isChatVisible;
    // Toggle class on the main container
    if (containerElement) {
         containerElement.classList.toggle('chat-active', isChatVisible);
         console.log("Popup: Toggled chat active state. Is active:", isChatVisible);
    } else {
         console.error("Popup: Container element not found for toggling chat class.");
    }

    if (isChatVisible && chatInputElement) {
        chatInputElement.focus();
        // Scroll may need slight delay to allow layout shift
        setTimeout(scrollChatToBottom, 50);
    }
}

// Handles sending summarize/explain commands
function sendCommand(commandType) {
    if (!port) { /* ... */ return; }

    // --- RESET state ---
    console.log("Popup: Resetting state for new command.");
    originalArticleText = '';
    conversationHistory = [];
    isChatVisible = false;

    // <<< Remove .chat-active class from container >>>
    if (containerElement) {
        containerElement.classList.remove('chat-active');
    }

    if (initialSummaryDisplayElement) initialSummaryDisplayElement.innerHTML = '<div class="loader"></div> Processing...';
    if (chatBubblesAreaElement) chatBubblesAreaElement.innerHTML = ''; // Clear bubbles
    if (chatToggleBtnElement) chatToggleBtnElement.style.display = 'none'; // Hide chat toggle
    currentAssistantChatBubbleElement = null;
    currentAccumulator = '';
    disableButtons(true);
    // --- End RESET ---

    const selectedLanguage = languageSelectElement.value;

    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
        if (!tab || !tab.id) { console.error('no tab found'); return; }

        chrome.scripting.executeScript(
            { target: { tabId: tab.id }, func: () => window.getSelection().toString(), },
            (selection) => {
                if (chrome.runtime.lastError) {
                    console.error('chrome.runtime.lastError', chrome.runtime.lastError);
                    return;
                }
                const selectedText = selection?.[0]?.result?.trim();
                let message = { language: selectedLanguage };
                let shouldSendMessage = true;
                if (selectedText) {
                       message.command = commandType === 'summarize' ? "summarizeSelectedText" : "explainSelectedText";
                       message.text = selectedText;
                       originalArticleText = selectedText;
                } else if (tab.url && !tab.url.startsWith('http') && !tab.url.startsWith('file')) {
                     /* ... skip non-webpage ... */
                     shouldSendMessage = false;
                } else if (tab.url && tab.url.toLowerCase().endsWith(".pdf")) {
                    shouldSendMessage = false;
                    originalArticleText = ''; // <<< Reset, wait for PDF content
                    // Content script needs to send content back to background
                    // Background needs to potentially forward it to popup if needed? Or just use it for summary.
                    // Let's simplify: Background gets PDF content, generates summary, sends summary.
                    // Popup receives summary ('complete'), stores THAT as the FIRST history item,
                    // but doesn't have original PDF text unless BG sends it via 'context'.
                    // --- Let's have BG send PDF context too ---
                    chrome.storage.local.set({ pdfProcessingInfo: { language: selectedLanguage, mode: commandType } })
                        .then(() => chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["getContentScript.js"] }))
                        .catch(err => { /* ... */ });
                } else {
                    // Whole page summary/explanation
                    message.command = commandType === 'summarize' ? "summarize" : "explain";
                    originalArticleText = ''; // <<< Reset, wait for 'context' action from background
                    console.log(`Popup: Using whole page. Sending '${message.command}' message.`);
                }

                if (shouldSendMessage && port) {
                     console.log("Popup: Sending message to background:", message);
                     try { port.postMessage(message); } catch(e) { /* ... port error handling ... */ }
                } else if (shouldSendMessage && !port) { /* ... port error handling ... */ }
                 else if (!shouldSendMessage && contextSource === 'pdf') {
                     // Wait for content script to send message for PDF
                     console.log("Popup: Waiting for PDF content script...");
                 }
            } // End selection callback
        ); // End executeScript
    }).catch(error => {
         console.error("Popup: Error querying tabs:", error);
         summaryElement.innerText = `Error: ${error.message}`;
         disableButtons(false);
         accumulatedRawText = ''; // Clear on error
    });
}

// Handles sending a chat message
function sendChatMessage() {
    if (!port || !chatInputElement || !originalArticleText) { // <<< Check originalArticleText
         console.error("Popup: Cannot send chat. Port, input, or ORIGINAL ARTICLE TEXT missing.");
         if (!originalArticleText) {
             // Maybe show error in UI
             console.error("Original article context is missing. Cannot ask questions.");
         }
         return;
     }
     const question = chatInputElement.value.trim();
     if (!question) return;

     // Add user question to history and display in BUBBLE AREA
     conversationHistory.push({ role: 'user', content: question });
     addChatBubble('user', question); // Display user bubble

     chatInputElement.value = '';
     disableButtons(true);

     // Add assistant placeholder in BUBBLE AREA
     addChatBubble('assistant', "", true);

     // Send ORIGINAL ARTICLE and CHAT HISTORY to background
     const message = {
         command: "chatWithContext",
         context: originalArticleText,
         history: conversationHistory, // Q&A history only
         language: languageSelectElement.value
     };

     console.log("Popup: Sending chat request to background:", message);
     try {
         port.postMessage(message);
     } catch(e) {
         console.error("Popup: Error sending chat message via port:", e);
         if (currentAssistantChatBubbleElement) {
             currentAssistantChatBubbleElement.innerText = "Error sending message.";
         }
         disableButtons(false); // Re-enable buttons on error
     }
}

// --- Initialize ---
document.addEventListener('DOMContentLoaded', () => {
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

    // --- Event Listeners ---
    summarizeBtnElement.addEventListener('click', () => sendCommand('summarize'));
    explainBtnElement.addEventListener('click', () => sendCommand('explain'));
    chatToggleBtnElement.addEventListener('click', toggleChatInput);
    sendChatBtnElement.addEventListener('click', sendChatMessage);
    // Allow sending chat with Enter key in textarea
    chatInputElement.addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) { // Enter sends, Shift+Enter adds newline
            e.preventDefault(); // Prevent newline
            sendChatMessage();
        }
    });

    copyBtnElement.addEventListener('click', function () {
        let textToCopy = "";
        if(initialSummaryDisplayElement) textToCopy += initialSummaryDisplayElement.innerText;
        if(chatBubblesAreaElement && chatBubblesAreaElement.innerText.trim()) {
            textToCopy += (textToCopy ? "\n\n--- Chat ---\n" : "") + chatBubblesAreaElement.innerText;
        }
        if (textToCopy && textToCopy !== "Summary/Explanation will appear here...") {
            navigator.clipboard.writeText(textToCopy).then(() => { /* ... */ }).catch((err) => { /* ... */ });
        }
    });

    // --- Establish Connection ---
    try {
        port = chrome.runtime.connect({ name: "popup" });
        console.log("Popup: Connection established.");

        port.onMessage.addListener(function (message) {
            // console.log("Popup: Message received:", message.action);

            // Update applies either to initial summary OR chat bubble placeholder
            switch (message.action) {
                case "update":
                    currentAccumulator += message.summary;
                    if (currentAssistantChatBubbleElement) { // Updating a chat bubble
                        currentAssistantChatBubbleElement.innerText = currentAccumulator;
                         scrollChatToBottom();
                    } else if (initialSummaryDisplayElement){ // Updating initial summary
                         // Update plain text during streaming for initial summary
                        initialSummaryDisplayElement.innerText = currentAccumulator;
                    }
                    break;

                case "complete":
                    const completedText = currentAccumulator;
                    currentAccumulator = '';

                    if (currentAssistantChatBubbleElement) { // Completing a CHAT response
                        // Finalize rendering in the bubble area
                        try {
                            currentAssistantChatBubbleElement.innerHTML = markdownConverter.makeHtml(completedText);
                         } catch (e) { currentAssistantChatBubbleElement.innerText = completedText; }
                        // Add assistant chat response to Q&A history
                        conversationHistory.push({ role: 'assistant', content: completedText });
                        currentAssistantChatBubbleElement = null; // Clear ref
                    } else if (initialSummaryDisplayElement) { // Completing the INITIAL summary/explanation
                        // Finalize rendering in the summary display area
                        try {
                            initialSummaryDisplayElement.innerHTML = markdownConverter.makeHtml(completedText);
                        } catch (e) { initialSummaryDisplayElement.innerText = completedText; }
                        // Initialize Q&A history as empty
                        conversationHistory = [];
                        // Check context and enable chat toggle
                        if (!originalArticleText) { console.warn("Popup: Initial complete, but originalArticleText missing!"); }
                        if (chatToggleBtnElement && originalArticleText) {
                            chatToggleBtnElement.style.display = 'inline-block';
                            chatToggleBtnElement.disabled = false;
                        } else if (chatToggleBtnElement) {
                            chatToggleBtnElement.style.display = 'none';
                        }
                    }
                    disableButtons(false);
                    scrollChatToBottom(); // Ensure chat is scrolled down if visible
                    break;

                case "context":
                     originalArticleText = message.content;
                     break;

                case "error":
                    const errorMsg = "Error: " + message.message;
                    if (currentAssistantChatBubbleElement) {
                        currentAssistantChatBubbleElement.innerText = errorMsg; // Show error in placeholder
                        currentAssistantChatBubbleElement = null; // Clear ref
                    } else {
                        chatDisplayElement.innerText = errorMsg; // Show error for initial request
                    }
                    disableButtons(false);
                    currentAccumulator = '';
                    // Optionally clear history/context on error?
                    break;
                case "aborted":
                     const abortMsg = "Operation cancelled.";
                      if (currentAssistantChatBubbleElement) {
                        currentAssistantChatBubbleElement.innerText = abortMsg;
                        currentAssistantChatBubbleElement = null;
                    } else {
                        chatDisplayElement.innerText = abortMsg;
                    }
                    disableButtons(false);
                    currentAccumulator = '';
                    break;
                default:
                     console.warn("Popup: Received unknown message action:", message.action);
            }
        });

        port.onDisconnect.addListener(() => {
            console.warn("Popup: Disconnected from background.");
            port = null;
            currentAccumulator = '';
            conversationHistory = [];
            if (containerElement) containerElement.classList.remove('chat-active'); // Also remove on disconnect
            isChatVisible = false;
            if (chatDisplayElement) { /* Update UI */ }
            disableButtons(true);
        });

        // Initial state after connection
        disableButtons(false);
        if (chatToggleBtnElement) chatToggleBtnElement.style.display = 'none';
        // Ensure class isn't present on load
        if (containerElement) containerElement.classList.remove('chat-active');


    } catch (error) {
        console.error("Popup: Failed to connect to background:", error);
        if (chatDisplayElement) chatDisplayElement.innerText = "Error connecting to background.";
        disableButtons(true);
    }
});