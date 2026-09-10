import test from 'node:test';
import assert from 'node:assert/strict';
import {watchYaml} from '../runtime/data-source.mjs';

test('hourly YAML refresh applies changes, preserves valid data on errors, and resumes after hidden tabs', async t => {
  t.mock.timers.enable({apis:['setTimeout','Date']});
  const document = new EventTarget(); document.hidden = false;
  globalThis.document = document;
  const calls = [], values = [], errors = [];
  let body = 'value: 1';
  globalThis.fetch = async (url, options) => {calls.push({url,options});return new Response(body);};
  const source = watchYaml('/website.yaml', {
    validate(data) {if (!Number.isFinite(data?.value)) throw Error('Invalid');return data;},
    onData:data=>values.push(data.value),onError:error=>errors.push(error),
  });
  const settle = () => new Promise(resolve=>setImmediate(resolve));
  await settle();
  assert.deepEqual(values,[1]);
  body = 'value: 2';
  t.mock.timers.tick(3600000); await settle();
  assert.deepEqual(values,[1,2]);
  assert.ok(calls.every(call=>call.options.cache==='no-store'));
  body = 'value: [broken';
  t.mock.timers.tick(3600000); await settle();
  assert.deepEqual(values,[1,2]);assert.equal(errors.length,1);
  document.hidden = true;
  const before = calls.length;
  t.mock.timers.tick(3600000); await settle();
  assert.equal(calls.length,before);
  body = 'value: 3';document.hidden = false;document.dispatchEvent(new Event('visibilitychange'));await settle();
  assert.deepEqual(values,[1,2,3]);
  source.dispose();
  t.mock.timers.tick(3600000);await settle();
  assert.equal(calls.length,before+1);
});
