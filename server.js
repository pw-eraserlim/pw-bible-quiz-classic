/**
 * 성경퀴즈 실시간 대시보드 v3
 * 메인 PC → /host (대시보드) / 학생 폰 → / (참여)
 */
const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const os = require("os");
const QRCode = require("qrcode");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingTimeout: 20000 });
app.use(express.static(path.join(__dirname, "public")));

/* ---------------- 미니게임 정의 ---------------- */
const MINIGAMES = {
  memory: {
    name: "기억력 카드 뒤집기",
    desc: "카드 16장 중 같은 말씀 짝 8쌍을 모두 찾으세요.",
    tip: "가장 빨리 다 찾은 순서대로 점수를 드립니다.",
    limit: 100,
  },
  order: {
    name: "성경 순서 맞추기",
    desc: "섞여 있는 사건을 성경에 나오는 순서대로 눌러 주세요.",
    tip: "세 세트를 모두 통과하면 완주입니다. 틀리면 잠깐 멈춥니다.",
    limit: 100,
  },
  speed: {
    name: "66권 스피드 탭",
    desc: "화면에 뜨는 이름 중 진짜 성경책만 골라 누르세요.",
    tip: "30초 안에 15개! 가짜 책 이름을 누르면 하나씩 깎입니다.",
    limit: 34,
  },
  verse: {
    name: "말씀 빈칸 채우기",
    desc: "유명한 말씀의 빈칸에 들어갈 단어를 네 개 중에서 고르세요.",
    tip: "8구절을 다 맞히면 완주. 틀리면 잠깐 멈춥니다.",
    limit: 90,
  },
  catch: {
    name: "베드로의 물고기 잡기",
    desc: "움직이는 표시가 초록 구간 안에 있을 때 누르면 물고기를 잡습니다.",
    tip: "10마리를 잡으면 완주. 잡을수록 빨라지고 구간이 좁아집니다.",
    limit: 70,
  },
  scramble: {
    name: "이름 글자 맞추기",
    desc: "섞여 있는 글자를 순서대로 눌러 성경 인물의 이름을 완성하세요.",
    tip: "8명을 다 맞히면 완주. 틀린 글자는 튕겨 나옵니다.",
    limit: 90,
  },
};

/* ---------------- 문제 불러오기 ---------------- */
const QUESTION_FILE = path.join(__dirname, "questions.json");
const CATEGORY_DEFAULT = { nonsense: "넌센스", bible: "성경" };
function loadQuestions() {
  try {
    const raw = JSON.parse(fs.readFileSync(QUESTION_FILE, "utf8"));
    return raw.map((q, i) => {
      if (q.type === "minigame") {
        const g = MINIGAMES[q.game] ? q.game : "memory";
        return { no: i + 1, type: "minigame", game: g, category: "미니게임", difficulty: 0, ...MINIGAMES[g] };
      }
      const kind = q.kind === "nonsense" ? "nonsense" : "bible";
      const d = Number(q.difficulty);
      return {
        no: i + 1,
        type: q.type === "choice" ? "choice" : "short",
        kind,
        category: (q.category || "").toString().trim() || CATEGORY_DEFAULT[kind],
        difficulty: d >= 1 && d <= 3 ? Math.round(d) : 2,
        text: q.text || "",
        options: Array.isArray(q.options) ? q.options : [],
        answerIndex: Number.isInteger(q.answerIndex) ? q.answerIndex : -1,
        answer: q.answer || "",
        alternates: q.alternates || [],
        hint: q.hint || "",
        reference: q.reference || "",
      };
    });
  } catch (e) {
    console.error("\n  questions.json 을 읽지 못했습니다:", e.message, "\n");
    return [];
  }
}

/* ---------------- 게임 상태 ---------------- */
const game = {
  phase: "lobby", // lobby | intro | question | grading | minigame | minigame_result | leaderboard | finished
  questions: loadQuestions(),
  index: -1,
  openedAt: 0,
  speedBonus: true,
  basePoints: 100,      // 난이도 ★★ 기준 점수
  points: new Map(),    // 문제번호 -> 호스트가 바꾼 점수
  done: new Set(),      // 이미 푼 문제 번호 (선택판에서 사라짐)
  lastDone: 0,          // 방금 푼 문제 번호 (선택판에서 사라지는 애니메이션용)
  introTimer: null,
  players: new Map(),
  answers: new Map(),
  mini: null, // {seed, results:Map(pid->{pct,doneAt}), order:[pid], timer}
};

/* 난이도별 배점 배율: ★ 1배, ★★ 1.5배, ★★★ 2배 (기본 100점이면 100 / 150 / 200) */
const DIFF_MULT = { 0: 1, 1: 1, 2: 1.5, 3: 2 };
const clampPoints = (v) => Math.max(0, Math.min(1000, Math.round((Number(v) || 0) / 10) * 10));
/* 이 문제에 실제로 적용되는 점수 (호스트가 바꿨으면 그 값, 아니면 기본 점수 × 난이도 배율) */
function qPoints(q) {
  if (!q) return game.basePoints;
  if (game.points.has(q.no)) return game.points.get(q.no);
  return clampPoints(game.basePoints * (DIFF_MULT[q.difficulty] ?? 1));
}

const normalize = (s) =>
  (s || "").toString().toLowerCase().replace(/\s+/g, "").replace(/[.,!?"'’“”·~\-()[\]]/g, "");

function autoGrade(a, q) {
  if (q.type === "choice") return a.choice === q.answerIndex;
  const t = normalize(a.text);
  if (!t) return false;
  return [q.answer, ...q.alternates].map(normalize).filter(Boolean)
    .some((k) => t === k || (k.length >= 2 && t.includes(k)));
}

const currentQuestion = () => game.questions[game.index] || null;

function ranked() {
  return [...game.players.values()]
    .map((p) => ({ id: p.id, name: p.name, score: p.score, connected: p.connected, streak: p.streak || 0 }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "ko"));
}

/* 답 공개용: 같은 답끼리 한 카드로 묶는다 (이름은 내보내지 않음) */
function answerGroups() {
  const q = currentQuestion();
  if (!q) return [];
  const map = new Map();
  for (const a of game.answers.values()) {
    const key = q.type === "choice" ? "c" + a.choice : normalize(a.text);
    let g = map.get(key);
    if (!g) {
      g = { key, text: a.text, choice: a.choice, count: 0, correct: !!a.correct, order: a.order, fastest: a.seconds };
      map.set(key, g);
    }
    g.count++;
    g.correct = !!a.correct;                        // 그룹은 항상 함께 채점된다
    if (a.order < g.order) { g.order = a.order; g.text = a.text; }
    if (a.seconds < g.fastest) g.fastest = a.seconds;
  }
  return [...map.values()].sort(
    (a, b) => (b.correct - a.correct) || (b.count - a.count) || (a.order - b.order)
  );
}

function miniView() {
  if (!game.mini) return null;
  const q = currentQuestion();
  const rows = [...game.players.values()].map((p) => {
    const r = game.mini.results.get(p.id);
    return { id: p.id, name: p.name, pct: r ? r.pct : 0, done: !!(r && r.doneAt) };
  });
  const finishers = game.mini.order.map((pid, i) => ({
    rank: i + 1,
    name: game.players.get(pid)?.name || "?",
    sec: Math.round(((game.mini.results.get(pid).doneAt - game.openedAt) / 1000) * 10) / 10,
  }));
  return {
    game: q.game, name: q.name, desc: q.desc, tip: q.tip, limit: q.limit,
    seed: game.mini.seed,
    rows: rows.sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name, "ko")),
    finishers,
    doneCount: finishers.length,
  };
}

function lobbyTop() {
  return [...game.players.values()]
    .filter((p) => (p.lobbyBest || 0) > 0)
    .sort((a, b) => (b.lobbyBest || 0) - (a.lobbyBest || 0))
    .slice(0, 6)
    .map((p) => ({ name: p.name, best: p.lobbyBest }));
}

/* 선택판용 문제 목록 */
function questionList() {
  return game.questions.map((q) => ({
    no: q.no, type: q.type, kind: q.kind, category: q.category, difficulty: q.difficulty,
    points: q.type === "minigame" ? 0 : qPoints(q),
    game: q.game || null, name: q.name || null,
    done: game.done.has(q.no),
  }));
}
function introInfo() {
  const q = currentQuestion();
  if (game.phase !== "intro" || !q) return null;
  return { no: q.no, type: q.type, kind: q.kind, category: q.category, difficulty: q.difficulty,
           points: q.type === "minigame" ? 0 : qPoints(q), name: q.name || null, until: game.introUntil || 0 };
}

function hostState() {
  const q = currentQuestion();
  const board = ranked();
  return {
    phase: game.phase,
    index: game.index,
    total: game.questions.length,
    doneCount: game.done.size,
    lastDone: game.lastDone,
    list: questionList(),
    intro: introInfo(),
    speedBonus: game.speedBonus,
    basePoints: game.basePoints,
    points: qPoints(q),
    openedAt: game.openedAt,
    question: q && { ...q, points: qPoints(q) },
    groups: game.phase === "grading" ? answerGroups() : [],
    mini: (game.phase === "minigame" || game.phase === "minigame_result") ? miniView() : null,
    submittedNames: game.phase === "question"
      ? [...game.answers.keys()].map((id) => game.players.get(id)?.name || "?") : [],
    submitted: game.answers.size,
    connected: board.filter((p) => p.connected).length,
    lobbyTop: lobbyTop(),
    board,
  };
}

function playerState(id) {
  const p = game.players.get(id);
  const q = currentQuestion();
  const mine = game.answers.get(id);
  const board = ranked();
  const mv = miniView();
  const myMini = game.mini?.results.get(id);
  return {
    phase: game.phase,
    me: p && { name: p.name, score: p.score, streak: p.streak || 0, lastGain: p.lastGain || 0,
               rank: board.findIndex((x) => x.id === id) + 1 },
    total: game.questions.length,
    doneCount: game.done.size,
    intro: introInfo(),
    question: q && ["question", "grading"].includes(game.phase)
      ? { no: q.no, type: q.type, kind: q.kind, category: q.category, difficulty: q.difficulty,
          text: q.text, options: q.options, hint: q.hint, points: qPoints(q) }
      : null,
    mini: mv && {
      game: mv.game, name: mv.name, desc: mv.desc, tip: mv.tip, limit: mv.limit, seed: mv.seed,
      openedAt: game.openedAt, doneCount: mv.doneCount,
      myDone: !!(myMini && myMini.doneAt),
      myRank: myMini && myMini.doneAt ? game.mini.order.indexOf(id) + 1 : 0,
      top: mv.finishers.slice(0, 5),
    },
    correctAnswer: game.phase === "grading" && q
      ? (q.type === "choice" ? q.options[q.answerIndex] : q.answer) : null,
    correctIndex: game.phase === "grading" && q ? q.answerIndex : -1,
    myAnswer: mine ? { text: mine.text, choice: mine.choice, correct: mine.correct } : null,
    top: board.slice(0, 5),
    lobbyBest: p?.lobbyBest || 0,
    lobbyTop: lobbyTop(),
    playerCount: game.players.size,
  };
}

const pushHost = () => io.to("host").emit("state", hostState());
function pushPlayers() {
  for (const [id, p] of game.players) if (p.socketId) io.to(p.socketId).emit("state", playerState(id));
}
const pushAll = () => { pushHost(); pushPlayers(); };

/* ---------------- 접속 주소 ---------------- */
function lanAddress() {
  for (const list of Object.values(os.networkInterfaces()))
    for (const net of list || []) if (net.family === "IPv4" && !net.internal) return net.address;
  return "localhost";
}
const JOIN_URL = `http://${lanAddress()}:${PORT}`;
app.get("/host", (req, res) => res.sendFile(path.join(__dirname, "public", "host.html")));

/* 대시보드가 자기 주소를 알려주면 그 주소로 QR을 만든다.
   단 localhost 로 열었을 때는 학생 폰이 못 들어오므로 랜 주소로 되돌린다. */
app.get("/api/join-info", async (req, res) => {
  let url = JOIN_URL, fallback = false;
  const given = (req.query.origin || "").toString().trim();
  if (given) {
    try {
      const u = new URL(given);
      const local = ["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"].includes(u.hostname);
      if (!/^https?:$/.test(u.protocol)) throw new Error("bad protocol");
      if (local) fallback = true;
      else url = u.origin;
    } catch { fallback = true; }
  }
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 460, color: { dark: "#0A1020", light: "#FFFFFF" } });
  res.json({ url, qr, fallback });
});

/* public/music 폴더에 넣어 둔 음악 파일 목록.
   파일 이름 앞에 lobby- / quiz- / board- / game- / final- 을 붙이면 그 장면에서만 재생되고,
   아무것도 안 붙이면 대기실에서 재생됩니다. */
const MUSIC_DIR = path.join(__dirname, "public", "music");
app.get("/api/music", (req, res) => {
  const slots = { lobby: [], quiz: [], board: [], game: [], final: [] };
  try {
    for (const f of fs.readdirSync(MUSIC_DIR)) {
      if (!/\.(mp3|m4a|ogg|wav|aac)$/i.test(f)) continue;
      const m = /^(lobby|quiz|board|game|final)[-_]/i.exec(f);
      slots[m ? m[1].toLowerCase() : "lobby"].push("/music/" + encodeURIComponent(f));
    }
  } catch { /* 폴더가 없으면 자체 연주곡만 쓴다 */ }
  res.json(slots);
});

/* ---------------- 소켓 ---------------- */
io.on("connection", (socket) => {
  socket.on("host:join", () => { socket.join("host"); socket.emit("state", hostState()); });

  socket.on("host:start", () => {
    if (!game.questions.length) return;
    game.phase = "leaderboard"; // 선택판을 먼저 보여준다
    pushAll();
  });

  // 선택판에서 카드를 클릭 → 3초 예고(intro) → 문제 열림
  socket.on("host:pick", (no) => {
    if (!["leaderboard", "lobby"].includes(game.phase)) return;
    const idx = game.questions.findIndex((q) => q.no === Number(no));
    if (idx < 0 || game.done.has(Number(no))) return;
    startIntro(idx);
  });

  // 스페이스바: 선택판이면 남은 문제 중 순서상 첫 번째를, 예고 중이면 바로 문제를 연다
  socket.on("host:openQuestion", () => {
    if (game.phase === "intro") return openStage();
    if (!["leaderboard", "lobby"].includes(game.phase)) return;
    const idx = game.questions.findIndex((q) => !game.done.has(q.no));
    if (idx >= 0) startIntro(idx);
  });

  socket.on("host:closeQuestion", () => {
    if (game.phase === "minigame") return finishMini();
    if (game.phase !== "question") return;
    const q = currentQuestion();
    for (const a of game.answers.values()) a.correct = autoGrade(a, q);
    applyScores();
    game.phase = "grading";
    pushAll();
  });

  // 카드 클릭 → 같은 답을 낸 사람 전체를 한 번에 전환
  socket.on("host:toggleGroup", (key) => {
    if (game.phase !== "grading") return;
    const q = currentQuestion();
    let target = null;
    for (const a of game.answers.values()) {
      const k = q.type === "choice" ? "c" + a.choice : normalize(a.text);
      if (k !== key) continue;
      if (target === null) target = !a.correct;
      a.correct = target;
    }
    if (target === null) return;
    applyScores();
    pushAll();
  });

  socket.on("host:next", () => {
    if (!["grading", "minigame_result"].includes(game.phase)) return;
    const q = currentQuestion();
    if (q) { game.done.add(q.no); game.lastDone = q.no; }
    game.answers.clear(); game.mini = null;
    if (game.done.size >= game.questions.length) { game.phase = "finished"; saveResults(); }
    else game.phase = "leaderboard";
    pushAll();
  });

  // 남은 문제가 있어도 여기서 끝내기
  socket.on("host:finish", () => {
    if (!["leaderboard"].includes(game.phase)) return;
    game.phase = "finished"; saveResults(); pushAll();
  });

  socket.on("host:leaderboard", () => { game.phase = "leaderboard"; pushAll(); });
  socket.on("host:speedBonus", (on) => { game.speedBonus = !!on; pushHost(); });

  // 지금 열려 있는 문제의 점수를 바꾼다 (채점 중에 바꾸면 즉시 다시 계산)
  socket.on("host:points", (v) => {
    const q = currentQuestion();
    if (!q || q.type === "minigame") return;
    game.points.set(q.no, clampPoints(v));
    if (game.phase === "grading") applyScores();
    pushAll();
  });

  // 모든 문제에 적용되는 기본 점수
  socket.on("host:basePoints", (v) => {
    game.basePoints = clampPoints(v);
    if (game.phase === "grading") applyScores();
    pushAll();
  });
  socket.on("host:kick", (pid) => {
    const p = game.players.get(pid);
    if (p?.socketId) io.to(p.socketId).emit("kicked");
    game.players.delete(pid); game.answers.delete(pid);
    game.mini?.results.delete(pid);
    pushAll();
  });
  socket.on("host:reset", () => {
    if (game.mini?.timer) clearTimeout(game.mini.timer);
    if (game.introTimer) clearTimeout(game.introTimer);
    game.questions = loadQuestions();
    game.phase = "lobby"; game.index = -1; game.answers.clear(); game.mini = null;
    game.points.clear(); game.done.clear(); game.lastDone = 0;
    for (const p of game.players.values()) {
      p.score = 0; p.history = []; p.streak = 0; p.lastGain = 0; p.lobbyBest = 0;
    }
    pushAll();
  });

  /* ---- 학생 ---- */
  socket.on("player:join", ({ name, id } = {}) => {
    const clean = (name || "").trim().slice(0, 12);
    if (!clean) return socket.emit("joinError", "이름을 입력해 주세요.");
    let player = id && game.players.get(id);
    if (!player) {
      if ([...game.players.values()].some((p) => p.name === clean && p.connected))
        return socket.emit("joinError", "같은 이름이 이미 있어요. 뒤에 한 글자만 더 붙여 주세요.");
      const newId = Math.random().toString(36).slice(2, 10);
      player = { id: newId, name: clean, score: 0, history: [], streak: 0, lastGain: 0, connected: true };
      game.players.set(newId, player);
    }
    player.name = clean; player.connected = true; player.socketId = socket.id;
    socket.data.playerId = player.id;
    socket.emit("joined", { id: player.id, name: player.name });
    socket.emit("state", playerState(player.id));
    pushHost();
  });

  socket.on("player:answer", (payload) => {
    const pid = socket.data.playerId;
    if (!pid || game.phase !== "question" || game.answers.has(pid)) return;
    const q = currentQuestion();
    const e = { seconds: 0, order: game.answers.size + 1, correct: false, text: "", choice: -1 };
    if (q.type === "choice") {
      const i = Number(payload);
      if (!Number.isInteger(i) || i < 0 || i >= q.options.length) return;
      e.choice = i; e.text = q.options[i];
    } else {
      const t = (payload || "").toString().trim().slice(0, 60);
      if (!t) return;
      e.text = t;
    }
    e.seconds = Math.round(((Date.now() - game.openedAt) / 1000) * 10) / 10;
    game.answers.set(pid, e);
    const p = game.players.get(pid);
    if (p?.socketId) io.to(p.socketId).emit("state", playerState(pid));
    pushHost();
  });

  /* ---- 대기실 점프 게임 ---- */
  socket.on("player:lobbyScore", (v) => {
    const pid = socket.data.playerId;
    if (!pid) return;
    const p = game.players.get(pid);
    if (!p) return;
    const s = Math.max(0, Math.min(99999, Math.floor(Number(v) || 0)));
    if (s <= (p.lobbyBest || 0)) return;
    p.lobbyBest = s;
    pushHost();
    if (p.socketId) io.to(p.socketId).emit("state", playerState(pid));
  });

  /* ---- 미니게임 ---- */
  socket.on("mini:progress", (pct) => {
    const pid = socket.data.playerId;
    if (!pid || game.phase !== "minigame") return;
    const r = game.mini.results.get(pid) || { pct: 0, doneAt: 0 };
    if (r.doneAt) return;
    r.pct = Math.max(0, Math.min(1, Number(pct) || 0));
    game.mini.results.set(pid, r);
    pushHost();
  });

  socket.on("mini:done", () => {
    const pid = socket.data.playerId;
    if (!pid || game.phase !== "minigame") return;
    const r = game.mini.results.get(pid) || { pct: 0, doneAt: 0 };
    if (r.doneAt) return;
    r.pct = 1; r.doneAt = Date.now();
    game.mini.results.set(pid, r);
    game.mini.order.push(pid);
    const p = game.players.get(pid);
    if (p?.socketId) io.to(p.socketId).emit("state", playerState(pid));
    pushHost();
  });

  socket.on("disconnect", () => {
    const pid = socket.data.playerId;
    if (pid && game.players.has(pid)) { game.players.get(pid).connected = false; pushHost(); }
  });
});

/* ---------------- 진행 ---------------- */
const INTRO_MS = 3200;
function startIntro(idx) {
  if (game.introTimer) clearTimeout(game.introTimer);
  if (game.mini?.timer) clearTimeout(game.mini.timer);
  game.index = idx;
  game.answers.clear(); game.mini = null;
  game.phase = "intro";
  game.introUntil = Date.now() + INTRO_MS;
  game.introTimer = setTimeout(() => { if (game.phase === "intro") openStage(); }, INTRO_MS);
  pushAll();
}

function openStage() {
  if (game.introTimer) { clearTimeout(game.introTimer); game.introTimer = null; }
  if (game.index < 0) game.index = 0;
  const q = currentQuestion();
  if (!q) return;
  game.answers.clear();
  if (game.mini?.timer) clearTimeout(game.mini.timer);
  game.openedAt = Date.now();
  if (q.type === "minigame") {
    game.mini = { seed: Math.floor(Math.random() * 1e9), results: new Map(), order: [], timer: null };
    game.phase = "minigame";
    game.mini.timer = setTimeout(() => { if (game.phase === "minigame") finishMini(); }, q.limit * 1000 + 1200);
  } else {
    game.mini = null;
    game.phase = "question";
  }
  pushAll();
}

function finishMini() {
  if (game.phase !== "minigame") return;
  if (game.mini.timer) clearTimeout(game.mini.timer);
  const q = currentQuestion();
  for (const p of game.players.values()) {
    p.history = (p.history || []).filter((h) => h.no !== q.no);
    const r = game.mini.results.get(p.id);
    let pts = 0;
    if (r && r.doneAt) pts = Math.max(100, 250 - game.mini.order.indexOf(p.id) * 10);
    else if (r) pts = Math.round(r.pct * 80);
    if (pts > 0) p.history.push({ no: q.no, pts });
    p.lastGain = pts;
    p.score = p.history.reduce((s, h) => s + h.pts, 0);
  }
  game.phase = "minigame_result";
  pushAll();
}

function applyScores() {
  const q = currentQuestion();
  const order = [...game.answers.entries()].filter(([, a]) => a.correct)
    .sort((a, b) => a[1].order - b[1].order).map(([pid]) => pid);
  for (const p of game.players.values()) {
    p.history = (p.history || []).filter((h) => h.no !== q.no);
    const a = game.answers.get(p.id);
    if (a && a.correct) {
      let pts = qPoints(q);
      if (game.speedBonus) pts += Math.max(0, 50 - order.indexOf(p.id) * 10);
      p.history.push({ no: q.no, pts });
      p.lastGain = pts;
    } else p.lastGain = 0;
    const nos = new Set(p.history.map((h) => h.no));
    p.streak = 0;
    for (let n = q.no; n >= 1; n--) { if (nos.has(n)) p.streak++; else break; }
    p.score = p.history.reduce((s, h) => s + h.pts, 0);
  }
}

function saveResults() {
  const file = path.join(__dirname, `결과_${new Date().toISOString().slice(0, 10)}.csv`);
  const csv = "\uFEFF순위,이름,점수\n" + ranked().map((p, i) => `${i + 1},${p.name},${p.score}`).join("\n");
  try { fs.writeFileSync(file, csv); console.log("  결과 저장:", file); } catch {}
}

server.listen(PORT, "0.0.0.0", () => {
  const mg = game.questions.filter((q) => q.type === "minigame").length;
  console.log("\n  성경퀴즈 서버가 켜졌습니다.");
  console.log("  ─────────────────────────────────────");
  console.log(`  대시보드(메인 화면) : http://localhost:${PORT}/host`);
  console.log(`  학생 접속 주소      : ${JOIN_URL}`);
  console.log(`  문제 ${game.questions.length - mg}개 + 미니게임 ${mg}개`);
  console.log("  ─────────────────────────────────────\n");
});
