import * as THREE from "./vendor/three.module.min.js";
import { FontLoader } from "./vendor/FontLoader.js";
import { TextGeometry } from "./vendor/TextGeometry.js";
import { traceStaticLighting } from "./static-lighting.mjs";
const applePolygons = [
  [
    [12.152, 6.896],
    [11.852, 6.866],
    [11.524, 6.784],
    [11.171, 6.664],
    [10.794, 6.519],
    [10.396, 6.362],
    [9.98, 6.206],
    [9.55, 6.064],
    [9.106, 5.95],
    [8.653, 5.876],
    [8.192, 5.856],
    [7.586, 5.898],
    [6.994, 6.004],
    [6.419, 6.173],
    [5.867, 6.401],
    [5.341, 6.687],
    [4.844, 7.026],
    [4.381, 7.417],
    [3.955, 7.856],
    [3.57, 8.341],
    [3.231, 8.87],
    [2.703, 10.021],
    [2.378, 11.252],
    [2.235, 12.538],
    [2.256, 13.853],
    [2.422, 15.173],
    [2.714, 16.472],
    [3.111, 17.726],
    [3.596, 18.908],
    [4.149, 19.995],
    [4.75, 20.96],
    [5.06, 21.4],
    [5.381, 21.839],
    [5.716, 22.267],
    [6.066, 22.673],
    [6.432, 23.044],
    [6.815, 23.37],
    [7.216, 23.64],
    [7.637, 23.842],
    [8.078, 23.966],
    [8.542, 23.999],
    [8.972, 23.956],
    [9.358, 23.871],
    [9.714, 23.757],
    [10.052, 23.623],
    [10.388, 23.481],
    [10.733, 23.341],
    [11.101, 23.213],
    [11.505, 23.108],
    [11.96, 23.038],
    [12.477, 23.012],
    [12.989, 23.04],
    [13.437, 23.114],
    [13.836, 23.224],
    [14.198, 23.357],
    [14.54, 23.501],
    [14.875, 23.643],
    [15.218, 23.772],
    [15.583, 23.876],
    [15.984, 23.943],
    [16.437, 23.96],
    [16.911, 23.911],
    [17.352, 23.784],
    [17.764, 23.589],
    [18.15, 23.334],
    [18.514, 23.027],
    [18.859, 22.676],
    [19.187, 22.291],
    [19.504, 21.88],
    [19.811, 21.451],
    [20.113, 21.012],
    [20.44, 20.509],
    [20.727, 20.017],
    [20.977, 19.547],
    [21.19, 19.107],
    [21.368, 18.705],
    [21.512, 18.352],
    [21.623, 18.055],
    [21.703, 17.825],
    [21.753, 17.669],
    [21.775, 17.597],
    [21.676, 17.556],
    [21.429, 17.436],
    [21.069, 17.229],
    [20.636, 16.929],
    [20.165, 16.527],
    [19.694, 16.017],
    [19.26, 15.39],
    [18.901, 14.64],
    [18.653, 13.759],
    [18.555, 12.74],
    [18.618, 11.875],
    [18.804, 11.105],
    [19.082, 10.427],
    [19.424, 9.841],
    [19.8, 9.345],
    [20.18, 8.938],
    [20.535, 8.62],
    [20.834, 8.388],
    [21.05, 8.242],
    [21.152, 8.181],
    [20.703, 7.608],
    [20.22, 7.136],
    [19.719, 6.756],
    [19.21, 6.457],
    [18.709, 6.229],
    [18.227, 6.062],
    [17.778, 5.946],
    [17.376, 5.871],
    [17.033, 5.828],
    [16.762, 5.805],
    [16.172, 5.798],
    [15.604, 5.858],
    [15.061, 5.972],
    [14.545, 6.121],
    [14.058, 6.292],
    [13.603, 6.466],
    [13.182, 6.63],
    [12.798, 6.767],
    [12.454, 6.86],
    [12.152, 6.895],
  ],
  [
    [15.53, 3.83],
    [15.774, 3.515],
    [15.998, 3.178],
    [16.2, 2.822],
    [16.377, 2.449],
    [16.527, 2.062],
    [16.647, 1.663],
    [16.734, 1.255],
    [16.786, 0.84],
    [16.801, 0.421],
    [16.775, 0],
    [16.406, 0.036],
    [16.028, 0.112],
    [15.644, 0.224],
    [15.261, 0.371],
    [14.883, 0.549],
    [14.514, 0.755],
    [14.161, 0.988],
    [13.829, 1.245],
    [13.521, 1.522],
    [13.243, 1.818],
    [13.013, 2.103],
    [12.794, 2.416],
    [12.59, 2.755],
    [12.406, 3.116],
    [12.246, 3.495],
    [12.115, 3.888],
    [12.018, 4.292],
    [11.958, 4.703],
    [11.941, 5.118],
    [11.97, 5.532],
    [12.372, 5.537],
    [12.773, 5.492],
    [13.169, 5.402],
    [13.558, 5.27],
    [13.935, 5.1],
    [14.297, 4.897],
    [14.641, 4.665],
    [14.963, 4.407],
    [15.26, 4.128],
    [15.529, 3.831],
  ],
];
const appleShapes = function (T) {
  return applePolygons.map(function (poly) {
    return new T.Shape(
      poly.map(function (pt) {
        return new T.Vector2(pt[0], pt[1]);
      }),
    );
  });
};
export function createLaunchControls(element, options) {
  const host = options.host;
  const cancelFrame = host ? unsubscribe => unsubscribe?.() : cancelAnimationFrame;
  const root = element.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host {display:block;height:100%;}
    * {box-sizing:border-box;}
    .controls {height:100%;display:flex;justify-content:center;align-items:center;gap:54px;font:700 18px/25.6px "Source Code Pro",monospace;}
    .launch-wrapper {position:relative;display:inline-flex;align-items:center;justify-content:center;padding:.3em .6em;}
    canvas {position:absolute;inset:-.78em -2.1em;height:calc(100% + 1.56em);pointer-events:none;}
    button {position:relative;z-index:1;display:inline-flex;align-items:center;justify-content:center;gap:.38em;padding:.45em .6em;background:none;border:0;font:inherit;letter-spacing:.02em;text-decoration:none;color:#FF66CC;cursor:pointer;white-space:nowrap;}
    .hero-cta {min-width:8.6em;}
    button {min-width:2.36em;}
    button:focus-visible {outline:2px solid #66F5F5;outline-offset:8px;}
    .fallback-frame {outline:2px solid #66F5F5;outline-offset:4px;}
    .launch-status {position:absolute;z-index:2;pointer-events:none;color:#FF66CC;white-space:nowrap;}
    .label {flex:1;text-align:center;}
    @media(max-width:768px){.controls{font-size:16px;gap:48px;}}
  `;
  const controls = document.createElement("div");
  controls.className = "controls";
  const make = (cls, label) => {
    const wrapper = document.createElement("div");
    wrapper.className = "launch-wrapper";
    const canvas = document.createElement("canvas");
    canvas.className = "launch-fx";
    canvas.setAttribute("aria-hidden", "true");
    const button = document.createElement("button");
    button.type = "button";
    button.className = cls;
    button.textContent = label;
    wrapper.append(canvas, button);
    controls.append(wrapper);
    return button;
  };
  const targets = options.targets;
  let current = options.index;
  let disposed = false;
  let failed = false;
  let showingStatus = false;
  const ctaBtn = make("hero-cta", "");
  const cycBtn = make("btn-cycle", "↻");
  const status = document.createElement("span");
  status.className = "launch-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");
  ctaBtn.parentElement.append(status);
  cycBtn.setAttribute("aria-label", "Show another platform");
  root.append(style, controls);
  const update = () => {
    const target = targets[current];
    ctaBtn.textContent = target.label;
    ctaBtn.setAttribute("aria-label", `${options.productName || "Download"} for ${target.label}`);
    ctaBtn.style.color = showingStatus || (!failed && element.dataset.ready === "true")
      ? "transparent"
      : "";
    status.style.color = !failed && element.dataset.ready === "true" ? "transparent" : "";
  };
  const showStatus = () => {
    if (disposed) return;
    const href = targets[current].href;
    if (href) { window.location.assign(href); return; }
    showingStatus = true;
    status.textContent = options.comingSoon;
    update();
    root.dispatchEvent(new CustomEvent("launch-status"));
  };
  ctaBtn.addEventListener("click", showStatus);
  for (const type of ["keydown", "keyup"]) {
    ctaBtn.addEventListener(type, (event) => {
      if (event.key === "Enter" || event.key === " ") event.stopPropagation();
    });
  }
  const cycle = (direction) => {
    if (disposed) return;
    const from = current;
    current = (current + direction + targets.length) % targets.length;
    showingStatus = false;
    status.textContent = "";
    update();
    root.dispatchEvent(
      new CustomEvent("plat-cycle", { detail: { from, to: current } }),
    );
  };
  cycBtn.addEventListener("click", () => cycle(1));
  cycBtn.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    cycle(-1);
  });
  update();
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const scheduled = new Set();
  const cleanups = [];
  const focus = () => options.onFocus();
  const blur = (event) => {
    if (!controls.contains(event.relatedTarget)) options.onBlur();
  };
  controls.addEventListener("focusin", focus);
  controls.addEventListener("focusout", blur);
  const stopRendering = () => {
    scheduled.forEach(cancelFrame);
    scheduled.clear();
    cleanups.splice(0).forEach((cleanup) => cleanup());
  };
  const fallback = () => {
    if (disposed || failed) return;
    failed = true;
    stopRendering();
    controls.querySelectorAll("canvas").forEach((canvas) => {
      canvas.style.visibility = "hidden";
    });
    [ctaBtn, cycBtn].forEach((button) => {
      button.style.color = "";
      button.classList.add("fallback-frame");
    });
    element.dataset.ready = "false";
    update();
  };
  const frame = (callback) => {
    if (disposed || failed) return;
    let id;
    const run = (time) => {
      scheduled.delete(id);
      if (host) id();
      if (!disposed && !failed) callback(time);
    };
    id = host ? host.tick(run) : requestAnimationFrame(run);
    scheduled.add(id);
    return id;
  };
  const start = async () => {
    const AA = false;
    const TAN = Math.tan(Math.PI / 12);
    const rScale = () => Math.min(4, Math.max(2, devicePixelRatio * 2));
    const dim = (h) => new THREE.Color(h).multiplyScalar(0.35);
    const frameMat = new THREE.MeshLambertMaterial({
      color: dim(0x66f5f5),
      emissive: 0x66f5f5,
      emissiveIntensity: 0.7,
    });
    const faceMat = host
      ? new THREE.MeshStandardMaterial({ color: 0xff66cc, roughness: 0.65, metalness: 0 })
      : new THREE.MeshBasicMaterial({ color: 0xff66cc });
    faceMat.userData.launchFace = true;
    const sideMat = host
      ? new THREE.MeshStandardMaterial({ color: 0x7a2e5e, roughness: 0.65, metalness: 0 })
      : new THREE.MeshBasicMaterial({ color: 0x7a2e5e });
    cleanups.push(() => {
      frameMat.dispose();
      faceMat.dispose();
      sideMat.dispose();
    });
    const boxMats = [sideMat, sideMat, sideMat, sideMat, faceMat, sideMat];
    const splitMaterials = (root) => {
      const meshes = [];
      root.traverse((mesh) => { if (mesh.isMesh) meshes.push(mesh); });
      for (const mesh of meshes) {
        if (!Array.isArray(mesh.material)) {
          mesh.material = mesh.material.clone();
          mesh.userData.launchFace = mesh.material.userData.launchFace === true;
          continue;
        }
        const source = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
        const group = new THREE.Group();
        group.position.copy(mesh.position); group.quaternion.copy(mesh.quaternion); group.scale.copy(mesh.scale);
        for (const part of source.groups) {
          const geometry = new THREE.BufferGeometry();
          for (const name of ["position", "normal"]) {
            const attribute = source.getAttribute(name);
            geometry.setAttribute(name, new THREE.BufferAttribute(
              attribute.array.slice(part.start * 3, (part.start + part.count) * 3), 3));
          }
          const original = mesh.material[part.materialIndex];
          const piece = new THREE.Mesh(geometry, original.clone());
          piece.userData.launchFace = original.userData.launchFace === true;
          if (piece.userData.launchFace) piece.material.color.setHex(0xff66cc);
          group.add(piece);
        }
        mesh.parent.add(group); mesh.removeFromParent();
        if (source !== mesh.geometry) source.dispose();
        if (mesh.geometry !== appleGeo) mesh.geometry.dispose();
      }
    };
    const bar = (w, h, x, y) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.3), boxMats);
      m.position.set(x, y, 0);
      return m;
    };
    let appleGeo = null;
    cleanups.push(() => appleGeo?.dispose());
    const appleIcon = () => {
      if (!appleGeo) {
        appleGeo = new THREE.ExtrudeGeometry(appleShapes(THREE), {
          depth: 2.6,
          bevelEnabled: false,
        });
        appleGeo.computeBoundingBox();
        const b0 = appleGeo.boundingBox;
        appleGeo.translate(
          -(b0.max.x + b0.min.x) / 2,
          -(b0.max.y + b0.min.y) / 2,
          -1.3,
        );
      }
      const bb = appleGeo.boundingBox;
      const m = new THREE.Mesh(appleGeo, [faceMat, sideMat]);
      m.rotation.x = Math.PI;
      m.scale.setScalar(1.1 / (bb.max.y - bb.min.y));
      m.position.y = 0.09;
      return m;
    };
    const windowsIcon = () => {
      const g = new THREE.Group();
      const pane = 0.48;
      const offset = 0.3;
      for (const x of [-offset, offset]) {
        for (const y of [-offset, offset]) g.add(bar(pane, pane, x, y));
      }
      return g;
    };
    const refreshIcon = () => {
      const g = new THREE.Group();
      const R = 0.38;
      const arcShape = new THREE.Shape();
      const start = 0.4 * Math.PI, end = start + Math.PI * 1.45;
      arcShape.absarc(0, 0, R + 0.085, start, end, false);
      arcShape.absarc(0, 0, R - 0.085, end, start, true);
      arcShape.closePath();
      const extrude = shape => new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false, curveSegments: 32 }).translate(0, 0, -0.06);
      const arc = new THREE.Mesh(extrude(arcShape), faceMat);
      g.add(arc);
      const a0 = 0.4 * Math.PI - 0.16;
      const arrowhead = new THREE.Shape();
      arrowhead.moveTo(-0.18, -0.17);
      arrowhead.lineTo(0.18, -0.17);
      arrowhead.lineTo(0, 0.17);
      arrowhead.closePath();
      const tip = new THREE.Mesh(extrude(arrowhead), faceMat);
      tip.position.set(Math.cos(a0) * R, Math.sin(a0) * R, 0);
      tip.rotation.z = a0 - Math.PI;
      g.add(tip);
      return g;
    };
    /* Flat strokes: an arm with depth that sits off-axis turns its side face towards the camera. */
    const mkFrame = (W, H, LX, LY, TT) => {
      const fg = new THREE.Group();
      [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ].forEach((s) => {
        const hArm = new THREE.Mesh(new THREE.PlaneGeometry(LX, TT), frameMat);
        hArm.position.set(s[0] * (W - LX / 2), s[1] * H, 0);
        fg.add(hArm);
        const vArm = new THREE.Mesh(new THREE.PlaneGeometry(TT, LY), frameMat);
        vArm.position.set(s[0] * W, s[1] * (H - LY / 2), 0);
        fg.add(vArm);
      });
      return fg;
    };
    const mkStage = (c, phase, build) => {
      const renderer = host?.renderer || new THREE.WebGLRenderer({
        canvas: c,
        antialias: AA,
        alpha: true,
        preserveDrawingBuffer: false,
      });
      const scene = host ? new THREE.Group() : new THREE.Scene();
      scene.name = 'launch-control';
      cleanups.push(() => {
        scene.traverse((o) => {
          if (o.isMesh) {
            o.geometry.dispose();
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            mats.forEach((m) => m.dispose());
          }
        });
        if (host) host.remove(scene);
        else renderer.dispose();
      });
      const cam = host?.camera || new THREE.PerspectiveCamera(30, 4, 0.1, 60);
      if (!host) {
        scene.add(new THREE.AmbientLight(0xffffff, 0.45));
        const dl = new THREE.DirectionalLight(0xffffff, 1.1);
        dl.position.set(2, 3, 4);
        scene.add(dl);
      }
      const rig = new THREE.Group();
      scene.add(rig);
      const fitted = build(rig);
      if (host) host.add(scene, { dynamic: true });
      let hvT = 0,
        hv = 0,
        faceClone = null;
      const wrapEl = c.parentElement;
      if (wrapEl) {
        wrapEl.addEventListener("pointerenter", () => {
          hvT = 1;
        });
        wrapEl.addEventListener("pointerleave", () => {
          hvT = 0;
        });
      }
      const baseFace = new THREE.Color(0xff66cc),
        hiFace = new THREE.Color(0xffb3df);
      rig.traverse((o) => {
        if (!o.isMesh) return;
        const rm = (mm) => {
          if (mm !== faceMat) return mm;
          if (!faceClone) faceClone = faceMat.clone();
          return faceClone;
        };
        o.material = Array.isArray(o.material)
          ? o.material.map(rm)
          : rm(o.material);
      });
      let curR = 1;
      let vis = true;
      const visibility = new IntersectionObserver((es) => {
        vis = es[es.length - 1].isIntersecting;
        updateAnimation();
      });
      visibility.observe(c);
      cleanups.push(() => visibility.disconnect());
      const BW = 470;
      const place = () => {
        if (!host) return;
        const bounds = c.getBoundingClientRect();
        const view = renderer.domElement.getBoundingClientRect();
        scene.position.set(bounds.left + bounds.width / 2 - view.left - view.width / 2,
          -(bounds.top + scrollY + bounds.height / 2), options.depth ?? 20);
        scene.scale.setScalar(bounds.height / (2 * fitted.y * 1.06));
      };
      const render = () => {
        if (disposed || failed) return;
        if (host) { place(); host.invalidate({ dynamic: true }); }
        else renderer.render(scene, cam);
      };
      c.addEventListener("webglcontextlost", fallback);
      /* Widening from inside the ResizeObserver trips its loop guard, so the canvas is given the
       width this frame needs once, and after that fit only ever reads. */
      let widenKey = "";
      const widen = () => {
        const h = c.clientHeight,
          base = c.parentElement.clientWidth;
        if (!h || !base) return;
        const key = base + "x" + h;
        if (key === widenKey) return;
        widenKey = key;
        const ex = Math.ceil(((fitted.x / fitted.y) * h - base) / 2);
        c.style.width = `${base + Math.max(0, ex * 2)}px`;
        c.style.left = c.style.right =
          (ex > 0 ? -ex : "") + (ex > 0 ? "px" : "");
      };
      const fit = () => {
        widen();
        const w = c.clientWidth,
          h = c.clientHeight;
        if (!w || !h) return;
        if (host) { render(); return; }
        {
          const gll = renderer.getContext();
          const mt = gll.getParameter(gll.MAX_TEXTURE_SIZE) || 16384;
          const bh = Math.round((BW * h) / w);
          const k = Math.min(
            curR,
            mt / Math.max(BW, bh),
            Math.sqrt(3.2e7 / (BW * bh)),
          );
          renderer.setSize(BW * k, bh * k, false);
        }
        cam.aspect = w / h;
        cam.position.z = (fitted.y / TAN) * 1.06;
        cam.updateProjectionMatrix();
        render();
      };
      const resize = new ResizeObserver(fit);
      resize.observe(c);
      cleanups.push(() => resize.disconnect());
      fit();
      if (!host) frame(() => {
        fit();
        frame(fit);
      });
      let animationFrame = null;
      const spin = (t) => {
        if (!host) animationFrame = null;
        if (motion.matches || !vis || document.hidden || disposed || failed)
          return;
        const rr = rScale();
        if (rr !== curR) {
          curR = rr;
          fit();
        }
        const ts = t / 1000 + phase;
        const cyc = (t + phase * 3000) % 9000;
        const ez = (x) => (x < 0 ? 0 : x > 1 ? 1 : x * x * (3 - 2 * x));
        const aIn = Math.max(
          1 - ez((cyc - 1600) / 300),
          ez((cyc - 8200) / 700),
        );
        const drift = 0.65 + 0.35 * aIn;
        hv += (hvT - hv) * 0.12;
        fitted.frame.position.set(
          (Math.sin(ts * 1.3) * 0.18 + Math.sin(ts * 2.1) * 0.06) * drift,
          (Math.cos(ts * 1.7) * 0.1 + Math.sin(ts * 0.9) * 0.05) * drift,
          0.13,
        );
        fitted.frame.scale.setScalar(
          1 + 0.14 * (1 - hv) + 0.08 * aIn * (1 - 0.6 * hv),
        );
        if (faceClone) faceClone.color.copy(baseFace).lerp(hiFace, hv);
        fitted.tint?.(hv);
        if (fitted.tick) fitted.tick(t);
        if (c.offsetParent && vis) render();
        if (!host) animationFrame = frame(spin);
      };
      const updateAnimation = () => {
        if (animationFrame !== null) {
          cancelFrame(animationFrame);
          scheduled.delete(animationFrame);
          animationFrame = null;
        }
        if (motion.matches) render();
        else if (vis && !document.hidden) {
          animationFrame = host ? host.tick(spin) : frame(spin);
          if (host) scheduled.add(animationFrame);
        }
      };
      motion.addEventListener("change", updateAnimation);
      document.addEventListener("visibilitychange", updateAnimation);
      cleanups.push(() => {
        motion.removeEventListener("change", updateAnimation);
        document.removeEventListener("visibilitychange", updateAnimation);
      });
      updateAnimation();
      render.camera = cam;
      return render;
    };
    try {
      if (!options.fontUrl) throw new Error("Font URL required");
      const font = await new FontLoader().loadAsync(options.fontUrl);
      if (disposed) return;
      const GAP = 0.5;
      const ICONS = { mac: appleIcon, ios: appleIcon, windows: windowsIcon };
      // Fit longer labels inside the original frame so controls stay within phone viewports.
      const CONTENT_WIDTH = 4.3;
      const initial = current;
      const advW = (str) => {
        const gs = font.data.glyphs,
          res = font.data.resolution;
        let w = 0;
        for (const ch of str) {
          const g = gs[ch] || gs["?"];
          if (g) w += g.ha;
        }
        return w / res;
      };
      /* Only the platform on screen needs its label extruded; the others wait until someone cycles
       to them, so a load never pays for three beveled TextGeometries it will not show. */
      const built = targets.map((target) => {
        const icon = ICONS[target.id]();
        const ib = new THREE.Box3().setFromObject(icon);
        const iw = ib.max.x - ib.min.x;
        const total = iw + GAP + advW(target.label);
        const g = new THREE.Group();
        const content = new THREE.Group();
        content.scale.setScalar(Math.min(1, CONTENT_WIDTH / total));
        icon.position.x = -total / 2 + iw / 2;
        content.add(icon);
        g.add(content);
        return { g, content, total, label: target.label, iw, lettered: false };
      });
      const statusLabel = {
        g: new THREE.Group(), content: new THREE.Group(), label: options.comingSoon,
        total: advW(options.comingSoon), iw: -GAP, lettered: false,
      };
      statusLabel.content.scale.setScalar(Math.min(1, CONTENT_WIDTH / statusLabel.total));
      statusLabel.g.add(statusLabel.content);
      const letter = (b) => {
        if (!b || b.lettered) return b;
        b.lettered = true;
        const geo = new TextGeometry(b.label, {
          font: font,
          size: 1,
          depth: 0.3,
          curveSegments: 3,
          bevelEnabled: true,
          bevelThickness: 0.06,
          bevelSize: 0.035,
          bevelSegments: 1,
        });
        geo.computeBoundingBox();
        const bb = geo.boundingBox;
        geo.translate(
          -bb.min.x - b.total / 2 + b.iw + GAP,
          -(bb.max.y + bb.min.y) / 2,
          -(bb.max.z + bb.min.z) / 2,
        );
        b.content.add(new THREE.Mesh(geo, [faceMat, sideMat]));
        splitMaterials(b.content);
        return b;
      };
      const tint = (b, amount = b.hover || 0) => {
        b.hover = amount;
        const base = new THREE.Color(0xff66cc), highlight = new THREE.Color(0xffb3df);
        b.content.traverse((mesh) => {
          if (!mesh.isMesh || !mesh.userData.launchFace) return;
          mesh.material.color.copy(base).lerp(highlight, amount);
          if (mesh.geometry.getAttribute("color")) mesh.material.color.setRGB(
            mesh.material.color.r / base.r, mesh.material.color.g / base.g, mesh.material.color.b / base.b);
        });
      };
      const halfW = (CONTENT_WIDTH / 2 + 0.86) * 1.3,
        halfH = 1.02;
      const ez = (x) => (x < 0 ? 0 : x > 1 ? 1 : x * x * (3 - 2 * x));
      let trans = null,
        fxIdx = 0,
        refreshG = null;
      const rst = (o) => {
        o.position.set(0, 0, 0);
        o.rotation.set(0, 0, 0);
        o.scale.set(1, 1, 1);
        o.visible = true;
      };
      // The capacity table's page-flip repertoire, replayed on the launch label.
      const fx = (a, b, p, ty) => {
        rst(a);
        rst(b);
        const e = p < 0.5;
        if (ty === 0) {
          if (e) {
            a.rotation.y = (p / 0.5) * (Math.PI / 2);
            b.visible = false;
          } else {
            a.visible = false;
            b.rotation.y = ((1 - p) / 0.5) * (-Math.PI / 2);
          }
        } else if (ty === 1) {
          if (e) {
            a.rotation.x = (p / 0.5) * (Math.PI / 2);
            b.visible = false;
          } else {
            a.visible = false;
            b.rotation.x = ((1 - p) / 0.5) * (-Math.PI / 2);
          }
        } else if (ty === 2) {
          if (e) {
            a.scale.setScalar(Math.max(0.001, 1 - p * 2));
            b.visible = false;
          } else {
            a.visible = false;
            b.scale.setScalar((p - 0.5) * 2);
          }
        } else if (ty === 3) {
          if (e) {
            a.rotation.z = p * Math.PI;
            a.scale.setScalar(Math.max(0.001, 1 - p * 2));
            b.visible = false;
          } else {
            a.visible = false;
            b.rotation.z = (p - 1) * Math.PI;
            b.scale.setScalar((p - 0.5) * 2);
          }
        } else {
          if (e) {
            a.rotation.y = p * 2 * Math.PI;
            a.scale.setScalar(Math.max(0.001, 1 - p * 2));
            b.visible = false;
          } else {
            a.visible = false;
            b.rotation.y = (p - 1) * 2 * Math.PI;
            b.scale.setScalar((p - 0.5) * 2);
          }
        }
      };
      const settle = () => {
        if (!trans) return;
        rst(built[trans.from].g);
        built[trans.from].g.visible = false;
        rst(built[trans.to].g);
        trans = null;
        if (refreshG) refreshG.rotation.z = 0;
      };
      const mainC = ctaBtn
        .closest(".launch-wrapper")
        .querySelector(".launch-fx");
      const cycC = cycBtn
        .closest(".launch-wrapper")
        .querySelector(".launch-fx");
      const renderMain = mkStage(mainC, 0, (rig) => {
        built.forEach((b, i) => {
          if (i === initial) letter(b);
          b.g.visible = i === initial && !showingStatus;
          rig.add(b.g);
        });
        if (showingStatus) letter(statusLabel);
        statusLabel.g.visible = showingStatus;
        rig.add(statusLabel.g);
        const frame = mkFrame(halfW, halfH, 0.72, 0.5, 0.1625);
        rig.add(frame);
        return {
          x: halfW * 1.26 + 0.3,
          y: halfH * 1.26 + 0.25,
          frame: frame,
          tint: (amount) => {
            built.forEach((b) => tint(b, amount));
            tint(statusLabel, amount);
          },
          tick: (t) => {
            if (!trans) return;
            if (trans.t0 === null) trans.t0 = t;
            const pr = Math.min(1, (t - trans.t0) / 650);
            fx(built[trans.from].g, built[trans.to].g, pr, trans.ty);
            if (refreshG) refreshG.rotation.z = -ez(pr) * Math.PI * 2;
            if (pr >= 1) settle();
          },
        };
      });
      const cycleLabel = { label: "Cycle", lettered: true };
      const renderCycle = mkStage(cycC, 0, (rig) => {
        refreshG = refreshIcon();
        splitMaterials(refreshG);
        cycleLabel.content = refreshG;
        rig.add(refreshG);
        const frame = mkFrame(1.05, halfH, 0.5, 0.5, 0.1625);
        rig.add(frame);
        return { x: 1.05 * 1.26 + 0.3, y: halfH * 1.26 + 0.25,
          frame: frame, tint: (amount) => tint(cycleLabel, amount) };
      });
      const bakePlatform = (b, canvas = mainC, render = renderMain) => {
        if (host) return;
        if (b.lightingStarted || !b.lettered) return;
        b.lightingStarted = true;
        const snapshot = new THREE.Scene();
        snapshot.add(new THREE.AmbientLight(0xffffff, 0.45));
        const light = new THREE.DirectionalLight(0xffffff, 1.1);
        light.position.set(2, 3, 4); snapshot.add(light);
        const content = b.content.clone(true);
        snapshot.add(content);
        const live = [], copies = [], palette = [];
        b.content.traverse((mesh) => { if (mesh.isMesh) live.push(mesh); });
        content.traverse((mesh) => {
          if (!mesh.isMesh) return;
          mesh.geometry = mesh.geometry.clone(); mesh.material = mesh.material.clone();
          if (mesh.userData.launchFace) mesh.material.color.setHex(0xff66cc);
          palette.push(mesh.material.color.clone());
          copies.push(mesh);
        });
        let retired = false;
        const cleanup = () => {
          if (retired) return;
          retired = true;
          b.lighting?.dispose();
          copies.forEach((mesh) => { mesh.geometry.dispose(); mesh.material.dispose(); });
        };
        cleanups.push(cleanup);
        try {
          b.lighting = traceStaticLighting(canvas, snapshot, render.camera.clone(),
            canvas.clientHeight, `launch:${b.label}`, () => {
              if (retired || disposed || failed) return;
              copies.forEach((mesh, index) => {
                const colors = mesh.geometry.getAttribute("color");
                if (!colors) return;
                const target = live[index];
                const shaded = colors.clone();
                const normals = mesh.geometry.getAttribute("normal");
                const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
                const normal = new THREE.Vector3();
                const direction = light.position.clone().normalize();
                const base = palette[index];
                // Preserve the original palette; ray occlusion supplies shadows, not a global dimmer.
                for (let vertex = 0; vertex < shaded.count; vertex++) {
                  normal.fromBufferAttribute(normals, vertex).applyNormalMatrix(normalMatrix);
                  const gain = Math.PI / (0.45 + 1.1 * Math.max(0, normal.dot(direction)));
                  shaded.setXYZ(vertex,
                    Math.min(base.r, shaded.getX(vertex) * gain),
                    Math.min(base.g, shaded.getY(vertex) * gain),
                    Math.min(base.b, shaded.getZ(vertex) * gain));
                }
                target.geometry.setAttribute("color", shaded);
                if (!target.material.vertexColors) {
                  target.material.vertexColors = true;
                  target.material.needsUpdate = true;
                }
                target.material.color.setHex(0xffffff);
              });
              tint(b); render();
            });
        } catch (_) { cleanup(); }
      };
      bakePlatform(built[initial]);
      bakePlatform(cycleLabel, cycC, renderCycle);
      if (showingStatus) bakePlatform(statusLabel);
      const settleMotion = () => {
        settle();
        renderMain();
        renderCycle();
      };
      motion.addEventListener("change", settleMotion);
      cleanups.push(() => motion.removeEventListener("change", settleMotion));
      const onStatus = () => {
        if (failed || disposed) return;
        try {
          settle();
          built.forEach((b) => { b.g.visible = false; });
          letter(statusLabel);
          rst(statusLabel.g);
          bakePlatform(statusLabel);
          renderMain();
          renderCycle();
        } catch (_) { fallback(); }
      };
      const onCycle = (e) => {
        if (failed || disposed) return;
        settle();
        statusLabel.g.visible = false;
        const d = e.detail;
        if (motion.matches) {
          letter(built[d.from]);
          letter(built[d.to]);
          bakePlatform(built[d.to]);
          built[d.from].g.visible = false;
          rst(built[d.to].g);
          renderMain();
          return;
        }
        letter(built[d.from]);
        letter(built[d.to]);
        bakePlatform(built[d.to]);
        trans = { from: d.from, to: d.to, t0: null, ty: fxIdx++ % 5 };
      };
      root.addEventListener("launch-status", onStatus);
      root.addEventListener("plat-cycle", onCycle);
      cleanups.push(() => {
        root.removeEventListener("launch-status", onStatus);
        root.removeEventListener("plat-cycle", onCycle);
      });
      element.dataset.ready = "true";
      update();
      cycBtn.style.color = "transparent";
    } catch (e) {
      fallback();
    }
  };
  start();
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      stopRendering();
      controls.removeEventListener("focusin", focus);
      controls.removeEventListener("focusout", blur);
      root.replaceChildren();
    },
  };
}
