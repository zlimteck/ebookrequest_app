import axios from 'axios';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import { getAIProviderConfig } from './aiProviderConfig.js';

dotenv.config();

/**
 * Returns true if an AI provider is properly configured.
 */
export const isAIConfigured = async () => {
  const cfg = await getAIProviderConfig();
  if (cfg.provider === 'openai') return Boolean(cfg.openaiApiKey);
  if (cfg.provider === 'ollama') return Boolean(cfg.ollamaUrl && cfg.ollamaModel);
  if (cfg.provider === 'claude') return Boolean(cfg.anthropicApiKey);
  return false;
};

// Modèles à exclure de la liste OpenAI (pas des modèles de chat) : embeddings,
// audio, image, modération... Tout le reste (gpt-*, o1/o3/o4-*, chatgpt-*) est
// gardé, sans liste figée de noms exacts, pour rester à jour automatiquement
// dès qu'OpenAI sort un nouveau modèle sans qu'on ait besoin de mettre à jour
// le code.
const OPENAI_NON_CHAT_PATTERN = /embedding|whisper|tts|dall-e|moderation|davinci|babbage|ada|curie/i;

/**
 * Liste les modèles de chat disponibles pour le provider donné, en interrogeant
 * directement l'API du fournisseur (jamais une liste codée en dur côté app,
 * qui deviendrait obsolète à chaque nouveau modèle sorti par OpenAI/Anthropic).
 */
export const listAvailableModels = async (provider, apiKey) => {
  if (!apiKey) throw new Error('Clé API requise.');

  if (provider === 'openai') {
    const client = new OpenAI({ apiKey });
    const res = await client.models.list();
    return res.data
      .filter(m => !OPENAI_NON_CHAT_PATTERN.test(m.id))
      .sort((a, b) => (b.created || 0) - (a.created || 0))
      .map(m => m.id);
  }

  if (provider === 'claude') {
    const client = new Anthropic({ apiKey });
    const res = await client.models.list({ limit: 100 });
    return res.data
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .map(m => m.id);
  }

  throw new Error(`Liste de modèles non disponible pour le provider "${provider}".`);
};

/**
 * Unified interface for AI text generation
 * @param {string} prompt - The prompt to send to the AI
 * @param {object} options - Generation options (temperature, top_p, top_k, timeout)
 * @returns {Promise<{text: string, tokensUsed: number, model: string, provider: string}>}
 */
export const generateCompletion = async (prompt, options = {}) => {
  const cfg = await getAIProviderConfig();
  const provider = cfg.provider.toLowerCase();

  switch (provider) {
    case 'openai':
      return await generateWithOpenAI(cfg, prompt, options);
    case 'ollama':
      return await generateWithOllama(cfg, prompt, options);
    case 'claude':
      return await generateWithClaude(cfg, prompt, options);
    default:
      throw new Error(`Unknown AI provider: ${cfg.provider}. Use 'openai', 'ollama' or 'claude'.`);
  }
};

/**
 * Generate completion using OpenAI API
 */
async function generateWithOpenAI(cfg, prompt, options = {}) {
  if (!cfg.openaiApiKey) {
    throw new Error('OpenAI API key not configured.');
  }
  const openaiClient = new OpenAI({ apiKey: cfg.openaiApiKey });

  const {
    temperature = 0.7,
    top_p = 0.9,
    timeout = 60000,
    max_tokens = 2000
  } = options;

  try {
    console.log('Sending request to OpenAI...', { model: cfg.openaiModel });

    const completion = await openaiClient.chat.completions.create({
      model: cfg.openaiModel,
      messages: [
        {
          role: 'system',
          content: 'Tu es un expert en littérature qui recommande des livres de manière précise et pertinente.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature,
      top_p,
      max_tokens
    }, {
      timeout
    });

    const text = completion.choices[0].message.content;
    const tokensUsed = completion.usage.total_tokens;

    console.log('Response received from OpenAI', {
      model: completion.model,
      tokensUsed,
      promptTokens: completion.usage.prompt_tokens,
      completionTokens: completion.usage.completion_tokens
    });

    return {
      text,
      tokensUsed,
      model: completion.model,
      provider: 'openai'
    };

  } catch (error) {
    console.error('Error generating completion with OpenAI:', error.message);

    if (error.status === 401) {
      throw new Error('Invalid OpenAI API key.');
    }

    if (error.status === 429) {
      throw new Error('OpenAI rate limit exceeded. Please try again later.');
    }

    if (error.status === 404) {
      throw new Error(`OpenAI model '${cfg.openaiModel}' not found or not accessible.`);
    }

    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
      throw new Error('OpenAI request timed out. Please try again.');
    }

    throw new Error(`OpenAI error: ${error.message}`);
  }
}

/**
 * Generate completion using Ollama API
 */
async function generateWithOllama(cfg, prompt, options = {}) {
  if (!cfg.ollamaUrl || !cfg.ollamaModel) {
    throw new Error('Ollama not configured.');
  }

  const {
    temperature = 0.7,
    top_p = 0.9,
    top_k = 40,
    timeout = 60000
  } = options;

  try {
    console.log('Sending request to Ollama...', { model: cfg.ollamaModel, url: cfg.ollamaUrl });

    const response = await axios.post(`${cfg.ollamaUrl}/api/generate`, {
      model: cfg.ollamaModel,
      prompt: prompt,
      stream: false,
      options: {
        temperature,
        top_p,
        top_k
      }
    }, {
      timeout
    });

    console.log('Response received from Ollama');

    const text = response.data.response;
    const tokensUsed = response.data.eval_count || null;

    return {
      text,
      tokensUsed,
      model: cfg.ollamaModel,
      provider: 'ollama'
    };

  } catch (error) {
    console.error('Error generating completion with Ollama:', error.message);

    if (error.code === 'ECONNREFUSED') {
      throw new Error('Unable to connect to Ollama server. Check that the service is running.');
    }

    if (error.code === 'ETIMEDOUT') {
      throw new Error('Ollama server is taking too long to respond. Try again later.');
    }

    throw new Error(`Ollama error: ${error.message}`);
  }
}

/**
 * Generate completion using Claude (Anthropic) API
 */
async function generateWithClaude(cfg, prompt, options = {}) {
  if (!cfg.anthropicApiKey) {
    throw new Error('Anthropic API key not configured.');
  }
  const anthropicClient = new Anthropic({ apiKey: cfg.anthropicApiKey });

  const {
    temperature = 0.7,
    max_tokens  = 2000,
    timeout     = 60000,
  } = options;

  try {
    console.log('Sending request to Claude...', { model: cfg.claudeModel });

    const message = await anthropicClient.messages.create(
      {
        model:      cfg.claudeModel,
        max_tokens,
        system:     'Tu es un expert en littérature qui recommande des livres de manière précise et pertinente.',
        messages:   [{ role: 'user', content: prompt }],
        temperature,
      },
      { timeout }
    );

    const text       = message.content[0].text;
    const tokensUsed = (message.usage.input_tokens || 0) + (message.usage.output_tokens || 0);

    console.log('Response received from Claude', { model: message.model, tokensUsed });

    return { text, tokensUsed, model: message.model, provider: 'claude' };

  } catch (error) {
    console.error('Error generating completion with Claude:', error.message);

    if (error.status === 401) throw new Error('Invalid Anthropic API key.');
    if (error.status === 429) throw new Error('Anthropic rate limit exceeded. Please try again later.');
    if (error.status === 404) throw new Error(`Claude model '${cfg.claudeModel}' not found.`);

    throw new Error(`Claude error: ${error.message}`);
  }
}

/**
 * Test connection to the configured AI provider
 * @returns {Promise<{connected: boolean, provider: string, model: string, url?: string, error?: string}>}
 */
export const testAIProviderConnection = async (explicitCfg = null) => {
  const cfg = explicitCfg || await getAIProviderConfig();
  const provider = cfg.provider.toLowerCase();

  try {
    if (provider === 'openai') {
      return await testOpenAIConnection(cfg);
    } else if (provider === 'ollama') {
      return await testOllamaConnection(cfg);
    } else if (provider === 'claude') {
      return await testClaudeConnection(cfg);
    } else {
      return {
        connected: false,
        provider: cfg.provider,
        error: `Unknown provider: ${cfg.provider}`
      };
    }
  } catch (error) {
    return {
      connected: false,
      provider,
      error: error.message
    };
  }
};

async function testOpenAIConnection(cfg) {
  if (!cfg.openaiApiKey) {
    return {
      connected: false,
      provider: 'openai',
      model: cfg.openaiModel,
      error: 'OpenAI API key not configured'
    };
  }

  try {
    const openaiClient = new OpenAI({ apiKey: cfg.openaiApiKey });
    const models = await openaiClient.models.list();

    return {
      connected: true,
      provider: 'openai',
      model: cfg.openaiModel,
      modelAvailable: true,
      availableModels: models.data.map(m => m.id).slice(0, 10)
    };
  } catch (error) {
    return {
      connected: false,
      provider: 'openai',
      model: cfg.openaiModel,
      error: error.message
    };
  }
}

async function testOllamaConnection(cfg) {
  if (!cfg.ollamaUrl || !cfg.ollamaModel) {
    return {
      connected: false,
      provider: 'ollama',
      url: cfg.ollamaUrl,
      model: cfg.ollamaModel,
      error: 'Ollama URL or model not configured'
    };
  }

  try {
    const response = await axios.get(`${cfg.ollamaUrl}/api/tags`, {
      timeout: 5000
    });

    const models = response.data.models || [];
    const modelExists = models.some(m => m.name.includes(cfg.ollamaModel.split(':')[0]));

    return {
      connected: true,
      provider: 'ollama',
      url: cfg.ollamaUrl,
      model: cfg.ollamaModel,
      modelAvailable: modelExists,
      availableModels: models.map(m => m.name)
    };
  } catch (error) {
    return {
      connected: false,
      provider: 'ollama',
      url: cfg.ollamaUrl,
      model: cfg.ollamaModel,
      error: error.message
    };
  }
}

async function testClaudeConnection(cfg) {
  if (!cfg.anthropicApiKey) {
    return { connected: false, provider: 'claude', model: cfg.claudeModel, error: 'Anthropic API key not configured' };
  }

  try {
    const anthropicClient = new Anthropic({ apiKey: cfg.anthropicApiKey });
    await anthropicClient.messages.create({
      model:      cfg.claudeModel,
      max_tokens: 10,
      messages:   [{ role: 'user', content: 'Hi' }],
    });

    return { connected: true, provider: 'claude', model: cfg.claudeModel };
  } catch (error) {
    return { connected: false, provider: 'claude', model: cfg.claudeModel, error: error.message };
  }
}

/**
 * Get information about the active AI provider
 * @returns {Promise<{provider: string, model: string, url?: string}>}
 */
export const getProviderInfo = async () => {
  const cfg = await getAIProviderConfig();
  const model = cfg.provider === 'openai' ? cfg.openaiModel
              : cfg.provider === 'claude'  ? cfg.claudeModel
              : cfg.ollamaModel;
  return {
    provider: cfg.provider,
    model,
    url: cfg.provider === 'ollama' ? cfg.ollamaUrl : undefined,
  };
};
