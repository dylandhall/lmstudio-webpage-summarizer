// getContentScript.js

// Prevent multiple executions if script is injected again
if (typeof window.pdfExtractorLoaded === 'undefined') {
    window.pdfExtractorLoaded = true;

    (async () => {
        const url = location.href;
        // console.log("getContentScript: Running on URL:", url);

        if (!url.toLowerCase().endsWith(".pdf")) {
            console.warn("getContentScript: Script injected on non-PDF page?");
            // Don't exit immediately, maybe it's an embedded PDF viewer
            // but log a warning.
        }

        // 1. Retrieve processing info from chrome.storage.local (set by popup.js)
        let language = 'en'; // Default language
        let mode = 'summarize'; // Default mode
        try {
            const { pdfProcessingInfo } = await chrome.storage.local.get('pdfProcessingInfo');
            if (pdfProcessingInfo && pdfProcessingInfo.language && pdfProcessingInfo.mode) {
                language = pdfProcessingInfo.language;
                mode = pdfProcessingInfo.mode; // We retrieve mode, though background currently doesn't use it for 'sendPdfContent'
                // console.log(`getContentScript: Retrieved language: ${language}, mode: ${mode}`);
                 // Optional: Clean up storage immediately after reading
                // chrome.storage.local.remove('pdfProcessingInfo');
            } else {
                console.warn("getContentScript: Could not retrieve processing info from storage. Using defaults.");
            }
        } catch (storageError) {
            console.error("getContentScript: Error retrieving from storage:", storageError);
             // Proceed with defaults
        }


        // --- PDF.js setup (remains the same) ---
        const workerSrc = chrome.runtime.getURL("lib/pdf.worker.mjs");
        let pdfjsLib;
        try {
            pdfjsLib = await import(chrome.runtime.getURL("lib/pdf.min.mjs"));
            pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
            // console.log("getContentScript: PDF.js library loaded and worker configured.");
        } catch (importError) {
             console.error("getContentScript: Failed to import PDF.js library:", importError);
             // Inform background/popup about the failure?
              chrome.runtime.sendMessage({
                  command: "pdfProcessingError",
                  message: "Failed to load PDF library."
              }).catch(e => console.error("Failed to send PDF error message", e));
             return; // Stop execution if library fails
        }
        // --- End PDF.js setup ---


        try {
            // console.log("getContentScript: Loading PDF document...");
            const loadingTask = pdfjsLib.getDocument(url);
            const pdfDoc = await loadingTask.promise;
            // console.log(`getContentScript: PDF loaded (${pdfDoc.numPages} pages).`);

            // Get the current text selection within the PDF viewer (if any)
            const selection = window.getSelection();
            const selectedText = selection ? selection.toString().trim() : "";

            let contentToSend = "";

            if (selectedText) {
                // console.log("getContentScript: Using selected text:", selectedText.substring(0, 100) + "...");
                contentToSend = selectedText;
            } else {
                // console.log("getContentScript: No text selected, extracting all pages...");
                // Otherwise, extract all text from the PDF
                let fullText = "";
                for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
                    try {
                        const page = await pdfDoc.getPage(pageNum);
                        const textContent = await page.getTextContent();
                        // Simple join, consider adding spaces/newlines more intelligently if needed
                        const pageText = textContent.items.map((item) => item.str).join(" ");
                        fullText += pageText + "\n"; // Add newline between pages
                    } catch (pageError) {
                         console.error(`getContentScript: Error processing page ${pageNum}:`, pageError);
                         // Continue with other pages
                    }
                }
                contentToSend = fullText.trim();
                // console.log(`getContentScript: Full text extracted (${contentToSend.length} chars).`);
            }

            // Send the content (either selected or full) to the background script
            if (contentToSend) {
                 // console.log(`getContentScript: Sending content (lang: ${language}).`);
                 chrome.runtime.sendMessage({
                    command: "sendPdfContent", // Command background script expects
                    content: contentToSend,
                    language: language // Use language retrieved from storage
                }).catch(e => console.error("getContentScript: Error sending message to background:", e));
            } else {
                 console.warn("getContentScript: No text content found (selected or full) to send.");
                  chrome.runtime.sendMessage({
                      command: "pdfProcessingError",
                      message: "No text content found in the PDF."
                  }).catch(e => console.error("Failed to send PDF error message", e));
            }

        } catch (err) {
            console.error("getContentScript: Error processing PDF document:", err);
             chrome.runtime.sendMessage({
                command: "pdfProcessingError",
                message: `Error processing PDF: ${err.message}`
             }).catch(e => console.error("Failed to send PDF error message", e));
        } finally {
             // Clean up storage after processing (success or failure)
             chrome.storage.local.remove('pdfProcessingInfo').catch(e => console.warn("Failed to remove pdfProcessingInfo from storage", e));
        }
    })();

} else {
    // console.log("getContentScript: Already loaded, skipping execution.");
}