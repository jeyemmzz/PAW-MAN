// ===================== PAW-MAN: BERRY CHASE (maze edition) =====================
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// ---------- MAZE ----------
// '#' wall   '.' mini dot   'o' cherry   ' ' empty
const MAZE = [
    "###################",
    "#P.......#........#",
    "#.##.###.#.###.##.#",
    "#o...............o#",
    "#.##.#.##.##.#.##.#",
    "#....#.......#....#",
    "####.#.##.##.#.####",
    " ........P........ ",
    "####.#.##.##.#.####",
    "#....#.......#....#",
    "#.##.#.##.##.#.##.#",
    "#o...............o#",
    "#.##.###.#.###.##.#",
    "#........#.......P#",
    "###################"
];
const ROWS = MAZE.length;
const COLS = MAZE[0].length;
const DOG_START = { c: 1, r: 13 };
const HUNTER_START = { c: 17, r: 1 };
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

let T = 32, OX = 0, OY = 70; // tile size + maze offset (set by computeLayout)

function computeLayout() {
    const isTouch = window.matchMedia("(pointer: coarse)").matches;
    const portrait = canvas.height > canvas.width;
    const topPad = canvas.width < 600 ? 64 : 76;
    const botPad = 12; // joystick floats over the empty side space in landscape
    const availH = canvas.height - topPad - botPad;
    T = Math.max(12, Math.floor(Math.min(canvas.width / COLS, availH / ROWS)));
    OX = Math.floor((canvas.width - COLS * T) / 2);
    OY = topPad + Math.floor((availH - ROWS * T) / 2);
}

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    computeLayout();
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// Columns wrap around: the open left edge of the tunnel row leads to the right edge.
function wrapCol(c) { return (c % COLS + COLS) % COLS; }

function isWall(c, r) {
    if (r < 0 || r >= ROWS) return true;
    return MAZE[r][wrapCol(c)] === "#";
}

// ---------- UI ----------
const hud = document.getElementById("hud");
const hudLives = document.getElementById("hud-lives");
const hudScore = document.getElementById("hud-score");
const hudBerries = document.getElementById("hud-berries");
const welcomeScreen = document.getElementById("welcome-screen");
const charactersScreen = document.getElementById("characters-screen");
const tutorialsScreen = document.getElementById("tutorials-screen");
const endScreen = document.getElementById("end-screen");
const endTitle = document.getElementById("end-title");
const endStats = document.getElementById("end-stats");
const joystick = document.getElementById("joystick");
const rotateScreen = document.getElementById("rotate-screen");
const IS_TOUCH = window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;

// ---------- STATE ----------
let gameState = "MENU";
let score = 0;
let itemsCollected = 0;
let totalItems = 0;
let lives = 3;
let selectedDog = "molly";
const DOG_SIZE = 2.0;     // dog size in maze tiles (raise to make the dog bigger)
const DOG_SPEED = 0.065;  // dog speed (0.085 was too fast, 0.05 too slow)
const POWER_MS = 8000;    // how long the big dot lets the dog hit Pac-Man
const REVIVE_MS = 10000;  // how long Pac-Man stays knocked out
let powerUntil = 0;       // timestamp (ms) when the power-up ends
let downUntil = 0;        // timestamp (ms) when Pac-Man revives
let freeze = 0;      // frames where everything pauses ("READY!")
let frameCount = 0;
let items = [];       // items[r][c] = 'dot' | 'cherry' | null

// ---------- DOG IMAGES (assets/dog.png and assets/buddy.jpg) ----------
// Each file is a SPRITE SHEET: 2 columns (walk frames) x 7 rows.
// Rows 0=Down, 1=Right, 2=Up, 3=Left. White background is made transparent.
const SHEET_COLS = 2, SHEET_ROWS = 7;

// Molly's sheet (dog.png) is sliced AUTOMATICALLY: the game finds every separate
// sprite on the sheet, so any grid size works. Which sheet row is used for each
// direction [Down, Right, Up, Left] - change these numbers if she faces the wrong way.
const MOLLY_DIR_ROWS = [0, 1, 2, 3];
// Same idea for the other auto-sliced dogs (Archer.jpg, Yoda.jpg)
const DOG_DIR_ROWS = {
    molly: MOLLY_DIR_ROWS,
    archer: [0, 1, 2, 3],
    yoda: [0, 1, 2, 3]
};

// Finds each sprite frame on a transparent-background sheet.
// Returns rows (top to bottom) of frames (left to right): [{x, y, w, h}, ...]
function detectFrames(d, W, H) {
    const solid = (x, y) => d[(y * W + x) * 4 + 3] > 40;
    const minSize = 6;

    // 1) horizontal bands = rows of sprites
    const bands = [];
    let start = -1;
    for (let y = 0; y <= H; y++) {
        let n = 0;
        if (y < H) for (let x = 0; x < W; x++) if (solid(x, y)) n++;
        if (n >= 2 && start < 0) start = y;
        else if (n < 2 && start >= 0) {
            if (y - start >= minSize) bands.push([start, y - 1]);
            start = -1;
        }
    }

    // 2) inside each band, vertical groups = individual frames
    const rows = [];
    for (const [y0, y1] of bands) {
        const groups = [];
        let gs = -1, gap = 0;
        for (let x = 0; x <= W; x++) {
            let has = false;
            if (x < W) for (let y = y0; y <= y1; y++) if (solid(x, y)) { has = true; break; }
            if (has) { if (gs < 0) gs = x; gap = 0; }
            else if (gs >= 0) {
                gap++;
                if (gap > 2 || x === W) { groups.push([gs, x - gap]); gs = -1; gap = 0; }
            }
        }
        const frames = [];
        for (const [x0, x1] of groups) {
            if (x1 - x0 + 1 < minSize) continue;
            let top = y1, bottom = y0;
            for (let y = y0; y <= y1; y++)
                for (let x = x0; x <= x1; x++)
                    if (solid(x, y)) { if (y < top) top = y; if (y > bottom) bottom = y; }
            frames.push({ x: x0, y: top, w: x1 - x0 + 1, h: bottom - top + 1 });
        }
        if (frames.length) rows.push(frames);
    }
    return rows;
}

function loadImg(src, auto = false) {
    const o = { img: new Image(), ok: false, clean: null, frames: null, maxW: 1, maxH: 1 };
    o.img.onload = () => {
        o.ok = true;
        try {
            const t = document.createElement("canvas");
            t.width = o.img.naturalWidth;
            t.height = o.img.naturalHeight;
            const tc = t.getContext("2d");
            tc.drawImage(o.img, 0, 0);
            const id = tc.getImageData(0, 0, t.width, t.height);
            const d = id.data;
            const W = t.width, H = t.height;
            // Buddy: fixed grid. Molly (auto): the whole sheet is one area.
            const gc = auto ? 1 : SHEET_COLS, gr = auto ? 1 : SHEET_ROWS;
            const fw = Math.floor(W / gc), fh = Math.floor(H / gr);
            const isBg = (idx) => d[idx * 4 + 3] < 10 ||
                (d[idx * 4] > 225 && d[idx * 4 + 1] > 225 && d[idx * 4 + 2] > 225);
            const removed = new Uint8Array(W * H);

            // Flood-fill the background from the edge of each frame, so only the
            // OUTSIDE white is removed. White fur inside the dog's outline stays.
            for (let cy = 0; cy < gr; cy++) {
                for (let cx = 0; cx < gc; cx++) {
                    const x0 = cx * fw, y0 = cy * fh, x1 = x0 + fw - 1, y1 = y0 + fh - 1;
                    const stack = [];
                    const push = (x, y) => {
                        const idx = y * W + x;
                        if (!removed[idx] && isBg(idx)) { removed[idx] = 1; stack.push(idx); }
                    };
                    for (let x = x0; x <= x1; x++) { push(x, y0); push(x, y1); }
                    for (let y = y0; y <= y1; y++) { push(x0, y); push(x1, y); }
                    while (stack.length) {
                        const idx = stack.pop();
                        const x = idx % W, y = (idx - x) / W;
                        if (x > x0) push(x - 1, y);
                        if (x < x1) push(x + 1, y);
                        if (y > y0) push(x, y - 1);
                        if (y < y1) push(x, y + 1);
                    }
                }
            }

            // Clean the light JPG fringe left right next to the removed background
            const halo = [];
            for (let y = 1; y < H - 1; y++) {
                for (let x = 1; x < W - 1; x++) {
                    const idx = y * W + x;
                    if (removed[idx]) continue;
                    if (d[idx * 4] > 200 && d[idx * 4 + 1] > 200 && d[idx * 4 + 2] > 200 &&
                        (removed[idx - 1] || removed[idx + 1] || removed[idx - W] || removed[idx + W])) {
                        halo.push(idx);
                    }
                }
            }
            halo.forEach((idx) => { removed[idx] = 1; });

            for (let idx = 0; idx < removed.length; idx++) {
                if (removed[idx]) d[idx * 4 + 3] = 0;
            }
            tc.putImageData(id, 0, 0);
            o.clean = t;

            if (auto) {
                const rows = detectFrames(d, W, H);
                if (rows.length) {
                    o.frames = rows;
                    // one common scale for ALL frames so Molly never changes size
                    rows.forEach((r) => r.forEach((f) => {
                        o.maxW = Math.max(o.maxW, f.w);
                        o.maxH = Math.max(o.maxH, f.h);
                    }));
                }
            } else {
                // Buddy: measure how big the dog itself is inside his frames, so Molly
                // can be scaled to the exact same on-screen size.
                let best = 1;
                for (let cy = 0; cy < gr; cy++) {
                    for (let cx = 0; cx < gc; cx++) {
                        let minX = W, maxX = -1, minY = H, maxY = -1;
                        for (let y = cy * fh; y < (cy + 1) * fh; y++) {
                            for (let x = cx * fw; x < (cx + 1) * fw; x++) {
                                if (d[(y * W + x) * 4 + 3] > 40) {
                                    if (x < minX) minX = x; if (x > maxX) maxX = x;
                                    if (y < minY) minY = y; if (y > maxY) maxY = y;
                                }
                            }
                        }
                        if (maxX >= 0) best = Math.max(best, maxX - minX + 1, maxY - minY + 1);
                    }
                }
                o.contentMax = best;
            }
        } catch (e) {
            o.clean = null; // e.g. opened from file:// - use the raw image instead
        }
    };
    o.img.onerror = () => { o.ok = false; };
    o.img.src = src;
    return o;
}
const dogImages = {
    molly: loadImg("assets/dog.png", true),
    buddy: loadImg("assets/buddy.jpg"),
    archer: loadImg("assets/Archer.jpg", true),
    yoda: loadImg("assets/Yoda.jpg", true)
};

// Pixel-style fallback so a dog is ALWAYS visible even if the image is missing
function drawDogFallback(c, kind, x, y, size) {
    const r = size / 2;
    const looks = {
        molly:  { fur: "#b5651d", patch: "#f5f0e6", ears: "#7a3f10" },
        buddy:  { fur: "#f5f5fa", patch: "#d9dde6", ears: "#cfd3de" },
        archer: { fur: "#d9a066", patch: "#f2dfc4", ears: "#9a6a36" },
        yoda:   { fur: "#8d99a6", patch: "#cfd6dd", ears: "#5f6a75" }
    };
    const look = looks[kind] || looks.buddy;
    const fur = look.fur;
    const patch = look.patch;
    c.save();
    c.translate(x, y);
    c.fillStyle = look.ears; // ears
    c.beginPath(); c.ellipse(-r * 0.8, -r * 0.1, r * 0.3, r * 0.6, 0.3, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(r * 0.8, -r * 0.1, r * 0.3, r * 0.6, -0.3, 0, Math.PI * 2); c.fill();
    c.fillStyle = fur;
    c.beginPath(); c.arc(0, 0, r * 0.88, 0, Math.PI * 2); c.fill();
    c.fillStyle = patch;
    c.beginPath(); c.ellipse(0, r * 0.3, r * 0.5, r * 0.4, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#111";
    c.beginPath(); c.arc(-r * 0.32, -r * 0.18, r * 0.12, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(r * 0.32, -r * 0.18, r * 0.12, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(0, r * 0.12, r * 0.16, r * 0.11, 0, 0, Math.PI * 2); c.fill();
    c.restore();
}

// Draw a dog token: the image cropped into a circle (works for png AND jpg)
// On-screen size (px) of Buddy's actual dog at a given token size
function buddyContentPx(size) {
    const b = dogImages.buddy;
    if (!(b.ok && b.contentMax && b.img.naturalWidth > 0)) return null;
    const src = b.clean || b.img;
    const sw = Math.floor(src.width / SHEET_COLS) - 2;
    const sh = Math.floor(src.height / SHEET_ROWS) - 2;
    return b.contentMax * size / Math.max(sw, sh);
}

// row = direction (0 Down, 1 Right, 2 Up, 3 Left)
// walkPos = distance walked (drives the walk cycle); negative = standing still
function drawDogSprite(c, kind, x, y, size, row = 0, walkPos = -1) {
    const o = dogImages[kind];
    if (!(o.ok && o.img.naturalWidth > 0)) {
        drawDogFallback(c, kind, x, y, size);
        return;
    }
    const src = o.clean || o.img;

    if (o.frames) {
        // ----- Molly: auto-detected frames -----
        const rowMap = DOG_DIR_ROWS[kind] || MOLLY_DIR_ROWS;
        const fr = o.frames[Math.min(rowMap[row] ?? row, o.frames.length - 1)];
        const n = fr.length;
        let idx = 0;
        if (n === 3) {
            // 3-frame walk: left, stand, right, stand  (standing = middle frame)
            idx = walkPos < 0 ? 1 : [0, 1, 2, 1][Math.floor(walkPos / 0.35) % 4];
        } else if (n > 1 && walkPos >= 0) {
            idx = Math.floor(walkPos / (1.4 / n)) % n;
        }
        const f = fr[idx];
        // same scale for every frame; feet stay on the same line = no bobbing/size change
        // Scale so Molly's dog is exactly as big on screen as Buddy's dog
        const target = buddyContentPx(size) || size;
        const scale = target / Math.max(o.maxW, o.maxH);
        const dw = f.w * scale, dh = f.h * scale;
        const baseY = y + (o.maxH * scale) / 2;
        c.drawImage(src, f.x, f.y, f.w, f.h, x - dw / 2, baseY - dh, dw, dh);
        return;
    }

    // ----- Buddy: fixed 2 x 7 grid -----
    const col = walkPos < 0 ? 0 : Math.floor(walkPos / 0.7) % SHEET_COLS;
    // Whole-pixel frame size and a 1px inset so no edge of the next frame bleeds in.
    const fw = Math.floor(src.width / SHEET_COLS);
    const fh = Math.floor(src.height / SHEET_ROWS);
    const inset = 1;
    const sw = fw - inset * 2, sh = fh - inset * 2;
    const scale = size / Math.max(sw, sh);
    const dw = sw * scale, dh = sh * scale;
    c.drawImage(src, col * fw + inset, row * fh + inset, sw, sh,
        x - dw / 2, y - dh / 2, dw, dh);
}

// ---------- ENTITIES (tile based so nobody can pass through walls) ----------
function makeEntity(c, r) {
    return { c, r, p: 0, dir: { x: 0, y: 0 }, next: { x: 0, y: 0 }, face: 0 };
}
let dog = makeEntity(DOG_START.c, DOG_START.r);
let hunter = makeEntity(HUNTER_START.c, HUNTER_START.r); // ONE Pac-Man only

function entityPos(e) {
    return {
        x: OX + (e.c + 0.5 + e.dir.x * e.p) * T,
        y: OY + (e.r + 0.5 + e.dir.y * e.p) * T
    };
}

// Moves an entity along the maze. It can only turn at tile centers and
// can never enter a wall tile.
function stepEntity(e, speed, chooser) {
    // instant U-turn mid-corridor
    if ((e.dir.x || e.dir.y) && (e.next.x || e.next.y) &&
        e.next.x === -e.dir.x && e.next.y === -e.dir.y) {
        e.c = wrapCol(e.c + e.dir.x); e.r += e.dir.y;
        e.p = 1 - e.p;
        e.dir = { x: -e.dir.x, y: -e.dir.y };
    }

    // Turn forgiveness for the player: if you press left/right/up/down just AFTER
    // passing an opening, still take the turn instead of missing it.
    if (!chooser && (e.dir.x || e.dir.y) && (e.next.x || e.next.y) &&
        e.next.x * e.dir.x + e.next.y * e.dir.y === 0 &&
        e.p > 0 && e.p < 0.3 && !isWall(e.c + e.next.x, e.r + e.next.y)) {
        e.p = 0;
        e.dir = { x: e.next.x, y: e.next.y };
    }

    let remaining = speed;
    let guard = 0;
    while (remaining > 0 && guard++ < 4) {
        if (!e.dir.x && !e.dir.y) {
            if (chooser) chooser(e);
            if ((e.next.x || e.next.y) && !isWall(e.c + e.next.x, e.r + e.next.y)) {
                e.dir = { x: e.next.x, y: e.next.y };
            } else break;
        }
        const need = 1 - e.p;
        if (remaining < need) {
            e.p += remaining;
            remaining = 0;
        } else {
            remaining -= need;
            e.c = wrapCol(e.c + e.dir.x); e.r += e.dir.y; e.p = 0;
            if (chooser) chooser(e);
            if ((e.next.x || e.next.y) && !isWall(e.c + e.next.x, e.r + e.next.y)) {
                e.dir = { x: e.next.x, y: e.next.y };
            } else if (isWall(e.c + e.dir.x, e.r + e.dir.y)) {
                e.dir = { x: 0, y: 0 };
            }
        }
    }
    if (e.dir.x || e.dir.y) e.face = Math.atan2(e.dir.y, e.dir.x);
}

// ---------- PAC-MAN HUNTER AI ----------
function bfsFrom(tc, tr) {
    const d = Array.from({ length: ROWS }, () => Array(COLS).fill(Infinity));
    tc = wrapCol(tc);
    if (isWall(tc, tr)) return d;
    const q = [[tc, tr]];
    d[tr][tc] = 0;
    for (let i = 0; i < q.length; i++) {
        const [c, r] = q[i];
        for (const [dx, dy] of DIRS) {
            const nc = wrapCol(c + dx), nr = r + dy;
            if (!isWall(nc, nr) && d[nr][nc] === Infinity) {
                d[nr][nc] = d[r][c] + 1;
                q.push([nc, nr]);
            }
        }
    }
    return d;
}

function hunterChoose(e) {
    const tc = dog.c + (dog.p >= 0.5 ? dog.dir.x : 0);
    const tr = dog.r + (dog.p >= 0.5 ? dog.dir.y : 0);
    const dist = bfsFrom(tc, tr);

    let options = DIRS.filter(([dx, dy]) => !isWall(e.c + dx, e.r + dy));
    const notBack = options.filter(([dx, dy]) => !(dx === -e.dir.x && dy === -e.dir.y));
    if (notBack.length > 0) options = notBack; // ghosts don't reverse unless dead end

    const scared = performance.now() < powerUntil;
    let pick;
    if (options.length > 1 && Math.random() < 0.18) {
        pick = options[Math.floor(Math.random() * options.length)]; // a little unpredictability
    } else {
        pick = options.reduce((best, o) =>
        {
            const dO = dist[e.r + o[1]][wrapCol(e.c + o[0])];
            const dB = dist[e.r + best[1]][wrapCol(e.c + best[0])];
            return (scared ? dO > dB : dO < dB) ? o : best; // scared = run AWAY from the dog
        }, options[0]);
    }
    e.next = { x: pick[0], y: pick[1] };
}

// ---------- COLLECTIBLES ----------
function initCollectibles() {
    items = [];
    totalItems = 0;
    for (let r = 0; r < ROWS; r++) {
        const row = [];
        for (let c = 0; c < COLS; c++) {
            const ch = MAZE[r][c];
            if (ch === ".") { row.push("dot"); totalItems++; }
            else if (ch === "o") { row.push("cherry"); totalItems++; }
            else if (ch === "P") { row.push("power"); totalItems++; }
            else row.push(null);
        }
        items.push(row);
    }
    // keep spawn tiles clear
    [DOG_START, HUNTER_START].forEach(s => {
        if (items[s.r][s.c]) { items[s.r][s.c] = null; totalItems--; }
    });
    itemsCollected = 0;
}

function checkCollectibles() {
    const tc = dog.c + (dog.p >= 0.5 ? dog.dir.x : 0);
    const tr = dog.r + (dog.p >= 0.5 ? dog.dir.y : 0);
    const it = items[tr] && items[tr][tc];
    if (it) {
        items[tr][tc] = null;
        itemsCollected++;
        if (it === "power") {
            score += 50;
            powerUntil = performance.now() + POWER_MS;
            // Pac-Man turns around and runs away
            hunter.next = { x: -hunter.dir.x, y: -hunter.dir.y };
        } else {
            score += it === "cherry" ? 200 : 25;
        }
    }
    if (totalItems > 0 && itemsCollected >= totalItems) showScreen("WIN");
}

// ---------- GAME FLOW ----------
function resetPositions() {
    dog = makeEntity(DOG_START.c, DOG_START.r);
    hunter = makeEntity(HUNTER_START.c, HUNTER_START.r);
    freeze = 80;
    powerUntil = 0;
    downUntil = 0;
}

function resetGame() {
    score = 0;
    lives = 3;
    initCollectibles();
    resetPositions();
}

function updateGame() {
    if (freeze > 0) { freeze--; return; }

    const now = performance.now();
    const hunterDown = now < downUntil;

    stepEntity(dog, DOG_SPEED);
    if (dog.dir.x || dog.dir.y) dog.walk = (dog.walk || 0) + DOG_SPEED;
    if (!hunterDown) {
        // Pac-Man is slower while scared
        stepEntity(hunter, now < powerUntil ? 0.03 : 0.04, hunterChoose);
    }
    checkCollectibles();
    if (gameState !== "PLAYING") return;
    if (hunterDown) return; // knocked-out Pac-Man is harmless until he revives

    const a = entityPos(dog), b = entityPos(hunter);
    if (Math.hypot(a.x - b.x, a.y - b.y) < T * 0.7) {
        if (now < powerUntil) {
            // The dog hits Pac-Man! He is out for 10s, then revives at his start spot.
            score += 500;
            downUntil = now + REVIVE_MS;
            hunter = makeEntity(HUNTER_START.c, HUNTER_START.r);
        } else {
            lives--;
            if (lives <= 0) showScreen("GAMEOVER");
            else resetPositions();
        }
    }
}

// ---------- MENU EVENTS ----------
const DOG_KINDS = ["molly", "buddy", "archer", "yoda"];
function selectDog(kind) {
    selectedDog = kind;
    DOG_KINDS.forEach((k) => {
        document.getElementById("card-" + k).classList.toggle("selected", k === kind);
        document.getElementById("status-" + k).classList.toggle("hidden", k !== kind);
    });
}
DOG_KINDS.forEach((k) => {
    document.getElementById("card-" + k).addEventListener("click", () => selectDog(k));
});

document.getElementById("btn-start").addEventListener("click", () => { enterLandscape(); resetGame(); showScreen("PLAYING"); });
document.getElementById("btn-characters").addEventListener("click", () => showScreen("CHARACTERS"));
document.getElementById("btn-tutorials").addEventListener("click", () => showScreen("TUTORIALS"));
document.getElementById("btn-back-char").addEventListener("click", () => showScreen("MENU"));
document.getElementById("btn-back-tut").addEventListener("click", () => showScreen("MENU"));
document.getElementById("btn-restart").addEventListener("click", () => { enterLandscape(); resetGame(); showScreen("PLAYING"); });
document.getElementById("btn-home").addEventListener("click", () => showScreen("MENU"));

function showScreen(screen) {
    welcomeScreen.classList.add("hidden");
    charactersScreen.classList.add("hidden");
    tutorialsScreen.classList.add("hidden");
    endScreen.classList.add("hidden");
    hud.classList.add("hidden");
    joystick.classList.add("hidden");

    if (screen === "MENU") {
        gameState = "MENU";
        welcomeScreen.classList.remove("hidden");
    } else if (screen === "CHARACTERS") {
        gameState = "MENU";
        charactersScreen.classList.remove("hidden");
    } else if (screen === "TUTORIALS") {
        gameState = "MENU";
        tutorialsScreen.classList.remove("hidden");
    } else if (screen === "PLAYING") {
        gameState = "PLAYING";
        hud.classList.remove("hidden");
        if (IS_TOUCH) joystick.classList.remove("hidden");
    } else if (screen === "GAMEOVER") {
        gameState = "GAMEOVER";
        endTitle.innerText = "💀 GAME OVER 💀";
        endTitle.style.color = "#ff4757";
        endStats.innerText = `FINAL SCORE: ${score} | COLLECTED: ${itemsCollected}/${totalItems}`;
        endScreen.classList.remove("hidden");
    } else if (screen === "WIN") {
        gameState = "WIN";
        endTitle.innerText = "🏆 PAW-SOME VICTORY! 🏆";
        endTitle.style.color = "#2ed573";
        endStats.innerText = `FINAL SCORE: ${score} | STAGE CLEARED!`;
        endScreen.classList.remove("hidden");
    }
}

// ---------- KEYBOARD ----------
const KEYDIR = {
    ArrowLeft: [-1, 0], a: [-1, 0], A: [-1, 0],
    ArrowRight: [1, 0], d: [1, 0], D: [1, 0],
    ArrowUp: [0, -1], w: [0, -1], W: [0, -1],
    ArrowDown: [0, 1], s: [0, 1], S: [0, 1]
};
window.addEventListener("keydown", (e) => {
    const d = KEYDIR[e.key];
    if (d) {
        e.preventDefault();
        if (gameState === "PLAYING") dog.next = { x: d[0], y: d[1] };
    }
    if (e.key === "Escape" && gameState === "PLAYING") showScreen("MENU");
});

// ---------- TOUCH CONTROLS (phones/tablets) ----------
function setDogDir(x, y) {
    if (gameState === "PLAYING") dog.next = { x, y };
}

// Virtual joystick: drag the knob, the dog follows the strongest direction
const joyBase = document.getElementById("joy-base");
const joyKnob = document.getElementById("joy-knob");
let joyId = null;

function joyMove(e) {
    const r = joyBase.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const len = Math.hypot(dx, dy);
    const travel = r.width / 2 - 28; // how far the knob may move
    if (len > travel) { dx = dx / len * travel; dy = dy / len * travel; }
    joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    if (len > 14) { // small dead zone so a light touch doesn't steer
        if (Math.abs(dx) > Math.abs(dy)) setDogDir(dx > 0 ? 1 : -1, 0);
        else setDogDir(0, dy > 0 ? 1 : -1);
    }
}
function joyEnd() {
    joyId = null;
    joyKnob.style.transform = "translate(0px, 0px)";
}
joyBase.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    joyId = e.pointerId;
    joyBase.setPointerCapture(e.pointerId);
    joyMove(e);
});
joyBase.addEventListener("pointermove", (e) => { if (e.pointerId === joyId) joyMove(e); });
joyBase.addEventListener("pointerup", joyEnd);
joyBase.addEventListener("pointercancel", joyEnd);

// Ask the phone/tablet for fullscreen + landscape (works on most Android browsers;
// iPhones/iPads don't allow it, so they see the "rotate your device" prompt instead)
function enterLandscape() {
    if (!IS_TOUCH) return;
    try {
        const el = document.documentElement;
        const req = el.requestFullscreen || el.webkitRequestFullscreen;
        const done = req ? Promise.resolve(req.call(el)).catch(() => {}) : Promise.resolve();
        done.then(() => {
            if (screen.orientation && screen.orientation.lock) {
                return screen.orientation.lock("landscape");
            }
        }).catch(() => {});
    } catch (e) { /* not supported - the rotate prompt covers it */ }
}

// Pause + show the rotate prompt while a touch device is held upright during play
let rotateShown = false;
let lastTick = performance.now();
function updateRotatePrompt() {
    const now = performance.now();
    const need = IS_TOUCH && gameState === "PLAYING" && window.innerHeight > window.innerWidth;
    if (need) {
        // freeze the power-up / revive countdowns while paused
        const dt = now - lastTick;
        if (powerUntil) powerUntil += dt;
        if (downUntil) downUntil += dt;
    }
    lastTick = now;
    rotateShown = need;
    rotateScreen.classList.toggle("hidden", !need);
}

// Swipe anywhere on the game screen
let touchStart = null;
canvas.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    touchStart = { x: t.clientX, y: t.clientY };
}, { passive: true });
canvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    if (!touchStart) return;
    const t = e.touches[0];
    const dx = t.clientX - touchStart.x, dy = t.clientY - touchStart.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) > 24) {
        if (Math.abs(dx) > Math.abs(dy)) setDogDir(dx > 0 ? 1 : -1, 0);
        else setDogDir(0, dy > 0 ? 1 : -1);
        touchStart = { x: t.clientX, y: t.clientY };
    }
}, { passive: false });
canvas.addEventListener("touchend", () => { touchStart = null; });

// Tap the HUD hint to go back to the menu (replaces ESC on phones)
document.querySelector(".hud-hint").addEventListener("click", () => {
    if (gameState === "PLAYING") showScreen("MENU");
});

// ---------- DRAWING ----------
function drawMaze() {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // wall fill
    ctx.fillStyle = "#06103a";
    for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++)
            if (isWall(c, r)) ctx.fillRect(OX + c * T, OY + r * T, T, T);

    // neon outline only where a wall touches a corridor
    ctx.strokeStyle = "#2a52ff";
    ctx.shadowColor = "#2a52ff";
    ctx.shadowBlur = 8;
    ctx.lineWidth = Math.max(2, T * 0.09);
    ctx.lineCap = "round";
    const inset = T * 0.12;
    ctx.beginPath();
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (!isWall(c, r)) continue;
            const x = OX + c * T, y = OY + r * T;
            const inBounds = (cc, rr) => rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS;
            if (inBounds(c, r - 1) && !isWall(c, r - 1)) { ctx.moveTo(x + inset, y + inset); ctx.lineTo(x + T - inset, y + inset); }
            if (inBounds(c, r + 1) && !isWall(c, r + 1)) { ctx.moveTo(x + inset, y + T - inset); ctx.lineTo(x + T - inset, y + T - inset); }
            if (inBounds(c - 1, r) && !isWall(c - 1, r)) { ctx.moveTo(x + inset, y + inset); ctx.lineTo(x + inset, y + T - inset); }
            if (inBounds(c + 1, r) && !isWall(c + 1, r)) { ctx.moveTo(x + T - inset, y + inset); ctx.lineTo(x + T - inset, y + T - inset); }
        }
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
}

function drawCherry(cx, cy) {
    const s = T;
    ctx.strokeStyle = "#7bd34a";
    ctx.lineWidth = Math.max(1.5, s * 0.06);
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.14, cy + s * 0.08); ctx.quadraticCurveTo(cx - s * 0.05, cy - s * 0.2, cx + s * 0.08, cy - s * 0.28);
    ctx.moveTo(cx + s * 0.14, cy + s * 0.12); ctx.quadraticCurveTo(cx + s * 0.15, cy - s * 0.15, cx + s * 0.08, cy - s * 0.28);
    ctx.stroke();
    ctx.fillStyle = "#ff2b2b";
    ctx.beginPath(); ctx.arc(cx - s * 0.14, cy + s * 0.12, s * 0.16, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + s * 0.14, cy + s * 0.16, s * 0.16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.beginPath(); ctx.arc(cx - s * 0.19, cy + s * 0.07, s * 0.04, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + s * 0.09, cy + s * 0.11, s * 0.04, 0, Math.PI * 2); ctx.fill();
}

function drawCollectibles() {
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const it = items[r] && items[r][c];
            if (!it) continue;
            const cx = OX + (c + 0.5) * T, cy = OY + (r + 0.5) * T;
            if (it === "dot") {
                ctx.fillStyle = "#ffd9b0";
                ctx.fillRect(cx - T * 0.07, cy - T * 0.07, T * 0.14, T * 0.14); // square retro pellet
            } else if (it === "power") {
                // big pulsing power pellet
                const pulse = 0.28 + 0.06 * Math.sin(frameCount * 0.15);
                ctx.save();
                ctx.fillStyle = "#ffffff";
                ctx.shadowColor = "#7fd0ff";
                ctx.shadowBlur = 14;
                ctx.beginPath();
                ctx.arc(cx, cy, T * pulse, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            } else {
                drawCherry(cx, cy);
            }
        }
    }
}

function drawDog() {
    const p = entityPos(dog);
    // pick sprite row from the direction of travel (0 Down, 1 Right, 2 Up, 3 Left)
    if (dog.dir.x > 0) dog.row = 1;
    else if (dog.dir.x < 0) dog.row = 3;
    else if (dog.dir.y < 0) dog.row = 2;
    else if (dog.dir.y > 0) dog.row = 0;
    const moving = dog.dir.x !== 0 || dog.dir.y !== 0;
    // walk frame follows the distance travelled, so legs only move when the dog moves
    drawDogSprite(ctx, selectedDog, p.x, p.y, T * DOG_SIZE, dog.row || 0, moving ? (dog.walk || 0) : -1);
}

// The one and only retro Pac-Man (drawn in code - no sprite sheet bugs)
function drawHunter() {
    const p = entityPos(hunter);
    const r = T * 0.46;
    const open = (Math.sin(frameCount * 0.35) + 1) / 2; // 0..1 chomp
    const mouth = 0.05 + open * 0.65;
    const now = performance.now();
    const down = now < downUntil;
    const powered = now < powerUntil;
    const flicker = powered && powerUntil - now < 2000 && Math.floor(now / 200) % 2 === 0;
    const color = down ? "#9aa3c7" : powered ? (flicker ? "#ffffff" : "#3b5bff") : "#ffe600";
    ctx.save();
    ctx.globalAlpha = down ? 0.35 : 1;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.arc(p.x, p.y, r, hunter.face + mouth, hunter.face + Math.PI * 2 - mouth);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

function drawReady() {
    if (gameState === "PLAYING" && freeze > 0) {
        ctx.fillStyle = "#ffe600";
        ctx.font = `bold ${Math.floor(T * 0.8)}px 'Courier New', monospace`;
        ctx.textAlign = "center";
        ctx.fillText("READY!", canvas.width / 2, OY + 9.35 * T);
    }
}

// Status text for power-up / revive countdowns (drawn on the top wall row)
function drawStatus() {
    if (gameState !== "PLAYING" || freeze > 0) return;
    const now = performance.now();
    let msg = null, color = "#ffffff";
    if (now < downUntil) {
        msg = `PAC-MAN REVIVES IN ${Math.ceil((downUntil - now) / 1000)}s`;
        color = "#ff6b6b";
    } else if (now < powerUntil) {
        msg = `POWER! HIT PAC-MAN  ${Math.ceil((powerUntil - now) / 1000)}s`;
        color = "#74c0ff";
    }
    if (!msg) return;
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = `bold ${Math.max(10, Math.floor(T * 0.55))}px 'Courier New', monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(msg, canvas.width / 2, OY + T * 0.5);
    ctx.restore();
}

let previewTimer = 0;
function drawCharacterPreviews() {
    previewTimer++;
    const bob = Math.sin(previewTimer * 0.1) * 2;
    [["previewMolly", "molly"], ["previewBuddy", "buddy"],
     ["previewArcher", "archer"], ["previewYoda", "yoda"]].forEach(([id, kind]) => {
        const cv = document.getElementById(id);
        if (!cv) return;
        const c = cv.getContext("2d");
        c.clearRect(0, 0, cv.width, cv.height);
        drawDogSprite(c, kind, cv.width / 2, cv.height / 2 + bob, 72, 0, previewTimer * 0.04);
    });
}

// ---------- MAIN LOOP ----------
initCollectibles();

function gameLoop() {
    frameCount++;
    updateRotatePrompt();
    if (gameState === "PLAYING" && !rotateShown) updateGame();

    drawMaze();
    drawCollectibles();
    drawHunter();
    drawDog();
    drawReady();
    drawStatus();

    if (!charactersScreen.classList.contains("hidden")) drawCharacterPreviews();

    hudScore.innerText = score;
    hudBerries.innerText = `${itemsCollected}/${totalItems}`;
    hudLives.innerText = "❤️".repeat(Math.max(0, lives));

    requestAnimationFrame(gameLoop);
}
gameLoop();