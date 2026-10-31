/*
  The scene behind the site: three layers of stars, and on the home page
  a small solar system of three planets under the page and a few more
  far off, each drawn in coloured dots with a halo. The camera rests
  above a planet's horizon while its sections are read and flies on to
  the next planet as the next pair of sections scrolls in.

  Everything here is driven by three numbers: the time, the scroll
  position and the pointer. Under reduced motion it is drawn once per
  scroll and never drifts.

  It also plays the home page's intro: the first planet's dots fly in
  from all over and gather into a sphere in the middle of the screen,
  which then sinks to become the horizon under the name. Following a
  writeup flies the camera in towards the planet being read before the
  page changes.
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

/* ---- the worlds ----
   Three planets, each under two sections of the home page. The camera
   rests above a planet's horizon while its sections are read, and flies
   to the next one as the next pair begins. They sit down and away from
   one another, so the one still to come hangs small in the distance. */

interface Orbit { radius: number; tilt: number; roll: number; speed: number }
interface WorldSpec {
  /* The id of the section it carries; "top" is the hero. Planets far off
     in the background carry none. */
  section?: string;
  at: [number, number, number];
  radius: number;
  color: string;
  deep: string;
  pattern: 'land' | 'bands' | 'craters';
  seed: number;
  /* Where its centre sits across the screen, as a share of half the
     width: negative to the left, positive to the right. */
  shift: number;
  turn: number;
  arcs?: number;
  orbits?: Orbit[];
  ring?: { inner: number; outer: number; tilt: number; roll: number };
  moon?: { radius: number; distance: number; tilt: number; speed: number };
}

const WORLDS: WorldSpec[] = [
  // Hero and About.
  {
    section: 'top', at: [0, 0, 0], radius: 6, color: '#2BE39B', deep: '#11B97A',
    pattern: 'land', seed: 0, shift: 0, turn: 0.045, arcs: 9,
    orbits: [
      { radius: 1.28, tilt: 0.42, roll: 0.3, speed: 0.2 },
      { radius: 1.52, tilt: 0.28, roll: -0.5, speed: -0.13 },
      { radius: 1.8, tilt: 0.55, roll: 0.12, speed: 0.08 },
    ],
  },
  // Certificates and Writeups.
  {
    section: 'certificates', at: [22, -34, -20], radius: 7, color: '#4fd1d9', deep: '#1b5f7a',
    pattern: 'bands', seed: 3.1, shift: 0.32, turn: 0.03,
    ring: { inner: 1.35, outer: 2.15, tilt: 0.32, roll: 0.22 },
  },
  // Profiles and Contact.
  {
    section: 'profiles', at: [-20, -72, -30], radius: 9.5, color: '#b49cff', deep: '#4b3a8f',
    pattern: 'bands', seed: 1.7, shift: 0.28, turn: 0.022,
    moon: { radius: 0.9, distance: 2.1, tilt: 0.35, speed: 0.12 },
  },
  // Far off behind the path: large, dim and few-dotted, they drift only
  // slowly while the camera flies, which is what gives the flights depth.
  { at: [-95, 15, -270], radius: 22, color: '#b49cff', deep: '#4b3a8f', pattern: 'bands', seed: 2.4, shift: 0, turn: 0.012 },
  { at: [120, -40, -320], radius: 30, color: '#4fd1d9', deep: '#1b5f7a', pattern: 'land', seed: 6.2, shift: 0, turn: 0.01 },
  { at: [-80, -85, -250], radius: 15, color: '#dfe8f0', deep: '#6b7a8a', pattern: 'craters', seed: 8.8, shift: 0, turn: 0.016 },
  { at: [70, -110, -290], radius: 20, color: '#8aa4ff', deep: '#2b3a8a', pattern: 'land', seed: 4.4, shift: 0, turn: 0.012 },
];

/* Which dots are bright: continents, the bands of a gas giant, or the
   scattered craters of a bare rock. */
function surface(pattern: WorldSpec['pattern'], seed: number, v: Vector3) {
  const n = fbm(v.x * 1.7 + 11.3 + seed, v.y * 1.7 + 4.1 + seed, v.z * 1.7 + 7.7 + seed);
  if (pattern === 'bands') return Math.sin(v.y * 10 + n * 5) > 0.25;
  if (pattern === 'craters') return fbm(v.x * 3.4 + seed, v.y * 3.4 - seed, v.z * 3.4 + 2.2) > 0.6;
  return n > 0.5;
}

/* A sphere of dots over a dark body: the shape of every planet and of
   the moon. The dots also know where they start the intro from. */
function makeSphere(radius: number, count: number, spec: WorldSpec, pixel: number, light: Vector3) {
  const color = new Color(spec.color);
  const deep = new Color(spec.deep);
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
    const onLand = surface(spec.pattern, spec.seed, v);
    positions.push(v.x * radius, v.y * radius, v.z * radius);
    // Where it starts the intro: anywhere in a wide shell around it.
    from.randomDirection().multiplyScalar(radius * (2.2 + Math.random() * 5));
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
      uColor: { value: color },
      uDeep: { value: deep },
    },
  });
  const dots = new Points(dotsGeometry, dotsMaterial);
  dots.renderOrder = 1;

  // A dark body just under the dots hides the far side and the stars
  // behind it, and carries the rim of atmosphere.
  const bodyMaterial = new ShaderMaterial({
    vertexShader: bodyVertex,
    fragmentShader: bodyFragment,
    transparent: true,
    uniforms: {
      uBase: { value: deep.clone().multiplyScalar(0.07).lerp(BODY, 0.5) },
      uColor: { value: color },
      uLight: { value: light },
      uOpacity: { value: 1 },
    },
  });
  const body = new Mesh(new SphereGeometry(radius * 0.985, 72, 48), bodyMaterial);
  body.renderOrder = 0;
  return { dots, dotsMaterial, body, bodyMaterial, landPoints, color };
}

function makeWorld(spec: WorldSpec, baseCount: number, pixel: number, light: Vector3) {
  const radius = spec.radius;
  const root = new Group();
  const globe = new Group();
  root.add(globe);
  globe.rotation.z = 0.32;
  root.position.fromArray(spec.at);

  // Dots by surface area, so a large planet is no sparser than a small
  // one; the far ones are only a few pixels across and need few.
  const count = spec.section ? Math.round(baseCount * (radius / R) ** 2) : Math.round(baseCount * 0.3);
  const sphere = makeSphere(radius, count, spec, pixel, light);
  globe.add(sphere.dots);
  root.add(sphere.body);
  const { color } = sphere;

  const span = 2.9;
  const haloMaterial = new ShaderMaterial({
    vertexShader: haloVertex,
    fragmentShader: haloFragment,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { uColor: { value: color }, uOpacity: { value: 1 }, uSpan: { value: span } },
  });
  const halo = new Mesh(new PlaneGeometry(radius * span, radius * span), haloMaterial);
  halo.renderOrder = -1;
  root.add(halo);

  // Arcs between continents, each a comet that runs its length.
  const arcs: Arc[] = [];
  const landPoints = sphere.landPoints;
  for (let n = 0; n < (spec.arcs ?? 0) && landPoints.length > 2; n++) {
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
      p.multiplyScalar(radius * (1 + Math.sin(Math.PI * t) * 0.16 * angle));
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
      uniforms: { uColor: { value: color }, uHead: { value: 0 }, uOpacity: { value: 1 } },
    });
    const line = new Line(geometry, material);
    line.renderOrder = 2;
    globe.add(line);
    arcs.push({ material, speed: 0.12 + Math.random() * 0.12, offset: Math.random() });
  }

  // Satellites, each on a tilted orbit drawn as a faint ring. They hang
  // off the root rather than the globe, so they keep their own pace.
  const orbitMaterial = new LineBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false });
  const satelliteMaterial = new ShaderMaterial({
    vertexShader: satelliteVertex,
    fragmentShader: satelliteFragment,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { uPixel: { value: pixel }, uCore: { value: new Color('#f2fff9') }, uGlow: { value: color }, uOpacity: { value: 1 } },
  });
  const spinners: { pivot: Group; speed: number }[] = [];
  for (const orbit of spec.orbits ?? []) {
    const plane = new Group();
    plane.rotation.set(orbit.tilt, 0, orbit.roll);
    root.add(plane);
    const ring: number[] = [];
    for (let i = 0; i < 160; i++) {
      const a = (i / 160) * Math.PI * 2;
      ring.push(Math.cos(a) * radius * orbit.radius, 0, Math.sin(a) * radius * orbit.radius);
    }
    const ringGeometry = new BufferGeometry();
    ringGeometry.setAttribute('position', new Float32BufferAttribute(ring, 3));
    plane.add(new LineLoop(ringGeometry, orbitMaterial));
    const pivot = new Group();
    pivot.rotation.y = Math.random() * Math.PI * 2;
    plane.add(pivot);
    const satelliteGeometry = new BufferGeometry();
    satelliteGeometry.setAttribute('position', new Float32BufferAttribute([radius * orbit.radius, 0, 0], 3));
    const satellite = new Points(satelliteGeometry, satelliteMaterial);
    satellite.renderOrder = 2;
    pivot.add(satellite);
    spinners.push({ pivot, speed: orbit.speed });
  }

  // A ring of dust, dotted like the planet: bands of it brighter, with
  // gaps between.
  const ringMaterials: ShaderMaterial[] = [];
  if (spec.ring) {
    const plane = new Group();
    plane.rotation.set(spec.ring.tilt, 0, spec.ring.roll);
    root.add(plane);
    const pts: number[] = [];
    const bright: number[] = [];
    const rand: number[] = [];
    const total = Math.round(baseCount * 0.5);
    for (let i = 0; i < total; i++) {
      const t = Math.random();
      const r = radius * (spec.ring.inner + (spec.ring.outer - spec.ring.inner) * t);
      const band = Math.sin(t * 38) * 0.5 + 0.5;
      if (band < 0.18) continue;
      const a = Math.random() * Math.PI * 2;
      pts.push(Math.cos(a) * r, (Math.random() - 0.5) * radius * 0.02, Math.sin(a) * r);
      bright.push(band > 0.7 ? 1 : 0);
      rand.push(Math.random());
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(pts, 3));
    geometry.setAttribute('aStart', new Float32BufferAttribute(pts, 3));
    geometry.setAttribute('aLand', new Float32BufferAttribute(bright, 1));
    geometry.setAttribute('aRand', new Float32BufferAttribute(rand, 1));
    const material = sphere.dotsMaterial.clone();
    material.uniforms.uLight = { value: light };
    const dust = new Points(geometry, material);
    dust.renderOrder = 1;
    plane.add(dust);
    ringMaterials.push(material);
  }

  // A small moon on its own tilted path.
  let moonPivot: Group | undefined;
  const moonMaterials: ShaderMaterial[] = [];
  if (spec.moon) {
    const plane = new Group();
    plane.rotation.set(spec.moon.tilt, 0, 0.2);
    root.add(plane);
    moonPivot = new Group();
    plane.add(moonPivot);
    const moonRadius = radius * spec.moon.radius * 0.3;
    const moonSpec: WorldSpec = { ...spec, pattern: 'craters', seed: spec.seed + 4, color: '#dfe8f0', deep: '#56606e' };
    const moon = makeSphere(moonRadius, Math.round(baseCount * 0.12), moonSpec, pixel, light);
    const holder = new Group();
    holder.position.set(radius * spec.moon.distance, 0, 0);
    holder.add(moon.dots, moon.body);
    moonPivot.add(holder);
    moonMaterials.push(moon.dotsMaterial, moon.bodyMaterial);
  }

  // The body, halo and the rest only fade in once the dots have
  // gathered; until then the body must not hide dots still flying
  // behind it.
  const setOpacity = (o: number, assemble: number, boost: number) => {
    const formed = o * smooth(clamp01((assemble - 0.7) / 0.3));
    sphere.dotsMaterial.uniforms.uOpacity.value = o;
    sphere.dotsMaterial.uniforms.uAssemble.value = assemble;
    sphere.dotsMaterial.uniforms.uBoost.value = boost;
    sphere.bodyMaterial.uniforms.uOpacity.value = Math.min(1, formed * 1.4);
    sphere.bodyMaterial.depthWrite = assemble > 0.9;
    haloMaterial.uniforms.uOpacity.value = formed;
    for (const arc of arcs) arc.material.uniforms.uOpacity.value = formed;
    orbitMaterial.opacity = formed * 0.16;
    satelliteMaterial.uniforms.uOpacity.value = formed;
    for (const m of ringMaterials) m.uniforms.uOpacity.value = formed;
    for (const m of moonMaterials) m.uniforms.uOpacity.value = Math.min(1, formed * 1.4);
    root.visible = o > 0.01;
  };
  const tick = (time: number, dt: number) => {
    sphere.dotsMaterial.uniforms.uTime.value = time;
    for (const m of ringMaterials) m.uniforms.uTime.value = time;
    for (const spinner of spinners) spinner.pivot.rotation.y += spinner.speed * dt;
    if (moonPivot && spec.moon) moonPivot.rotation.y += spec.moon.speed * dt;
    for (const arc of arcs) {
      // Each arc runs, then rests a while before the next run.
      arc.material.uniforms.uHead.value = ((time * arc.speed + arc.offset) % 1) * 2.6 - 0.2;
    }
  };
  return { spec, root, globe, setOpacity, tick };
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/* Catmull-Rom through four points, so the flight between two planets
   bends smoothly into the next one instead of turning at a corner. */
function catmull(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, t: number, out: Vector3) {
  const t2 = t * t;
  const t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return out.set(f(p0.x, p1.x, p2.x, p3.x), f(p0.y, p1.y, p2.y, p3.y), f(p0.z, p1.z, p2.z, p3.z));
}

/* ---- the whole scene ---- */

export function createSpace(canvas: HTMLCanvasElement, initialMode: SpaceMode, initialIntro: boolean, still: boolean): SpaceScene {
  const small = matchMedia('(max-width: 52rem)').matches;
  const pixel = Math.min(window.devicePixelRatio || 1, 1.5);
  const renderer = new WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(pixel);
  renderer.setClearColor(0x000000, 0);

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 0.1, 600);
  const light = new Vector3(-0.55, 0.65, 0.55).normalize();

  const layers = [
    makeStars(small ? 700 : 1500, 48, 75, 1.1, 0.04, 0.5, 0.012, pixel),
    makeStars(small ? 320 : 650, 28, 48, 1.6, 0.11, 1.2, 0.02, pixel),
    makeStars(small ? 90 : 200, 14, 28, 2.3, 0.24, 2.4, 0.035, pixel),
  ];
  for (const layer of layers) scene.add(layer.points);

  const worlds = WORLDS.map((spec) => makeWorld(spec, small ? 7000 : 18000, pixel, light));
  for (const world of worlds) scene.add(world.root);
  // The planets the camera stops at, in order down the page.
  const stops = worlds.filter((world) => world.spec.section);
  const home = stops[0];

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
  let journey = 0;
  // Set when the camera should be where the scroll says at once, with no
  // glide: on arriving at the home page.
  let snap = true;
  // How far the page has been scrolled, as a running total that ignores
  // jumps: a new page starts at its top, and the stars and the globes'
  // turn must carry on from where they were rather than leap with it.
  let lastScroll = window.scrollY;
  let travel = window.scrollY;
  // Where the camera rests for the current scroll; held still while a
  // page other than the home page is up.
  const rest = new Vector3();
  const stations = stops.map(() => new Vector3());
  // The scroll position at which the camera should be over each
  // planet: when its section's top is just under halfway up the screen,
  // so the landing is done as the section comes in.
  let anchors: number[] = stops.map((_, i) => (i === 0 ? 0 : Infinity));

  const measure = () => {
    anchors = stops.map((world, i) => {
      if (i === 0) return 0;
      const el = document.getElementById(world.spec.section ?? '');
      return el ? el.getBoundingClientRect().top + window.scrollY - height * 0.45 : Infinity;
    });
  };

  // Where the camera sits over each planet: above its horizon, which
  // shows across the bottom of the screen, nudged to one side or the
  // other. Larger planets are seen from further back, so all of them
  // show the same curve.
  const placeStations = () => {
    stops.forEach((world, i) => {
      const { at, radius, shift } = world.spec;
      const scale = radius / R;
      const back = baseZ * scale;
      const half = back * TAN;
      const show = i === 0 ? 0.42 : 0.5;
      stations[i].set(at[0] - shift * half * camera.aspect, at[1] + show * half + radius, at[2] + back);
    });
  };

  const resize = () => {
    width = window.innerWidth;
    height = window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // A tall phone screen would show only a sliver of each planet;
    // stepping the camera back keeps its curve readable.
    baseZ = camera.aspect < 1 ? Math.min(20, 10 / Math.pow(camera.aspect, 0.75)) : 10;
    camera.updateProjectionMatrix();
    placeStations();
    measure();
  };
  resize();
  // Sections change height (fonts arriving, the writeup list unfolding).
  new ResizeObserver(() => measure()).observe(document.body);

  // How far along the journey the scroll is: a whole number while a
  // section is being read, and in between while the next one comes in.
  // Each flight takes a screen of scroll, ending as the next section
  // arrives; before it, the camera rests over the planet for at least
  // half a screen more, however short its section is.
  const progress = (y: number) => {
    let u = 0;
    for (let i = 1; i < anchors.length; i++) {
      const a = anchors[i];
      if (y >= a) { u = i; continue; }
      const span = Math.max(1, Math.min(height, a - anchors[i - 1] - height * 0.55));
      if (y > a - span) u = i - 1 + easeInOut((y - (a - span)) / span);
      break;
    }
    return u;
  };

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
    snap = true;
    if (intro && !still) startIntro();
    else rise();
  };
  if (mode === 'home') arrive(initialIntro);

  const centredAt = new Vector3();
  const target = new Vector3();

  const place = (time: number, dt: number) => {
    const scrollY = window.scrollY;
    const k = Math.min(1, dt * 3);
    const moved = scrollY - lastScroll;
    if (Math.abs(moved) < height * 0.9) travel += moved;
    lastScroll = scrollY;

    const targetStars = mode === 'home' ? 1 : 0.6;
    const targetPlanet = mode === 'home' ? 1 : 0;
    starAlpha = still ? targetStars : mix(starAlpha, targetStars, k);
    planetAlpha = still ? targetPlanet : mix(planetAlpha, targetPlanet, k);

    const now = performance.now();
    if (rising) entrance = Math.min(1, (now - riseStart) / 2600);
    const up = ease(entrance);

    // The intro: how far the dots have gathered, and how much of the
    // camera's place is still out in front of the whole sphere.
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

    // The camera's resting place for this scroll: along the path through
    // the planets' stations, pulled back a little in the middle of each
    // flight so both planets are in view. Away from the home page (from
    // the moment its hero is swapped out) it holds where it was.
    if (mode === 'home' && hero?.isConnected) {
      // The camera follows the scroll with a lag, so it glides between
      // planets and settles, rather than lurching with every turn of the
      // wheel.
      const goal = progress(scrollY);
      journey = snap || still ? goal : mix(journey, goal, 1 - Math.exp(-dt * 2.2));
      snap = false;
      const i = Math.min(Math.floor(journey), stations.length - 1);
      const t = journey - i;
      const p0 = stations[Math.max(0, i - 1)];
      const p1 = stations[i];
      const p2 = stations[Math.min(stations.length - 1, i + 1)];
      const p3 = stations[Math.min(stations.length - 1, i + 2)];
      catmull(p0, p1, p2, p3, t, rest);
      rest.z += Math.sin(Math.PI * t) * 32;
      // Arriving without the intro, the camera settles from above, so the
      // planet rises into its place.
      rest.y += (1 - up) * baseZ * TAN * 0.9;
      // The intro starts out in front of the whole home planet.
      const back = home.spec.radius / (TAN * Math.min(0.5, 0.72 * camera.aspect));
      centredAt.set(home.root.position.x, home.root.position.y, home.root.position.z + back);
      rest.lerp(centredAt, centred);
    }

    // Flying in towards the planet being read when a writeup is opened;
    // once there, the camera drifts back out to where it rests.
    if (flying) {
      fly = clamp01((now - flyStart) / FLY);
      if (fly >= 1) flying = false;
    } else {
      fly = mix(fly, 0, Math.min(1, dt * 0.9));
    }
    const nearest = stops[Math.round(journey)] ?? home;
    target.copy(rest).sub(nearest.root.position).setLength(nearest.spec.radius * 1.7).add(nearest.root.position);
    camera.position.copy(rest).lerp(target, easeInOut(fly));

    // Stars: carried with the camera, each layer scrolling by a share of
    // the page, drifting upward slowly, and leaning away from the
    // pointer by its depth.
    for (const layer of layers) {
      const d = baseZ + layer.depth;
      const unitsPerPixel = (2 * d * TAN) / height;
      layer.material.uniforms.uOffset.value = travel * layer.scroll * unitsPerPixel + time * layer.drift;
      layer.material.uniforms.uTime.value = time;
      layer.material.uniforms.uTwinkle.value = still ? 0 : 1;
      layer.material.uniforms.uOpacity.value = starAlpha;
      layer.points.position.set(
        camera.position.x - leanX * layer.lean,
        camera.position.y + leanY * layer.lean * 0.6,
        camera.position.z - baseZ,
      );
    }

    // Planets: the home one carries the intro; the rest wait until it is
    // over. Each turns on its own, a little faster while scrolling, and
    // tips towards the pointer.
    worlds.forEach((world, index) => {
      const own = index === 0
        ? mix(clamp01(up * 1.5), 1, centred)
        : (1 - centred) * (world.spec.section ? 1 : 0.7);
      world.setOpacity(planetAlpha * own, index === 0 ? assemble : 1, index === 0 ? centred : 0);
      world.globe.rotation.y = time * world.spec.turn + travel * 0.0004 + leanX * 0.18 + (index === 0 ? (1 - ease(assemble)) * 2.4 : index);
      world.globe.rotation.x = 0.18 - leanY * 0.1;
      world.tick(time, dt);
    });
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
      measure();
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
