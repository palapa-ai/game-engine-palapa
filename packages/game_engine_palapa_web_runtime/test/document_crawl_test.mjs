import test from 'node:test';
import assert from 'node:assert/strict';
import { copyDocument, createDocumentCrawl } from '../runtime/components/document-crawl.mjs';

class Element {
  constructor(tagName = '', text = '') {
    this.tagName = tagName.toUpperCase(); this.nodeType = tagName ? 1 : 3;
    this.text = text; this.childNodes = []; this.attributes = {}; this.handlers = {};
    this.classes = new Set(); this.classList = { toggle: (name, value) => value ? this.classes.add(name) : this.classes.delete(name) };
    this.clientHeight = 500; this.scrollHeight = 1200; this.animations = [];
  }
  get textContent() { return this.text + this.childNodes.map(node => node.textContent).join(''); }
  set textContent(value) { this.text = value; this.childNodes = []; }
  append(node) { this.childNodes.push(node); }
  replaceChildren() { this.text = ''; this.childNodes = []; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, fn) { this.handlers[name] = fn; }
  removeEventListener(name) { delete this.handlers[name]; }
  showModal() { this.open = true; }
  close() { this.open = false; this.handlers.close?.(); }
  focus() { this.focused = true; }
  remove() { this.removed = true; }
  animate(frames, options) {
    const animation = { frames, options, cancel() { this.cancelled = true; } };
    this.animations.push(animation); return animation;
  }
}

function environment(t, reduced = false) {
  const selectors = Object.fromEntries(['dialog', '.stage', '.copy', '.status', '.close', '.original', '#title'].map(name => [name, new Element('div')]));
  const root = { querySelector: selector => selectors[selector] };
  const host = new Element('div'); host.attachShadow = () => root;
  const opener = new Element('a'), motion = new Element('media'); motion.matches = reduced;
  const replacements = {
    document: {
      activeElement: opener, body: new Element('body'),
      createElement: tag => tag === 'div' ? host : new Element(tag),
      createTextNode: text => new Element('', text), createDocumentFragment: () => new Element('fragment'),
    },
    location: { href: 'https://palapa.test/' },
    matchMedia: () => motion,
    DOMParser: class { parseFromString(text) { return { body: { childNodes: [new Element('', text)] } }; } },
    fetch: async () => new Response('Every word, exactly.\nTerms & conditions.'),
  };
  const originals = Object.fromEntries(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(() => {
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  return { selectors, host, opener, motion };
}

test('document copying preserves legal words, punctuation, and links without executable content', t => {
  environment(t);
  const paragraph = new Element('p'); paragraph.append(new Element('', 'You agree: “word for word,” including 2.3(a). '));
  const link = new Element('a'); link.setAttribute('href', '/privacy-policy.html'); link.append(new Element('', 'Privacy Policy'));
  paragraph.append(link);
  const script = new Element('script'); script.append(new Element('', 'untrusted code'));
  const unsafeLink = new Element('a'); unsafeLink.setAttribute('href', 'javascript:alert(1)'); unsafeLink.append(new Element('', 'Still text.'));
  const target = new Element('article');
  copyDocument({ childNodes: [paragraph, script, unsafeLink] }, target, 'https://palapa.test/tos.html');
  assert.equal(target.textContent, 'You agree: “word for word,” including 2.3(a). Privacy PolicyStill text.');
  assert.equal(target.childNodes[0].childNodes[1].href, 'https://palapa.test/privacy-policy.html');
  assert.equal(target.childNodes[1].href, undefined);
});

test('crawl keeps a direct document link and becomes readable for reduced motion or keyboard focus', async t => {
  const { selectors, host, opener, motion } = environment(t, true);
  const popup = createDocumentCrawl();
  await popup.open({ title: 'Terms of Service', url: '/tos.html' });
  const copy = selectors['.copy'], stage = selectors['.stage'], link = selectors['.original'];
  assert.equal(copy.textContent, 'Every word, exactly.\nTerms & conditions.');
  assert.equal(link.href, '/tos.html');
  assert.equal(link.getAttribute('aria-label'), 'Open full Terms of Service in a new tab');
  assert.equal(stage.classes.has('reading'), true);
  assert.equal(copy.animations.length, 0);
  selectors['dialog'].close();
  assert.equal(opener.focused, true);
  motion.matches = false;
  await popup.open({ title: 'Privacy Policy', url: '/privacy-policy.html' });
  assert.equal(copy.animations.length, 1);
  assert.equal(copy.animations[0].options.iterations, Infinity);
  stage.handlers.focusin();
  assert.equal(stage.classes.has('reading'), true);
  assert.equal(copy.animations[0].cancelled, true);
  popup.dispose();
  assert.equal(host.removed, true);
  assert.equal(motion.handlers.change, undefined);
});

test('closing during a document download cannot revive its crawl', async t => {
  const { selectors } = environment(t);
  let finish, signal;
  globalThis.fetch = (_, options) => { signal = options.signal; return new Promise(resolve => { finish = resolve; }); };
  const popup = createDocumentCrawl();
  const pending = popup.open({ title: 'Terms of Service', url: '/tos.html' });
  selectors['dialog'].close();
  assert.equal(signal.aborted, true);
  finish(new Response('Late response'));
  await pending;
  assert.equal(selectors['.copy'].textContent, '');
  assert.equal(selectors['.copy'].animations.length, 0);
  popup.dispose();
});
