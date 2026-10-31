/*
  The scene behind the site: three layers of stars at different depths
  and, on the home page, a planet drawn in green dots with a halo and a
  few arcs crossing between its continents.

  Everything here is driven by three numbers: the time, the scroll
  position and the pointer. Scrolling moves the star layers at
  different speeds and carries the planet up out of the horizon and
  then aside; the pointer leans the whole thing a little. Under
  reduced motion it is drawn once per scroll and never drifts.

  It also plays the home page's intro: the planet's dots fly in from
  all over and gather into a sphere in the middle of the screen, which
  then sinks to become the horizon under the name.

  A few satellites circle the planet, and following a writeup flies
  the camera in towards the planet before the page changes.
*/
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';

export type SpaceMode = 'home' | 'page';
export interface SpaceScene {
  setMode(mode: SpaceMode, intro: boolean): void;
  skipIntro(): void;
  flyIn(): void;
}

const ACCENT = new Color('#2BE39B');
const DEEP = new Color('#11B97A');
const BODY = new Color('#04100c');
const FOV = 45;
const TAN = Math.tan((FOV / 2) * (Math.PI / 180));
const R = 6;
/* The intro, in milliseconds: the dots gather, the sphere hangs there
   for a moment, then sinks to the horizon. It is kept short by joining
   the gathering partway through, not by playing it faster: the dots
   are already closing in when the screen first shows them, and the
   name rises while the planet sinks. */
const ASSEMBLE = 2600;
const JOIN_AT = 1750;
const HOLD = 150;
const DESCEND = 1600;
/* Flying in towards the planet when a writeup is opened. The page
   changes near the end of it; the flight finishes on the new page and
   only then drifts back out, slowly, while the planet fades. */
const FLY = 1300;

/* ---- noise, for where the continents are ---- */

function hash(x: number, y: number, z: number) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1440662683);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
const fade = (t: number) => t * t * (3 - 2 * t);
function noise(x: number, y: number, z: number) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = fade(x - xi), yf = fade(y - yi), zf = fade(z - zi);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash(xi + dx, yi + dy, zi + dz);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), xf), lerp(c(0, 1, 0), c(1, 1, 0), xf), yf),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), xf), lerp(c(0, 1, 1), c(1, 1, 1), xf), yf),
    zf,
  );
}
function fbm(x: number, y: number, z: number) {
  let sum = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < 4; i++) {
    sum += amp * noise(x * freq, y * freq, z * freq);
    amp *= 0.5;
    freq *= 2.1;
  }
  return sum;
}
const isLand = (v: Vector3) => fbm(v.x * 1.7 + 11.3, v.y * 1.7 + 4.1, v.z * 1.7 + 7.7) > 0.5;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const smooth = (t: number) => t * t * (3 - 2 * t);

/* ---- stars ---- */

const starVertex = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uPixel;
  uniform float uScale;
  uniform float uOpacity;
  uniform float uOffset;
  uniform float uHeight;
  uniform float uTwinkle;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec3 p = position;
    p.y = mod(p.y + uOffset + uHeight * 0.5, uHeight) - uHeight * 0.5;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float twinkle = 0.55 + 0.45 * sin(uTime * (0.5 + aPhase) + aPhase * 12.0);
    vAlpha = mix(0.85, twinkle, uTwinkle) * uOpacity;
    vColor = aColor;
    gl_PointSize = aSize * uScale * uPixel;
  }
`;
const starFragment = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vColor, a * a * vAlpha);
  }
`;

interface StarLayer {
  points: Points;
  material: ShaderMaterial;
  depth: number;
  height: number;
  scroll: number;
  lean: number;
  drift: number;
}

function makeStars(count: number, zNear: number, zFar: number, scale: number, scroll: number, lean: number, drift: number, pixel: number): StarLayer {
  // Tall enough to cover the window from the furthest the camera goes.
  const height = 2 * (20 + zFar) * TAN * 1.15;
  const width = height * 2.6;
  const positions: number[] = [];
  const sizes: number[] = [];
  const phases: number[] = [];
  const colors: number[] = [];
  const white = new Color('#e6edff');
  const blue = new Color('#9db8ff');
  for (let i = 0; i < count; i++) {
    positions.push((Math.random() - 0.5) * width, (Math.random() - 0.5) * height, -mix(zNear, zFar, Math.random()));
    const bright = Math.random() < 0.06;
    sizes.push(bright ? 2.2 + Math.random() : 0.6 + Math.random() * 1.1);
    phases.push(Math.random());
    const pick = Math.random();
    const c = pick < 0.12 ? ACCENT : pick < 0.22 ? blue : white;
    colors.push(c.r, c.g, c.b);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aSize', new Float32BufferAttribute(sizes, 1));
  geometry.setAttribute('aPhase', new Float32BufferAttribute(phases, 1));
  geometry.setAttribute('aColor', new Float32BufferAttribute(colors, 3));
  const material = new ShaderMaterial({
    vertexShader: starVertex,
    fragmentShader: starFragment,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uPixel: { value: pixel },
      uScale: { value: scale },
      uOpacity: { value: 1 },
      uOffset: { value: 0 },
      uHeight: { value: height },
      uTwinkle: { value: 1 },
    },
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = -2;
  return { points, material, depth: (zNear + zFar) / 2, height, scroll, lean, drift };
}

/* ---- planet ---- */

const dotVertex = /* glsl */ `
  attribute float aLand;
  attribute float aRand;
  attribute vec3 aStart;
  uniform float uTime;
  uniform float uPixel;
  uniform float uOpacity;
  uniform float uAssemble;
  uniform float uBoost;
  uniform vec3 uLight;
  varying float vAlpha;
  varying float vLand;
  void main() {
    // Each dot sets off a little after the last and settles on the
    // sphere; in flight it is lit whichever way it faces.
    float t = clamp(uAssemble * 1.6 - aRand * 0.6, 0.0, 1.0);
    float e = 1.0 - pow(1.0 - t, 3.0);
    vec3 n = normalize(normalMatrix * position);
    vec4 mv = modelViewMatrix * vec4(mix(aStart, position, e), 1.0);
    gl_Position = projectionMatrix * mv;
    float lit = mix(1.0, smoothstep(-0.3, 0.8, dot(n, uLight)), e);
    float pulse = 0.82 + 0.18 * sin(uTime * 1.6 + aRand * 6.2831);
    // Brighter while the planet hangs in the middle of the intro, far
    // from the camera; ordinary once it has sunk to the horizon.
    vAlpha = min(1.0, mix(0.2, 0.95, aLand) * (0.14 + 0.86 * lit) * pulse * (1.0 + uBoost * 1.6)) * uOpacity;
    vLand = aLand;
    // Shrinks with distance, but gently, so the gathered sphere in the
    // middle of the intro still reads as dots.
    gl_PointSize = mix(1.4, 2.5, aLand) * uPixel * pow(11.0 / -mv.z, 0.45) * (1.0 + uBoost * 0.5);
  }
`;
const dotFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uDeep;
  varying float vAlpha;
  varying float vLand;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    gl_FragColor = vec4(mix(uDeep, uColor, vLand), smoothstep(0.5, 0.1, d) * vAlpha);
  }
`;
const bodyVertex = /* glsl */ `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const bodyFragment = /* glsl */ `
  uniform vec3 uBase;
  uniform vec3 uColor;
  uniform vec3 uLight;
  uniform float uOpacity;
  varying vec3 vNormal;
  void main() {
    float rim = pow(1.0 - max(dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0), 2.6);
    float lit = clamp(dot(vNormal, uLight) * 0.5 + 0.5, 0.0, 1.0);
    vec3 color = uBase + uColor * rim * (0.08 + 0.75 * lit);
    gl_FragColor = vec4(color, uOpacity);
  }
`;
const haloVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const haloFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uSpan;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - 0.5) * uSpan;
    float r = length(p);
    float g = r < 1.0 ? 0.0 : pow(clamp(1.0 - (r - 1.0) / 0.38, 0.0, 1.0), 2.6);
    float side = 0.55 + 0.45 * dot(normalize(p), normalize(vec2(-0.45, 0.9)));
    gl_FragColor = vec4(uColor, g * side * 0.6 * uOpacity);
  }
`;
const arcVertex = /* glsl */ `
  attribute float aT;
  varying float vT;
  void main() {
    vT = aT;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const satelliteVertex = /* glsl */ `
  uniform float uPixel;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = 10.0 * uPixel;
  }
`;
const satelliteFragment = /* glsl */ `
  uniform vec3 uCore;
  uniform vec3 uGlow;
  uniform float uOpacity;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float core = smoothstep(0.16, 0.0, d);
    float glow = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(mix(uGlow, uCore, core), (core + glow * glow * 0.7) * uOpacity);
  }
`;
const arcFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uHead;
  uniform float uOpacity;
  varying float vT;
  void main() {
    float tail = smoothstep(uHead - 0.4, uHead, vT) * step(vT, uHead);
    gl_FragColor = vec4(uColor, tail * uOpacity);
  }
`;

interface Arc { material: ShaderMaterial; speed: number; offset: number }

function makePlanet(count: number, pixel: number, light: Vector3) {
  const root = new Group();
  const globe = new Group();
  root.add(globe);
  globe.rotation.z = 0.32;

  // Dots spread evenly over the sphere: a Fibonacci lattice.
  const positions: number[] = [];
  const starts: number[] = [];
  const land: number[] = [];
  const rand: number[] = [];
  const landPoints: Vector3[] = [];
  const from = new Vector3();
  const golden = Math.PI * (3 - Math.sqrt(5));
  const v = new Vector3();
  for (let i = 0; i < count; i++) {
    const y = 1 - ((i + 0.5) / count) * 2;
    const r = Math.sqrt(1 - y * y);
    v.set(Math.cos(i * golden) * r, y, Math.sin(i * golden) * r);
    const onLand = isLand(v);
    positions.push(v.x * R, v.y * R, v.z * R);
    // Where it starts the intro: anywhere in a wide shell around it.
    from.randomDirection().multiplyScalar(R * (2.2 + Math.random() * 5));
    starts.push(from.x, from.y, from.z);
    land.push(onLand ? 1 : 0);
    rand.push(Math.random());
    if (onLand && i % 7 === 0) landPoints.push(v.clone());
  }
  const dotsGeometry = new BufferGeometry();
  dotsGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  dotsGeometry.setAttribute('aLand', new Float32BufferAttribute(land, 1));
  dotsGeometry.setAttribute('aRand', new Float32BufferAttribute(rand, 1));
  dotsGeometry.setAttribute('aStart', new Float32BufferAttribute(starts, 3));
  const dotsMaterial = new ShaderMaterial({
    vertexShader: dotVertex,
    fragmentShader: dotFragment,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uPixel: { value: pixel },
      uOpacity: { value: 1 },
      uAssemble: { value: 1 },
      uBoost: { value: 0 },
      uLight: { value: light },
      uColor: { value: ACCENT },
      uDeep: { value: DEEP },
    },
  });
  const dots = new Points(dotsGeometry, dotsMaterial);
  dots.renderOrder = 1;
  globe.add(dots);

  // A dark body just under the dots hides the far side and the stars
  // behind it, and carries the rim of atmosphere.
  const bodyMaterial = new ShaderMaterial({
    vertexShader: bodyVertex,
    fragmentShader: bodyFragment,
    transparent: true,
    uniforms: {
      uBase: { value: BODY },
      uColor: { value: ACCENT },
      uLight: { value: light },
      uOpacity: { value: 1 },
    },
  });
  const body = new Mesh(new SphereGeometry(R * 0.985, 72, 48), bodyMaterial);
  body.renderOrder = 0;
  root.add(body);

  const span = 2.9;
  const haloMaterial = new ShaderMaterial({
    vertexShader: haloVertex,
    fragmentShader: haloFragment,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { uColor: { value: ACCENT }, uOpacity: { value: 1 }, uSpan: { value: span } },
  });
  const halo = new Mesh(new PlaneGeometry(R * span, R * span), haloMaterial);
  halo.renderOrder = -1;
  root.add(halo);

  // Arcs between continents, each a comet that runs its length.
  const arcs: Arc[] = [];
  for (let n = 0; n < 9 && landPoints.length > 2; n++) {
    const a = landPoints[Math.floor(Math.random() * landPoints.length)];
    let b = a;
    for (let tries = 0; tries < 40; tries++) {
      b = landPoints[Math.floor(Math.random() * landPoints.length)];
      const angle = a.angleTo(b);
      if (angle > 0.5 && angle < 1.5) break;
    }
    const angle = a.angleTo(b);
    if (angle < 0.3) continue;
    const pts: number[] = [];
    const ts: number[] = [];
    const steps = 64;
    const p = new Vector3();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // Spherical interpolation, lifted off the surface in the middle.
      const s = Math.sin(angle);
      p.copy(a).multiplyScalar(Math.sin((1 - t) * angle) / s).addScaledVector(b, Math.sin(t * angle) / s);
      p.multiplyScalar(R * (1 + Math.sin(Math.PI * t) * 0.16 * angle));
      pts.push(p.x, p.y, p.z);
      ts.push(t);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(pts, 3));
    geometry.setAttribute('aT', new Float32BufferAttribute(ts, 1));
    const material = new ShaderMaterial({
      vertexShader: arcVertex,
      fragmentShader: arcFragment,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uColor: { value: ACCENT }, uHead: { value: 0 }, uOpacity: { value: 1 } },
    });
    const line = new Line(geometry, material);
    line.renderOrder = 2;
    globe.add(line);
    arcs.push({ material, speed: 0.12 + Math.random() * 0.12, offset: Math.random() });
  }

  // Satellites, each on a tilted orbit drawn as a faint ring. They hang
  // off the root rather than the globe, so they keep their own pace.
  const orbitMaterial = new LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0, depthWrite: false });
  const satelliteMaterial = new ShaderMaterial({
    vertexShader: satelliteVertex,
    fragmentShader: satelliteFragment,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { uPixel: { value: pixel }, uCore: { value: new Color('#f2fff9') }, uGlow: { value: ACCENT }, uOpacity: { value: 1 } },
  });
  const satellites: { pivot: Group; speed: number }[] = [];
  const orbits = [
    { radius: 1.28, tilt: 0.42, roll: 0.3, speed: 0.2 },
    { radius: 1.52, tilt: 0.28, roll: -0.5, speed: -0.13 },
    { radius: 1.8, tilt: 0.55, roll: 0.12, speed: 0.08 },
  ];
  for (const orbit of orbits) {
    const plane = new Group();
    plane.rotation.set(orbit.tilt, 0, orbit.roll);
    root.add(plane);
    const ring: number[] = [];
    for (let i = 0; i < 160; i++) {
      const a = (i / 160) * Math.PI * 2;
      ring.push(Math.cos(a) * R * orbit.radius, 0, Math.sin(a) * R * orbit.radius);
    }
    const ringGeometry = new BufferGeometry();
    ringGeometry.setAttribute('position', new Float32BufferAttribute(ring, 3));
    plane.add(new LineLoop(ringGeometry, orbitMaterial));
    const pivot = new Group();
    pivot.rotation.y = Math.random() * Math.PI * 2;
    plane.add(pivot);
    const satelliteGeometry = new BufferGeometry();
    satelliteGeometry.setAttribute('position', new Float32BufferAttribute([R * orbit.radius, 0, 0], 3));
    const satellite = new Points(satelliteGeometry, satelliteMaterial);
    satellite.renderOrder = 2;
    pivot.add(satellite);
    satellites.push({ pivot, speed: orbit.speed });
  }

  // The body, halo and arcs only fade in once the dots have gathered;
  // until then the body must not hide dots still flying behind it.
  const setOpacity = (o: number, assemble: number, boost: number) => {
    const formed = o * smooth(clamp01((assemble - 0.7) / 0.3));
    dotsMaterial.uniforms.uOpacity.value = o;
    dotsMaterial.uniforms.uAssemble.value = assemble;
    dotsMaterial.uniforms.uBoost.value = boost;
    bodyMaterial.uniforms.uOpacity.value = Math.min(1, formed * 1.4);
    bodyMaterial.depthWrite = assemble > 0.9;
    haloMaterial.uniforms.uOpacity.value = formed;
    for (const arc of arcs) arc.material.uniforms.uOpacity.value = formed;
    orbitMaterial.opacity = formed * 0.16;
    satelliteMaterial.uniforms.uOpacity.value = formed;
  };
  const tick = (time: number, dt: number) => {
    dotsMaterial.uniforms.uTime.value = time;
    for (const satellite of satellites) satellite.pivot.rotation.y += satellite.speed * dt;
    for (const arc of arcs) {
      // Each arc runs, then rests a while before the next run.
      arc.material.uniforms.uHead.value = ((time * arc.speed + arc.offset) % 1) * 2.6 - 0.2;
    }
  };
  return { root, globe, setOpacity, tick };
}

/* ---- the whole scene ---- */

export function createSpace(canvas: HTMLCanvasElement, initialMode: SpaceMode, initialIntro: boolean, still: boolean): SpaceScene {
  const small = matchMedia('(max-width: 52rem)').matches;
  const pixel = Math.min(window.devicePixelRatio || 1, 1.5);
  const renderer = new WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(pixel);
  renderer.setClearColor(0x000000, 0);

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 0.1, 200);
  const light = new Vector3(-0.55, 0.65, 0.55).normalize();

  const layers = [
    makeStars(small ? 700 : 1500, 48, 75, 1.1, 0.04, 0.5, 0.012, pixel),
    makeStars(small ? 320 : 650, 28, 48, 1.6, 0.11, 1.2, 0.02, pixel),
    makeStars(small ? 90 : 200, 14, 28, 2.3, 0.24, 2.4, 0.035, pixel),
  ];
  for (const layer of layers) scene.add(layer.points);

  const planet = makePlanet(small ? 9000 : 22000, pixel, light);
  scene.add(planet.root);

  let mode = initialMode;
  let hero: HTMLElement | null = document.querySelector('[data-planet]');
  let planetAlpha = mode === 'home' ? 1 : 0;
  let starAlpha = mode === 'home' ? 1 : 0.6;
  let entrance = 0;
  let rising = false;
  let riseStart = 0;
  let pointerX = 0, pointerY = 0, leanX = 0, leanY = 0;
  let width = 0, height = 0;
  let introOn = false;
  let introSent = false;
  let introStart = 0;
  let descendAt = 0;
  let baseZ = 10;
  let fly = 0;
  let flying = false;
  let flyStart = 0;
  // How far the page has been scrolled, as a running total that ignores
  // jumps: a new page starts at its top, and the stars and the globe's
  // turn must carry on from where they were rather than leap with it.
  let lastScroll = window.scrollY;
  let travel = window.scrollY;

  const resize = () => {
    width = window.innerWidth;
    height = window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // A tall phone screen would show only a sliver of the planet;
    // stepping the camera back keeps its curve readable.
    baseZ = camera.aspect < 1 ? Math.min(20, 10 / Math.pow(camera.aspect, 0.75)) : 10;
    camera.position.z = baseZ;
    camera.updateProjectionMatrix();
  };
  resize();

  const rise = () => {
    if (still) { entrance = 1; return; }
    entrance = 0;
    rising = true;
    riseStart = performance.now();
  };
  const startIntro = () => {
    introOn = true;
    introSent = false;
    introStart = performance.now() - JOIN_AT;
    descendAt = introStart + ASSEMBLE + HOLD;
    entrance = 1;
    rising = false;
    starAlpha = 0;
  };
  // Arriving on the home page: the intro if it is due, otherwise the
  // planet just rises into its horizon.
  const arrive = (intro: boolean) => {
    if (intro && !still) startIntro();
    else rise();
  };
  if (mode === 'home') arrive(initialIntro);

  const place = (time: number, dt: number) => {
    const scrollY = window.scrollY;
    const k = Math.min(1, dt * 3);
    const moved = scrollY - lastScroll;
    if (Math.abs(moved) < height * 0.9) travel += moved;
    lastScroll = scrollY;

    // Stars: each layer scrolls by a share of the page, drifts upward
    // slowly, and leans away from the pointer by its depth.
    for (const layer of layers) {
      const d = baseZ + layer.depth;
      const unitsPerPixel = (2 * d * TAN) / height;
      layer.material.uniforms.uOffset.value = travel * layer.scroll * unitsPerPixel + time * layer.drift;
      layer.material.uniforms.uTime.value = time;
      layer.material.uniforms.uTwinkle.value = still ? 0 : 1;
      layer.points.position.x = -leanX * layer.lean;
      layer.points.position.y = leanY * layer.lean * 0.6;
    }

    const targetStars = mode === 'home' ? 1 : 0.6;
    const targetPlanet = mode === 'home' ? 1 : 0;
    starAlpha = still ? targetStars : mix(starAlpha, targetStars, k);
    planetAlpha = still ? targetPlanet : mix(planetAlpha, targetPlanet, k);
    for (const layer of layers) layer.material.uniforms.uOpacity.value = starAlpha;

    const now = performance.now();
    if (rising) entrance = Math.min(1, (now - riseStart) / 2600);
    const up = ease(entrance);

    // The intro: how far the dots have gathered, and how much of the
    // planet's place is still the middle of the screen.
    let assemble = 1;
    let centred = 0;
    if (introOn) {
      assemble = clamp01((now - introStart) / ASSEMBLE);
      const sink = clamp01((now - descendAt) / DESCEND);
      centred = 1 - smooth(sink);
      if (!introSent && now >= descendAt) {
        introSent = true;
        document.dispatchEvent(new Event('pytho:intro-done'));
      }
      if (sink >= 1) introOn = false;
    }

    // Planet: a horizon under the hero, risen once the hero has been
    // scrolled past, and then off to one side for the rest of the page.
    const heroHeight = hero?.offsetHeight || height;
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - height);
    const p = smooth(clamp01(scrollY / heroHeight));
    const q = smooth(clamp01((scrollY - heroHeight) / Math.max(1, (maxScroll - heroHeight) * 0.35)));
    const z = mix(mix(0, -3, p), -9, q);
    const half = (baseZ - z) * TAN;
    const horizon = -half * 0.42 - R;
    const risen = -half * 0.05 - R * 0.55;
    // Far enough back for the whole sphere to sit inside the screen.
    const back = R / (TAN * Math.min(0.5, 0.72 * camera.aspect));
    // Away from the home page (from the moment its hero is swapped out)
    // the planet stays where it was left while it fades, instead of
    // following the new page's scroll.
    if (mode === 'home' && hero?.isConnected) {
      planet.root.position.set(
        mix(mix(0, half * camera.aspect * 0.62, q), 0, centred),
        mix(mix(mix(horizon, risen, p), half * 0.1, q) - (1 - up) * half * 0.9, 0, centred),
        mix(z, baseZ - back, centred),
      );
    }
    planet.setOpacity(planetAlpha * mix(mix(1, 0.4, q) * clamp01(up * 1.5), 1, centred), assemble, centred);
    planet.root.visible = planetAlpha > 0.01;

    // The globe turns on its own, a little faster while scrolling, and
    // tips towards the pointer.
    planet.globe.rotation.y = time * 0.045 + travel * 0.0004 + leanX * 0.18 + (1 - ease(assemble)) * 2.4;
    planet.globe.rotation.x = 0.18 - leanY * 0.1;
    planet.tick(time, dt);

    // Flying in: the camera eases in towards the planet and, once there,
    // drifts back out to where it rests.
    if (flying) {
      fly = clamp01((now - flyStart) / FLY);
      if (fly >= 1) flying = false;
    } else {
      fly = mix(fly, 0, Math.min(1, dt * 0.9));
    }
    const pull = fly < 0.5 ? 4 * fly * fly * fly : 1 - Math.pow(-2 * fly + 2, 3) / 2;
    const at = planet.root.position;
    camera.position.set(at.x * pull * 0.75, at.y * pull * 0.6, mix(baseZ, at.z + R * 1.7, pull));
  };

  let last = performance.now();
  let frame = 0;
  const loop = (now: number) => {
    frame = requestAnimationFrame(loop);
    if (document.hidden) { last = now; return; }
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    leanX = mix(leanX, pointerX, Math.min(1, dt * 2.5));
    leanY = mix(leanY, pointerY, Math.min(1, dt * 2.5));
    place(now / 1000, dt);
    renderer.render(scene, camera);
  };

  const drawOnce = () => {
    place(0, 1);
    renderer.render(scene, camera);
  };

  window.addEventListener('resize', () => { resize(); if (still) drawOnce(); });
  if (still) {
    let queued = false;
    window.addEventListener('scroll', () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; drawOnce(); });
    }, { passive: true });
    drawOnce();
  } else {
    window.addEventListener('pointermove', (event) => {
      pointerX = (event.clientX / width) * 2 - 1;
      pointerY = (event.clientY / height) * 2 - 1;
    }, { passive: true });
    frame = requestAnimationFrame(loop);
  }
  void frame;

  return {
    setMode(next, intro) {
      hero = document.querySelector('[data-planet]');
      const wasHome = mode === 'home';
      mode = next;
      if (next === 'home') flying = false;
      if (next === 'home' && !wasHome) arrive(intro);
      if (still) drawOnce();
    },
    // Straight to the sinking part, with every dot already home.
    skipIntro() {
      if (!introOn) return;
      const now = performance.now();
      if (now < descendAt) {
        introStart = Math.min(introStart, now - ASSEMBLE);
        descendAt = now;
      }
    },
    flyIn() {
      if (still || mode !== 'home') return;
      flying = true;
      flyStart = performance.now();
    },
  };
}
