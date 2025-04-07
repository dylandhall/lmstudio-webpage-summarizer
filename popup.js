// popup.js

let port = null;
let accumulatedRawText = ''; // <--- ADD: Variable to store raw text

try {
    port = chrome.runtime.connect({ name: "popup" });
    // console.log("Popup: Connection established.");

    port.onMessage.addListener(function (message) {
        // console.log("Popup: Message received from background:", message); // Less noisy log
        const summaryElement = document.getElementById("summary");

        if (!summaryElement) {
             console.error("Popup: Summary element not found!");
             return;
        }

        // Clear "Processing..." message on first update
        if (message.action !== 'complete' && summaryElement.innerHTML.includes("Processing...")) {
             summaryElement.innerText = ""; // Use innerText now for display
             accumulatedRawText = ''; // Reset accumulator too
        }

        switch (message.action) {
            case "update":
                accumulatedRawText += message.summary; // <--- Append to raw text variable
                summaryElement.innerText = accumulatedRawText; // <--- Update display using innerText
                break;
            case "complete":
                disableButtons(false);
                try {
                    const converter = new showdown.Converter({
                         ghCompatibleHeaderId: true,
                         simpleLineBreaks: true // This should now work correctly
                    });
                    // Use the ACCUMULATED RAW TEXT as input for Showdown
                    summaryElement.innerHTML = converter.makeHtml(accumulatedRawText); // <--- Use accumulatedRawText
                    // Optional: Clear the accumulator after processing is complete
                    // accumulatedRawText = ''; // Might clear too early if user interacts again quickly? Decide based on UX.
                } catch(e) {
                     console.error("Showdown conversion failed:", e);
                     // Fallback: Display the raw accumulated text if conversion fails
                     summaryElement.innerText = accumulatedRawText;
                }
                // Don't clear accumulatedRawText here if you want copy to work after completion.
                break;
            case "error":
                summaryElement.innerText = "Error: " + message.message;
                disableButtons(false);
                accumulatedRawText = ''; // Clear accumulator on error
                break;
            case "aborted":
                 summaryElement.innerText = "Operation cancelled.";
                 disableButtons(false);
                 accumulatedRawText = ''; // Clear accumulator on abort
                 break;
            default:
                 console.warn("Popup: Received unknown message action:", message.action);
        }
    });

    port.onDisconnect.addListener(() => {
        console.warn("Popup: Disconnected from background.");
        port = null;
        accumulatedRawText = ''; // Clear accumulator on disconnect
        const summaryElement = document.getElementById("summary");
        // ... (rest of disconnect logic)
        disableButtons(true);
    });

} catch (error) {
    console.error("Popup: Failed to connect to background:", error);
    accumulatedRawText = ''; // Clear accumulator on connect error
    // ... (rest of connect error logic)
    disableButtons(true);
}


// Function to disable/enable buttons (remains the same)
function disableButtons(disabled) { /* ... */ }

// Function to send commands (IMPORTANT modification)
function sendCommand(commandType) {
    // console.log(`Popup: sendCommand called with type: ${commandType}`);
    if (!port) { /* ... error handling ... */ return; }

    // --- RESET state before starting ---
    accumulatedRawText = ''; // <--- Reset accumulator at the START of a new command
    const summaryElement = document.getElementById("summary");
    summaryElement.innerHTML = '<div class="loader"></div> Processing...'; // Show loader
    disableButtons(true);
    // --- End RESET ---

    const selectedLanguage = document.getElementById("languageSelect").value;
    // ... (rest of sendCommand logic remains the same) ...
     chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
        if (!tab || !tab.id) { /* ... error handling ... */ return; }
        // console.log("Popup: Got active tab:", tab.url);

        chrome.scripting.executeScript(
            { target: { tabId: tab.id }, func: () => window.getSelection().toString(), },
            (selection) => {
                if (chrome.runtime.lastError) { /* ... error handling ... */ return; }

                const selectedText = selection?.[0]?.result;
                let message = { language: selectedLanguage };
                let shouldSendMessage = true;

                if (selectedText && selectedText.trim().length > 0) {
                    // console.log("Popup: Using selected text.");
                    message.command = commandType === 'summarize' ? "summarizeSelectedText" : "explainSelectedText";
                    message.text = selectedText;
                } else if (tab.url && !tab.url.startsWith('http') && !tab.url.startsWith('file')) {
                     // console.log("Popup: Skipping non-http/file page.");
                     summaryElement.innerText = "Cannot process this type of page.";
                     disableButtons(false);
                     shouldSendMessage = false;
                     accumulatedRawText = ''; // Clear if we error out early
                } else if (tab.url && tab.url.toLowerCase().endsWith(".pdf")) {
                    // console.log("Popup: Handling PDF page.");
                    summaryElement.innerHTML = '<div class="loader"></div> Processing PDF...';
                    accumulatedRawText = ''; // Clear for PDF processing start
                    shouldSendMessage = false;

                     // console.log("Popup: Storing PDF info and injecting content script.");
                    chrome.storage.local.set({ pdfProcessingInfo: { language: selectedLanguage, mode: commandType } })
                        .then(() => chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["getContentScript.js"] }))
                        .catch(err => {
                            console.error("Popup: Error setting storage or injecting PDF script:", err);
                            summaryElement.innerText = `Error processing PDF: ${err.message}.`;
                            disableButtons(false);
                            accumulatedRawText = ''; // Clear on error
                        });

                } else {
                    // console.log("Popup: Using whole page.");
                    message.command = commandType === 'summarize' ? "summarize" : "explain";
                }

                if (shouldSendMessage && port) {
                     // console.log("Popup: Sending message to background:", message);
                     try { port.postMessage(message); } catch(e) { /* ... error handling ... */ }
                } else if (shouldSendMessage && !port) { /* ... error handling ... */ }
            }
        );
    }).catch(error => {
         console.error("Popup: Error querying tabs:", error);
         summaryElement.innerText = `Error: ${error.message}`;
         disableButtons(false);
         accumulatedRawText = ''; // Clear on error
    });
}

// Attach Event Listeners (remains the same)
document.getElementById("summarizeBtn").addEventListener("click", () => sendCommand('summarize'));
document.getElementById("explainBtn").addEventListener("click", () => sendCommand('explain'));
document.getElementById("copyBtn").addEventListener("click", function () {
    const summaryElement = document.getElementById("summary");
    if (!summaryElement) return;

    // --- IMPORTANT: Use accumulated text for copy after completion ---
    // If Showdown potentially adds HTML structure, innerText might be better for copying plain text
    // Decide based on desired copy behavior. Using innerText is usually safer for plain text copy.
    // const textToCopy = accumulatedRawText; // Option 1: Copy raw accumulated text
    const textToCopy = summaryElement.innerText; // Option 2: Copy the rendered text (usually preferred)

    if (textToCopy && textToCopy !== "Summary will appear here..." && !summaryElement.innerHTML.includes("Processing...") && !textToCopy.startsWith("Error:")) {
        navigator.clipboard.writeText(textToCopy).then(function () { /* ... feedback ... */ }).catch(function (err) { /* ... */ });
    } else { /* ... */ }
});


// Initial State (remains the same)
if (port) { disableButtons(false); } else { /* Connection failed */ }