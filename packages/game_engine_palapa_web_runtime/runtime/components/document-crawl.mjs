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
    *{box-sizing:border-box}dialog{width:min(1120px,94vw,163dvh);max-width:none;max-height:92dvh;aspect-ratio:16/9;padding:0;border:1px solid #666;border-radius:8px;background:#030409;color:#ffe36e;font:16px/1.55 system-ui,sans-serif;overflow:hidden;box-shadow:0 24px 100px #000}
    dialog::backdrop{background:#000b;backdrop-filter:blur(4px)}.screen{height:100%;display:flex;flex-direction:column}
    header,footer{flex:none;display:flex;align-items:center;gap:12px;padding:10px 16px;background:#090b12;z-index:2}header{border-bottom:1px solid #303443}header h2{font-size:16px;margin:0;flex:1;color:#fff}footer{border-top:1px solid #303443;flex-wrap:wrap}
    button,a{font:inherit;color:#fff}button{background:#1b1e28;border:1px solid #565c6f;border-radius:4px;padding:5px 12px;cursor:pointer}button:focus-visible,a:focus-visible{outline:2px solid #66f5f5;outline-offset:3px}.close{font-size:20px;padding:0 10px}a{margin-left:auto;font-size:13px}
    .stage{position:relative;flex:1;min-height:0;overflow:hidden;perspective:420px;perspective-origin:50% 12%;background:radial-gradient(1px 1px at 17% 23%,#d0defa 90%,transparent),radial-gradient(1px 1px at 77% 63%,#ccd9ed 90%,transparent),radial-gradient(1px 1px at 31% 79%,#7c8da6 90%,transparent),#030409;background-size:139px 157px,211px 193px,263px 251px}
    .tilt{position:absolute;inset:0;transform:rotateX(25deg);transform-origin:50% 100%;transform-style:preserve-3d}.copy{width:72%;margin:0 auto;font-size:clamp(14px,2.1vw,25px);line-height:1.6;text-align:justify;font-weight:600;overflow-wrap:anywhere}.copy p{margin:0 0 1em}.copy a{font:inherit;color:inherit}.copy table{width:100%}.copy h1,.copy h2{text-align:center}.copy li{margin-bottom:.5em}
    .stage.reading{overflow:auto;perspective:none;background:#080a0f}.reading .tilt{position:static;transform:none}.reading .copy{width:auto;max-width:850px;margin:auto;padding:20px;font-size:16px;color:#fff;text-align:start;font-weight:400}.status{padding:20px;color:white}.status:empty{display:none}
    @media(max-width:600px){header,footer{padding:5px 8px;gap:5px}header h2{font-size:13px}button{font-size:11px;padding:3px 7px}footer a{font-size:11px}.copy{width:80%}}
  </style><dialog aria-labelledby="title"><div class="screen"><header><h2 id="title"></h2><button class="close" aria-label="Close">×</button></header><div class="stage"><div class="status" role="status"></div><div class="tilt"><article class="copy"></article></div></div><footer><button class="pause">Pause</button><button class="restart">Restart</button><button class="mode">Read normally</button><a class="original" target="_blank" rel="noopener">Open document ↗</a></footer></div></dialog>`;
  document.body.append(host);
  const get = selector => root.querySelector(selector);
  const dialog = get('dialog'), stage = get('.stage'), copy = get('.copy');
  const pause = get('.pause'), restart = get('.restart'), mode = get('.mode'), status = get('.status');
  let animation, request, opener, reading = false, loaded = false;
  const animate = () => {
    animation?.cancel(); animation = null;
    if (reading || !loaded || !dialog.open) return;
    const start = stage.clientHeight * 0.7, end = -copy.scrollHeight - stage.clientHeight;
    animation = copy.animate([{ transform: `translateY(${start}px)` }, { transform: `translateY(${end}px)` }], {
      duration: Math.max(30000, (start - end) / 26 * 1000), easing: 'linear', fill: 'both',
    });
    pause.textContent = 'Pause';
    animation.onfinish = () => { pause.textContent = 'Replay'; };
  };
  const setMode = value => {
    reading = value; stage.classList.toggle('reading', reading); stage.scrollTop = 0;
    mode.textContent = reading ? 'Play crawl' : 'Read normally';
    pause.hidden = restart.hidden = reading;
    animate();
  };
  const close = () => { if (dialog.open) dialog.close(); };
  get('.close').addEventListener('click', close);
  dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
  dialog.addEventListener('close', () => {
    request?.abort(); animation?.cancel(); animation = null; opener?.focus();
  });
  pause.addEventListener('click', () => {
    if (!animation) return;
    if (animation.playState === 'finished') { animate(); return; }
    if (animation.playState === 'running') { animation.pause(); pause.textContent = 'Resume'; }
    else { animation.play(); pause.textContent = 'Pause'; }
  });
  restart.addEventListener('click', animate);
  mode.addEventListener('click', () => setMode(!reading));
  stage.addEventListener('focusin', event => { if (event.target.closest('a') && !reading) setMode(true); });
  return {
    async open({ title, url }) {
      request?.abort(); request = new AbortController();
      const current = request;
      opener = document.activeElement; loaded = false;
      get('#title').textContent = title; get('.original').href = url;
      copy.replaceChildren(); status.textContent = 'Loading document…';
      if (!dialog.open) dialog.showModal();
      setMode(matchMedia('(prefers-reduced-motion: reduce)').matches);
      try {
        const response = await fetch(url, { signal: current.signal });
        if (!response.ok) throw Error('Document unavailable');
        const parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
        if (current !== request || current.signal.aborted) return;
        copyDocument(parsed.body, copy, new URL(url, location.href));
        status.textContent = ''; loaded = true; animate();
      } catch (error) {
        if (!current.signal.aborted) status.textContent = 'Unable to load. Use Open document to read it.';
      }
    },
    dispose() { request?.abort(); animation?.cancel(); close(); host.remove(); },
  };
}
