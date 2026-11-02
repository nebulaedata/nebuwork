import { consumeReturnTo } from '../../services/authSession.js';
/* views/login.js — 登录页:WebGL 引力透镜黑洞动态特效(2D canvas 兜底)+ 登录卡片(无注册) */
(function () {
  window.Views = window.Views || {};

  /* ---------- WebGL 真实感黑洞:光线引力弯曲步进 + 开普勒吸积盘 + 光子环 ---------- */
  var BH_VERT = [
    'attribute vec2 aP;',
    'void main(){ gl_Position = vec4(aP, 0.0, 1.0); }'
  ].join('\n');

  /* 单位约定:事件视界半径 = 1,光子球 1.5,吸积盘 2.8~9,相机距离 14 */
  var BH_FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uCenter;
uniform vec2 uMouse;

float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0; float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = m * p; a *= 0.5; }
  return v;
}
vec3 starField(vec3 d){
  vec3 col = vec3(0.0);
  for (int L = 0; L < 2; L++) {
    float s = L == 0 ? 16.0 : 30.0;
    vec3 p = d * s;
    vec3 id = floor(p);
    vec3 f = fract(p) - 0.5;
    float h = hash13(id);
    if (h > 0.88) {
      vec3 off = (vec3(hash13(id + 7.1), hash13(id + 3.7), hash13(id + 9.3)) - 0.5) * 0.72;
      float dd = length(f - off);
      float m = smoothstep(0.09, 0.0, dd) * (h - 0.88) * 8.0;
      float tw = 0.72 + 0.28 * sin(uTime * (0.8 + h * 2.4) + h * 41.0);
      col += vec3(0.82, 0.88, 1.0) * m * tw * (L == 0 ? 0.8 : 0.5);
    }
  }
  return col;
}
vec3 background(vec3 d){
  vec3 col = vec3(0.010, 0.013, 0.019);
  float nb = fbm(d.xy * 2.6 + vec2(1.7, 4.2));
  col += vec3(0.09, 0.11, 0.15) * nb * nb * 0.5;
  float nb2 = fbm(d.xy * 1.4 + vec2(-6.3, 2.9));
  col += vec3(0.14, 0.10, 0.06) * nb2 * nb2 * 0.30;
  col += starField(d);
  return col;
}
vec4 disk(vec3 hit, vec3 camPos){
  float r = length(hit.xz);
  float ang = atan(hit.z, hit.x);
  float a = ang + uTime * 1.3 / pow(r, 1.5);
  float streak = fbm(vec2(a * 2.3, r * 1.9));
  float streak2 = fbm(vec2(a * 5.1 + 3.7, r * 4.3));
  float tex = 0.50 + 0.72 * streak + 0.30 * streak2;
  float lane = smoothstep(0.52, 0.78, fbm(vec2(r * 2.4, a * 0.55)));
  tex *= 1.0 - lane * 0.42;
  vec3 cold = vec3(0.13, 0.065, 0.04);
  vec3 rust = vec3(0.52, 0.24, 0.11);
  vec3 gold = vec3(1.18, 0.72, 0.36);
  vec3 hot  = vec3(1.55, 1.42, 1.18);
  vec3 c = mix(cold, rust, smoothstep(8.6, 5.6, r));
  c = mix(c, gold, smoothstep(5.6, 3.7, r));
  c = mix(c, hot, smoothstep(4.0, 2.85, r));
  vec3 tangent = normalize(vec3(-hit.z, 0.0, hit.x));
  float dop = dot(tangent, normalize(camPos - hit));
  float boost = clamp(1.0 + dop * 0.9, 0.30, 2.3);
  c *= boost;
  c = mix(c, c * vec3(1.06, 1.00, 0.88), clamp(-dop, 0.0, 1.0) * 0.55);
  c = mix(c, c * vec3(0.88, 0.98, 1.14), clamp(dop, 0.0, 1.0) * 0.40);
  float alpha = smoothstep(2.80, 3.10, r) * (1.0 - smoothstep(6.0, 9.0, r));
  alpha *= clamp(tex, 0.0, 1.25);
  return vec4(c * tex, alpha * 0.92);
}
vec3 render(vec3 ro, vec3 rd){
  vec3 p = ro;
  vec3 v = rd;
  vec3 hv = cross(p, v);
  float h2 = dot(hv, hv);
  vec3 col = vec3(0.0);
  float trans = 1.0;
  float minR = 1e9;
  bool absorbed = false;
  for (int i = 0; i < 120; i++) {
    float r = length(p);
    minR = min(minR, r);
    if (r < 1.0) { absorbed = true; break; }
    float dt = clamp(r * 0.10, 0.05, 0.55);
    v += p * (-1.5 * h2 / pow(r, 5.0)) * dt;
    v = normalize(v);
    vec3 pn = p + v * dt;
    if (p.y * pn.y < 0.0) {
      float t = p.y / (p.y - pn.y);
      vec3 hit = mix(p, pn, t);
      float hr = length(hit.xz);
      if (hr > 2.82 && hr < 9.0) {
        vec4 dc = disk(hit, ro);
        col += dc.rgb * dc.a * trans;
        trans *= 1.0 - dc.a;
        if (trans < 0.04) { p = pn; break; }
      }
    }
    p = pn;
    if (r > 18.0 && dot(p, v) > 0.0) break;
  }
  if (!absorbed) {
    col += background(v) * trans;
    float ring = exp(-pow((minR - 1.52) * 20.0, 2.0));
    col += vec3(1.30, 1.18, 0.94) * ring * 1.5;
    float halo = exp(-pow((minR - 1.62) * 4.6, 2.0));
    col += vec3(1.00, 0.72, 0.40) * halo * 0.20 * trans;
  }
  return col;
}
void main(){
  vec2 suv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec2 uv = suv - uCenter + uMouse * 0.045;
  vec3 ro = vec3(0.0, 2.45, -14.0);
  vec3 fw = normalize(-ro);
  vec3 rt = normalize(cross(fw, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(rt, fw);
  float focal = 1.0 + sin(uTime * 0.10) * 0.015;
  vec3 rd = normalize(uv.x * rt + uv.y * up + focal * fw);
  vec3 col = render(ro, rd);
  float gd = length(uv);
  col += vec3(0.90, 0.62, 0.30) * 0.045 / (gd * gd * 5.0 + 0.55);
  col = 1.0 - exp(-col * 1.65);
  col = pow(col, vec3(0.85));
  col *= 1.0 - 0.30 * dot(suv, suv);
  gl_FragColor = vec4(col, 1.0);
}`;

  function startSceneGL(canvas) {
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
    if (!gl) return false;
    function sh(type, src) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn('login shader:', gl.getShaderInfoLog(s)); return null; }
      return s;
    }
    const vs = sh(gl.VERTEX_SHADER, BH_VERT), fs = sh(gl.FRAGMENT_SHADER, BH_FRAG);
    if (!vs || !fs) return false;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn('login program:', gl.getProgramInfoLog(prog)); return false; }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aP');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(prog, 'uRes');
    const uTime = gl.getUniformLocation(prog, 'uTime');
    const uCenter = gl.getUniformLocation(prog, 'uCenter');
    const uMouse = gl.getUniformLocation(prog, 'uMouse');
    let mx = 0, my = 0, tx = 0, ty = 0;
    function onMove(e) {
      if (!document.body.contains(canvas)) { window.removeEventListener('mousemove', onMove); return; }
      tx = (e.clientX / window.innerWidth - 0.5) * 2;
      ty = (0.5 - e.clientY / window.innerHeight) * 2;
    }
    window.addEventListener('mousemove', onMove);
    function resize() {
      const q = Math.min(window.devicePixelRatio || 1, 1.25) * 0.75;
      canvas.width = Math.max(2, Math.round(canvas.clientWidth * q));
      canvas.height = Math.max(2, Math.round(canvas.clientHeight * q));
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    function onResize() {
      if (!document.body.contains(canvas)) { window.removeEventListener('resize', onResize); return; }
      resize();
    }
    window.addEventListener('resize', onResize);
    resize();
    canvas.addEventListener('webglcontextlost', e => e.preventDefault());
    const t0 = performance.now();
    function frame(now) {
      if (!document.body.contains(canvas)) return;
      const t = (now - t0) / 1000;
      mx += (tx - mx) * 0.04; my += (ty - my) * 0.04;
      const aspect = canvas.width / canvas.height;
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, t);
      gl.uniform2f(uCenter, (0.68 - 0.5) * aspect, 0.58 - 0.5);
      gl.uniform2f(uMouse, mx, my);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      window.__loginRAF = requestAnimationFrame(frame);
    }
    window.__loginRAF = requestAnimationFrame(frame);
    return true;
  }

  /* ---------- 兜底:2D canvas 黑洞(星空闪烁 + 旋转吸积盘 + 事件视界光子环) ---------- */
  function startScene2D(canvas) {
    let ctx = canvas.getContext('2d');
    if (!ctx) {
      /* canvas 已被失败的 WebGL 尝试占用时,换一块新画布再初始化 */
      const fresh = canvas.cloneNode();
      canvas.parentNode.replaceChild(fresh, canvas);
      canvas = fresh;
      ctx = canvas.getContext('2d');
      if (!ctx) return;
    }
    let w = 0, h = 0;
    const stars = [];
    for (let i = 0; i < 180; i++) {
      stars.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.6 + 0.4, base: Math.random() * 0.5 + 0.25, tw: Math.random() * 1.6 + 0.4, ph: Math.random() * Math.PI * 2 });
    }
    function resize() {
      w = canvas.clientWidth; h = canvas.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize);

    function frame(tms) {
      const t = tms / 1000;
      ctx.fillStyle = '#050608';
      ctx.fillRect(0, 0, w, h);
      /* 星野 */
      stars.forEach(s => {
        ctx.globalAlpha = Math.max(0.06, s.base + Math.sin(t * s.tw + s.ph) * 0.3);
        ctx.fillStyle = '#CFE0FF';
        ctx.fillRect(s.x * w, s.y * h, s.r, s.r);
      });
      ctx.globalAlpha = 1;

      const cx = w * 0.68, cy = h * 0.4, R = Math.min(w, h) * 0.15;
      /* 金色光晕 */
      const glow = ctx.createRadialGradient(cx, cy, R * 0.4, cx, cy, R * 3.2);
      glow.addColorStop(0, 'rgba(232,180,92,0.30)');
      glow.addColorStop(0.5, 'rgba(232,180,92,0.07)');
      glow.addColorStop(1, 'rgba(232,180,92,0)');
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(cx, cy, R * 3.2, 0, Math.PI * 2); ctx.fill();
      /* 吸积盘(三层虚线环,差速旋转) */
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-0.30);
      for (let i = 0; i < 3; i++) {
        const rx = R * (2.0 + i * 0.55), ry = rx * 0.32;
        ctx.strokeStyle = 'rgba(232,180,92,' + (0.5 - i * 0.13) + ')';
        ctx.lineWidth = R * (0.11 - i * 0.025);
        ctx.setLineDash([rx * 0.55, rx * 0.28]);
        ctx.lineDashOffset = -t * rx * (0.22 - i * 0.05);
        ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.setLineDash([]);
      /* 吸积盘亮核 */
      const disk = ctx.createLinearGradient(-R * 2.2, 0, R * 2.2, 0);
      disk.addColorStop(0, 'rgba(107,74,23,0.0)');
      disk.addColorStop(0.5, 'rgba(255,224,160,0.5)');
      disk.addColorStop(1, 'rgba(107,74,23,0.0)');
      ctx.strokeStyle = disk;
      ctx.lineWidth = R * 0.34;
      ctx.globalAlpha = 0.55;
      ctx.beginPath(); ctx.ellipse(0, 0, R * 1.7, R * 1.7 * 0.32, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();
      /* 事件视界 */
      ctx.fillStyle = '#000000';
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
      /* 光子环 */
      ctx.strokeStyle = 'rgba(255,239,196,0.95)';
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(cx, cy, R + 1.5, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(232,180,92,0.35)';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(cx, cy, R + 3.5, 0, Math.PI * 2); ctx.stroke();
      /* 盘面前弧(遮挡视界下缘,随时间微动) */
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-0.30);
      ctx.strokeStyle = 'rgba(255,214,140,0.9)';
      ctx.lineWidth = R * 0.12;
      ctx.lineCap = 'round';
      const drift = Math.sin(t * 0.6) * 0.05;
      ctx.beginPath(); ctx.ellipse(0, 0, R * 1.9, R * 1.9 * 0.32, 0, Math.PI * (0.06 + drift), Math.PI * (0.94 - drift)); ctx.stroke();
      ctx.restore();

      window.__loginRAF = requestAnimationFrame(frame);
    }
    window.__loginRAF = requestAnimationFrame(frame);
  }

  function startScene(canvas) {
    let ok = false;
    try { ok = startSceneGL(canvas); } catch (e) { console.warn('WebGL 黑洞初始化失败,回退 2D:', e); }
    if (!ok) startScene2D(canvas);
  }

  Views.login = {
    async render(el) {
      el.innerHTML = `
      <div class="login-wrap">
        <canvas id="login-canvas"></canvas>
        <div class="login-card">
          <img class="lg-logo" src="assets/logo.svg" alt="NebuWork">
          <div class="lg-title">NebuWork</div>
          <div class="lg-sub">智能体工作台 · 让专家智能体驱动业务</div>
          <div class="field"><label>账号</label>
            <div class="lg-input">${ICON('user', 14)}<input id="lg-account" placeholder="请输入账号" autocomplete="username"></div>
          </div>
          <div class="field"><label>密码</label>
            <div class="lg-input">${ICON('lock', 14)}<input id="lg-pass" type="password" placeholder="请输入密码" autocomplete="current-password"></div>
          </div>
          <button class="btn btn-primary" id="lg-submit" style="width:100%;justify-content:center;padding:11px 16px;margin-top:6px">${ICON('log-in', 15)}进入工作台</button>
          <div class="lg-hint">使用 NebuWork 账号登录 · 请联系管理员获取账号</div>
        </div>
      </div>`;

      startScene(el.querySelector('#login-canvas'));

      async function doLogin() {
        const button = el.querySelector('#lg-submit');
        if (!button || button.disabled) return;
        const account = el.querySelector('#lg-account').value.trim();
        const passwordInput = el.querySelector('#lg-pass');
        const pass = passwordInput.value;
        if (!account || !pass) { UI.toast('请输入账号和密码', 'err'); return; }
        button.disabled = true;
        button.innerHTML = ICON('loader', 14, 'spin') + '验证中…';
        try {
          await API.login(account, pass);
          passwordInput.value = '';
          // The route subscriber may already have navigated on authentication.
          if (location.hash.startsWith('#/login')) location.hash = consumeReturnTo();
        } catch (error) {
          UI.toast(error.message || '登录失败', 'err');
        } finally {
          button.disabled = false;
          button.innerHTML = ICON('log-in', 15) + '进入工作台';
        }
      }
      el.querySelector('#lg-submit').addEventListener('click', doLogin);
      el.querySelector('#lg-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
      el.querySelector('#lg-account').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
    }
  };
})();
