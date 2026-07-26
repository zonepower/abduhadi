// ---------------------------------------------------------------------------
// GLSL for the "ray traced look" pipeline.
//
// The browser has no DXR / hardware ray tracing, so every effect here is a
// screen-space ray march against the depth + normal G-buffer:
//   * reflections      -> per pixel ray march, binary refined hit
//   * ambient occlusion-> hemisphere ray march (short rays)
//   * volumetric light -> ray march camera->fragment with depth-buffer shadows
//   * denoise          -> temporal reprojection-free accumulation
// ---------------------------------------------------------------------------

export const FULLSCREEN_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// --- G-buffer ---------------------------------------------------------------
// rgb = view space normal (encoded), a = reflectivity mask used by the SSR pass.

export const GBUFFER_VERT = /* glsl */`
varying vec3 vViewNormal;
void main() {
  vViewNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const GBUFFER_FRAG = /* glsl */`
uniform float uReflectivity;
varying vec3 vViewNormal;
void main() {
  gl_FragColor = vec4(normalize(vViewNormal) * 0.5 + 0.5, uReflectivity);
}
`;

// --- main composite ---------------------------------------------------------

export const COMPOSITE_FRAG = /* glsl */`
precision highp float;

varying vec2 vUv;

uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tNormal;
uniform sampler2D tNoise;
uniform sampler2D tDust;

uniform mat4 uProj;
uniform mat4 uInvProj;
uniform vec2 uResolution;
uniform float uNear;
uniform float uFar;
uniform float uTime;

uniform float uSSRIntensity;
uniform float uSSRMaxDistance;
uniform float uSSRThickness;

uniform float uAOIntensity;
uniform float uAORadius;

uniform float uFogDensity;
uniform vec3  uFogColor;
uniform float uVolumetricStrength;

// player flashlight, expressed in view space
uniform vec3  uFlashPos;
uniform vec3  uFlashDir;
uniform float uFlashCosInner;
uniform float uFlashCosOuter;
uniform float uFlashRange;
uniform vec3  uFlashColor;
uniform float uFlashIntensity;

uniform vec4 uLightPos[MAX_VOL_LIGHTS];   // xyz view space, w = range
uniform vec4 uLightColor[MAX_VOL_LIGHTS]; // rgb colour, a = intensity
uniform int  uLightCount;

float viewZFromDepth(float depth) {
  float z = depth * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear)) * -1.0;
}

vec3 viewPosFromUV(vec2 uv, float depth) {
  vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 view = uInvProj * clip;
  return view.xyz / view.w;
}

vec2 viewToUV(vec3 viewPos) {
  vec4 clip = uProj * vec4(viewPos, 1.0);
  return (clip.xy / clip.w) * 0.5 + 0.5;
}

float sceneViewZ(vec2 uv) {
  return viewZFromDepth(texture2D(tDepth, uv).x);
}

float rand(vec2 co) {
  return texture2D(tNoise, co * uResolution / 128.0).r;
}

// --- screen space reflections ----------------------------------------------
vec3 traceReflection(vec3 viewPos, vec3 normal, float jitter, out float confidence) {
  confidence = 0.0;
  vec3 dir = normalize(reflect(normalize(viewPos), normal));

  // rays coming back at the camera have no on-screen information
  float facing = smoothstep(0.0, 0.35, -dir.z + 0.35);
  if (facing <= 0.001) return vec3(0.0);

  float stepSize = uSSRMaxDistance / float(SSR_STEPS);
  vec3 p = viewPos + normal * 0.06 + dir * stepSize * (0.4 + jitter * 0.6);
  vec3 stepVec = dir * stepSize;

  vec2 hitUV = vec2(-1.0);
  float travelled = 0.0;

  for (int i = 0; i < SSR_STEPS; i++) {
    p += stepVec;
    travelled += length(stepVec);
    stepVec *= 1.045; // stretch far samples so short range stays crisp

    vec2 uv = viewToUV(p);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;

    float sz = sceneViewZ(uv);
    if (sz < -uFar * 0.98) continue;

    float delta = sz - p.z;
    if (delta > 0.0 && delta < uSSRThickness + travelled * 0.05) {
      // binary refine so the hit lands on the surface, not past it
      vec3 lo = p - stepVec;
      vec3 hi = p;
      for (int r = 0; r < 5; r++) {
        vec3 mid = (lo + hi) * 0.5;
        vec2 muv = viewToUV(mid);
        float mz = sceneViewZ(muv);
        if (mz - mid.z > 0.0) hi = mid; else lo = mid;
      }
      hitUV = viewToUV((lo + hi) * 0.5);
      break;
    }
  }

  if (hitUV.x < 0.0) return vec3(0.0);

  vec2 edge = smoothstep(vec2(0.0), vec2(0.14), hitUV) *
              smoothstep(vec2(0.0), vec2(0.14), 1.0 - hitUV);
  confidence = edge.x * edge.y * facing * (1.0 - travelled / uSSRMaxDistance);
  confidence = clamp(confidence, 0.0, 1.0);
  return texture2D(tColor, hitUV).rgb;
}

// --- ambient occlusion ------------------------------------------------------
float traceOcclusion(vec3 viewPos, vec3 normal, float jitter) {
  float occlusion = 0.0;
  float ang = jitter * 6.2831853;
  for (int i = 0; i < AO_SAMPLES; i++) {
    float fi = (float(i) + 0.5) / float(AO_SAMPLES);
    float theta = ang + fi * 7.7;
    float radius = uAORadius * sqrt(fi);
    vec3 tangent = normalize(abs(normal.z) < 0.9 ? cross(normal, vec3(0.0, 0.0, 1.0))
                                                 : cross(normal, vec3(1.0, 0.0, 0.0)));
    vec3 bitangent = cross(normal, tangent);
    vec3 offset = (tangent * cos(theta) + bitangent * sin(theta)) * radius
                + normal * radius * (0.35 + jitter * 0.4);
    vec3 samplePos = viewPos + offset;
    vec2 uv = viewToUV(samplePos);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) continue;
    float sz = sceneViewZ(uv);
    float diff = sz - samplePos.z;
    // bias keeps flat surfaces from occluding themselves
    if (diff > 0.06) {
      occlusion += smoothstep(0.0, 1.0, uAORadius / max(0.05, abs(diff)));
    }
  }
  return clamp(1.0 - (occlusion / float(AO_SAMPLES)) * uAOIntensity, 0.0, 1.0);
}

// --- volumetric lighting ----------------------------------------------------
float spotFalloff(vec3 p) {
  vec3 toFrag = p - uFlashPos;
  float dist = length(toFrag);
  if (dist > uFlashRange) return 0.0;
  vec3 l = toFrag / max(dist, 0.0001);
  float cosA = dot(l, uFlashDir);
  float cone = smoothstep(uFlashCosOuter, uFlashCosInner, cosA);
  float atten = 1.0 - clamp(dist / uFlashRange, 0.0, 1.0);
  return cone * atten * atten;
}

vec3 traceVolumetrics(vec3 viewPos, float jitter) {
  vec3 accum = vec3(0.0);
  float maxDist = min(length(viewPos), 34.0);
  float stepLen = maxDist / float(VOL_STEPS);
  vec3 dir = normalize(viewPos);
  float t = stepLen * jitter;

  for (int i = 0; i < VOL_STEPS; i++) {
    t += stepLen;
    if (t > maxDist) break;
    vec3 p = dir * t;

    // depth-buffer shadow: skip samples hidden behind on-screen geometry
    vec2 uv = viewToUV(p);
    if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
      if (p.z < sceneViewZ(uv) - 0.05) continue;
    }

    float dust = texture2D(tDust, p.xz * 0.06 + vec2(uTime * 0.008, uTime * 0.013)).r;
    dust = 0.45 + dust * 0.9;

    accum += uFlashColor * uFlashIntensity * spotFalloff(p) * dust;

    for (int l = 0; l < MAX_VOL_LIGHTS; l++) {
      if (l >= uLightCount) break;
      vec3 d = uLightPos[l].xyz - p;
      float dist = length(d);
      float range = uLightPos[l].w;
      if (dist < range) {
        float atten = 1.0 - dist / range;
        accum += uLightColor[l].rgb * uLightColor[l].a * atten * atten * dust;
      }
    }
  }
  return accum * stepLen * uVolumetricStrength;
}

void main() {
  float depth = texture2D(tDepth, vUv).x;
  vec3 color = texture2D(tColor, vUv).rgb;
  vec4 gbuf = texture2D(tNormal, vUv);
  vec3 normal = normalize(gbuf.rgb * 2.0 - 1.0);
  float reflectivity = gbuf.a;
  float jitter = rand(vUv + fract(uTime * 0.37));

  vec3 viewPos = viewPosFromUV(vUv, depth);
  bool isSky = depth >= 0.9999;

  if (!isSky) {
    if (reflectivity > 0.02 && uSSRIntensity > 0.0) {
      float confidence;
      vec3 reflected = traceReflection(viewPos, normal, jitter, confidence);
      // Schlick fresnel keeps grazing angles bright, head-on subtle
      float fresnel = pow(1.0 - clamp(dot(normal, -normalize(viewPos)), 0.0, 1.0), 4.0);
      float weight = reflectivity * confidence * uSSRIntensity * (0.18 + fresnel * 0.9);
      color = mix(color, color + reflected * 1.15, clamp(weight, 0.0, 0.92));
    }

    if (uAOIntensity > 0.0) {
      color *= traceOcclusion(viewPos, normal, jitter);
    }

    float dist = length(viewPos);
    float fog = 1.0 - exp(-dist * dist * uFogDensity * uFogDensity);
    color = mix(color, uFogColor, clamp(fog, 0.0, 0.92));
  } else {
    color = mix(color, uFogColor, 0.65);
  }

  if (uVolumetricStrength > 0.0) {
    color += traceVolumetrics(isSky ? normalize(viewPosFromUV(vUv, 0.999)) * 34.0 : viewPos, jitter);
  }

  gl_FragColor = vec4(color, 1.0);
}
`;

// --- temporal accumulation --------------------------------------------------

export const TEMPORAL_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tCurrent;
uniform sampler2D tHistory;
uniform float uBlend;

void main() {
  vec3 cur = texture2D(tCurrent, vUv).rgb;
  vec3 hist = texture2D(tHistory, vUv).rgb;
  // neighbourhood clamp keeps ghosting off moving objects
  vec2 texel = vec2(dFdx(vUv.x), dFdy(vUv.y));
  vec3 lo = cur;
  vec3 hi = cur;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec3 s = texture2D(tCurrent, vUv + vec2(float(x), float(y)) * texel).rgb;
      lo = min(lo, s);
      hi = max(hi, s);
    }
  }
  hist = clamp(hist, lo - 0.06, hi + 0.06);
  gl_FragColor = vec4(mix(cur, hist, uBlend), 1.0);
}
`;

// --- bloom ------------------------------------------------------------------

export const BRIGHT_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform float uThreshold;
void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float w = smoothstep(uThreshold, uThreshold + 0.7, luma);
  gl_FragColor = vec4(c * w, 1.0);
}
`;

export const BLUR_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec2 uDirection;
void main() {
  vec3 sum = texture2D(tDiffuse, vUv).rgb * 0.227027;
  sum += texture2D(tDiffuse, vUv + uDirection * 1.3846).rgb * 0.316216;
  sum += texture2D(tDiffuse, vUv - uDirection * 1.3846).rgb * 0.316216;
  sum += texture2D(tDiffuse, vUv + uDirection * 3.2308).rgb * 0.070270;
  sum += texture2D(tDiffuse, vUv - uDirection * 3.2308).rgb * 0.070270;
  gl_FragColor = vec4(sum, 1.0);
}
`;

// --- final grade ------------------------------------------------------------

export const FINAL_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;

uniform sampler2D tDiffuse;
uniform sampler2D tBloomA;
uniform sampler2D tBloomB;
uniform sampler2D tBloomC;
uniform sampler2D tNoise;

uniform float uTime;
uniform float uBloomStrength;
uniform float uExposure;
uniform float uVignette;
uniform float uGrain;
uniform float uAberration;
uniform float uSanity;     // 1 = calm, 0 = losing it
uniform float uDamage;     // red pulse on hit
uniform float uFade;       // 0 = black, 1 = fully visible
uniform float uHeartbeat;

vec3 aces(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  vec2 uv = vUv;
  vec2 centered = uv - 0.5;
  float dist = length(centered);

  float panic = 1.0 - uSanity;
  // low sanity warps the frame and pushes the heartbeat into the lens
  float pulse = sin(uTime * 6.0) * 0.5 + 0.5;
  uv += centered * panic * 0.02 * sin(uTime * 2.3 + dist * 18.0);
  uv += centered * uHeartbeat * 0.012 * pulse;

  float ab = uAberration * (1.0 + panic * 5.0 + uDamage * 3.0) * (0.35 + dist);
  vec3 color;
  color.r = texture2D(tDiffuse, uv + centered * ab * 0.004).r;
  color.g = texture2D(tDiffuse, uv).g;
  color.b = texture2D(tDiffuse, uv - centered * ab * 0.004).b;

  vec3 bloom = texture2D(tBloomA, uv).rgb * 0.5
             + texture2D(tBloomB, uv).rgb * 0.32
             + texture2D(tBloomC, uv).rgb * 0.2;
  color += bloom * uBloomStrength;

  color *= uExposure;
  color = aces(color);

  // filmic grade: crushed cold shadows, sickly warm highlights
  color = pow(color, vec3(1.0, 0.985, 0.96));
  color = mix(vec3(dot(color, vec3(0.299, 0.587, 0.114))), color, 0.86 - panic * 0.25);
  color.b += 0.035 * (1.0 - color.r);
  color.r += uDamage * 0.35 * (0.4 + dist);

  float vig = smoothstep(0.95, 0.28, dist);
  color *= mix(1.0, vig, uVignette + panic * 0.25);

  float grain = texture2D(tNoise, uv * 4.0 + vec2(fract(uTime * 3.1), fract(uTime * 2.7))).r;
  color += (grain - 0.5) * uGrain * (1.0 + panic);

  color *= uFade;
  color = pow(max(color, 0.0), vec3(1.0 / 2.2));
  gl_FragColor = vec4(color, 1.0);
}
`;
