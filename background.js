// background.js

import { defaultModel, defaultSummarizePrompt, defaultExplainPrompt } from './defaults.js';

let currentAbortController = null;
let popupPort = null;

// --- Function Definitions (extractContent, getSettings, summarizeContent) ---
// Keep these functions as they were defined in the previous working version
// Function to extract content
function extractContent() {
    // ... (implementation using cloneNode) ...
    return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs || tabs.length === 0 || !tabs[0].id) {
        console.error("BG: No active tab found or tab has no ID.");
        return reject("No active tab found.");
      }
      const tabId = tabs[0].id;
      // console.log("BG: Attempting script execution on tab:", tabId);

      chrome.scripting.executeScript(
        {
          target: { tabId: tabId },
          function: () => {
            // console.log("CS: Extract script executing..."); // CS = Content Script context
            try {
              const clonedBody = document.body.cloneNode(true);
              const selectorsToRemove = "header, footer, nav, aside, .ad, .advertisement, .popup, .modal, .sidebar, script, style, link, [aria-hidden='true'], noscript, iframe, svg, canvas, video, audio, button, input, select, textarea";
              clonedBody.querySelectorAll(selectorsToRemove)
                       .forEach((el) => el.remove());
              const mainContentSelectors = 'main, article, [role="main"], #main, #content, .main, .content, .post-body, .entry-content';
              let mainContentElement = clonedBody.querySelector(mainContentSelectors);
              let text;
              if (mainContentElement) {
                text = mainContentElement.innerText;
              } else {
                text = clonedBody.innerText;
              }
              const cleanedText = text.replace(/\s\s+/g, ' ').trim();
              // console.log(`CS: Extraction complete, length: ${cleanedText.length}`);
              return cleanedText;
            } catch (e) {
              console.error("CS: Error during content extraction script:", e);
              // Fallback to basic body text if cloning/cleaning fails
              return document.body.innerText.replace(/\s\s+/g, ' ').trim();
            }
          },
        },
        (results) => {
          if (chrome.runtime.lastError) {
            console.error("BG: Scripting Error:", chrome.runtime.lastError.message);
            return reject(`Failed to execute content extraction script: ${chrome.runtime.lastError.message}`);
          }
          if (results && results[0] && typeof results[0].result === 'string') {
             if(results[0].result.trim().length > 0) {
                // console.log("BG: Successfully extracted content (length: " + results[0].result.length + ").");
                resolve(results[0].result);
             } else {
                 console.warn("BG: Extraction resulted in empty string. Attempting fallback.");
                 chrome.scripting.executeScript( // Fallback
                   { target: { tabId: tabId }, function: () => document.body.innerText.replace(/\s\s+/g, ' ').trim() },
                   (fallbackResults) => {
                     if (chrome.runtime.lastError || !fallbackResults || !fallbackResults[0] || typeof fallbackResults[0].result !== 'string') {
                       console.error("BG: Final fallback content extraction failed:", chrome.runtime.lastError?.message);
                       return reject("Failed to extract any meaningful content.");
                     }
                     if (fallbackResults[0].result.trim().length === 0) {
                        console.error("BG: Even basic body.innerText extraction yielded empty string.");
                        return reject("Page seems to contain no extractable text.");
                     }
                     // console.log("BG: Used final fallback body.innerText extraction.");
                     resolve(fallbackResults[0].result);
                   }
                 );
             }
          } else {
            console.error("BG: Content extraction script returned unexpected result:", results);
            reject("Failed to extract content: script did not return valid text.");
          }
        }
      );
    });
  });
}

// Function to get settings
function getSettings() {
    // ... (implementation remains the same) ...
     return new Promise((resolve) => {
        chrome.storage.sync.get({
            modelName: defaultModel,
            summarizePrompt: defaultSummarizePrompt,
            explainPrompt: defaultExplainPrompt
        }, (items) => { resolve(items); });
    });
}

// Function to summarize/explain (API call)
async function summarizeContent(contentType, content, lang, mode, abortSignal) {
    // ... (implementation remains the same, includes fetch with signal, stream reading, error handling) ...
     try {
        // console.log(`BG: summarizeContent called. Type: ${contentType}, Lang: ${lang}, Mode: ${mode}`);
        const settings = await getSettings();
        const modelName = settings.modelName;
        let baseSummarizePrompt = settings.summarizePrompt;
        let baseExplainPrompt = settings.explainPrompt;

        // Add a timeout for content extraction? Could be complex. Start without it.
        if (contentType === "web") {
            // console.log("BG: Extracting web content...");
            content = ""; // Reset content
            try {
                content = await extractContent(); // This might reject
            } catch (extractError) {
                 console.error("BG: Content extraction failed:", extractError);
                 throw new Error(`Content extraction failed: ${extractError.message || extractError}`); // Re-throw to be caught below
            }
            // console.log(`BG: Web content extracted (${content.length} chars).`);
            if (!content || content.trim().length === 0) {
                console.error("BG: Extracted content is empty.");
                throw new Error("No content extracted from the page to summarize/explain.");
            }
        } else if (!content || content.trim().length === 0) {
            console.error("BG: Received empty content for processing.");
            throw new Error("No content provided to summarize/explain.");
        } else {
             // console.log(`BG: Using provided content (${content.length} chars). Type: ${contentType}`);
        }


        let systemPromptTemplate = mode === "summarize" ? baseSummarizePrompt : baseExplainPrompt;
        let systemCommand = systemPromptTemplate.replace(/{lang}/g, lang);

        // console.log(`BG: Using Model: ${modelName}`);
        // // console.log(`BG: System Command: ${systemCommand.substring(0, 100)}...`);
        // console.log("BG: Preparing fetch request to API...");

        const response = await fetch("http://localhost:1234/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", },
          body: JSON.stringify({
            model: modelName,
            messages: [ { role: "system", content: systemCommand }, { role: "user", content: content.trim() }, ],
            temperature: 0.3, max_tokens: -1, stream: true,
          }),
          signal: abortSignal
        });

        // console.log(`BG: Fetch response status: ${response.status}`);

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`BG: API request failed. Status: ${response.status}, Body: ${errorBody}`);
            throw new Error(`API Error: ${response.status} - ${response.statusText}. Check LM Studio console.`);
        }
        if (!response.body) {
             console.error("BG: Response body is null.");
             throw new Error("Response body is null.");
        }


        // console.log("BG: Starting to read API response stream...");
        let summary = "";
        const reader = response.body.getReader();
        let decoder = new TextDecoder();
        let buffer = "";
        let chunksReceived = 0;

        while (true) {
          if (abortSignal.aborted) {
              // console.log("BG: Aborting fetch read loop.");
              reader.cancel().catch(e => console.warn("BG: Error cancelling reader:", e)); // Attempt to cancel
              throw new DOMException('Aborted by user', 'AbortError');
          }

          const { done, value } = await reader.read();

          if (done) {
            // console.log("BG: API stream finished.");
            if (!abortSignal.aborted) {
                safeSendMessage({ action: "complete", summary: "" }); // Send final accumulated summary if needed? Or just signal done.
            }
            break;
          }

          chunksReceived++;
          buffer += decoder.decode(value, { stream: true });
          // console.log(`BG: Received stream chunk ${chunksReceived}. Buffer size: ${buffer.length}`); // Can be very noisy

          let lines = buffer.split('\n');
          buffer = lines.pop(); // Keep incomplete line

          for (const line of lines) {
              if (line.startsWith("data: ")) {
                  const jsonStr = line.substring(6).trim();
                  if (jsonStr === "[DONE]" || !jsonStr) continue;
                  try {
                    const result = JSON.parse(jsonStr);
                    if (result?.choices?.[0]?.delta?.content) {
                      const contentChunk = result.choices[0].delta.content;
                      summary += contentChunk;
                      if (contentChunk && !abortSignal.aborted) {
                        // console.log("BG: Sending 'update' message to popup."); // Noisy
                        safeSendMessage({ action: "update", summary: contentChunk, });
                      }
                    }
                  } catch (error) { console.warn("BG: Failed to parse JSON chunk:", jsonStr, "Error:", error); }
              }
          }
        }
        // console.log(`BG: summarizeContent finished successfully. Total Chunks: ${chunksReceived}`);
        return summary;

      } catch (error) {
          if (error.name === 'AbortError') {
              // console.log("BG: Fetch aborted successfully in summarizeContent.");
              safeSendMessage({ action: "aborted" });
              return "Operation aborted.";
          } else {
              console.error("BG: Error caught in summarizeContent:", error);
              safeSendMessage({ action: "error", message: error.message || "An unknown error occurred during processing." });
              // Ensure the promise rejects or returns an error string
              // throw error; // Re-throwing might be better if caller needs to know
              return `Error: ${error.message}`;
          }
      } finally {
          // console.log("BG: summarizeContent finally block executing.");
          if (currentAbortController && currentAbortController.signal === abortSignal) {
              currentAbortController = null;
              // console.log("BG: Cleared current AbortController.");
          }
      }
}

// Function to safely send messages to popup
function safeSendMessage(message) {
    // ... (implementation remains the same) ...
     if (popupPort) {
        try {
            // console.log("BG: Sending message to popup:", message.action);
            popupPort.postMessage(message);
        } catch (error) {
            // console.log("BG: Failed to send message to popup (likely closed):", error.message);
            popupPort = null;
             if (currentAbortController) {
                 // console.log("BG: Aborting request due to failed message send (popup closed).");
                 currentAbortController.abort();
                 currentAbortController = null;
             }
        }
    } else {
        // console.log("BG: Skipping message send, popup not connected:", message.action);
        if (currentAbortController && message.action !== 'aborted') {
             // console.log("BG: Aborting request because popup is already disconnected.");
             currentAbortController.abort();
             currentAbortController = null;
        }
    }
}

// --- Connection Handling ---
chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "popup") return; // Ignore other connections

    popupPort = port;
    // console.log("BG: Popup connected.");

    // *** Attach message listener HERE ***
    port.onMessage.addListener((message) => {
        // console.log("BG: Message received from popup via port:", message);

        // --- Check if it's a command to process ---
        if (message.command === "summarize" || message.command === "explain" ||
            message.command === "summarizeSelectedText" || message.command === "explainSelectedText" ||
            message.command === "sendPdfContent" || message.command === "pdfProcessingError") // Also handle PDF errors from content script
        {
             // Handle PDF error from content script separately
            if (message.command === "pdfProcessingError") {
                console.error("BG: Received PDF Processing Error from content script:", message.message);
                safeSendMessage({ action: "error", message: `PDF Error: ${message.message}` });
                return; // Stop processing this message further
            }

            // --- Abort previous request ---
            if (currentAbortController) {
                // console.log("BG: New request received, aborting previous one.");
                currentAbortController.abort();
                // Don't nullify here, let the finally block in summarizeContent do it
            }
            currentAbortController = new AbortController();
            const signal = currentAbortController.signal;
            // -------------

            const mode = message.command.toLowerCase().includes("explain") ? "explain" : "summarize";
            let contentType = "web";
            let contentToProcess = "";

            if (message.command.includes("SelectedText")) {
                contentType = "text";
                contentToProcess = message.text;
            } else if (message.command === "sendPdfContent") {
                contentType = "pdf";
                contentToProcess = message.content;
            } // Else: command is "summarize" or "explain", contentType remains "web"

            // console.log(`BG: Preparing to call summarizeContent. Type: ${contentType}, Mode: ${mode}, Lang: ${message.language}`);

            // Call summarizeContent asynchronously
            summarizeContent(contentType, contentToProcess, message.language || 'en', mode, signal)
                .then(result => {
                    // Logging is done inside summarizeContent now for completion/abort
                    // console.log(`BG: summarizeContent promise resolved. Result type: ${typeof result}`);
                })
                .catch(error => {
                     // Errors should be caught and handled within summarizeContent or during extraction
                     // This catch is mainly for unexpected errors before or after summarizeContent async call
                    if (error.name !== 'AbortError') { // Don't log aborts as top-level errors here
                        console.error(`BG: Uncaught error in message handling for command ${message.command}:`, error);
                         // Maybe send a generic error if one wasn't sent already
                        safeSendMessage({ action: "error", message: "An unexpected background error occurred." });
                    }
                });
        } else {
            console.warn("BG: Received unknown message command via port:", message.command);
        }
    }); // End of port.onMessage.addListener

    port.onDisconnect.addListener(() => {
        // console.log("BG: Popup disconnected.");
        popupPort = null;

        if (currentAbortController) {
            // console.log("BG: Popup closed, aborting current request.");
            currentAbortController.abort();
            currentAbortController = null;
        }
    });
});

// console.log("Background service worker (module) started or woke up.");