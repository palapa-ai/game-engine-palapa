const allowed = new Set(['P', 'DIV', 'SPAN', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'A', 'STRONG', 'B', 'EM', 'I', 'U', 'BR', 'HR', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'BLOCKQUOTE', 'SUP', 'SUB']);
const omitted = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'FORM']);

export function copyDocument(source, target, base) {
  for (const node of source.childNodes) {
    if (node.nodeType === 3) { target.append(document.createTextNode(node.textContent)); continue; }
    if (node.nodeType !== 1 || omitted.has(node.tagName)) continue;
    const copy = allowed.has(node.tagName) ? document.createElement(node.tagName.toLowerCase()) : document.createDocumentFragment();
    if (node.tagName === 'A') {
      const href = new URL(node.getAttribute('href') || '', base);
      if (['http:', 'https:', 'mailto:'].includes(href.protocol)) {
        copy.href = href.href; copy.target = '_blank'; copy.rel = 'noopener noreferrer';
      }
    }
    for (const attribute of ['start', 'colspan', 'rowspan']) {
      const value = node.getAttribute(attribute);
      if (value && /^\d+$/.test(value) && copy.setAttribute) copy.setAttribute(attribute, value);
    }
    copyDocument(node, copy, base); target.append(copy);
  }
}

export function createDocumentCrawl() {
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    *{box-sizing:border-box}dialog{width:min(1120px,94vw,163dvh);max-width:none;max-height:92dvh;aspect-ratio:16/9;padding:0;border:1px solid #888;border-radius:0;background:#000;color:#fff;font:16px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow:hidden}
    dialog::backdrop{background:#0009}.screen{position:absolute;inset:0}.title{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
    .control{position:absolute;right:4px;z-index:2;display:grid;place-items:center;width:44px;height:44px;padding:10px;border:0;border-radius:0;background:#000;color:#fff;cursor:pointer}.control svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}.control:focus-visible,.copy a:focus-visible{outline:2px solid #66f5f5;outline-offset:-3px}.close{top:4px}.original{bottom:4px}
    .stage{position:absolute;inset:24px 48px;overflow:hidden;perspective:420px;perspective-origin:50% 12%}
    .tilt{position:absolute;inset:0;transform:rotateX(25deg);transform-origin:50% 100%;transform-style:preserve-3d}.copy{width:80%;margin:0 auto;font-size:clamp(14px,2.1vw,25px);line-height:1.6;text-align:start;font-weight:400;overflow-wrap:anywhere}.copy p{margin:0 0 1em}.copy a{font:inherit;color:inherit}.copy table{width:100%}.copy h1,.copy h2{text-align:center}.copy li{margin-bottom:.5em}
    .stage.reading{overflow:auto;perspective:none}.reading .tilt{position:static;transform:none}.reading .copy{width:auto;max-width:850px;margin:auto;font-size:16px}.status{color:#fff}.status:empty{display:none}
    @media(max-width:600px){.stage{inset:16px 44px 16px 16px}.copy{width:90%}.reading .copy{font-size:14px}}
  </style><dialog aria-labelledby="title"><div class="screen"><h2 class="title" id="title"></h2><button class="control close" aria-label="Close" title="Close" autofocus><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button><div class="stage" tabindex="0" aria-label="Document text"><div class="status" role="status"></div><div class="tilt"><article class="copy"></article></div></div><a class="control original" target="_blank" rel="noopener noreferrer" aria-label="Open full document in a new tab" title="Open full document"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h8"/></svg></a></div></dialog>`;
  document.body.append(host);
  const get = selector => root.querySelector(selector);
  const dialog = get('dialog'), stage = get('.stage'), copy = get('.copy');
  const status = get('.status');
  let animation, request, opener, reading = false, loaded = false;
  const animate = () => {
    animation?.cancel(); animation = null;
    if (reading || !loaded || !dialog.open) return;
    const start = stage.clientHeight * 0.7, end = -copy.scrollHeight - stage.clientHeight;
    animation = copy.animate([{ transform: `translateY(${start}px)` }, { transform: `translateY(${end}px)` }], {
      duration: Math.max(30000, (start - end) / 26 * 1000), easing: 'linear', iterations: Infinity,
    });
  };
  const setMode = value => {
    reading = value; stage.classList.toggle('reading', reading); stage.scrollTop = 0;
    animate();
  };
  const close = () => { if (dialog.open) dialog.close(); };
  get('.close').addEventListener('click', close);
  dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
  dialog.addEventListener('close', () => {
    request?.abort(); animation?.cancel(); animation = null; opener?.focus();
  });
  stage.addEventListener('focusin', () => { if (!reading) setMode(true); });
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const motionChanged = () => { if (motion.matches) setMode(true); };
  motion.addEventListener('change', motionChanged);
  return {
    async open({ title, url }) {
      request?.abort(); request = new AbortController();
      const current = request;
      opener = document.activeElement; loaded = false;
      get('#title').textContent = title; get('.original').href = url;
      get('.original').setAttribute('aria-label', `Open full ${title} in a new tab`);
      copy.replaceChildren(); status.textContent = 'Loading document…';
      if (!dialog.open) dialog.showModal();
      setMode(motion.matches);
      try {
        const response = await fetch(url, { signal: current.signal });
        if (!response.ok) throw Error('Document unavailable');
        const parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
        if (current !== request || current.signal.aborted) return;
        copyDocument(parsed.body, copy, new URL(url, location.href));
        status.textContent = ''; loaded = true; animate();
      } catch (error) {
        if (!current.signal.aborted) status.textContent = 'Unable to load. Open the full document using the document icon.';
      }
    },
    dispose() { request?.abort(); animation?.cancel(); motion.removeEventListener('change', motionChanged); close(); host.remove(); },
  };
}
