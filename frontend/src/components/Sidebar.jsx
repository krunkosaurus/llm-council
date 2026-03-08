import { useEffect, useState } from 'react';
import './Sidebar.css';

export default function Sidebar({
  conversations,
  currentConversationId,
  onSelectConversation,
  onDeleteConversation,
  onNewConversation,
  authProviders,
  oauthBusyProvider,
  providerModelBusy,
  deletingConversationId,
  onConnectProvider,
  onDisconnectProvider,
  onProviderModelChange,
  onAddProviderModel,
  onRemoveProviderModel,
  onRefreshProviderModels,
  pendingCodeOAuth,
  pendingOAuthCode,
  oauthError,
  onPendingOAuthCodeChange,
  onPendingOAuthCodeSubmit,
  onPendingOAuthCancel,
}) {
  const providerList = Object.values(authProviders || {});
  const [providersExpanded, setProvidersExpanded] = useState(() => {
    if (typeof window === 'undefined') {
      return true;
    }
    return window.localStorage.getItem('sidebar.providers.expanded') !== '0';
  });
  const [additionalModelSelections, setAdditionalModelSelections] = useState({});

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem('sidebar.providers.expanded', providersExpanded ? '1' : '0');
  }, [providersExpanded]);

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h1>LLM Council</h1>
        <button className="new-conversation-btn" onClick={onNewConversation}>
          + New Conversation
        </button>
      </div>

      <div className="auth-section">
        <div className="auth-section-header">
          <h2>Providers</h2>
          <button
            type="button"
            className="auth-collapse-btn"
            onClick={() => setProvidersExpanded((prev) => !prev)}
            aria-expanded={providersExpanded}
          >
            {providersExpanded ? 'Hide' : 'Show'}
          </button>
        </div>
        {providersExpanded ? (
          providerList.length === 0 ? (
            <div className="oauth-empty">Loading providers...</div>
          ) : (
            providerList.map((provider) => {
              const busy = oauthBusyProvider === provider.id;
              const modelBusy = providerModelBusy === provider.id;
              const connected = provider.connected;
              const availableModels = Array.isArray(provider.available_models) ? provider.available_models : [];
              const additionalSelectedModels = Array.isArray(provider.additional_selected_models)
                ? provider.additional_selected_models
                : [];
              const additionalSelectedSet = new Set(additionalSelectedModels);
              const addableModels = availableModels.filter(
                (model) => model.id !== provider.selected_model && !additionalSelectedSet.has(model.id)
              );
              const pendingAdditionalModel = additionalModelSelections[provider.id] || '';
              const modelLabelById = new Map(availableModels.map((model) => [model.id, model.label]));
              const isPendingCodeFlow = pendingCodeOAuth?.providerId === provider.id;
              const supportsConnectControls =
                provider.connect_method === 'redirect' ||
                provider.connect_method === 'code' ||
                provider.connect_method === 'env' ||
                provider.connect_method === 'config';
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
                    {supportsConnectControls
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
                  {availableModels.length > 0 ? (
                    <label className="oauth-model-picker">
                      <span className="oauth-model-label">
                        Model
                        {provider.dynamic_models ? (
                          <button
                            className="oauth-model-refresh"
                            onClick={(e) => {
                              e.preventDefault();
                              onRefreshProviderModels(provider.id);
                            }}
                            disabled={!connected || busy || modelBusy}
                            title="Refresh model list"
                          >
                            ↻
                          </button>
                        ) : null}
                      </span>
                      <select
                        className="oauth-model-select"
                        value={provider.selected_model || ''}
                        onChange={(event) => onProviderModelChange(provider.id, event.target.value)}
                        disabled={!connected || busy || modelBusy}
                      >
                        {availableModels.length === 0 ? (
                          <option value="">Loading models...</option>
                        ) : (
                          availableModels.map((model) => (
                            <option key={model.id} value={model.id}>
                              {model.label}
                            </option>
                          ))
                        )}
                      </select>
                    </label>
                  ) : null}
                  {provider.dynamic_models ? (
                    <div className="oauth-additional-models">
                      <div className="oauth-model-label">Additional Council Models</div>
                      <div className="oauth-additional-row">
                        <select
                          className="oauth-model-select"
                          value={pendingAdditionalModel}
                          onChange={(event) => {
                            const modelId = event.target.value;
                            setAdditionalModelSelections((prev) => ({
                              ...prev,
                              [provider.id]: modelId,
                            }));
                          }}
                          disabled={!connected || busy || modelBusy || addableModels.length === 0}
                        >
                          <option value="">
                            {addableModels.length === 0 ? 'No additional models available' : 'Select model to add'}
                          </option>
                          {addableModels.map((model) => (
                            <option key={model.id} value={model.id}>
                              {model.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="oauth-btn oauth-btn-connect oauth-btn-add-model"
                          onClick={() => {
                            if (!pendingAdditionalModel) {
                              return;
                            }
                            onAddProviderModel(provider.id, pendingAdditionalModel);
                            setAdditionalModelSelections((prev) => ({
                              ...prev,
                              [provider.id]: '',
                            }));
                          }}
                          disabled={!connected || busy || modelBusy || !pendingAdditionalModel}
                        >
                          Add
                        </button>
                      </div>
                      {additionalSelectedModels.length > 0 ? (
                        <div className="oauth-additional-list">
                          {additionalSelectedModels.map((modelId) => (
                            <div key={modelId} className="oauth-additional-item">
                              <span>{modelLabelById.get(modelId) || modelId}</span>
                              <button
                                type="button"
                                className="oauth-additional-remove"
                                onClick={() => onRemoveProviderModel(provider.id, modelId)}
                                disabled={!connected || busy || modelBusy}
                                title="Remove from council"
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="oauth-provider-hint">No additional council models selected.</div>
                      )}
                    </div>
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
          )
        ) : null}
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
              <div className="conversation-header">
                <div className="conversation-title">{conv.title || 'New Conversation'}</div>
                <button
                  type="button"
                  className="conversation-delete-btn"
                  title="Delete conversation"
                  aria-label={`Delete ${conv.title || 'conversation'}`}
                  disabled={deletingConversationId === conv.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeleteConversation(conv.id);
                  }}
                >
                  {deletingConversationId === conv.id ? '...' : '×'}
                </button>
              </div>
              <div className="conversation-footer">
                <div className="conversation-meta">{conv.message_count} messages</div>
                {conv.winner_label ? (
                  <div className="conversation-winner-badge" title={conv.winner_model || conv.winner_label}>
                    👑 {conv.winner_label}
                  </div>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
