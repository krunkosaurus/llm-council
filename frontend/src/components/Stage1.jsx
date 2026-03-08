import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './Stage1.css';

function getModelShortName(model) {
  return model.split('/')[1] || model;
}

export default function Stage1({ responses, failures = [] }) {
  const [activeTab, setActiveTab] = useState(0);

  if ((!responses || responses.length === 0) && (!failures || failures.length === 0)) {
    return null;
  }

  return (
    <div className="stage stage1">
      <h3 className="stage-title">Stage 1: Individual Responses</h3>

      {responses && responses.length > 0 ? (
        <>
          <div className="tabs">
            {responses.map((resp, index) => (
              <button
                key={index}
                className={`tab ${activeTab === index ? 'active' : ''}`}
                onClick={() => setActiveTab(index)}
              >
                {getModelShortName(resp.model)}
              </button>
            ))}
          </div>

          <div className="tab-content">
            <div className="model-name">{responses[activeTab].model}</div>
            <div className="response-text markdown-content">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{responses[activeTab].response}</ReactMarkdown>
            </div>
          </div>
        </>
      ) : (
        <div className="stage-description">No Stage 1 models returned a response.</div>
      )}

      {failures && failures.length > 0 && (
        <div className="stage-failures">
          <h4>Skipped / Failed Models</h4>
          <div className="failure-list">
            {failures.map((failure, index) => (
              <div key={index} className="failure-item">
                <span className="failure-model">{getModelShortName(failure.model)}</span>
                <span className="failure-error">{failure.error}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
