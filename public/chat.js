/**
 * LLM Chat App Frontend
 *
 * Handles the chat UI interactions and communication with the backend API.
 */

// DOM elements
const chatMessages = document.getElementById("chat-messages");
const userInput = document.getElementById("user-input");
const sendButton = document.getElementById("send-button");
const typingIndicator = document.getElementById("typing-indicator");
const themeToggle = document.getElementById("themeToggle");
const newChatButton = document.getElementById("newChatButton");

// Chat state
let chatHistory = JSON.parse(localStorage.getItem('chatHistory')) || [
	{
		role: "assistant",
		content:
			"Hello! I'm an LLM chat app powered by Cloudflare Workers AI. How can I help you today?",
	},
];
let isProcessing = false;

// Save chat history to localStorage
function saveChatHistory() {
	localStorage.setItem('chatHistory', JSON.stringify(chatHistory));
}

// Initialize theme
const savedTheme = localStorage.getItem('theme') || 'light';
document.body.classList.toggle('dark', savedTheme === 'dark');
themeToggle.textContent = savedTheme === 'dark' ? '☀️' : '🌙';

// Theme toggle handler
themeToggle.addEventListener('click', () => {
	const isDark = document.body.classList.toggle('dark');
	localStorage.setItem('theme', isDark ? 'dark' : 'light');
	themeToggle.textContent = isDark ? '☀️' : '🌙';
});

// New chat handler
newChatButton.addEventListener('click', () => {
	if (confirm('Start a new chat? This will clear the current conversation.')) {
		chatHistory = [{
			role: "assistant",
			content: "Hello! I'm an LLM chat app powered by Cloudflare Workers AI. How can I help you today?",
		}];
		saveChatHistory();
		initializeChat();
	}
});

// Auto-resize textarea as user types
userInput.addEventListener("input", function () {
	this.style.height = "auto";
	this.style.height = this.scrollHeight + "px";
});

// Send message on Enter (without Shift)
userInput.addEventListener("keydown", function (e) {
	if (e.key === "Enter" && !e.shiftKey) {
		e.preventDefault();
		sendMessage();
	}
});

// Send button click handler
sendButton.addEventListener("click", sendMessage);

/**
 * Sends a message to the chat API and processes the response
 */
async function sendMessage() {
	const message = userInput.value.trim();

	// Don't send empty messages
	if (message === "" || isProcessing) return;

	// Disable input while processing
	isProcessing = true;
	userInput.disabled = true;
	sendButton.disabled = true;

	// Add user message to chat
	addMessageToChat("user", message);

	// Clear input
	userInput.value = "";
	userInput.style.height = "auto";

	// Show typing indicator
	typingIndicator.classList.add("visible");

	// Add message to history
	chatHistory.push({ role: "user", content: message });
	saveChatHistory();

	try {
		// Create new assistant response element
		const messageEl = document.createElement("div");
		messageEl.className = "message assistant-message";
		messageEl.innerHTML = `<div class="message-content"></div>`;

		// Add copy button
		const copyButton = document.createElement("button");
		copyButton.className = "copy-button";
		copyButton.textContent = "📋";
		copyButton.title = "Copy message";
		copyButton.style.opacity = "0"; // Initially hidden
		messageEl.appendChild(copyButton);

		chatMessages.appendChild(messageEl);
		const messageContentEl = messageEl.querySelector(".message-content");

		// Scroll to bottom
		chatMessages.scrollTop = chatMessages.scrollHeight;

		// Send request to API
		const response = await fetch("/api/chat", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				messages: chatHistory,
			}),
		});

		// Handle errors
		if (!response.ok) {
			throw new Error("Failed to get response");
		}
		if (!response.body) {
			throw new Error("Response body is null");
		}

		// Process streaming response
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let responseText = "";
		let buffer = "";
		const flushAssistantText = () => {
			messageContentEl.innerHTML = renderMarkdown(responseText);
			chatMessages.scrollTop = chatMessages.scrollHeight;
		};

		let sawDone = false;
		while (true) {
			const { done, value } = await reader.read();

			if (done) {
				// Process any remaining complete events in buffer
				const parsed = consumeSseEvents(buffer + "\n\n");
				for (const data of parsed.events) {
					if (data === "[DONE]") {
						break;
					}
					try {
						const jsonData = JSON.parse(data);
						// Handle both Workers AI format (response) and OpenAI format (choices[0].delta.content)
						let content = "";
						if (
							typeof jsonData.response === "string" &&
							jsonData.response.length > 0
						) {
							content = jsonData.response;
						} else if (jsonData.choices?.[0]?.delta?.content) {
							content = jsonData.choices[0].delta.content;
						}
						if (content) {
							responseText += content;
							flushAssistantText();
						}
					} catch (e) {
						console.error("Error parsing SSE data as JSON:", e, data);
					}
				}
				break;
			}

			// Decode chunk
			buffer += decoder.decode(value, { stream: true });
			const parsed = consumeSseEvents(buffer);
			buffer = parsed.buffer;
			for (const data of parsed.events) {
				if (data === "[DONE]") {
					sawDone = true;
					buffer = "";
					break;
				}
				try {
					const jsonData = JSON.parse(data);
					// Handle both Workers AI format (response) and OpenAI format (choices[0].delta.content)
					let content = "";
					if (
						typeof jsonData.response === "string" &&
						jsonData.response.length > 0
					) {
						content = jsonData.response;
					} else if (jsonData.choices?.[0]?.delta?.content) {
						content = jsonData.choices[0].delta.content;
					}
					if (content) {
						responseText += content;
						flushAssistantText();
					}
				} catch (e) {
					console.error("Error parsing SSE data as JSON:", e, data);
				}
			}
			if (sawDone) {
				break;
			}
		}

		// Add completed response to chat history
		if (responseText.length > 0) {
			chatHistory.push({ role: "assistant", content: responseText });
			saveChatHistory();

			// Set up copy button for completed message
			copyButton.addEventListener("click", () => {
				navigator.clipboard.writeText(responseText).then(() => {
					copyButton.textContent = "✅";
					copyButton.title = "Copied!";
					setTimeout(() => {
						copyButton.textContent = "📋";
						copyButton.title = "Copy message";
					}, 2000);
				}).catch(err => {
					console.error("Failed to copy: ", err);
					copyButton.textContent = "❌";
					setTimeout(() => {
						copyButton.textContent = "📋";
						copyButton.title = "Copy message";
					}, 2000);
				});
			});
		}
	} catch (error) {
		console.error("Error:", error);
		addMessageToChat(
			"assistant",
			"Sorry, there was an error processing your request.",
		);
	} finally {
		// Hide typing indicator
		typingIndicator.classList.remove("visible");

		// Re-enable input
		isProcessing = false;
		userInput.disabled = false;
		sendButton.disabled = false;
		userInput.focus();
	}
}

/**
 * Simple markdown renderer
 */
function renderMarkdown(text) {
	// Escape HTML first
	text = text.replace(/[&<>"']/g, (match) => ({
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		"'": '&#39;'
	}[match]));

	// Code blocks (```)
	text = text.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');

	// Inline code (`)
	text = text.replace(/`([^`]+)`/g, '<code>$1</code>');

	// Bold (** or __)
	text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
	text = text.replace(/__(.*?)__/g, '<strong>$1</strong>');

	// Italic (* or _)
	text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
	text = text.replace(/_([^_]+)_/g, '<em>$1</em>');

	// Links [text](url)
	text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

	// Headers (# ## ###)
	text = text.replace(/^### (.*$)/gm, '<h3>$1</h3>');
	text = text.replace(/^## (.*$)/gm, '<h2>$1</h2>');
	text = text.replace(/^# (.*$)/gm, '<h1>$1</h1>');

	// Blockquotes (>)
	text = text.replace(/^> (.*$)/gm, '<blockquote>$1</blockquote>');

	// Lists (- or * or numbers)
	text = text.replace(/^(\d+)\. (.*$)/gm, '<li>$2</li>');
	text = text.replace(/^[-*] (.*$)/gm, '<li>$1</li>');

	// Line breaks
	text = text.replace(/\n/g, '<br>');

	return text;
}

/**
 * Helper function to add message to chat
 */
function addMessageToChat(role, content) {
	const messageEl = document.createElement("div");
	messageEl.className = `message ${role}-message`;

	// Render markdown content
	const renderedContent = renderMarkdown(content);

	messageEl.innerHTML = `<div class="message-content">${renderedContent}</div>`;

	// Add copy button
	const copyButton = document.createElement("button");
	copyButton.className = "copy-button";
	copyButton.textContent = "📋";
	copyButton.title = "Copy message";
	copyButton.addEventListener("click", () => {
		navigator.clipboard.writeText(content).then(() => {
			copyButton.textContent = "✅";
			copyButton.title = "Copied!";
			setTimeout(() => {
				copyButton.textContent = "📋";
				copyButton.title = "Copy message";
			}, 2000);
		}).catch(err => {
			console.error("Failed to copy: ", err);
			copyButton.textContent = "❌";
			setTimeout(() => {
				copyButton.textContent = "📋";
				copyButton.title = "Copy message";
			}, 2000);
		});
	});
	messageEl.appendChild(copyButton);

	chatMessages.appendChild(messageEl);

	// Scroll to bottom
	chatMessages.scrollTop = chatMessages.scrollHeight;
}

function consumeSseEvents(buffer) {
	let normalized = buffer.replace(/\r/g, "");
	const events = [];
	let eventEndIndex;
	while ((eventEndIndex = normalized.indexOf("\n\n")) !== -1) {
		const rawEvent = normalized.slice(0, eventEndIndex);
		normalized = normalized.slice(eventEndIndex + 2);

		const lines = rawEvent.split("\n");
		const dataLines = [];
		for (const line of lines) {
			if (line.startsWith("data:")) {
				dataLines.push(line.slice("data:".length).trimStart());
			}
		}
		if (dataLines.length === 0) continue;
		events.push(dataLines.join("\n"));
	}
	return { events, buffer: normalized };
}

// Initialize chat with saved messages
function initializeChat() {
	chatMessages.innerHTML = ''; // Clear any existing content
	chatHistory.forEach(message => {
		addMessageToChat(message.role, message.content);
	});
}

// Initialize chat
initializeChat();
