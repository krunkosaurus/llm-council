import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Stage1 from './Stage1';
import Stage2 from './Stage2';
import Stage3 from './Stage3';
import './ChatInterface.css';

function shouldShowRecoveryLoading(conversation) {
  if (!conversation || !Array.isArray(conversation.messages) || conversation.messages.length === 0) {
    return false;
  }

  const lastMessage = conversation.messages[conversation.messages.length - 1];
  if (!lastMessage || lastMessage.role !== 'user') {
    return false;
  }

  return !conversation.messages.some((message) => message && message.role === 'assistant');
}

export default function ChatInterface({
  conversation,
  onSendMessage,
  isLoading,
}) {
  const [input, setInput] = useState('');
  const messagesContainerRef = useRef(null);
  const messagesEndRef = useRef(null);
  const autoScrollEnabledRef = useRef(true);
  const lastScrollSignatureRef = useRef('');

  const isNearBottom = () => {
    const container = messagesContainerRef.current;
    if (!container) return true;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    return distanceFromBottom <= 80;
  };

  useEffect(() => {
    // Reset stick-to-bottom behavior whenever switching conversations.
    autoScrollEnabledRef.current = true;
    lastScrollSignatureRef.current = '';
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [conversation?.id]);

  useEffect(() => {
    if (!conversation) return;

    const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
    const lastMessage = messages[messages.length - 1] || null;
    const signature = [
      conversation.id || '',
      messages.length,
      isLoading ? 1 : 0,
      lastMessage && lastMessage.role ? lastMessage.role : '',
      Boolean(lastMessage && lastMessage.loading && lastMessage.loading.stage1),
      Boolean(lastMessage && lastMessage.loading && lastMessage.loading.stage2),
      Boolean(lastMessage && lastMessage.loading && lastMessage.loading.stage3),
      Boolean(lastMessage && lastMessage.stage1),
      Boolean(lastMessage && lastMessage.stage2),
      Boolean(lastMessage && lastMessage.stage3),
    ].join('|');

    if (signature === lastScrollSignatureRef.current) {
      return;
    }
    lastScrollSignatureRef.current = signature;

    if (autoScrollEnabledRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [conversation, isLoading]);

  const handleMessagesScroll = () => {
    autoScrollEnabledRef.current = isNearBottom();
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      onSendMessage(input);
      setInput('');
    }
  };

  const handleKeyDown = (e) => {
    // Submit on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  if (!conversation) {
    return (
      <div className="chat-interface">
        <div className="empty-state">
          <h2>Welcome to LLM Council</h2>
          <p>Create a new conversation to get started</p>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-interface">
      <div
        ref={messagesContainerRef}
        className="messages-container"
        onScroll={handleMessagesScroll}
      >
        {conversation.messages.length === 0 ? (
          <div className="empty-state">
            <h2>Start a conversation</h2>
            <p>Ask a question to consult the LLM Council</p>
          </div>
        ) : (
          conversation.messages.map((msg, index) => (
            <div key={index} className="message-group">
              {msg.role === 'user' ? (
                <div className="user-message">
                  <div className="message-label">You</div>
                    <div className="message-content">
                      <div className="markdown-content">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                      </div>
                    </div>
                  </div>
              ) : (
                <div className="assistant-message">
                  <div className="message-label">LLM Council</div>

                  {/* Stage 1 */}
                  {msg.loading?.stage1 && (
                    <div className="stage-loading">
                      <div className="spinner"></div>
                      <span>Running Stage 1: Collecting individual responses...</span>
                    </div>
                  )}
                  {(msg.stage1 || msg.metadata?.stage1_failures) && (
                    <Stage1
                      responses={msg.stage1}
                      failures={msg.metadata?.stage1_failures}
                    />
                  )}

                  {/* Stage 2 */}
                  {msg.loading?.stage2 && (
                    <div className="stage-loading">
                      <div className="spinner"></div>
                      <span>Running Stage 2: Peer rankings...</span>
                    </div>
                  )}
                  {(msg.stage2 || msg.metadata?.stage2_failures) && (
                    <Stage2
                      rankings={msg.stage2}
                      labelToModel={msg.metadata?.label_to_model}
                      aggregateRankings={msg.metadata?.aggregate_rankings}
                      failures={msg.metadata?.stage2_failures}
                    />
                  )}

                  {/* Stage 3 */}
                  {msg.loading?.stage3 && (
                    <div className="stage-loading">
                      <div className="spinner"></div>
                      <span>Running Stage 3: Final synthesis...</span>
                    </div>
                  )}
                  {msg.stage3 && <Stage3 finalResponse={msg.stage3} />}
                </div>
              )}
            </div>
          ))
        )}

        {shouldShowRecoveryLoading(conversation) && (
          <div className="recovery-loading">
            <div className="spinner"></div>
            <span>This request is still processing or was interrupted during refresh. The page will keep checking for updates.</span>
          </div>
        )}

        {isLoading && (
          <div className="loading-indicator">
            <div className="spinner"></div>
            <span>Consulting the council...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {conversation.messages.length === 0 && (
        <form className="input-form" onSubmit={handleSubmit}>
          <textarea
            className="message-input"
            placeholder="Ask your question... (Shift+Enter for new line, Enter to send)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            rows={3}
          />
          <button
            type="submit"
            className="send-button"
            disabled={!input.trim() || isLoading}
          >
            Send
          </button>
        </form>
      )}
    </div>
  );
}
