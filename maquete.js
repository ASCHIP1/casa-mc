/* Casa MC · maquete 3D.
   The real Revit model (assets/casa-mc.glb, converted by source/fbx_to_glb.py)
   in two modes:
     Maquete  orbit view, a horizontal section plane lowered floor by floor,
              rotation by slider (all devices) or drag (fine pointer only).
     Passeio  a guided walk at eye height along the real route of the house,
              street > gate > garden > pivot door > hall > living room > dining > kitchen,
              driven by a slider or the Andar button; drag to look around.
   Zoom buttons work in both (distance in Maquete, focal length in Passeio).
   Model trees and shrubs are generated here: the project's own shrub beds and its
   4 m tree sit at their Revit positions; the street and back-garden trees are
   indicative, and the caption says so.
   Renders on demand, only while the chapter is near the viewport. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const $ = (id) => document.getElementById(id);
const section = $('maquete'), frame = $('model-frame'), canvas = $('model-canvas'), status = $('model-status');
const cut = $('cut'), cutOut = $('cut-out'), turn = $('turn');
const walk = $('walk'), walkOut = $('walk-out'), walkPlay = $('walk-play');
const zoomIn = $('zoom-in'), zoomOut = $('zoom-out'), zoomReset = $('zoom-reset');
const modeBtns = [...section.querySelectorAll('.model__mode')];
const panes = { orbit: section.querySelector('[data-pane="orbit"]'), walk: section.querySelector('[data-pane="walk"]') };
const controlsAll = [cut, turn, walk, walkPlay, zoomIn, zoomOut, zoomReset, ...modeBtns];
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = matchMedia('(hover: hover) and (pointer: fine)');

// Real levels from the Revit export: ground finish +0,60, PAV. SUPERIOR +3,60.
// A plan is a horizontal cut 1,20 m above the floor.
const CUT_NONE = 9.2, CUT_UPPER = 4.8, CUT_GROUND = 1.8;
const cutHeight = (v) => v <= 1 ? CUT_NONE + (CUT_UPPER - CUT_NONE) * v : CUT_UPPER + (CUT_GROUND - CUT_UPPER) * (v - 1);
const fmt = (z) => '+' + z.toFixed(2).replace('.', ',');
const EYE = 0.60 + 1.60;   // eye height on the ground floor

// The walk, in model coordinates (glTF: x, y up, z). Positions come from the
// Revit objects: street gate (pivot), house door (P01, 1,60 x 3,65), sofa,
// dining table, cooktop.
const ROUTE = [
  { name: 'Rua',             p: [ 9.6, 1.65,  6.0], look: [ 9.0, 2.6,  -6.7] },
  { name: 'Portão',          p: [ 9.62, 1.65, -0.8], look: [ 9.2, 2.4,  -6.7] },
  { name: 'Jardim',          p: [ 9.4, 1.80, -3.4], look: [ 9.0, 2.9,  -6.7] },
  { name: 'Porta pivotante', p: [ 9.15, EYE, -5.9], look: [ 9.0, 2.0, -11.0] },
  { name: 'Recebedor',       p: [ 9.25, EYE, -7.7], look: [ 8.6, 1.4, -11.2] },
  { name: 'Sala',            p: [ 9.6,  EYE, -9.1], look: [ 6.8, 6.0, -11.0] },
  { name: 'Sala de jantar',  p: [ 9.6,  EYE, -12.8], look: [ 9.1, 1.0, -15.3] },
  { name: 'Cozinha',         p: [ 5.4,  EYE, -15.0], look: [ 3.2, 1.3, -16.6] },
];
// The house door (P01, 1,60 x 3,65) pivots on its own axis, 0,34 m from its left edge.
const DOOR_AXIS = [8.33, -6.68], DOOR_OPEN = THREE.MathUtils.degToRad(84);

function fail(msg) {
  status.textContent = msg;
  status.hidden = false;
  controlsAll.forEach((c) => { c.disabled = true; });
  frame.classList.add('is-static');
}

function webglOK() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); }
  catch (e) { return false; }
}

// Deterministic scatter, so the page looks the same on every visit.
function rng(seed) { return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646; }

function buildGreenery(plane) {
  const g = new THREE.Group(); g.name = 'vegetacao';
  const canopyMats = [0xAFC3A4, 0xC1D0B6, 0x9DB394].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.95, flatShading: true }));
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8E7C68, roughness: 0.9 });
  const bedMat = new THREE.MeshStandardMaterial({ color: 0xC9D3C1, roughness: 1 });
  [...canopyMats, trunkMat, bedMat].forEach((m) => { m.clippingPlanes = [plane]; m.clipShadows = true; });
  const canopyGeo = new THREE.IcosahedronGeometry(1, 1);
  const shrubGeo = new THREE.IcosahedronGeometry(1, 0);
  const trunkGeo = new THREE.CylinderGeometry(0.07, 0.1, 1, 6);
  const add = (geo, mat, x, y, z, sx, sy, sz, ry = 0) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.y = ry;
    m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
  };
  const tree = (x, z, h, r, k, rot) => {     // model tree: a stick and a faceted crown
    add(trunkGeo, trunkMat, x, h * 0.32, z, 1, h * 0.64, 1);
    add(canopyGeo, canopyMats[k % 3], x, h * 0.66, z, r, r * 1.15, r, rot);
  };
  const shrub = (x, y, z, r, k, rot) => add(shrubGeo, canopyMats[k % 3], x, y + r * 0.55, z, r, r * 0.75, r, rot);
  const R = rng(20261109);

  // Project greenery at its Revit positions: the two shrub beds and the 4 m tree.
  const beds = [
    [2.23, -4.81], [2.93, -4.81], [3.83, -4.81], [4.73, -4.81], [5.23, -4.91], [9.24, -4.81], [9.84, -4.91], [10.34, -4.91], [11.14, -4.81],
    [2.32, -0.36], [2.62, -0.36], [2.72, -0.36], [3.22, -0.36], [3.32, -0.42], [3.42, -0.36], [6.35, -0.36], [7.15, -0.36], [7.35, -0.36],
    [10.25, -0.36], [10.72, -0.42], [11.25, -0.27], [12.05, -0.27], [12.72, -0.33], [13.21, -0.42], [13.51, -0.42]];
  beds.forEach(([x, z], i) => shrub(x, 0, z, 0.32 + R() * 0.14, i, R() * 6));
  tree(10.92, -7.57, 4.0, 1.25, 0);

  // Indicative: back garden and the street, never inside the house footprint.
  [[1.6, -25.5, 4.6, 1.5], [6.0, -27.8, 5.2, 1.7], [11.5, -26.4, 4.2, 1.4], [15.8, -27.6, 4.8, 1.6]]
    .forEach(([x, z, h, r], i) => tree(x, z, h, r, i + 1, R() * 6));
  for (let i = 0; i < 18; i++) shrub(0.8 + R() * 16.4, 0, -23.6 - R() * 5.6, 0.3 + R() * 0.35, i, R() * 6);
  // street trees, both kerbs, and a few beyond the side walls
  for (let i = 0; i < 7; i++) tree(-6 + i * 5.2 + R(), 7.2 + R() * 0.6, 5 + R() * 1.6, 1.5 + R() * 0.4, i, R() * 6);
  for (let i = 0; i < 5; i++) tree(-4 + i * 7 + R() * 2, 11.0, 4.6 + R() * 1.4, 1.4 + R() * 0.4, i + 2, R() * 6);
  [[-4.5, -8], [-5.5, -18], [-4.2, -30], [-6.5, -40], [23, -9], [24.5, -21], [22.5, -33], [25.5, -43], [8, -40], [14, -44]]
    .forEach(([x, z], i) => tree(x + R(), z + R(), 4.4 + R() * 2, 1.3 + R() * 0.6, i, R() * 6));
  for (let i = 0; i < 26; i++) {
    const side = R() < 0.5 ? -1 : 1;
    const x = side < 0 ? -1.5 - R() * 10 : 19.5 + R() * 10;
    shrub(x, -0.1, 4 - R() * 48, 0.35 + R() * 0.5, i, R() * 6);
  }
  return g;
}

async function start() {
  if (!webglOK()) { fail('Este navegador não mostra 3D. Fica a vista fixa da maquete.'); return; }

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true,
    preserveDrawingBuffer: new URLSearchParams(location.search).has('poster') });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.localClippingEnabled = true;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.5, 400);
  const hemi = new THREE.HemisphereLight(0xf4f7f8, 0xb7b2a8, 1.25);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), CUT_NONE);

  const draco = new DRACOLoader().setDecoderPath('vendor/three/addons/libs/draco/gltf/');
  const loader = new GLTFLoader().setDRACOLoader(draco);
  let gltf;
  try { gltf = await loader.loadAsync('assets/casa-mc.glb'); }
  catch (e) { fail('Não foi possível carregar a maquete. Fica a vista fixa.'); return; }

  const model = gltf.scene;
  const POCHE = 'vec3(0.106, 0.137, 0.165)'; // cut walls read as ink, like a drawn section
  model.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    m.clippingPlanes = [plane];
    m.clipShadows = true;
    m.side = THREE.DoubleSide;
    if (m.transparent) {
      m.depthWrite = false; o.castShadow = false; o.receiveShadow = false;
    } else {
      o.castShadow = true; o.receiveShadow = true;
      m.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>',
          '#include <dithering_fragment>\n if (!gl_FrontFacing) gl_FragColor = vec4(' + POCHE + ', 1.0);');
      };
    }
    if (/terreno/.test(o.name + (o.parent ? o.parent.name : ''))) { o.castShadow = false; }
  });
  scene.add(model);
  scene.add(buildGreenery(plane));

  const doorPivot = new THREE.Group();
  doorPivot.position.set(DOOR_AXIS[0], 0, DOOR_AXIS[1]);
  scene.add(doorPivot);
  const doorNode = model.getObjectByName('porta_entrada');
  if (doorNode) { doorPivot.attach(doorNode); }
  const setDoor = (k) => { doorPivot.rotation.y = DOOR_OPEN * k; };

  // inside, the roof keeps the sun out: a soft fill only for the walk
  const fill = new THREE.AmbientLight(0xffffff, 0);
  scene.add(fill);

  // Frame the house (the slabs), not the whole plot.
  const box = new THREE.Box3();
  model.traverse((o) => { if (o.isMesh && /laje/.test(o.name + (o.parent ? o.parent.name : ''))) box.expandByObject(o); });
  if (box.isEmpty()) box.setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = size.length() * 0.5;
  const radiusH = Math.hypot(size.x, size.z) * 0.5;
  center.y = box.min.y + 3.2;

  sun.position.set(center.x + radius * 1.1, center.y + radius * 1.6, center.z + radius * 0.7);
  sun.target.position.copy(center);
  const sc = sun.shadow.camera; sc.left = -radius * 1.6; sc.right = radius * 1.6; sc.top = radius * 1.6; sc.bottom = -radius * 1.6; sc.near = 1; sc.far = radius * 6;
  sc.updateProjectionMatrix();

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(center);
  controls.enableZoom = false;   // the wheel belongs to the page; zoom is a button
  controls.enablePan = false;
  controls.enableDamping = !reduce;
  controls.dampingFactor = 0.08;
  controls.minPolarAngle = 0.35;
  controls.maxPolarAngle = 1.32;

  let mode = 'orbit';
  let dirty = true, touched = false, visible = false;
  let dist0 = 1, zoomK = 1;                 // orbit: distance multiplier
  let fovWalk = 62;                         // walk: focal length
  const BASE_AZ = Math.PI * 0.18, POLAR = 1.02;

  const setInput = () => {
    controls.enabled = mode === 'orbit' && fine.matches;
    // In the walk the canvas takes drags on every device (looking around);
    // in the orbit view touch keeps scrolling the page.
    canvas.style.touchAction = (mode === 'walk' || fine.matches) ? 'none' : 'pan-y';
  };
  setInput(); fine.addEventListener('change', setInput);

  const scrollAz = () => {
    if (reduce) return 0;
    const p = parseFloat(section.style.getPropertyValue('--sc-p')) || 0.5;
    return (p - 0.5) * 0.9;
  };
  const polarFor = () => POLAR - 0.42 * Math.min(parseFloat(cut.value) || 0, 2) / 2;
  const curSph = () => new THREE.Spherical().setFromVector3(camera.position.clone().sub(center));

  function place(az, polar) {
    const s = new THREE.Spherical(dist0 * zoomK, polar, az);
    camera.position.copy(center).add(new THREE.Vector3().setFromSpherical(s));
    camera.lookAt(center);
    controls.update();
  }

  // ---------------------------------------------------------------- walk
  const pts = ROUTE.map((r) => new THREE.Vector3(...r.p));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.3);
  // arc-length position of each stop on the curve, so the slider is uniform in metres
  const stopT = (() => {
    const lens = curve.getLengths(400), L = lens[lens.length - 1];
    return pts.map((p) => {
      let best = 0, bd = Infinity;
      for (let i = 0; i <= 400; i++) { const d = curve.getPoint(i / 400).distanceTo(p); if (d < bd) { bd = d; best = i; } }
      return lens[best] / L;
    });
  })();
  const looks = ROUTE.map((r) => new THREE.Vector3(...r.look));
  let lookYaw = 0, lookPitch = 0;           // visitor's own look-around offset
  let playing = false, lastT = 0;

  function walkPose(u) {
    const pos = curve.getPointAt(u);
    let k = 0;
    while (k < stopT.length - 2 && u > stopT[k + 1]) k++;
    const f = THREE.MathUtils.smoothstep(u, stopT[k], stopT[k + 1]);
    const look = looks[k].clone().lerp(looks[k + 1], f);
    const name = ROUTE[f > 0.5 ? k + 1 : k].name;
    return { pos, look, name };
  }

  function applyWalk() {
    const u = parseFloat(walk.value);
    const { pos, look, name } = walkPose(u);
    camera.position.copy(pos);
    const dir = look.clone().sub(pos).normalize();
    // apply the visitor's yaw/pitch on top of the authored gaze
    const sph = new THREE.Spherical().setFromVector3(dir);
    sph.theta += lookYaw;
    sph.phi = THREE.MathUtils.clamp(sph.phi - lookPitch, 0.25, Math.PI - 0.25);
    const target = pos.clone().add(new THREE.Vector3().setFromSpherical(sph));
    camera.lookAt(target);
    // the door swings open as the visitor comes up the steps, and stays open
    setDoor(THREE.MathUtils.smoothstep(u, stopT[2] - 0.02, stopT[3] - 0.01));
    if (walkOut.textContent !== name) walkOut.textContent = name;
    walk.setAttribute('aria-valuetext', name);
    dirty = true;
  }

  // drag to look around (walk mode, any pointer)
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (mode !== 'walk') return;
    drag = { x: e.clientX, y: e.clientY, yaw: lookYaw, pitch: lookPitch };
  });
  addEventListener('pointermove', (e) => {
    if (!drag) return;
    const k = 2.4 / Math.max(frame.clientWidth, 1);
    lookYaw = drag.yaw + (e.clientX - drag.x) * k;
    lookPitch = THREE.MathUtils.clamp(drag.pitch + (e.clientY - drag.y) * k, -0.9, 0.9);
    applyWalk();
  });
  addEventListener('pointerup', () => { drag = null; });
  addEventListener('pointercancel', () => { drag = null; });

  function setPlaying(on) {
    playing = on && !reduce;
    walkPlay.setAttribute('aria-pressed', playing ? 'true' : 'false');
    walkPlay.textContent = playing ? 'Parar' : (parseFloat(walk.value) >= 0.999 ? 'Recomeçar' : 'Andar');
    lastT = performance.now();
  }
  walkPlay.addEventListener('click', () => {
    if (reduce) {               // no animation: step to the next stop instead
      const u = parseFloat(walk.value);
      const next = stopT.find((t) => t > u + 0.002);
      walk.value = next === undefined ? 0 : next; lookYaw = lookPitch = 0; applyWalk();
      walkPlay.textContent = next === undefined ? 'Andar' : 'Seguinte';
      return;
    }
    if (!playing && parseFloat(walk.value) >= 0.999) walk.value = 0;
    setPlaying(!playing);
  });
  walk.addEventListener('input', () => { setPlaying(false); lookYaw = lookPitch = 0; applyWalk(); });

  // ---------------------------------------------------------------- modes
  function setMode(m) {
    if (m === mode) return;
    mode = m;
    modeBtns.forEach((b) => b.setAttribute('aria-pressed', b.dataset.mode === m ? 'true' : 'false'));
    panes.orbit.hidden = m !== 'orbit';
    panes.walk.hidden = m !== 'walk';
    setPlaying(false);
    if (m === 'walk') {
      plane.constant = CUT_NONE;            // walk through the whole house
      camera.fov = fovWalk; camera.near = 0.05; camera.far = 260;
      hemi.intensity = 1.6; fill.intensity = 0.9;   // the roof would leave the inside in shadow
      camera.updateProjectionMatrix();
      lookYaw = lookPitch = 0;
      applyWalk();
    } else {
      hemi.intensity = 1.25; fill.intensity = 0;
      setDoor(0);
      applyCut();
      resize();
    }
    setInput();
    frame.classList.toggle('is-walk', m === 'walk');
    dirty = true;
  }
  modeBtns.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  // ---------------------------------------------------------------- zoom
  function zoom(dir) {
    if (mode === 'orbit') {
      zoomK = THREE.MathUtils.clamp(zoomK * (dir > 0 ? 0.8 : 1.25), 0.35, 1.6);
      const s = curSph(); place(s.theta, s.phi);
    } else {
      fovWalk = THREE.MathUtils.clamp(fovWalk * (dir > 0 ? 0.82 : 1.22), 26, 80);
      camera.fov = fovWalk; camera.updateProjectionMatrix();
    }
    dirty = true;
  }
  zoomIn.addEventListener('click', () => zoom(1));
  zoomOut.addEventListener('click', () => zoom(-1));
  zoomReset.addEventListener('click', () => {
    if (mode === 'orbit') { zoomK = 1; touched = false; turn.value = 0; const s = curSph(); place(BASE_AZ + scrollAz(), polarFor()); }
    else { fovWalk = 62; camera.fov = fovWalk; camera.updateProjectionMatrix(); lookYaw = lookPitch = 0; applyWalk(); }
    dirty = true;
  });

  // ---------------------------------------------------------------- orbit
  function resize() {
    const w = frame.clientWidth, h = frame.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    if (mode === 'walk') { camera.updateProjectionMatrix(); dirty = true; return; }
    camera.fov = 28;
    const vfov = THREE.MathUtils.degToRad(camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
    dist0 = (Math.max(radiusH, 6) * 1.02) / Math.sin(Math.min(vfov, hfov) / 2);
    camera.near = dist0 * 0.03; camera.far = dist0 * 8;
    camera.updateProjectionMatrix();
    const s = curSph();
    place(touched ? s.theta : BASE_AZ + scrollAz(), touched ? s.phi : polarFor());
    dirty = true;
  }

  controls.addEventListener('start', () => { touched = true; });
  controls.addEventListener('change', () => {
    if (mode !== 'orbit') return;
    dirty = true;
    turn.value = Math.round(THREE.MathUtils.radToDeg(curSph().theta - BASE_AZ));
  });

  function applyCut() {
    if (mode !== 'orbit') return;
    const z = cutHeight(parseFloat(cut.value));
    plane.constant = z;
    cutOut.textContent = z >= CUT_NONE - 0.05 ? 'sem corte' : fmt(z);
    dirty = true;
  }
  cut.addEventListener('input', applyCut);
  turn.addEventListener('input', () => {
    touched = true;
    place(BASE_AZ + THREE.MathUtils.degToRad(parseFloat(turn.value)), curSph().phi);
    dirty = true;
  });

  new ResizeObserver(resize).observe(frame);
  new IntersectionObserver((es) => {
    visible = es[0].isIntersecting;
    if (visible) dirty = true; else setPlaying(false);
  }, { rootMargin: '200px' }).observe(frame);

  let lastAz = null, lastPol = POLAR;
  const WALK_SPEED = 1 / 38;                 // the whole route in ~38 s
  function loop(now) {
    requestAnimationFrame(loop);
    if (!visible) return;
    if (mode === 'orbit') {
      if (!touched) {
        const az = BASE_AZ + scrollAz(), pol = polarFor();
        if (lastAz === null || Math.abs(az - lastAz) > 0.0005 || Math.abs(pol - lastPol) > 0.0005) { place(az, pol); lastAz = az; lastPol = pol; dirty = true; }
      }
      if (controls.enableDamping && controls.update()) dirty = true;
    } else if (playing) {
      const dt = Math.min((now - lastT) / 1000, 0.1); lastT = now;
      let u = parseFloat(walk.value) + dt * WALK_SPEED;
      // ease the gaze back to the authored direction while walking
      lookYaw *= 0.96; lookPitch *= 0.96;
      if (u >= 1) { u = 1; walk.value = u; applyWalk(); setPlaying(false); }
      else { walk.value = u; applyWalk(); }
    }
    if (!dirty) return;
    dirty = false;
    renderer.render(scene, camera);
  }

  applyCut();
  resize();
  applyWalkLabelOnly();
  renderer.render(scene, camera);
  frame.classList.add('is-live');
  status.hidden = true;
  controlsAll.forEach((c) => { c.disabled = false; });
  requestAnimationFrame(loop);
  window.__maquete = { ready: true, setMode, zoom, walkTo: (u) => { walk.value = u; setPlaying(false); applyWalk(); }, render: () => renderer.render(scene, camera) };

  function applyWalkLabelOnly() { walkOut.textContent = ROUTE[0].name; walk.setAttribute('aria-valuetext', ROUTE[0].name); }
}

// Load only when the chapter is close, so the rest of the page never waits on 3D.
const near = new IntersectionObserver((es) => {
  if (!es[0].isIntersecting) return;
  near.disconnect();
  start().catch((e) => { console.error(e); fail('Não foi possível mostrar a maquete. Fica a vista fixa.'); });
}, { rootMargin: '900px 0px' });
near.observe(section);
