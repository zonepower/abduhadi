// ---------------------------------------------------------------------------
// Level blueprints.
//
// Layouts are authored as rectangles (rooms, corridors, wall blocks) and
// rasterised into the ASCII grid the builder consumes. Working in rectangles
// keeps rooms readable, guarantees sealed geometry, and makes it trivial to
// tune sight lines and encounter spacing.
// ---------------------------------------------------------------------------

function rasterize(blueprint) {
  const { size, rooms = [], walls = [], doors = [], markers = {} } = blueprint;
  const [W, H] = size;
  const grid = Array.from({ length: H }, () => new Array(W).fill(' '));
  const wallPref = Array.from({ length: H }, () => new Array(W).fill(null));

  const inside = (x, y) => x >= 0 && x < W && y >= 0 && y < H;

  // 1. carve every walkable rectangle
  rooms.forEach((room) => {
    for (let y = room.y; y < room.y + room.h; y += 1) {
      for (let x = room.x; x < room.x + room.w; x += 1) {
        if (!inside(x, y)) continue;
        grid[y][x] = room.floor || '.';
      }
    }
    // remember which wall style should surround this space
    for (let y = room.y - 1; y <= room.y + room.h; y += 1) {
      for (let x = room.x - 1; x <= room.x + room.w; x += 1) {
        if (inside(x, y) && !wallPref[y][x]) wallPref[y][x] = room.wall || '#';
      }
    }
  });

  // 2. explicit structural blocks (pillars, partitions)
  walls.forEach((w) => {
    for (let y = w.y; y < w.y + w.h; y += 1) {
      for (let x = w.x; x < w.x + w.w; x += 1) {
        if (!inside(x, y)) continue;
        const edge = w.outline
          ? (x === w.x || y === w.y || x === w.x + w.w - 1 || y === w.y + w.h - 1)
          : true;
        if (edge) grid[y][x] = w.char || '#';
      }
    }
  });

  // 3. seal: every empty cell touching a walkable cell becomes wall
  const snapshot = grid.map((row) => row.slice());
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (snapshot[y][x] !== ' ') continue;
      let touches = false;
      for (let dy = -1; dy <= 1 && !touches; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (!inside(nx, ny)) continue;
          const c = snapshot[ny][nx];
          if (c !== ' ' && c !== '#' && c !== 'X') { touches = true; break; }
        }
      }
      if (touches) grid[y][x] = wallPref[y][x] || '#';
    }
  }

  // 4. doors punched through walls
  doors.forEach(([x, y]) => { if (inside(x, y)) grid[y][x] = '+'; });

  // 5. gameplay markers
  Object.entries(markers).forEach(([ch, spots]) => {
    spots.forEach(([x, y]) => { if (inside(x, y)) grid[y][x] = ch; });
  });

  return grid.map((row) => row.join(''));
}

// ---------------------------------------------------------------------------
// CHAPTER 1 — الطريق المهجور
// Tutorial approach. Wide sight lines, a single readable goal (the porch), one
// optional side room that teaches "search rooms for supplies".
// ---------------------------------------------------------------------------
const CH1 = {
  id: 'road',
  index: 1,
  title: 'الفصل الأول',
  subtitle: 'الطريق المهجور',
  objective: 'اتبع الطريق إلى باب البيت',
  ambience: 'rain',
  space: 'outdoor',
  environment: { sky: true, rain: 1.0, lightning: true, skyTop: 0x0d1a2e, skyBottom: 0x04060b, moonDir: [-0.5, 0.72, 0.42] },
  wallHeight: 4.6,
  ceiling: false,
  windows: false,
  sconceColor: 0x9fc4ff,
  sconceSpacing: 7,
  sconceLimit: 12,
  defaultFloor: 'grass',
  wallMaterial: 'wallStone',
  fog: { color: 0x121a26, density: 0.016 },
  exposure: 1.05,
  ambientLight: { color: 0x6f8ec0, intensity: 1.5 },
  moon: { color: 0x9fc0ff, intensity: 2.6, position: [-40, 60, 30] },
  blueprint: rasterize({
    size: [34, 28],
    rooms: [
      { x: 13, y: 2, w: 8, h: 3, floor: '=', wall: 'X' },      // الشرفة
      { x: 16, y: 5, w: 3, h: 2, floor: '=' },                  // الدرج
      { x: 15, y: 7, w: 4, h: 19, floor: '%' },                 // الطريق
      { x: 2, y: 8, w: 11, h: 15, floor: ';' },                 // حديقة غربية
      { x: 21, y: 8, w: 11, h: 15, floor: ';' },                // حديقة شرقية
      { x: 13, y: 15, w: 2, h: 3, floor: ';' },                 // ممر غربي
      { x: 19, y: 12, w: 2, h: 3, floor: ';' },                 // ممر شرقي
      { x: 4, y: 10, w: 5, h: 4, floor: '.', wall: 'X' },       // السقيفة
    ],
    walls: [{ x: 3, y: 9, w: 7, h: 6, outline: true, char: 'X' }],
    doors: [[6, 14]],
    markers: {
      P: [[16, 24]],
      L: [[17, 24]],
      E: [[16, 2]],
      1: [[6, 11]],
      '!': [[16, 20]],
      '?': [[16, 9]],
      o: [[5, 19], [27, 12]],
      n: [[15, 21], [18, 14], [15, 10]],
      k: [[7, 12], [24, 17]],
      b: [[29, 19]],
      g: [[14, 3]],
    },
  }),
  items: {
    1: { kind: 'flashlight', name: 'كشّاف يدوي', line: 'كشّاف. الحمد لله.' },
  },
  props: [
    { type: 'corpse', marker: 'o' },
    { type: 'lantern', marker: 'n' },
    { type: 'crate', marker: 'k' },
    { type: 'barrel', marker: 'b' },
    { type: 'painting', marker: 'g' },
    { type: 'car', marker: 'P', offset: [3.4, 1.2] },
  ],
  enemies: [],
};

// ---------------------------------------------------------------------------
// CHAPTER 2 — البهو المظلم
// Hub-and-spoke. The foyer is the landmark you always return to; three fuses
// sit in three different spokes so the player learns the whole floor plan.
// ---------------------------------------------------------------------------
const CH2 = {
  id: 'foyer',
  index: 2,
  title: 'الفصل الثاني',
  subtitle: 'البهو المظلم',
  objective: 'اجمع ثلاثة مصاهر وأعد الكهرباء',
  ambience: 'house',
  space: 'house',
  environment: { dust: 0.8 },
  wallHeight: 4.2,
  defaultFloor: 'wood',
  wallMaterial: 'wallPaper',
  ceilingMaterial: 'panel',
  fog: { color: 0x0e1018, density: 0.019 },
  exposure: 1.2,
  ambientLight: { color: 0x63708c, intensity: 1.9 },
  blueprint: rasterize({
    size: [40, 30],
    rooms: [
      { x: 16, y: 20, w: 9, h: 8, floor: ',' },                 // البهو
      { x: 19, y: 28, w: 3, h: 2, floor: '=' },                 // المدخل
      { x: 8, y: 23, w: 8, h: 3, floor: '.' },                  // ممر غربي
      { x: 2, y: 18, w: 10, h: 8, floor: '.' },                 // غرفة الطعام
      { x: 5, y: 14, w: 3, h: 4, floor: '.' },                  // ممر المطبخ
      { x: 2, y: 6, w: 9, h: 8, floor: '=' },                   // المطبخ
      { x: 11, y: 10, w: 3, h: 3, floor: '=' },                 // وصلة المطبخ
      { x: 14, y: 8, w: 13, h: 6, floor: '.' },                 // الصالة العليا
      { x: 19, y: 14, w: 3, h: 6, floor: '.' },                 // الدرج الأوسط
      { x: 25, y: 22, w: 2, h: 3, floor: '.' },                 // ممر شرقي
      { x: 27, y: 17, w: 11, h: 9, floor: ',' },                // المكتبة
      { x: 27, y: 10, w: 2, h: 3, floor: '.' },                 // وصلة القبو
      { x: 29, y: 6, w: 8, h: 8, floor: '%', wall: 'X' },       // بسطة القبو
    ],
    // wall stubs beside each door so a closed door really blocks the opening
    walls: [
      { x: 15, y: 23, w: 1, h: 1 }, { x: 15, y: 25, w: 1, h: 1 },
      { x: 25, y: 22, w: 2, h: 1 }, { x: 25, y: 24, w: 2, h: 1 },
      { x: 19, y: 19, w: 1, h: 1 }, { x: 21, y: 19, w: 1, h: 1 },
      { x: 27, y: 10, w: 2, h: 1 }, { x: 27, y: 12, w: 2, h: 1 },
    ],
    doors: [[25, 23], [26, 23], [15, 24], [20, 19], [27, 11], [28, 11]],
    markers: {
      P: [[20, 28]],
      L: [[21, 26]],
      E: [[33, 12]],
      1: [[4, 8]],
      2: [[35, 20]],
      3: [[5, 20]],
      F: [[33, 7]],
      '!': [[20, 25]],
      '*': [[12, 11]],
      $: [[32, 21]],
      '&': [[33, 9]],
      Z: [[3, 20], [30, 19], [16, 10], [9, 8]],
      h: [[20, 22], [20, 10]],
      m: [[17, 21], [26, 9]],
      c: [[24, 27], [17, 27], [3, 7], [37, 18], [15, 9], [30, 13]],
      t: [[6, 21]],
      r: [[6, 19], [8, 22], [4, 22]],
      s: [[28, 18], [31, 18], [34, 18], [37, 22]],
      p: [[29, 24]],
      g: [[16, 8], [24, 8], [10, 24]],
      o: [[9, 12], [36, 25]],
      B: [[10, 13], [20, 16], [35, 24]],
      k: [[31, 8], [35, 12]],
    },
  }),
  items: {
    1: { kind: 'fuse', name: 'مصهر (١/٣)', line: 'مصهر واحد. باقي اثنان.' },
    2: { kind: 'fuse', name: 'مصهر (٢/٣)', line: 'الثاني. أوشكت.' },
    3: { kind: 'fuse', name: 'مصهر (٣/٣)', line: 'الثالث! هيا إلى اللوحة.' },
  },
  props: [
    { type: 'chandelier', marker: 'h', hang: true },
    { type: 'mirror', marker: 'm' },
    { type: 'candle', marker: 'c' },
    { type: 'table', marker: 't' },
    { type: 'chair', marker: 'r' },
    { type: 'shelf', marker: 's' },
    { type: 'piano', marker: 'p' },
    { type: 'painting', marker: 'g' },
    { type: 'corpse', marker: 'o' },
    { type: 'bloodPool', marker: 'B' },
    { type: 'crate', marker: 'k' },
    { type: 'fuseBox', marker: 'F' },
  ],
  enemies: [
    { marker: 'Z', type: 'crawler', dormantUntil: 'fuse1' },
  ],
};

// ---------------------------------------------------------------------------
// CHAPTER 3 — القبو الغارق
// A ring corridor with three dead-end valve rooms. Water slows movement, so
// the ring doubles as the chase track for the ending of the chapter.
// ---------------------------------------------------------------------------
const CH3 = {
  id: 'basement',
  index: 3,
  title: 'الفصل الثالث',
  subtitle: 'القبو الغارق',
  objective: 'أدر الصمامات الثلاثة لتصريف المياه',
  ambience: 'basement',
  space: 'basement',
  environment: { dust: 0.4 },
  wallHeight: 3.6,
  defaultFloor: 'concrete',
  wallMaterial: 'wallStone',
  trimMaterial: 'stoneTrim',
  sconceColor: 0x8fc0d8,
  windows: false,
  ceilingMaterial: 'concrete',
  fog: { color: 0x0b1114, density: 0.023 },
  exposure: 1.25,
  ambientLight: { color: 0x567e8c, intensity: 2.0 },
  blueprint: rasterize({
    size: [36, 28],
    rooms: [
      { x: 16, y: 23, w: 6, h: 4, floor: '%' },                 // بسطة الدرج
      { x: 18, y: 21, w: 3, h: 2, floor: '~' },
      { x: 5, y: 17, w: 26, h: 4, floor: '~' },                 // الممر الغارق
      { x: 6, y: 16, w: 3, h: 1, floor: '~' },
      { x: 3, y: 8, w: 10, h: 8, floor: '%' },                  // غرفة المرجل
      { x: 27, y: 15, w: 1, h: 2, floor: '~' },
      { x: 25, y: 8, w: 8, h: 7, floor: '%' },                  // المخزن
      { x: 14, y: 4, w: 10, h: 8, floor: '%' },                 // غرفة الطقوس
      { x: 13, y: 9, w: 1, h: 3, floor: '%' },
      { x: 24, y: 10, w: 1, h: 2, floor: '%' },
    ],
    walls: [
      { x: 17, y: 7, w: 1, h: 1 }, { x: 20, y: 7, w: 1, h: 1 },
      { x: 18, y: 22, w: 1, h: 1 }, { x: 20, y: 22, w: 1, h: 1 },
      { x: 6, y: 16, w: 1, h: 1 }, { x: 8, y: 16, w: 1, h: 1 },
    ],
    doors: [[19, 22], [7, 16], [27, 15]],
    markers: {
      P: [[19, 25]],
      L: [[18, 25]],
      E: [[18, 4]],
      V: [[5, 10], [30, 10], [18, 6]],
      '!': [[19, 21]],
      '?': [[10, 18]],
      '*': [[18, 8]],
      Z: [[10, 19], [24, 19], [16, 5], [28, 12], [6, 13]],
      n: [[8, 18], [20, 18], [28, 18], [4, 9], [31, 9]],
      b: [[7, 12], [11, 9], [26, 9], [31, 13]],
      k: [[5, 15], [29, 14]],
      j: [[16, 10], [22, 10], [12, 18], [24, 18]],
      q: [[21, 5]],
      o: [[9, 15], [27, 11], [15, 18]],
      B: [[18, 10], [8, 19], [26, 19]],
      A: [[15, 5]],
    },
  }),
  items: {},
  props: [
    { type: 'lantern', marker: 'n' },
    { type: 'barrel', marker: 'b' },
    { type: 'crate', marker: 'k' },
    { type: 'hook', marker: 'j', hang: true },
    { type: 'cage', marker: 'q' },
    { type: 'corpse', marker: 'o' },
    { type: 'bloodPool', marker: 'B' },
    { type: 'valve', marker: 'V' },
  ],
  enemies: [
    { marker: 'Z', type: 'crawler' },
  ],
};

// ---------------------------------------------------------------------------
// CHAPTER 4 — المذبح
// One-way funnel: corridor -> antechamber -> nave. No branches, no loot. The
// geometry exists only to frame the scene at the altar.
// ---------------------------------------------------------------------------
const CH4 = {
  id: 'chapel',
  index: 4,
  title: 'الفصل الرابع',
  subtitle: 'المذبح',
  objective: 'اعثر على ليلى',
  ambience: 'chapel',
  space: 'chapel',
  environment: { dust: 0.9 },
  wallHeight: 6.5,
  defaultFloor: 'tile',
  wallMaterial: 'wallStone',
  ceilingMaterial: 'wallStone',
  trimMaterial: 'stoneTrim',
  sconceSpacing: 6,
  windows: false,
  fog: { color: 0x120d0f, density: 0.021 },
  exposure: 1.15,
  ambientLight: { color: 0x8a6062, intensity: 1.8 },
  blueprint: rasterize({
    size: [32, 30],
    rooms: [
      { x: 14, y: 20, w: 4, h: 9, floor: '=' },                 // الممر
      { x: 10, y: 14, w: 12, h: 6, floor: '=' },                // الردهة
      { x: 6, y: 3, w: 20, h: 10, floor: '=' },                 // الصحن
    ],
    walls: [
      { x: 6, y: 13, w: 20, h: 1 },
      { x: 9, y: 6, w: 1, h: 1 }, { x: 9, y: 10, w: 1, h: 1 },
      { x: 22, y: 6, w: 1, h: 1 }, { x: 22, y: 10, w: 1, h: 1 },
    ],
    doors: [[15, 13], [16, 13]],
    markers: {
      P: [[16, 28]],
      L: [[17, 6]],
      Y: [[16, 4]],
      E: [[25, 3]],
      '!': [[16, 17]],
      '?': [[16, 12]],
      A: [[16, 5]],
      c: [[8, 4], [24, 4], [8, 12], [24, 12], [12, 15], [20, 15], [15, 22], [17, 26]],
      j: [[11, 5], [21, 5], [11, 11], [21, 11]],
      q: [[7, 8], [25, 8]],
      o: [[13, 12], [19, 12], [11, 17]],
      B: [[16, 7], [16, 9], [14, 16]],
      g: [[16, 3]],
    },
  }),
  items: {},
  props: [
    { type: 'altar', marker: 'A' },
    { type: 'candle', marker: 'c' },
    { type: 'hook', marker: 'j', hang: true },
    { type: 'cage', marker: 'q' },
    { type: 'corpse', marker: 'o' },
    { type: 'bloodPool', marker: 'B' },
    { type: 'painting', marker: 'g' },
  ],
  enemies: [],
};

// ---------------------------------------------------------------------------
// CHAPTER 5 — الانتقام
// Symmetric arena. Four corner pillars give cover from the boss's ranged
// phase; the centre block forces you to break line of sight while reloading.
// ---------------------------------------------------------------------------
const CH5 = {
  id: 'revenge',
  index: 5,
  title: 'الفصل الخامس',
  subtitle: 'الانتقام',
  objective: 'اقتل الراعي',
  ambience: 'fire',
  space: 'arena',
  environment: { embers: 1.0, dust: 0.5 },
  wallHeight: 7.0,
  defaultFloor: 'tile',
  wallMaterial: 'wallStone',
  ceilingMaterial: 'wallStone',
  trimMaterial: 'stoneTrim',
  sconceColor: 0xff7a3a,
  windows: false,
  fog: { color: 0x241008, density: 0.024 },
  exposure: 1.3,
  ambientLight: { color: 0xa85c30, intensity: 2.2 },
  blueprint: rasterize({
    size: [30, 30],
    rooms: [
      { x: 4, y: 4, w: 22, h: 22, floor: '=' },
    ],
    walls: [
      { x: 8, y: 8, w: 2, h: 2 }, { x: 20, y: 8, w: 2, h: 2 },
      { x: 8, y: 20, w: 2, h: 2 }, { x: 20, y: 20, w: 2, h: 2 },
      { x: 14, y: 14, w: 2, h: 2 },
    ],
    doors: [],
    markers: {
      P: [[15, 24]],
      Y: [[15, 7]],
      '!': [[15, 21]],
      c: [[6, 6], [23, 6], [6, 23], [23, 23], [15, 5], [15, 25], [5, 15], [24, 15]],
      j: [[11, 11], [18, 11], [11, 18], [18, 18]],
      q: [[7, 12], [22, 12]],
      o: [[12, 8], [19, 22], [9, 17]],
      B: [[15, 12], [15, 18], [11, 15], [19, 15]],
      A: [[15, 9]],
    },
  }),
  items: {},
  props: [
    { type: 'altar', marker: 'A' },
    { type: 'candle', marker: 'c' },
    { type: 'hook', marker: 'j', hang: true },
    { type: 'cage', marker: 'q' },
    { type: 'corpse', marker: 'o' },
    { type: 'bloodPool', marker: 'B' },
  ],
  enemies: [],
};

export const LEVELS = [CH1, CH2, CH3, CH4, CH5];

export function levelByIndex(index) {
  return LEVELS[Math.max(0, Math.min(LEVELS.length - 1, index))];
}
