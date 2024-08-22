// Função para extrair o conteúdo da página
function extractContent() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      chrome.scripting.executeScript(
        {
          target: { tabId: tabs[0].id },
          function: () => {
            // Remova anúncios, menus e rodapés do conteúdo da página
            document
              .querySelectorAll("header, footer, nav, .ad, .advertisement")
              .forEach((el) => el.remove());
            return document.body.innerText;
          },
        },
        (results) => {
          if (chrome.runtime.lastError || !results || results.length === 0) {
            reject("Failed to extract content");
          } else {
            resolve(results[0].result);
          }
        }
      );
    });
  });
}

// Função para enviar conteúdo extraído para a API e receber o resultado
async function summarizeContent(contentType, content, lang, mode) {
  // If it is a webpage, it calls extractContent to clean it up
  if (contentType === "web") {
    content = "";
    content = await extractContent();
    if (!content) throw new Error("No content to summarize");
  }

  try {
    // Prompts
    // let systemCommand = 'Create a summary of the original text in ' + lang + ' language, structured into 3-5 sentences that capture the main ideas and key points. The summary should be easy to understand and free from ambiguity. Summarize in ' + lang + ' language: '
    // let systemCommand = 'Summarize in ' + lang + ' language: '
    let systemCommand =
      mode === "summarize"
        ? "Task: Summarize the following article. Lenght: 3-5 sentences. Format: Markdown. Requirements: capture the main ideas and key points; easy to understand; summary should be free from ambiguity. You will always follow these structured instructions: Break down tasks by using Chain of Thought (CoT) reasoning, articulating each logical step and verifying them for coherence. Apply Step-by-Step Rationalization (STaR) to justify decisions, balancing depth with efficiency. Integrate A Search* principles to optimize your approach, evaluating the efficiency of potential paths and selecting the most direct strategy. Use Tree of Thoughts (ToT) to explore multiple solutions in parallel, evaluating and converging on the most promising one. Simulate Adaptive Learning by reflecting on decisions as if learning from outcomes, prioritizing strategies that yield the best results. Continuously monitor your process, assessing progress to ensure alignment with the overall goal and refining your approach as needed. Your ultimate goal is to deliver the most logical, effective, and comprehensive solution possible by fully integrating these advanced reasoning techniques. Summarize in  " + lang + " language. Article: "
        : "Task: Explain following the article. Format: Markdown. Requirements: explain all the main ideas, key points and tech terminology; use simple terms that a beginner can easily understand; explanation should be free from ambiguity. Explain in " + lang + " language. Article: ";

    const response = await fetch("http://localhost:1234/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF",
        messages: [
          { role: "system", content: systemCommand },
          { role: "user", content: content },
        ],
        temperature: 0.3,
        max_tokens: -1,
        stream: true,
      }),
    });

    let summary = "";
    const reader = response.body.getReader();
    let receivedJson = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        chrome.runtime.sendMessage({ action: "complete", summary: "" }); // Indicate completion
        return;
      }
      // if (done) break;
      receivedJson = new TextDecoder().decode(value);

      try {
        const result = JSON.parse(receivedJson.split("data: ")[1]);
        // Reset the receivedJson for the next chunk if JSON is successfully parsed
        receivedJson = "";
        if (
          result &&
          result.choices &&
          result.choices[0] &&
          result.choices[0].delta &&
          result.choices[0].delta.content
        ) {
          summary += result.choices[0].delta.content;
          chrome.runtime.sendMessage({
            action: "update",
            summary: result.choices[0].delta.content,
          });
        }
      } catch (error) {
        // If JSON is not complete, it throws an error which is caught here.
        // No action is required as the loop continues to get more data.
      }
    }
    return summary;
  } catch (error) {
    console.error("Error summarizing content:", error);
    return "Error summarizing content";
  }
}

// Listener para comunicação com o popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const mode = message.command.includes("explain") ? "explain" : "summarize";
  if (
    message.command === "summarizeSelectedText" ||
    message.command === "explainSelectedText"
  ) {
    // Directly use the provided text if the command indicates selected text should be used.
    summarizeContent("text", message.text, message.language, mode).then(
      sendResponse
    );
    return true; // asynchronous response
  } else if (message.command === "sendPdfContent") {
    // Handle PDF content summarization/explanation
    summarizeContent("pdf", message.content, message.language, mode).then(
      sendResponse
    );
    return true;
  } else if (message.command === "summarize" || message.command === "explain") {
    // No text selected, proceed to summarize or explain the entire web content.
    summarizeContent("web", "", message.language, mode).then(sendResponse);
    return true;
  }
});
