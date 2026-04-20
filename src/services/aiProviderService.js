import axios from 'axios';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

// Configuration
const AI_PROVIDER = process.env.AI_PROVIDER || 'openai';
const OLLAMA_URL = process.env.OLLAMA_URL;
const OLLAMA_MODEL = process.env.OLLAMA_MODEL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// Initialize OpenAI client if using OpenAI
let openaiClient = null;
if (AI_PROVIDER === 'openai' && OPENAI_API_KEY) {
  openaiClient = new OpenAI({
    apiKey: OPENAI_API_KEY
  });
}

console.log(`AI Provider configured: ${AI_PROVIDER}`);

/**
 * Unified interface for AI text generation
 * @param {string} prompt - The prompt to send to the AI
 * @param {object} options - Generation options (temperature, top_p, top_k, timeout)
 * @returns {Promise<{text: string, tokensUsed: number, model: string, provider: string}>}
 */
export const generateCompletion = async (prompt, options = {}) => {
  const provider = AI_PROVIDER.toLowerCase();

  switch (provider) {
    case 'openai':
      return await generateWithOpenAI(prompt, options);
    case 'ollama':
      return await generateWithOllama(prompt, options);
    default:
      throw new Error(`Unknown AI provider: ${AI_PROVIDER}. Use 'openai' or 'ollama'.`);
  }
};

/**
 * Generate completion using OpenAI API
 * @param {string} prompt - The prompt
 * @param {object} options - Options (temperature, top_p, timeout)
 * @returns {Promise<{text: string, tokensUsed: number, model: string, provider: string}>}
 */
async function generateWithOpenAI(prompt, options = {}) {
  if (!openaiClient) {
    throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY environment variable.');
  }

  const {
    temperature = 0.7,
    top_p = 0.9,
    timeout = 60000,
    max_tokens = 2000
  } = options;

  try {
    console.log('Sending request to OpenAI...', { model: OPENAI_MODEL });

    const completion = await openaiClient.chat.completions.create({
      model: OPENAI_MODEL,
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

    // Handle specific OpenAI errors
    if (error.status === 401) {
      throw new Error('Invalid OpenAI API key. Please check your OPENAI_API_KEY environment variable.');
    }

    if (error.status === 429) {
      throw new Error('OpenAI rate limit exceeded. Please try again later.');
    }

    if (error.status === 404) {
      throw new Error(`OpenAI model '${OPENAI_MODEL}' not found or not accessible.`);
    }

    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
      throw new Error('OpenAI request timed out. Please try again.');
    }

    throw new Error(`OpenAI error: ${error.message}`);
  }
}

/**
 * Generate completion using Ollama API
 * @param {string} prompt - The prompt
 * @param {object} options - Options (temperature, top_p, top_k, timeout)
 * @returns {Promise<{text: string, tokensUsed: number, model: string, provider: string}>}
 */
async function generateWithOllama(prompt, options = {}) {
  if (!OLLAMA_URL || !OLLAMA_MODEL) {
    throw new Error('Ollama not configured. Set OLLAMA_URL and OLLAMA_MODEL environment variables.');
  }

  const {
    temperature = 0.7,
    top_p = 0.9,
    top_k = 40,
    timeout = 60000
  } = options;

  try {
    console.log('Sending request to Ollama...', { model: OLLAMA_MODEL, url: OLLAMA_URL });

    const response = await axios.post(`${OLLAMA_URL}/api/generate`, {
      model: OLLAMA_MODEL,
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
      model: OLLAMA_MODEL,
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
 * Test connection to the configured AI provider
 * @returns {Promise<{connected: boolean, provider: string, model: string, url?: string, error?: string}>}
 */
export const testAIProviderConnection = async () => {
  const provider = AI_PROVIDER.toLowerCase();

  try {
    if (provider === 'openai') {
      return await testOpenAIConnection();
    } else if (provider === 'ollama') {
      return await testOllamaConnection();
    } else {
      return {
        connected: false,
        provider: AI_PROVIDER,
        error: `Unknown provider: ${AI_PROVIDER}`
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

/**
 * Test OpenAI connection
 */
async function testOpenAIConnection() {
  if (!openaiClient) {
    return {
      connected: false,
      provider: 'openai',
      model: OPENAI_MODEL,
      error: 'OpenAI API key not configured'
    };
  }

  try {
    // Try to list models to verify API key works
    const models = await openaiClient.models.list();

    return {
      connected: true,
      provider: 'openai',
      model: OPENAI_MODEL,
      modelAvailable: true,
      availableModels: models.data.map(m => m.id).slice(0, 10) // First 10 models
    };
  } catch (error) {
    return {
      connected: false,
      provider: 'openai',
      model: OPENAI_MODEL,
      error: error.message
    };
  }
}

/**
 * Test Ollama connection
 */
async function testOllamaConnection() {
  if (!OLLAMA_URL || !OLLAMA_MODEL) {
    return {
      connected: false,
      provider: 'ollama',
      url: OLLAMA_URL,
      model: OLLAMA_MODEL,
      error: 'Ollama URL or model not configured'
    };
  }

  try {
    const response = await axios.get(`${OLLAMA_URL}/api/tags`, {
      timeout: 5000
    });

    const models = response.data.models || [];
    const modelExists = models.some(m => m.name.includes(OLLAMA_MODEL.split(':')[0]));

    return {
      connected: true,
      provider: 'ollama',
      url: OLLAMA_URL,
      model: OLLAMA_MODEL,
      modelAvailable: modelExists,
      availableModels: models.map(m => m.name)
    };
  } catch (error) {
    return {
      connected: false,
      provider: 'ollama',
      url: OLLAMA_URL,
      model: OLLAMA_MODEL,
      error: error.message
    };
  }
}

/**
 * Get information about the active AI provider
 * @returns {{provider: string, model: string, url?: string}}
 */
export const getProviderInfo = () => {
  return {
    provider: AI_PROVIDER,
    model: AI_PROVIDER === 'openai' ? OPENAI_MODEL : OLLAMA_MODEL,
    url: AI_PROVIDER === 'ollama' ? OLLAMA_URL : undefined
  };
};
