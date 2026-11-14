import { readLlmConfig, createLlmAdapter } from '../server/llm.js';
const config = readLlmConfig();
if (!config.enabled) {
  console.error('LLM_ENABLED is false. Set the environment variables from .env.example first.');
  process.exit(1);
}
console.log(`Checking OpenAI-compatible endpoint with model "${config.model}"…`);
try {
  const result = await createLlmAdapter(config).generate({
    stepIndex: 1,
    mode: 'guide',
    message: 'Задай один короткий вопрос о проблеме школьника.',
    workbook: {},
    language: 'ru',
  });
  console.log(
    JSON.stringify(
      {
        ok: true,
        source: result.source,
        model: result.model,
        reply: result.reply,
        nextQuestion: result.nextQuestion,
        usage: result.usage,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify({ ok: false, code: error.code || 'configuration_error', message: error.message }),
  );
  process.exitCode = 1;
}
