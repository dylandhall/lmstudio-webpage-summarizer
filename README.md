# Note

## Updates to this fork

Original readme below - this project has now been very heavily modified. It supports:

* Customising your prompts and model
* Saving state if the popup is closed/opened
* Automatic reconnects and state handling if chrome closes the background service
* Chat interface to ask questions about the article
* Rolling chat window to continue conversation

Note, a lot of this was done as an experiment with AI generated code. It falls WELL below the standard for anything I'd write myself but it's working and that's impressive. I'm not sure it saved time in the long run but it was a fun experiment.

### Screenshots

#### Summary

![image](https://github.com/user-attachments/assets/bbd57a1f-2143-4532-9379-6e1d0c045c07)

#### With the chat interface

![image](https://github.com/user-attachments/assets/a8476895-6d85-4d7d-a3ea-17df068c3ee8)


# Original readme below

# Local Web Page Summarizer Chrome Extension

This Chrome extension provides a convenient way to summarize the content of web pages directly from your browser. Utilizing a local API that simulates the OpenAI API through LM Studio, this extension fetches and displays summaries quickly, helping users to grasp the essential content without reading the entire text.

## Features

- **Web Page Summarization:** Extracts and summarizes the text from any webpage, excluding non-essential elements like ads, headers, and footers.
- **Real-time Streaming:** Handles JSON streams for real-time summarization responses from a local API.

## Installation

To install this extension in your Chrome browser, follow these steps:

1. **Clone the repository:**
   ```bash
   git clone https://github.com/eddieoz/lmstudio-webpage-summarizer.git
   ```

2. **Load the extension in Chrome:**
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable Developer Mode by toggling the switch in the upper right corner.
   - Click on the "Load unpacked" button and select the directory where you cloned the repository.

## Usage

After installing the extension, follow these steps to use it:

1. **Navigate to any webpage in Chrome.**
2. **Click the extension icon in the Chrome toolbar.**
3. **Press the "Summarize" button in the popup to view the summary in the text area provided.**

## Local API Setup

To simulate the OpenAI API:

1. Set up your LM Studio, with a local server enabled

## Technologies Used

- **Chrome Extension API** for interacting with web content and browser tabs.
- **LM Studio** for handling local AI models and backend.
- **JavaScript Fetch API** for making network requests to the local API.

## Contributing

Contributions to this project are welcome! Please follow these steps:

1. Fork the repository on GitHub.
2. Create a new branch for your feature or bug fix.
3. Develop and test your changes.
4. Submit a pull request with a clear description of your changes.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Buy me a coffee
Did you like it? [Buy me a coffee](https://www.buymeacoffee.com/eddieoz)

[![Buy me a coffee](https://ipfs.io/ipfs/QmR6W4L3XiozMQc3EjfFeqSkcbu3cWnhZBn38z2W2FuTMZ?filename=buymeacoffee.webp)](https://www.buymeacoffee.com/eddieoz)

Or drop me a tip through Lightning Network: ⚡ [zbd.gg/eddieoz](https://zbd.gg/eddieoz)
