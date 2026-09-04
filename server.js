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
};

/* ---------------- 문제 불러오기 ---------------- */
const QUESTION_FILE = path.join(__dirname, "questions.json");
function loadQuestions() {
  try {
    const raw = JSON.parse(fs.readFileSync(QUESTION_FILE, "utf8"));
    return raw.map((q, i) => {
      if (q.type === "minigame") {
        const g = MINIGAMES[q.game] ? q.game : "memory";
        return { no: i + 1, type: "minigame", game: g, ...MINIGAMES[g] };
      }
      return {
        no: i + 1,
        type: q.type === "choice" ? "choice" : "short",
        kind: q.kind === "nonsense" ? "nonsense" : "bible",
        text: q.text || "",
        options: Array.isArray(q.options) ? q.options : [],
        answerIndex: Number.isInteger(q.answerIndex) ? q.answerIndex : -1,
        answer: q.answer || "",
        alternates: q.alternates || [],
        hint: q.hint || "",
        points: q.points || 100,
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
  phase: "lobby", // lobby | question | grading | minigame | minigame_result | leaderboard | finished
  questions: loadQuestions(),
  index: -1,
  openedAt: 0,
  speedBonus: true,
  players: new Map(),
  answers: new Map(),
  mini: null, // {seed, results:Map(pid->{pct,doneAt}), order:[pid], timer}
};

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

/* 답 공개용: 한 사람 한 카드, 이름 그대로 */
function answerCards() {
  const q = currentQuestion();
  return [...game.answers.entries()]
    .map(([pid, a]) => ({
      id: pid,
      name: game.players.get(pid)?.name || "?",
      text: a.text,
      key: q.type === "choice" ? "c" + a.choice : normalize(a.text),
      choice: a.choice,
      seconds: a.seconds,
      order: a.order,
      correct: a.correct,
    }))
    .sort((a, b) => (b.correct - a.correct) || a.order - b.order);
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

function hostState() {
  const q = currentQuestion();
  const board = ranked();
  return {
    phase: game.phase,
    index: game.index,
    total: game.questions.length,
    speedBonus: game.speedBonus,
    openedAt: game.openedAt,
    question: q && { ...q },
    cards: game.phase === "grading" ? answerCards() : [],
    mini: (game.phase === "minigame" || game.phase === "minigame_result") ? miniView() : null,
    submittedNames: game.phase === "question"
      ? [...game.answers.keys()].map((id) => game.players.get(id)?.name || "?") : [],
    submitted: game.answers.size,
    connected: board.filter((p) => p.connected).length,
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
    question: q && ["question", "grading"].includes(game.phase)
      ? { no: q.no, type: q.type, kind: q.kind, text: q.text, options: q.options, hint: q.hint, points: q.points }
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
const LAN_URL = `http://${lanAddress()}:${PORT}`;

/* 대시보드를 연 브라우저의 주소창 주소를 그대로 학생 접속 주소로 쓴다.
   여러 랜카드가 잡혀도 선생님이 실제로 접속한 주소가 QR 에 나온다.
   다만 localhost 로 열면 학생 폰이 찾아올 수 없으니 그때만 랜 주소로 바꾼다. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
function joinUrl(req) {
  const host = (req.headers.host || "").trim();
  if (!host) return LAN_URL;
  let name = host;
  const cut = name.lastIndexOf(":");
  if (cut > name.lastIndexOf("]")) name = name.slice(0, cut); // 포트 떼기
  name = name.split("[").join("").split("]").join("").toLowerCase();
  if (LOOPBACK.has(name)) return LAN_URL;
  return `${req.protocol}://${host}`;
}

app.get("/host", (req, res) => res.sendFile(path.join(__dirname, "public", "host.html")));
app.get("/api/join-info", async (req, res) => {
  const url = joinUrl(req);
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 460, color: { dark: "#0A1020", light: "#FFFFFF" } });
  res.json({ url, qr });
});

/* ---------------- 소켓 ---------------- */
io.on("connection", (socket) => {
  socket.on("host:join", () => { socket.join("host"); socket.emit("state", hostState()); });

  socket.on("host:start", () => { if (game.questions.length) { game.index = 0; openStage(); } });
  socket.on("host:openQuestion", () => openStage());

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
    if (game.index + 1 >= game.questions.length) { game.phase = "finished"; saveResults(); }
    else { game.index += 1; game.phase = "leaderboard"; game.answers.clear(); game.mini = null; }
    pushAll();
  });

  socket.on("host:leaderboard", () => { game.phase = "leaderboard"; pushAll(); });
  socket.on("host:speedBonus", (on) => { game.speedBonus = !!on; pushHost(); });
  socket.on("host:kick", (pid) => {
    const p = game.players.get(pid);
    if (p?.socketId) io.to(p.socketId).emit("kicked");
    game.players.delete(pid); game.answers.delete(pid);
    game.mini?.results.delete(pid);
    pushAll();
  });
  socket.on("host:reset", () => {
    if (game.mini?.timer) clearTimeout(game.mini.timer);
    game.questions = loadQuestions();
    game.phase = "lobby"; game.index = -1; game.answers.clear(); game.mini = null;
    for (const p of game.players.values()) { p.score = 0; p.history = []; p.streak = 0; p.lastGain = 0; }
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
function openStage() {
  if (game.index < 0) game.index = 0;
  const q = currentQuestion();
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
      let pts = q.points;
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
  console.log(`  학생 접속 주소      : ${LAN_URL}  (대시보드를 연 주소가 QR 에 그대로 나옵니다)`);
  console.log(`  문제 ${game.questions.length - mg}개 + 미니게임 ${mg}개`);
  console.log("  ─────────────────────────────────────\n");
});
