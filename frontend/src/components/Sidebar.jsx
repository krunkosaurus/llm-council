import './Sidebar.css';

export default function Sidebar({
  conversations,
  currentConversationId,
  onSelectConversation,
  onNewConversation,
  authProviders,
  oauthBusyProvider,
  providerModelBusy,
  onConnectProvider,
  onDisconnectProvider,
  onProviderModelChange,
  pendingCodeOAuth,
  pendingOAuthCode,
  oauthError,
  onPendingOAuthCodeChange,
  onPendingOAuthCodeSubmit,
  onPendingOAuthCancel,
}) {
  const providerList = Object.values(authProviders || {});

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h1>LLM Council</h1>
        <button className="new-conversation-btn" onClick={onNewConversation}>
          + New Conversation
        </button>
      </div>

      <div className="auth-section">
        <h2>Providers</h2>
        {providerList.length === 0 ? (
          <div className="oauth-empty">Loading providers...</div>
        ) : (
          providerList.map((provider) => {
            const busy = oauthBusyProvider === provider.id;
            const modelBusy = providerModelBusy === provider.id;
            const connected = provider.connected;
            const isPendingCodeFlow = pendingCodeOAuth?.providerId === provider.id;
            const supportsInteractiveConnect =
              provider.connect_method === 'redirect' || provider.connect_method === 'code';
            const statusText =
              provider.status_text ||
              (!provider.configured
                ? 'Not configured'
                : connected
                  ? 'Connected'
                  : isPendingCodeFlow
                    ? 'Waiting for code'
                    : 'Not connected');

            return (
              <div key={provider.id} className="oauth-provider-card">
                <div className="oauth-provider-row">
                  <div>
                    <div className="oauth-provider-name">{provider.name}</div>
                    <div
                      className={`oauth-provider-status ${
                        provider.configured ? 'configured' : 'not-configured'
                      }`}
                    >
                      {statusText}
                    </div>
                  </div>
                  {supportsInteractiveConnect
                    ? connected ? (
                        <button
                          className="oauth-btn oauth-btn-disconnect"
                          onClick={() => onDisconnectProvider(provider.id)}
                          disabled={busy}
                        >
                          {busy ? '...' : 'Disconnect'}
                        </button>
                      ) : (
                        <button
                          className="oauth-btn oauth-btn-connect"
                          onClick={() => onConnectProvider(provider.id)}
                          disabled={!provider.configured || busy}
                        >
                          {busy ? '...' : isPendingCodeFlow ? 'Reconnect' : 'Connect'}
                        </button>
                      )
                    : null}
                </div>
                {provider.setup_hint ? <div className="oauth-provider-hint">{provider.setup_hint}</div> : null}
                {Array.isArray(provider.available_models) && provider.available_models.length > 0 ? (
                  <label className="oauth-model-picker">
                    <span className="oauth-model-label">Model</span>
                    <select
                      className="oauth-model-select"
                      value={provider.selected_model || ''}
                      onChange={(event) => onProviderModelChange(provider.id, event.target.value)}
                      disabled={!connected || busy || modelBusy}
                    >
                      {provider.available_models.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {isPendingCodeFlow ? (
                  <form
                    className="oauth-code-panel"
                    onSubmit={(event) => {
                      event.preventDefault();
                      onPendingOAuthCodeSubmit();
                    }}
                  >
                    <div className="oauth-code-help">
                      {pendingCodeOAuth.instructions || 'Paste the returned authorization code here.'}
                    </div>
                    <a
                      className="oauth-code-link"
                      href={pendingCodeOAuth.authUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open auth page
                    </a>
                    <textarea
                      className="oauth-code-input"
                      rows="3"
                      value={pendingOAuthCode}
                      onChange={(event) => onPendingOAuthCodeChange(event.target.value)}
                      placeholder="Paste the Claude code or callback URL"
                    />
                    {oauthError ? <div className="oauth-code-error">{oauthError}</div> : null}
                    <div className="oauth-code-actions">
                      <button
                        type="submit"
                        className="oauth-btn oauth-btn-connect"
                        disabled={busy || !pendingOAuthCode.trim()}
                      >
                        {busy ? '...' : 'Submit Code'}
                      </button>
                      <button
                        type="button"
                        className="oauth-btn oauth-btn-cancel"
                        onClick={onPendingOAuthCancel}
                        disabled={busy}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      <div className="conversation-list">
        {conversations.length === 0 ? (
          <div className="no-conversations">No conversations yet</div>
        ) : (
          conversations.map((conv) => (
            <div
              key={conv.id}
              className={`conversation-item ${
                conv.id === currentConversationId ? 'active' : ''
              }`}
              onClick={() => onSelectConversation(conv.id)}
            >
              <div className="conversation-title">{conv.title || 'New Conversation'}</div>
              <div className="conversation-meta">{conv.message_count} messages</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
