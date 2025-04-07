// Saves options to chrome.storage.sync
import { defaultModel, defaultSummarizePrompt, defaultExplainPrompt } from './defaults.js';

function saveOptions() {
    const modelName = document.getElementById('modelName').value;
    const summarizePrompt = document.getElementById('summarizePrompt').value;
    const explainPrompt = document.getElementById('explainPrompt').value;

    chrome.storage.sync.set({
        modelName: modelName,
        summarizePrompt: summarizePrompt,
        explainPrompt: explainPrompt
    }, function() {
        // Update status to let user know options were saved.
        const status = document.getElementById('status');
        status.textContent = 'Options saved.';
        setTimeout(function() {
            status.textContent = '';
        }, 1500);
    });
}

// Restores select box and checkbox state using the preferences
// stored in chrome.storage.
function restoreOptions() {
    chrome.storage.sync.get({
        modelName: defaultModel,
        summarizePrompt: defaultSummarizePrompt,
        explainPrompt: defaultExplainPrompt
    }, function(items) {
        document.getElementById('modelName').value = items.modelName;
        document.getElementById('summarizePrompt').value = items.summarizePrompt;
        document.getElementById('explainPrompt').value = items.explainPrompt;
    });
}

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('save').addEventListener('click', saveOptions);