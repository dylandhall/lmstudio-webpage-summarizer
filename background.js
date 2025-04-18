// background.js

// Import defaults from the central file
import { defaultModel, defaultSummarizePrompt, defaultExplainPrompt } from './defaults.js';

// Global variable to hold the controller for the CURRENTLY active fetch request
let currentAbortController = null;
// Keep track of the popup port to know when it disconnects
let popupPort = null;

// Function to extract content using cloneNode to avoid modifying the live page
function extractContent() {
    return new Promise((resolve, reject) => {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            if (!tabs || tabs.length === 0 || !tabs[0].id) {
                console.error("BG: No active tab found or tab has no ID.");
                return reject("No active tab found.");
            }
            const tabId = tabs[0].id;

            chrome.scripting.executeScript(
                {
                    target: { tabId: tabId },
                    function: () => {
                        try {
                            const clonedBody = document.body.cloneNode(true);
                            const selectorsToRemove = "header, footer, nav, aside, .ad, .advertisement, .popup, .modal, .sidebar, script, style, link, [aria-hidden='true'], noscript, iframe, svg, canvas, video, audio, button, input, select, textarea";
                            clonedBody.querySelectorAll(selectorsToRemove)
                                .forEach((el) => el.remove());
                            const mainContentSelectors = 'main, article, [role="main"], #main, #content, .main, .content, .post-body, .entry-content';
                            let mainContentElement = clonedBody.querySelector(mainContentSelectors);
                            let text = mainContentElement ? mainContentElement.innerText : clonedBody.innerText;
                            return text.replace(/\s\s+/g, ' ').trim();
                        } catch (e) {
                            console.error("CS: Error during content extraction script:", e);
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
                        if (results[0].result.trim().length > 0) {
                            resolve(results[0].result);
                        } else {
                            // Attempt fallback if primary extraction yields empty string
                            chrome.scripting.executeScript(
                                { target: { tabId: tabId }, function: () => document.body.innerText.replace(/\s\s+/g, ' ').trim() },
                                (fallbackResults) => {
                                    if (chrome.runtime.lastError || !fallbackResults || !fallbackResults[0] || typeof fallbackResults[0].result !== 'string') {
                                        console.error("BG: Fallback content extraction failed:", chrome.runtime.lastError?.message);
                                        return reject("Failed to extract any meaningful content.");
                                    }
                                    if (fallbackResults[0].result.trim().length === 0) {
                                        console.error("BG: Even fallback body.innerText extraction yielded empty string.");
                                        return reject("Page seems to contain no extractable text.");
                                    }
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

// Function to get settings from storage or use imported defaults
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

// Function to safely send messages to the potentially closed popup
function safeSendMessage(message) {
    if (popupPort) {
        try {
            popupPort.postMessage(message);
        } catch (error) {
            popupPort = null;
            if (currentAbortController) {
                currentAbortController.abort();
                currentAbortController = null;
            }
        }
    } else {
        if (currentAbortController && message.action !== 'aborted') {
            currentAbortController.abort();
            currentAbortController = null;
        }
    }
}


// Function to handle initial Summary/Explanation requests
async function summarizeContent(contentType, content, lang, mode, abortSignal) {
    try {
        const settings = await getSettings();
        const modelName = settings.modelName;
        let baseSummarizePrompt = settings.summarizePrompt;
        let baseExplainPrompt = settings.explainPrompt;

        // --- Context Handling ---
        if (contentType === "web") {
            try {
                content = await extractContent();
                if (content && content.trim().length > 0) {
                    safeSendMessage({ action: "context", content: content }); // Send web context
                } else { console.warn("BG: Extracted web content is empty."); }
            } catch (extractError) { /* ... handle extract error ... */ throw extractError; }
            if (!content || content.trim().length === 0) { /* ... handle no content ... */ }
        }
        else if (contentType === "pdf" || contentType === "text") {
             if (content && content.trim().length > 0) {
                  console.log(`BG: Sending provided ${contentType} content back as context.`);
                  safeSendMessage({ action: "context", content: content });
             } else {
                 const errorMsg = `No content provided for ${contentType}.`;
                 safeSendMessage({ action: "error", message: errorMsg });
                 throw new Error(errorMsg);
             }
        }
        else { /* ... unknown type error ... */ }
        // --------------------

        // Prepare API request
        let systemPromptTemplate = mode === "summarize" ? baseSummarizePrompt : baseExplainPrompt;
        let systemCommand = systemPromptTemplate.replace(/{lang}/g, lang);

        const response = await fetch("http://localhost:1234/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", },
            body: JSON.stringify({
                model: modelName,
                messages: [{ role: "system", content: systemCommand }, { role: "user", content: content.trim() }],
                temperature: 0.3, max_tokens: -1, stream: true,
            }),
            signal: abortSignal
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`BG: API Error Response: ${errorBody}`);
            safeSendMessage({ action: "error", message: `API Error ${response.status}: ${response.statusText}` });
            throw new Error(`API Error: ${response.status}`);
        }
        if (!response.body) {
             safeSendMessage({ action: "error", message: "API response body is missing." });
             throw new Error("Response body is null.");
        }

        // Process stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = ""; let responseText = "";
        while (true) {
            if (abortSignal.aborted) { throw new DOMException('Aborted by user', 'AbortError'); }
            const { done, value } = await reader.read();
            if (done) {
                if (!abortSignal.aborted) { safeSendMessage({ action: "complete" }); }
                break;
            }
            buffer += decoder.decode(value, { stream: true });
            let lines = buffer.split('\n');
            buffer = lines.pop();
            for (const line of lines) {
                if (line.startsWith("data: ")) {
                    const jsonStr = line.substring(6).trim();
                    if (jsonStr === "[DONE]" || !jsonStr) continue;
                    try {
                        const result = JSON.parse(jsonStr);
                        if (result?.choices?.[0]?.delta?.content) {
                            const contentChunk = result.choices[0].delta.content;
                            responseText += contentChunk;
                            if (contentChunk && !abortSignal.aborted) { safeSendMessage({ action: "update", summary: contentChunk }); }
                        }
                    } catch (error) { console.warn("BG: Failed to parse JSON chunk:", jsonStr, error); }
                }
            }
        }
        return responseText;

    } catch (error) {
        if (error.name === 'AbortError') { safeSendMessage({ action: "aborted" }); }
        else {
            console.error("BG: Error caught in summarizeContent:", error);
            if (!error.message?.includes("API Error") && !error.message?.includes("extraction failed") && !error.message?.includes("No content")) {
                 safeSendMessage({ action: "error", message: error.message || "An unknown background error occurred." });
            }
        }
        return `ErrorState: ${error.message}`;
    } finally {
        if (currentAbortController && currentAbortController.signal === abortSignal) { currentAbortController = null; }
    }
}

// Function to handle chat requests
async function processChat(originalContext, history, lang, abortSignal) {
    try {
        const settings = await getSettings();
        const modelName = settings.modelName;
        const systemPrompt = `You are a helpful assistant discussing the following text. Answer the user's questions concisely based *only* on the text provided. Text:\n"""${originalContext}"""`;
        const messages = [ { role: "system", content: systemPrompt }, ...history ]; // History starts with 'user'

        const response = await fetch("http://localhost:1234/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: modelName,
                messages: messages,
                temperature: 0.5,
                max_tokens: -1, // Or set a reasonable limit like 1024
                stream: true,
            }),
            signal: abortSignal,
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`BG: Chat API Error Response: ${errorBody}`);
            safeSendMessage({ action: "error", message: `Chat API Error ${response.status}: ${response.statusText}` });
            throw new Error(`Chat API Error: ${response.status}`);
        }
        if (!response.body) {
            safeSendMessage({ action: "error", message: "Chat API response body is missing." });
            throw new Error("Chat response body is null.");
        }

        // Process stream (Identical stream logic as summarizeContent)
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = ""; let responseText = "";
        while (true) {
            if (abortSignal.aborted) { throw new DOMException('Aborted by user', 'AbortError'); }
            const { done, value } = await reader.read();
            if (done) { if (!abortSignal.aborted) { safeSendMessage({ action: "complete" }); } break; }
            buffer += decoder.decode(value, { stream: true });
            let lines = buffer.split('\n'); buffer = lines.pop();
            for (const line of lines) {
                if (line.startsWith("data: ")) {
                    const jsonStr = line.substring(6).trim();
                    if (jsonStr === "[DONE]" || !jsonStr) continue;
                    try {
                        const result = JSON.parse(jsonStr);
                        if (result?.choices?.[0]?.delta?.content) {
                            const contentChunk = result.choices[0].delta.content;
                            responseText += contentChunk;
                            if (contentChunk && !abortSignal.aborted) { safeSendMessage({ action: "update", summary: contentChunk }); }
                        }
                    } catch (error) { console.warn("BG: Failed to parse JSON chunk:", jsonStr, error); }
                }
            }
        }
        return responseText;

    } catch (error) {
        if (error.name === 'AbortError') { safeSendMessage({ action: "aborted" }); }
        else {
            console.error("BG: Error caught in processChat:", error);
             if (!error.message?.includes("API Error")) { safeSendMessage({ action: "error", message: error.message || "An unknown chat error occurred." }); }
        }
        return `ErrorState: ${error.message}`;
    } finally {
        if (currentAbortController && currentAbortController.signal === abortSignal) { currentAbortController = null; }
    }
}

// Connection listener for communication with the popup
chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "popup") return;
    popupPort = port;

    port.onMessage.addListener((message) => {
        let shouldAbort = message.command !== "pdfProcessingError";
        if (shouldAbort && currentAbortController) { currentAbortController.abort(); }
        if (shouldAbort) { currentAbortController = new AbortController(); }
        const signal = currentAbortController ? currentAbortController.signal : null;

        // Route based on command
        if (message.command === "summarize" || message.command === "explain" ||
            message.command === "summarizeSelectedText" || message.command === "explainSelectedText" ||
            message.command === "sendPdfContent")
        {
            if (!signal) { // Should have a signal for these commands
                 console.error("BG: Missing AbortController signal for command:", message.command);
                 safeSendMessage({action: "error", message: "Internal background error (signal missing)."});
                 return;
            }
            const mode = message.command.toLowerCase().includes("explain") ? "explain" : "summarize";
            let contentType = "web";
            let contentToProcess = "";

            if (message.command.includes("SelectedText")) {
                contentType = "text";
                contentToProcess = message.text;
            } else if (message.command === "sendPdfContent") {
                contentType = "pdf";
                contentToProcess = message.content;
            } // Else: "summarize"/"explain" -> "web"

            summarizeContent(contentType, contentToProcess, message.language || 'en', mode, signal)
                .then(result => { /* Optional: Log completion state */ })
                .catch(error => { if (error.name !== 'AbortError') { console.error(`BG: Error after summarizeContent call:`, error); }});

        } else if (message.command === "chatWithContext") {
             if (!signal) { // Should have a signal for chat
                 console.error("BG: Missing AbortController signal for chat command.");
                 safeSendMessage({action: "error", message: "Internal background error (signal missing)."});
                 return;
             }
             processChat(message.context, message.history, message.language || 'en', signal)
                 .then(result => { /* Optional: Log completion state */ })
                 .catch(error => { if (error.name !== 'AbortError') { console.error(`BG: Error after processChat call:`, error); } });

        } else if (message.command === "pdfProcessingError") {
             safeSendMessage({ action: "error", message: `PDF Error: ${message.message}` });
        } else {
            console.warn("BG: Received unknown message command via port:", message.command);
        }
    }); // End of port.onMessage.addListener

    port.onDisconnect.addListener(() => {
        popupPort = null;
        if (currentAbortController) { currentAbortController.abort(); currentAbortController = null; }
    });
});