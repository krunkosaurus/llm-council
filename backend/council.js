const { queryModel, queryModelsParallel } = require('./modelClients');
const { COUNCIL_PROVIDER_ORDER } = require('./config');
const { listProviderStatuses } = require('./oauth');

async function getConnectedCouncilModels() {
  const providers = await listProviderStatuses();
  const connectedModels = [];

  COUNCIL_PROVIDER_ORDER.forEach((providerId) => {
    const provider = providers[providerId];
    if (!provider || !provider.connected || !provider.selected_model) {
      return;
    }
    connectedModels.push(provider.selected_model);
    if (Array.isArray(provider.additional_selected_models)) {
      connectedModels.push(...provider.additional_selected_models);
    }
  });

  return [...new Set(connectedModels)];
}

async function pickChairmanModel(models) {
  if (Array.isArray(models) && models.length > 0) {
    return models[0];
  }

  const connectedModels = await getConnectedCouncilModels();
  return connectedModels[0] || null;
}

/**
 * Stage 1: Collect individual responses from all connected council models.
 */
async function stage1CollectResponses(userQuery) {
  const councilModels = await getConnectedCouncilModels();
  if (councilModels.length === 0) {
    return [[], []];
  }

  const messages = [{ role: 'user', content: userQuery }];
  const responses = await queryModelsParallel(councilModels, messages);

  const stage1Results = [];
  const stage1Failures = [];
  for (const [model, result] of Object.entries(responses)) {
    if (result && result.response !== null) {
      stage1Results.push({
        model,
        response: result.response.content || '',
      });
      continue;
    }

    stage1Failures.push({
      model,
      error: (result && result.error) || 'Unknown error',
    });
  }

  return [stage1Results, stage1Failures];
}

/**
 * Stage 2: Each successful stage 1 model ranks the anonymized responses.
 * Returns [stage2Results, labelToModel].
 */
async function stage2CollectRankings(userQuery, stage1Results) {
  const labels = stage1Results.map((_, i) => String.fromCharCode(65 + i));
  const rankingModels = stage1Results.map((result) => result.model);

  const labelToModel = {};
  labels.forEach((label, i) => {
    labelToModel[`Response ${label}`] = stage1Results[i].model;
  });

  if (rankingModels.length === 0) {
    return [[], labelToModel, []];
  }

  const responsesText = labels
    .map((label, i) => `Response ${label}:\n${stage1Results[i].response}`)
    .join('\n\n');

  const rankingPrompt = `You are evaluating different responses to the following question:

Question: ${userQuery}

Here are the responses from different models (anonymized):

${responsesText}

Your task:
1. First, evaluate each response individually. For each response, explain what it does well and what it does poorly.
2. Then, at the very end of your response, provide a final ranking.

IMPORTANT: Your final ranking MUST be formatted EXACTLY as follows:
- Start with the line "FINAL RANKING:" (all caps, with colon)
- Then list the responses from best to worst as a numbered list
- Each line should be: number, period, space, then ONLY the response label (e.g., "1. Response A")
- Do not add any other text or explanations in the ranking section

Example of the correct format for your ENTIRE response:

Response A provides good detail on X but misses Y...
Response B is accurate but lacks depth on Z...
Response C offers the most comprehensive answer...

FINAL RANKING:
1. Response C
2. Response A
3. Response B

Now provide your evaluation and ranking:`;

  const messages = [{ role: 'user', content: rankingPrompt }];
  const responses = await queryModelsParallel(rankingModels, messages);

  const stage2Results = [];
  const stage2Failures = [];
  for (const [model, result] of Object.entries(responses)) {
    if (result && result.response !== null) {
      const fullText = result.response.content || '';
      const parsed = parseRankingFromText(fullText);
      stage2Results.push({
        model,
        ranking: fullText,
        parsed_ranking: parsed,
      });
      continue;
    }

    stage2Failures.push({
      model,
      error: (result && result.error) || 'Unknown error',
    });
  }

  return [stage2Results, labelToModel, stage2Failures];
}

/**
 * Stage 3: Chairman synthesizes final response.
 */
async function stage3SynthesizeFinal(userQuery, stage1Results, stage2Results) {
  const chairmanModel = await pickChairmanModel(stage1Results.map((result) => result.model));

  if (!chairmanModel) {
    return {
      model: 'error',
      response: 'No connected models are available for final synthesis.',
    };
  }

  const stage1Text = stage1Results
    .map((r) => `Model: ${r.model}\nResponse: ${r.response}`)
    .join('\n\n');

  const stage2Text = stage2Results
    .map((r) => `Model: ${r.model}\nRanking: ${r.ranking}`)
    .join('\n\n');

  const chairmanPrompt = `You are the Chairman of an LLM Council. Multiple AI models have provided responses to a user's question, and then ranked each other's responses.

Original Question: ${userQuery}

STAGE 1 - Individual Responses:
${stage1Text}

STAGE 2 - Peer Rankings:
${stage2Text}

Your task as Chairman is to synthesize all of this information into a single, comprehensive, accurate answer to the user's original question. Consider:
- The individual responses and their insights
- The peer rankings and what they reveal about response quality
- Any patterns of agreement or disagreement

Provide a clear, well-reasoned final answer that represents the council's collective wisdom:`;

  const messages = [{ role: 'user', content: chairmanPrompt }];
  const response = await queryModel(chairmanModel, messages);

  if (response === null) {
    return {
      model: chairmanModel,
      response: 'Error: Unable to generate final synthesis.',
    };
  }

  return {
    model: chairmanModel,
    response: response.content || '',
  };
}

/**
 * Parse the FINAL RANKING section from the model's response.
 * Returns list of response labels in ranked order.
 */
function parseRankingFromText(rankingText) {
  if (typeof rankingText !== 'string' || !rankingText.trim()) {
    return [];
  }

  const upperText = rankingText.toUpperCase();
  const finalRankingIndex = upperText.lastIndexOf('FINAL RANKING:');
  if (finalRankingIndex === -1) {
    return [];
  }

  const rankingSection = rankingText.slice(finalRankingIndex + 'FINAL RANKING:'.length);
  const labels = [];

  for (const line of rankingSection.split('\n')) {
    const match = line.match(/^\s*\d+\.\s*(Response [A-Z])\b/i);
    if (match) {
      labels.push(match[1].replace(/\s+/g, ' ').trim());
      continue;
    }

    if (labels.length > 0 && line.trim()) {
      break;
    }
  }

  return labels;
}

/**
 * Calculate aggregate rankings across all models.
 * Returns sorted array of { model, average_rank, rankings_count }.
 */
function calculateAggregateRankings(stage2Results, labelToModel) {
  const modelPositions = {};

  for (const ranking of stage2Results) {
    const parsedRanking = parseRankingFromText(ranking.ranking);

    parsedRanking.forEach((label, index) => {
      const position = index + 1;
      if (label in labelToModel) {
        const modelName = labelToModel[label];
        if (!modelPositions[modelName]) {
          modelPositions[modelName] = [];
        }
        modelPositions[modelName].push(position);
      }
    });
  }

  const aggregate = [];
  for (const [model, positions] of Object.entries(modelPositions)) {
    if (positions.length > 0) {
      const avgRank = positions.reduce((a, b) => a + b, 0) / positions.length;
      aggregate.push({
        model,
        average_rank: Math.round(avgRank * 100) / 100,
        rankings_count: positions.length,
      });
    }
  }

  aggregate.sort((a, b) => a.average_rank - b.average_rank);
  return aggregate;
}

/**
 * Generate a short title for a conversation based on the first user message.
 */
async function generateConversationTitle(userQuery) {
  const titlePrompt = `Generate a very short title (3-5 words maximum) that summarizes the following question.
The title should be concise and descriptive. Do not use quotes or punctuation in the title.

Question: ${userQuery}

Title:`;

  const messages = [{ role: 'user', content: titlePrompt }];
  const titleModels = await getConnectedCouncilModels();

  if (titleModels.length === 0) {
    return 'New Conversation';
  }

  let response = null;
  for (const model of titleModels) {
    response = await queryModel(model, messages, 30000);
    if (response !== null) {
      break;
    }
  }

  if (response === null) {
    return 'New Conversation';
  }

  let title = (response.content || 'New Conversation').trim();
  title = title.replace(/^["']|["']$/g, '');

  if (title.length > 50) {
    title = title.slice(0, 47) + '...';
  }

  return title;
}

/**
 * Run the complete 3-stage council process.
 * Returns [stage1Results, stage2Results, stage3Result, metadata].
 */
async function runFullCouncil(userQuery) {
  const [stage1Results, stage1Failures] = await stage1CollectResponses(userQuery);

  if (stage1Results.length === 0) {
    return [
      [],
      [],
      { model: 'error', response: 'All connected models failed to respond. Please try again.' },
      { stage1_failures: stage1Failures, stage2_failures: [] },
    ];
  }

  const [stage2Results, labelToModel, stage2Failures] = await stage2CollectRankings(userQuery, stage1Results);
  const aggregateRankings = calculateAggregateRankings(stage2Results, labelToModel);
  const stage3Result = await stage3SynthesizeFinal(userQuery, stage1Results, stage2Results);

  const metadata = {
    label_to_model: labelToModel,
    aggregate_rankings: aggregateRankings,
    stage1_failures: stage1Failures,
    stage2_failures: stage2Failures,
  };

  return [stage1Results, stage2Results, stage3Result, metadata];
}

module.exports = {
  stage1CollectResponses,
  stage2CollectRankings,
  stage3SynthesizeFinal,
  calculateAggregateRankings,
  generateConversationTitle,
  runFullCouncil,
};
