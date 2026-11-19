// Policy loop for the table-climb demo: the SuperMimic actor (policy_motion.onnx) driving the Unitree G1 in MuJoCo.
// A port of supermimic_obs.py and cpu_rollout.py. Shared by the web page and the Node check.
export const HISTORY = 5, NUM_GOAL = 10, STRIDE = 5, EDGE_VISIBLE_X = 0.10;

function qmul(a, b) {
  const [w1, x1, y1, z1] = a, [w2, x2, y2, z2] = b;
  return [w1*w2 - x1*x2 - y1*y2 - z1*z2, w1*x2 + x1*w2 + y1*z2 - z1*y2,
          w1*y2 - x1*z2 + y1*w2 + z1*x2, w1*z2 + x1*y2 - y1*x2 + z1*w2];
}
const qconj = q => [q[0], -q[1], -q[2], -q[3]];
function qmat(q) {  // row-major 3x3
  const [w, x, y, z] = q;
  return [1 - 2*(y*y + z*z), 2*(x*y - w*z), 2*(x*z + w*y),
          2*(x*y + w*z), 1 - 2*(x*x + z*z), 2*(y*z - w*x),
          2*(x*z - w*y), 2*(y*z + w*x), 1 - 2*(x*x + y*y)];
}
function yawq(q) { const m = qmat(q); const yaw = Math.atan2(m[3], m[0]); return [Math.cos(yaw/2), 0, 0, Math.sin(yaw/2)]; }

export class Reference {
  constructor(buffer, meta) {
    this.T = meta.frames; this.n = meta.joints.length;
    const n = this.n, w = 2*n + 4 + 3 + 3;
    this.data = new Float32Array(buffer); this.w = w;
    if (this.data.length !== this.T * w) throw new Error('reference size mismatch');
  }
  row(t) { return this.data.subarray(t*this.w, (t+1)*this.w); }
  jp(t) { return this.row(t).subarray(0, this.n); }
  jv(t) { return this.row(t).subarray(this.n, 2*this.n); }
  quat(t) { const r = this.row(t); return Array.from(r.subarray(2*this.n, 2*this.n + 4)); }
  pos(t) { const r = this.row(t); return Array.from(r.subarray(2*this.n + 4, 2*this.n + 7)); }
  linvel(t) { const r = this.row(t); return Array.from(r.subarray(2*this.n + 7, 2*this.n + 10)); }
}

export class ObsBuilder {
  constructor(ref, def) { this.ref = ref; this.def = def; this.n = def.length; this.reset(); }
  reset() { this.hist = null; this.yawOffset = null; this.lastAction = new Float64Array(this.n); }
  frame(pq, gyro, q, dq, table) {
    const R = qmat(pq);  // gravity in the pelvis frame = R^T (0,0,-1)
    const grav = [-R[6], -R[7], -R[8]];
    const qd = Array.from(q, (v, i) => v - this.def[i]);
    return [grav, Array.from(gyro), qd, Array.from(dq), Array.from(this.lastAction), Array.from(table)];
  }
  goal(t, pq) {
    const T = this.ref.T, out = [], idx = [];
    for (let k = 0; k < NUM_GOAL; k++) idx.push(Math.min(t + k*STRIDE, T - 1));
    for (const i of idx) { out.push(...this.ref.jp(i), ...this.ref.jv(i)); }
    if (this.yawOffset === null) this.yawOffset = qmul(yawq(pq), qconj(yawq(this.ref.quat(Math.min(t, T - 1)))));
    const pc = qconj(pq);
    for (const i of idx) {
      const m = qmat(qmul(pc, qmul(this.yawOffset, this.ref.quat(i))));
      out.push(m[0], m[1], m[3], m[4], m[6], m[7]);  // first two columns, row-major
    }
    return out;
  }
  build(t, pq, gyro, q, dq, table) {
    const f = this.frame(pq, gyro, q, dq, table);
    this.hist = this.hist === null ? Array(HISTORY).fill(f) : [...this.hist.slice(1), f];
    const out = [];
    for (let k = 0; k < f.length; k++) for (const h of this.hist) out.push(...h[k]);
    out.push(...this.goal(t, pq));
    return Float32Array.from(out);
  }
  setAction(a) { this.lastAction = Float64Array.from(a); }
}

// The simulation: model indices, reset to reference frame 0, one 20 ms control step.
export class Climb {
  constructor(mujoco, model, ref, meta) {
    Object.assign(this, {mujoco, model, ref, meta});
    const m = model, names = meta.joints;
    const jid = names.map(n => mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_JOINT.value, 'robot/' + n));
    if (jid.some(j => j < 0)) throw new Error('joint not found');
    const qposadr = m.jnt_qposadr, dofadr = m.jnt_dofadr, trn = m.actuator_trnid;
    this.qadr = jid.map(j => qposadr[j]); this.vadr = jid.map(j => dofadr[j]);
    this.act = jid.map(j => { for (let a = 0; a < m.nu; a++) if (trn[2*a] === j) return a; throw new Error('no actuator'); });
    const gyro = mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_SENSOR.value, 'robot/imu_ang_vel');
    this.gyroAdr = m.sensor_adr[gyro];
    this.tableBody = mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_BODY.value, 'table/table');
    this.tableGeoms = []; const gb = m.geom_bodyid;
    for (let g = 0; g < m.ngeom; g++) if (gb[g] === this.tableBody) this.tableGeoms.push(g);
    this.basePoint = Array.from(m.body_pos.subarray(3*this.tableBody, 3*this.tableBody + 3));
    this.def = meta.default; this.scale = meta.scale;
    this.obs = new ObsBuilder(ref, this.def);
    this.data = new mujoco.MjData(m);
  }
  // offset [dx, dy, dz] of the table, friction of its surfaces
  reset(offset = [0, 0, 0], friction = 0.8) {
    const m = this.model, d = this.data, mj = this.mujoco, r = this.ref;
    this.point = this.basePoint.map((v, i) => v + offset[i]);
    m.body_pos.set(this.point, 3*this.tableBody);
    const fr = m.geom_friction; for (const g of this.tableGeoms) fr[3*g] = friction;
    mj.mj_resetData(m, d);
    const qpos = d.qpos, qvel = d.qvel;
    qpos.set(r.pos(0), 0); qpos.set(r.quat(0), 3);
    const jp = r.jp(0), jv = r.jv(0);
    this.qadr.forEach((a, i) => { qpos[a] = jp[i]; }); this.vadr.forEach((a, i) => { qvel[a] = jv[i]; });
    qvel.set(r.linvel(0), 0);
    mj.mj_forward(m, d);
    this.obs.reset(); this.step = 0;
  }
  tableInput() {
    const q = this.data.qpos, pq = [q[3], q[4], q[5], q[6]], R = qmat(pq);
    const d = [this.point[0] - q[0], this.point[1] - q[1], this.point[2] - q[2]];
    const rel = [R[0]*d[0] + R[3]*d[1] + R[6]*d[2], R[1]*d[0] + R[4]*d[1] + R[7]*d[2], R[2]*d[0] + R[5]*d[1] + R[8]*d[2]];
    return rel[0] > EDGE_VISIBLE_X ? [...rel, 1] : [0, 0, 0, 0];
  }
  observe() {
    const d = this.data, q = d.qpos, v = d.qvel, s = d.sensordata;
    const t = Math.min(this.step, this.ref.T - 1);
    const pq = [q[3], q[4], q[5], q[6]];
    return {t, obs: this.obs.build(t, pq, [s[this.gyroAdr], s[this.gyroAdr+1], s[this.gyroAdr+2]],
      this.qadr.map(a => q[a]), this.vadr.map(a => v[a]), this.tableInput())};
  }
  apply(action) {
    const d = this.data, ctrl = d.ctrl;
    this.obs.setAction(action);
    this.act.forEach((a, i) => { ctrl[a] = this.def[i] + this.scale[i]*action[i]; });
    for (let k = 0; k < this.meta.decimation; k++) this.mujoco.mj_step(this.model, d);
    this.step++;
  }
  // pelvis height above the table top, over the table, upright within 20 degrees
  status() {
    const q = this.data.qpos, p = this.point;
    const above = q[2] - p[2], up = 1 - 2*(q[4]*q[4] + q[5]*q[5]);
    const over = q[0] > p[0] && q[0] < p[0] + 1.0 && Math.abs(q[1] - p[1]) < 0.725;
    return {above, upright: up, standing: above >= 0.6 && over && up >= Math.cos(20*Math.PI/180), onTable: over && above > 0};
  }
}
