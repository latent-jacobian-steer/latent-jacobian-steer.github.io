// Live table-climb demo: MuJoCo (WebAssembly) simulates the Unitree G1 and the table, and the trained policy
// (ONNX Runtime Web) drives it in closed loop at 50 Hz, reading only the inputs the real robot has.
import * as THREE from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';
import loadMujoco from './vendor/mujoco.js';
import * as ort from './vendor/ort.wasm.min.mjs';
import {Reference, Climb} from './core.js';

const BASE = new URL('./', import.meta.url).href;
const HOLD_STEPS = 100;  // 2 s on the table after the climb ends

async function fetchBytes(path, onBytes) {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
  const reader = res.body.getReader(); const parts = []; let n = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    parts.push(value); n += value.length; onBytes(value.length);
  }
  const out = new Uint8Array(n); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export async function start(ui) {
  const TOTAL = 76e6; let loaded = 0;
  const progress = k => { loaded += k; ui.loading(Math.min(99, Math.round(100*loaded/TOTAL))); };
  ui.loading(0);
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = BASE + 'vendor/';
  const [mujoco, policyBytes, refBytes, meta, xml, list] = await Promise.all([
    loadMujoco({locateFile: f => BASE + 'vendor/' + f}).then(m => { progress(11.2e6); return m; }),
    fetchBytes('policy/policy_motion.onnx', progress),
    fetchBytes('policy/reference.bin', progress),
    fetch(BASE + 'policy/meta.json').then(r => r.json()),
    fetchBytes('scene/scene.xml', progress),
    fetch(BASE + 'scene/assets.txt').then(r => r.text()),
  ]);
  mujoco.FS.mkdir('/scene'); mujoco.FS.mkdir('/scene/assets');
  mujoco.FS.writeFile('/scene/scene.xml', xml);
  const names = list.split('\n').filter(Boolean);
  await Promise.all(names.map(async f => mujoco.FS.writeFile('/scene/assets/' + f, await fetchBytes('scene/assets/' + f, progress))));
  const model = mujoco.MjModel.from_xml_path('/scene/scene.xml');
  const session = await ort.InferenceSession.create(policyBytes, {executionProviders: ['wasm']});
  const ref = new Reference(refBytes.buffer, meta);
  const climb = new Climb(mujoco, model, ref, meta);
  const view = new View(ui.canvas, mujoco, model, climb);
  ui.loading(100);
  return new Demo(climb, session, view, ref, ui);
}

class Demo {
  constructor(climb, session, view, ref, ui) {
    Object.assign(this, {climb, session, view, ref, ui});
    this.running = false; this.speed = 1; this.done = true;
    this.reset(ui.params());
    const loop = async now => {
      if (this.running && !this.busy) {
        this.busy = true;
        const dt = Math.min(0.1, (now - (this.last ?? now)) / 1000); this.budget += dt * this.speed;
        let n = 0;
        while (this.budget >= 0.02 && n < 12 && this.running) { await this.step(); this.budget -= 0.02; n++; }
        this.busy = false;
      }
      this.last = now;
      this.view.render(this.climb.data);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  reset(p) {
    this.running = false; this.done = false; this.budget = 0;
    this.climb.reset([p.dx, p.dy, p.dz], p.friction);
    this.view.syncTable(); this.view.render(this.climb.data);
    this.ui.status('ready', 0, this.ref.T);
  }
  deploy(p) { this.reset(p); this.running = true; this.ui.status('climbing', 0, this.ref.T); }
  async step() {
    const {t, obs} = this.climb.observe();
    const out = await this.session.run({obs: new ort.Tensor('float32', obs, [1, obs.length]),
                                        time_step: new ort.Tensor('float32', Float32Array.of(t), [1, 1])});
    this.climb.apply(out[this.session.outputNames[0]].data);
    const s = this.climb.step, T = this.ref.T, st = this.climb.status();
    if (!st.onTable && this.climb.data.qpos[2] < 0.45 && s > 200) { this.running = false; this.ui.status('fell', s, T); return; }
    if (s >= T - 1 + HOLD_STEPS) { this.running = false; this.ui.status(st.standing ? 'standing' : 'notstanding', s, T); return; }
    this.ui.status('climbing', s, T);
  }
}

class View {
  constructor(canvas, mujoco, model, climb) {
    this.canvas = canvas; this.model = model; this.climb = climb;
    const r = this.renderer = new THREE.WebGLRenderer({canvas, antialias: true});
    r.setPixelRatio(Math.min(2, window.devicePixelRatio)); r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeef1f5); scene.fog = new THREE.Fog(0xeef1f5, 9, 22);
    const cam = this.camera = new THREE.PerspectiveCamera(40, 1, 0.05, 60);
    cam.up.set(0, 0, 1); cam.position.set(-1.1, -2.4, 1.75);
    this.controls = new OrbitControls(cam, canvas); this.controls.target.set(0.6, 0, 0.8);
    this.controls.enableDamping = true; this.controls.maxPolarAngle = Math.PI * 0.49; this.controls.minDistance = 1.2; this.controls.maxDistance = 9;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8d8a84, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(-2.5, -3.5, 6); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, {left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 15});
    sun.shadow.bias = -0.0004; sun.target.position.set(0.8, 0, 0.5); scene.add(sun, sun.target);
    this.geoms = []; const m = model;
    const type = m.geom_type, group = m.geom_group, size = m.geom_size, rgba = m.geom_rgba, matid = m.geom_matid, matRgba = m.mat_rgba, dataid = m.geom_dataid;
    const vert = m.mesh_vert, face = m.mesh_face, vadr = m.mesh_vertadr, vnum = m.mesh_vertnum, fadr = m.mesh_faceadr, fnum = m.mesh_facenum;
    this.tableGeoms = new Set(climb.tableGeoms);
    for (let g = 0; g < m.ngeom; g++) {
      if (group[g] !== 0 && group[g] !== 2) continue;  // group 3 = collision shapes
      let geo;
      const t = type[g], s = [size[3*g], size[3*g+1], size[3*g+2]];
      if (t === 0) {  // floor
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({color: 0xd9dde3, roughness: 0.95}));
        floor.receiveShadow = true; scene.add(floor);
        const grid = new THREE.GridHelper(40, 80, 0xb8bec7, 0xc9ced6); grid.rotation.x = Math.PI / 2; grid.position.z = 0.001; scene.add(grid);
        continue;
      } else if (t === 6) geo = new THREE.BoxGeometry(2*s[0], 2*s[1], 2*s[2]);
      else if (t === 7) {
        const id = dataid[g], v0 = vadr[id], nv = vnum[id], f0 = fadr[id], nf = fnum[id];
        geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(vert.subarray(3*v0, 3*(v0+nv))), 3));
        geo.setIndex(new THREE.BufferAttribute(Uint32Array.from(face.subarray(3*f0, 3*(f0+nf))), 1));
        geo.computeVertexNormals();
      } else continue;
      let c = [rgba[4*g], rgba[4*g+1], rgba[4*g+2], rgba[4*g+3]];
      if (matid[g] >= 0) { const k = matid[g]; c = [matRgba[4*k], matRgba[4*k+1], matRgba[4*k+2], matRgba[4*k+3]]; }
      const robot = t === 7;
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace),
        roughness: robot ? 0.45 : 0.75, metalness: robot ? 0.15 : 0.0, transparent: c[3] < 1, opacity: c[3]});
      if (robot && c[0] < 0.3) mat.color.setRGB(0.16, 0.17, 0.19, THREE.SRGBColorSpace);  // dark shells
      const mesh = new THREE.Mesh(geo, mat); mesh.matrixAutoUpdate = false;
      mesh.castShadow = c[3] >= 1; mesh.receiveShadow = true; scene.add(mesh); this.geoms.push([g, mesh]);
    }
    this.focus = new THREE.Vector3(0.6, 0, 0.8);
    const resize = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (w && h && (canvas.width !== Math.round(w*r.getPixelRatio()) || canvas.height !== Math.round(h*r.getPixelRatio()))) {
        r.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
      }
    };
    this.resize = resize; new ResizeObserver(resize).observe(canvas); resize();
  }
  syncTable() { this.render(this.climb.data); }
  render(d) {
    const xp = d.geom_xpos, xm = d.geom_xmat;
    for (const [g, mesh] of this.geoms) {
      const p = 3*g, R = 9*g;
      mesh.matrix.set(xm[R], xm[R+1], xm[R+2], xp[p], xm[R+3], xm[R+4], xm[R+5], xp[p+1], xm[R+6], xm[R+7], xm[R+8], xp[p+2], 0, 0, 0, 1);
      mesh.matrixWorldNeedsUpdate = true;
    }
    // follow the pelvis gently
    const q = d.qpos, goal = new THREE.Vector3(q[0], q[1], Math.max(0.7, q[2] - 0.05));
    const delta = goal.clone().sub(this.focus).multiplyScalar(0.04);
    this.focus.add(delta); this.controls.target.add(delta); this.camera.position.add(delta);
    this.controls.update(); this.resize();
    this.renderer.render(this.scene, this.camera);
  }
}
