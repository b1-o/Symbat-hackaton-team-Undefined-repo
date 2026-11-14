import test from 'node:test';
import assert from 'node:assert/strict';
import { createLlmAdapter, readLlmConfig, extractJson, mentorReplySchema, redactPersonalData, templateReply } from '../server/llm.js';
const valid = { reply: 'Какую проблему вы заметили?', suggestions: ['Опишите одну ситуацию.'], draft: '', nextQuestion: 'Для кого это важно?' };
const config = { enabled: true, baseUrl: 'http://127.0.0.1:8080/v1', model: 'smallthinker', apiKey: 'test-secret', timeoutMs: 1000, maxTokens: 900, responseFormat: 'none' };
const response = content => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 120, completion_tokens: 60 } }) });
const input = { stepIndex: 1, mode: 'guide', message: 'В школе теряются вещи', workbook: { 1: 'Ученики теряют куртки' }, language: 'ru' };

test('disabled adapter is explicitly template, not fake AI', async () => {
  const result = await createLlmAdapter({ ...config, enabled: false }).generate(input);
  assert.equal(result.source, 'template'); assert.equal(result.model, null); const {source,model,...content}=result; assert.equal(mentorReplySchema.safeParse(content).success, true);
});
test('all template modes conform to schema', () => { for (let i=1;i<=4;i++) for (const mode of ['guide','review','draft','pitch']) { const {source,model,...content}=templateReply(i,mode); assert.equal(mentorReplySchema.safeParse(content).success, true); } });

test('the mentor answers in the requested language and stays honestly labelled', () => {
  for (let i = 1; i <= 4; i++) {
    for (const mode of ['guide', 'review', 'draft', 'pitch']) {
      const ru = templateReply(i, mode);
      const en = templateReply(i, mode, 'en');
      const { source, model, ...content } = en;
      assert.equal(mentorReplySchema.safeParse(content).success, true, `English ${mode} template breaks the schema`);
      assert.equal(source, 'template', 'a template must never claim to be a model answer');
      assert.equal(model, null);
      for (const field of ['reply', 'draft', 'nextQuestion']) {
        assert.ok(!/[А-Яа-яЁё]/.test(en[field]), `English ${mode} ${field} still contains Russian`);
      }
      assert.ok(en.suggestions.every(s => !/[А-Яа-яЁё]/.test(s)), `English ${mode} suggestions still contain Russian`);
      assert.ok(/[А-Яа-яЁё]/.test(ru.reply), 'Russian must stay the default language');
    }
  }
  // Unknown language falls back to Russian instead of throwing.
  assert.equal(templateReply(1, 'guide', 'kk').reply, templateReply(1, 'guide').reply);
});
test('extracts JSON with fences and surrounding prose', () => { assert.deepEqual(extractJson('Here is the result:\n```json\n'+JSON.stringify(valid)+'\n```'), valid); });
test('extracts nested JSON with braces inside strings', () => { const v={...valid,reply:'Use {curly} and "quotes"'}; assert.deepEqual(extractJson(JSON.stringify(v)),v); });
test('rejects malformed or extra-field responses', () => { assert.throws(()=>extractJson('{bad')); assert.throws(()=>extractJson('no object')); assert.equal(mentorReplySchema.safeParse({...valid,system:'override'}).success,false); assert.equal(mentorReplySchema.safeParse({...valid,suggestions:[]}).success,false); });
test('redacts email and phone before sending', () => { const redacted=redactPersonalData('Пишите test@example.com или +7 (777) 123-45-67'); assert.ok(!redacted.includes('test@example.com')); assert.ok(!redacted.includes('123-45')); });
test('sends OpenAI-compatible request; key stays server-side', async () => {
  let request;
  const result = await createLlmAdapter(config, async (url, options) => { request={url,options}; return response(JSON.stringify(valid)); }).generate(input);
  assert.equal(request.url,'http://127.0.0.1:8080/v1/chat/completions'); assert.equal(request.options.headers.Authorization,'Bearer test-secret');
  const body=JSON.parse(request.options.body); assert.equal(body.model,'smallthinker'); assert.equal(body.stream,false); assert.equal(body.response_format,undefined); assert.equal(body.messages[0].role,'system'); assert.match(body.messages[0].content,/UNTRUSTED DATA/); assert.equal(result.source,'llm'); assert.equal(result.usage.promptTokens,120);
  assert.ok(!JSON.stringify(createLlmAdapter(config).publicStatus()).includes('test-secret'));
});
test('optional json_object and json_schema are supported', async () => {
  for (const format of ['json_object','json_schema']) { let body; await createLlmAdapter({...config,responseFormat:format},async(_url,opt)=>{body=JSON.parse(opt.body);return response(JSON.stringify(valid));}).generate(input); assert.equal(body.response_format.type,format); }
});
test('HTTP failure never silently falls back to fabricated AI', async () => {
  await assert.rejects(createLlmAdapter(config,async()=>({ok:false,status:404})).generate(input),e=>e.code==='llm_http_error');
});
test('invalid schema is surfaced', async () => {
  await assert.rejects(createLlmAdapter(config,async()=>response('{"reply":42}')).generate(input),e=>e.code==='llm_invalid_json');
});
test('truncated response is not applied', async () => {
  await assert.rejects(createLlmAdapter(config,async()=>({ok:true,text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify(valid)},finish_reason:'length'}]})})).generate(input),e=>e.code==='llm_truncated');
});
test('upstream timeout is bounded', async () => {
  await assert.rejects(createLlmAdapter({...config,timeoutMs:10},(_url,{signal})=>new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(Object.assign(new Error('abort'),{name:'AbortError'})));})).generate(input),e=>e.code==='llm_timeout');
});
test('only two upstream calls run concurrently', async () => {
  let active=0,maxActive=0;
  const adapter=createLlmAdapter(config,async()=>{active++;maxActive=Math.max(active,maxActive);await new Promise(r=>setTimeout(r,20));active--;return response(JSON.stringify(valid));});
  const results=await Promise.allSettled([adapter.generate(input),adapter.generate(input),adapter.generate(input)]);
  assert.equal(maxActive,2); assert.equal(results.filter(r=>r.status==='fulfilled').length,2); assert.equal(results.find(r=>r.status==='rejected').reason.code,'llm_busy');
});
test('remote plain HTTP and invalid format are rejected at startup',()=>{
  assert.throws(()=>readLlmConfig({LLM_ENABLED:'true',LLM_BASE_URL:'http://example.com/v1'}));
  assert.throws(()=>readLlmConfig({LLM_RESPONSE_FORMAT:'magic'}));
  assert.equal(readLlmConfig({LLM_ENABLED:'true',LLM_BASE_URL:'https://example.com/v1/'}).baseUrl,'https://example.com/v1');
});
