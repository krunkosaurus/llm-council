import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import './Stage2.css';

function getModelShortName(model) {
  return model.split('/')[1] || model;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function deAnonymizeText(text, labelToModel) {
  if (!labelToModel) return text;

  let result = text;
  // Keep the original label visible while making the mapped model explicit.
  Object.entries(labelToModel).forEach(([label, model]) => {
    const modelShortName = getModelShortName(model);
    result = result.replace(
      new RegExp(escapeRegExp(label), 'g'),
      `${label} (${modelShortName})`
    );
  });
  return result;
}

function getLabelForModel(model, labelToModel) {
  if (!labelToModel) {
    return null;
  }

  const entry = Object.entries(labelToModel).find(([, mappedModel]) => mappedModel === model);
  return entry ? entry[0] : null;
}

export default function Stage2({ rankings, labelToModel, aggregateRankings }) {
  const [activeTab, setActiveTab] = useState(0);

  if (!rankings || rankings.length === 0) {
    return null;
  }

  return (
    <div className="stage stage2">
      <h3 className="stage-title">Stage 2: Peer Rankings</h3>

      <h4>Raw Evaluations</h4>
      <p className="stage-description">
        Each model evaluated all responses (anonymized as Response A, B, C, etc.) and provided rankings.
        Below, each response label is shown with its mapped model so you do not need to look it up separately.
      </p>

      {labelToModel && Object.keys(labelToModel).length > 0 && (
        <div className="response-map">
          {Object.entries(labelToModel).map(([label, model]) => (
            <div key={label} className="response-map-item">
              <span className="response-map-label">{label}</span>
              <span className="response-map-arrow">{'->'}</span>
              <span className="response-map-model">{getModelShortName(model)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="tabs">
        {rankings.map((rank, index) => (
          <button
            key={index}
            className={`tab ${activeTab === index ? 'active' : ''}`}
            onClick={() => setActiveTab(index)}
          >
            {rank.model.split('/')[1] || rank.model}
          </button>
        ))}
      </div>

      <div className="tab-content">
        <div className="ranking-model">
          {rankings[activeTab].model}
        </div>
        <div className="ranking-content markdown-content">
          <ReactMarkdown>
            {deAnonymizeText(rankings[activeTab].ranking, labelToModel)}
          </ReactMarkdown>
        </div>

        {rankings[activeTab].parsed_ranking &&
         rankings[activeTab].parsed_ranking.length > 0 && (
          <div className="parsed-ranking">
            <strong>Mapped Final Ranking:</strong>
            <ol>
              {rankings[activeTab].parsed_ranking.map((label, i) => (
                <li key={i}>
                  {labelToModel && labelToModel[label]
                    ? `${label} -> ${getModelShortName(labelToModel[label])}`
                    : label}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {aggregateRankings && aggregateRankings.length > 0 && (
        <div className="aggregate-rankings">
          <h4>Aggregate Rankings (Street Cred)</h4>
          <p className="stage-description">
            Combined results across all peer evaluations (lower score is better):
          </p>
          <div className="aggregate-list">
            {aggregateRankings.map((agg, index) => (
              <div key={index} className="aggregate-item">
                <span className="rank-position">#{index + 1}</span>
                <span className="rank-model">
                  {(() => {
                    const label = getLabelForModel(agg.model, labelToModel);
                    const modelName = getModelShortName(agg.model);
                    return label ? `${label} -> ${modelName}` : modelName;
                  })()}
                </span>
                <span className="rank-score">
                  Avg: {agg.average_rank.toFixed(2)}
                </span>
                <span className="rank-count">
                  ({agg.rankings_count} votes)
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
