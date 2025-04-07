// Default values - these are used if no settings are found in storage
import { defaultModel, defaultSummarizePrompt, defaultExplainPrompt } from './defaults.js';

// Function to extract the content of the active tab WITHOUT modifying the original page
function extractContent() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs || tabs.length === 0 || !tabs[0].id) {
        console.error("No active tab found or tab has no ID.");
        return reject("No active tab found.");
      }
      const tabId = tabs[0].id;

      chrome.scripting.executeScript(
        {
          target: { tabId: tabId },
          // IMPORTANT: This function now operates on a CLONE of the body
          // to avoid modifying the user's visible page.
          function: () => {
            try {
              // 1. Create a deep clone of the document's body in memory
              const clonedBody = document.body.cloneNode(true);

              // 2. Select elements to remove FROM THE CLONE
              const selectorsToRemove = "header, footer, nav, aside, .ad, .advertisement, .popup, .modal, .sidebar, script, style, link, [aria-hidden='true'], noscript, iframe, svg, canvas, video, audio, button, input, select, textarea";
              clonedBody.querySelectorAll(selectorsToRemove)
                       .forEach((el) => el.remove());

              // 3. Attempt to find the main content area within THE CLONE
              // Prioritize more specific semantic elements
              const mainContentSelectors = 'main, article, [role="main"], #main, #content, .main, .content, .post-body, .entry-content';
              let mainContentElement = clonedBody.querySelector(mainContentSelectors);

              // 4. Extract innerText FROM THE CLONE
              let text;
              if (mainContentElement) {
                // console.log("Extracting text from main content clone");
                text = mainContentElement.innerText;
              } else {
                // console.log("Extracting text from full body clone (fallback)");
                text = clonedBody.innerText; // Fallback to the cleaned body clone
              }

              // Basic whitespace cleanup
              return text.replace(/\s\s+/g, ' ').trim();

            } catch (e) {
              console.error("Error during content extraction script:", e);
              // Fallback to basic body text if cloning/cleaning fails
              return document.body.innerText.replace(/\s\s+/g, ' ').trim();
            }
          },
        },
        (results) => {
          if (chrome.runtime.lastError) {
            console.error("Scripting Error:", chrome.runtime.lastError.message);
            return reject(`Failed to execute content extraction script: ${chrome.runtime.lastError.message}`);
          }
          // Check if the result exists and has content
          if (results && results[0] && typeof results[0].result === 'string' && results[0].result.trim().length > 0) {
            console.log("Successfully extracted content (length: " + results[0].result.length + ").");
            resolve(results[0].result);
          } else if (results && results[0] && results[0].result === '') {
             console.warn("Extraction resulted in empty string. The page might have little text content after cleaning.");
             // Attempt a simpler extraction as a last resort
             chrome.scripting.executeScript(
               {
                 target: { tabId: tabId },
                 function: () => document.body.innerText.replace(/\s\s+/g, ' ').trim()
               },
               (fallbackResults) => {
                 if (chrome.runtime.lastError || !fallbackResults || !fallbackResults[0] || typeof fallbackResults[0].result !== 'string') {
                   console.error("Final fallback content extraction failed:", chrome.runtime.lastError?.message);
                   return reject("Failed to extract any meaningful content.");
                 }
                 if (fallbackResults[0].result.trim().length === 0) {
                    console.error("Even basic body.innerText extraction yielded empty string.");
                    return reject("Page seems to contain no extractable text.");
                 }
                 console.log("Used final fallback body.innerText extraction.");
                 resolve(fallbackResults[0].result);
               }
             );
          } else {
            console.error("Content extraction script returned unexpected result:", results);
            reject("Failed to extract content: script did not return valid text.");
          }
        }
      );
    });
  });
}

// Function to get settings from storage or use defaults
function getSettings() {
    return new Promise((resolve) => {
        chrome.storage.sync.get({
            modelName: defaultModel,
            summarizePrompt: defaultSummarizePrompt,
            explainPrompt: defaultExplainPrompt
        }, (items) => {
            resolve(items);
        });
    });
}

// Function to send content to the API and stream the response
async function summarizeContent(contentType, content, lang, mode) {
  try {
    // Get settings from storage
    const settings = await getSettings();
    const modelName = settings.modelName;
    let baseSummarizePrompt = settings.summarizePrompt;
    let baseExplainPrompt = settings.explainPrompt;

    // If it is a webpage, extract content first
    if (contentType === "web") {
      content = ""; // Reset content
      content = await extractContent(); // This might reject
      if (!content || content.trim().length === 0) {
          console.error("Extracted content is empty.");
          throw new Error("No content extracted from the page to summarize/explain.");
      }
    } else if (!content || content.trim().length === 0) {
        console.error("Received empty content for processing.");
        throw new Error("No content provided to summarize/explain.");
    }


    // Replace {lang} placeholder in the selected prompt
    let systemPromptTemplate = mode === "summarize"
      ? baseSummarizePrompt
      : baseExplainPrompt;

    let systemCommand = systemPromptTemplate.replace(/{lang}/g, lang); // Use replaceAll if targeting newer environments, or regex for broader compatibility

    // console.log(`Using Model: ${modelName}`);
    // console.log(`System Command: ${systemCommand}`);
    // console.log(`Content to process (first 500 chars): ${content.substring(0, 500)}...`); // For debugging

    const response = await fetch("http://localhost:1234/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelName, // Use model name from settings
        messages: [
          { role: "system", content: systemCommand },
          { role: "user", content: content.trim() }, // Trim whitespace
        ],
        temperature: 0.3,
        max_tokens: -1, // Or set a reasonable limit like 1024 / 2048 if -1 causes issues
        stream: true,
      }),
    });

    if (!response.ok) {
        const errorBody = await response.text();
        console.error(`API request failed with status ${response.status}: ${errorBody}`);
        throw new Error(`API Error: ${response.status} - ${response.statusText}. Check LM Studio console.`);
    }
    if (!response.body) {
         throw new Error("Response body is null.");
    }


    let summary = "";
    const reader = response.body.getReader();
    let decoder = new TextDecoder();
    let buffer = ""; // Buffer to handle incomplete JSON chunks

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        // console.log("Stream finished.");
        chrome.runtime.sendMessage({ action: "complete", summary: "" }).catch(e => console.log("Error sending complete message:", e)); // Indicate completion
        break; // Exit loop
      }

      buffer += decoder.decode(value, { stream: true }); // Decode chunk and append to buffer
     // console.log("Received chunk, buffer:", buffer); // Debugging incoming data stream

      // Process buffer line by line (server-sent events format)
      let lines = buffer.split('\n');
      buffer = lines.pop(); // Keep the potentially incomplete last line in the buffer

      for (const line of lines) {
          if (line.startsWith("data: ")) {
              const jsonStr = line.substring(6).trim(); // Remove "data: " prefix
             // console.log("Processing JSON line:", jsonStr); // Debugging JSON data
              if (jsonStr === "[DONE]") {
                // Special signal from some OpenAI-compatible servers
                // console.log("Received [DONE] signal.");
                // We already handle 'done' from reader.read(), but good to acknowledge
                continue; // Skip to next line/chunk
              }
              if (!jsonStr) {
                  continue; // Skip empty lines
              }
              try {
                const result = JSON.parse(jsonStr);
                if (
                  result &&
                  result.choices &&
                  result.choices[0] &&
                  result.choices[0].delta &&
                  result.choices[0].delta.content
                ) {
                  const contentChunk = result.choices[0].delta.content;
                  summary += contentChunk;
                  // Send update only if there's content
                  if(contentChunk) {
                    chrome.runtime.sendMessage({
                      action: "update",
                      summary: contentChunk, // Send only the new chunk
                    }).catch(e => console.log("Error sending update message:", e));
                  }
                }
              } catch (error) {
                console.warn("Failed to parse JSON chunk:", jsonStr, "Error:", error);
                // Don't discard buffer here, might be needed for next chunk
              }
          }
      }
    }
     // console.log("Final summary:", summary); // Debugging final result
    // Although we stream updates, returning the full summary might be useful
    // if the caller needs it, but popup.js primarily uses streamed updates.
    return summary;

  } catch (error) {
    console.error("Error in summarizeContent:", error);
    // Send error message back to popup
    chrome.runtime.sendMessage({ action: "error", message: error.message || "An unknown error occurred during processing." })
        .catch(e => console.log("Error sending error message:", e));
    return `Error: ${error.message}`; // Also return error string
  }
}

// Listener for messages from popup or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.command === "summarize" || message.command === "explain" ||
      message.command === "summarizeSelectedText" || message.command === "explainSelectedText" ||
      message.command === "sendPdfContent")
  {
      const mode = message.command.toLowerCase().includes("explain") ? "explain" : "summarize";
      let contentType = "web";
      let contentToProcess = "";

      if (message.command.includes("SelectedText")) {
          contentType = "text";
          contentToProcess = message.text;
      } else if (message.command === "sendPdfContent") {
          contentType = "pdf";
          contentToProcess = message.content;
      }
      // For "summarize" or "explain", contentType remains "web" and contentToProcess is empty (will be extracted)

      // Use a Promise to handle the async operation and keep the message channel open
      summarizeContent(contentType, contentToProcess, message.language || 'en', mode)
          .then(summary => {
              // Note: The primary communication is via streaming messages ('update', 'complete', 'error').
              // This sendResponse might only send the *final* summary after the stream is done,
              // or potentially race with the stream completion. It's less critical now.
              // Consider removing sendResponse if popup only relies on stream messages.
             // sendResponse({ status: 'completed', summary: summary }); // Example response
          })
          .catch(error => {
              console.error(`Error processing command ${message.command}:`, error);
              // Error is already sent via message in summarizeContent's catch block
              // sendResponse({ status: 'error', message: error.message }); // Optionally send error via sendResponse too
          });

      return true; // Indicate that the response is asynchronous
  }
  // Handle other potential messages if needed
  return false; // Indicate synchronous response or no response needed for other messages
});

console.log("Background service worker started.");