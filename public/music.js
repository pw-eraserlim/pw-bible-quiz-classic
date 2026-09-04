/* ═══════════════════════════════════════════════════════════════════
   성경퀴즈 음악 엔진 — 자체 연주 (Web Audio)
   ─────────────────────────────────────────────────────────────────
   · 배경음악 6곡: 자작곡 4곡 + 저작권 소멸 찬송가 2곡 편곡
       Amazing Grace (New Britain, 1835) / Ode to Joy (베토벤, 1824)
   · 팡파레·효과음: 브라스, 벨, 팀파니, 심벌 합성
   · public/music/ 폴더에 mp3 를 넣으면 그 곡이 대신 재생됩니다.
   모든 소리는 이 파일 안에서 실시간으로 만들어지며 외부 음원을 쓰지 않습니다.
   ═══════════════════════════════════════════════════════════════════ */
window.Music = (() => {
  const NOTE = { C:0, "C#":1, Db:1, D:2, "D#":3, Eb:3, E:4, F:5, "F#":6, Gb:6, G:7, "G#":8, Ab:8, A:9, "A#":10, Bb:10, B:11 };
  const midi = (n) => { const m = /^([A-G][#b]?)(-?\d)$/.exec(n); return NOTE[m[1]] + (parseInt(m[2], 10) + 1) * 12; };
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

  /* ── 곡 정의 ───────────────────────────────────────────────
     chords: 한 마디에 한 코드. melody: 마디는 | 로, 음은 "음이름:박자", 쉼표는 r
  ─────────────────────────────────────────────────────────── */
  const SONGS = {
    dawn: {
      title: "고요한 아침 (자작곡)", bpm: 64, tsig: 4, style: "ambient",
      chords: ["C","G/B","Am","F","C","G/B","Am","F","Dm7","G","Em","Am","F","G","C","C"],
      melody: "G4:3 E4:1 | D4:2 G4:2 | A4:2 C5:1 B4:1 | A4:4 | E5:2 D5:1 C5:1 | D5:3 B4:1 | C5:2 A4:2 | G4:4 | " +
              "F4:2 A4:1 C5:1 | B4:3 A4:1 | G4:2 B4:2 | C5:2 A4:1 G4:1 | A4:4 | B4:2 D5:2 | E5:2 D5:2 | C5:4",
    },
    grace: {
      title: "나 같은 죄인 살리신 (Amazing Grace · 1835)", bpm: 72, tsig: 3, style: "hymn", pickup: "D4:1",
      chords: ["G","G","C","G","G","G","D","D","G","G","C","G","Em","D","G","G"],
      melody: "G4:2 B4:.5 G4:.5 | B4:2 A4:1 | G4:2 E4:1 | D4:2 D4:1 | G4:2 B4:.5 G4:.5 | B4:2 A4:1 | D5:3 | D5:2 B4:1 | " +
              "D5:2 B4:.5 G4:.5 | B4:2 A4:1 | G4:2 E4:1 | D4:2 D4:1 | G4:2 B4:.5 G4:.5 | B4:2 A4:1 | G4:3 | G4:3",
    },
    joy: {
      title: "기뻐하며 경배하세 (Ode to Joy · 베토벤)", bpm: 104, tsig: 4, style: "upbeat",
      chords: ["D","A","D","A","D","A","D","D","A","D","A","A","D","A","D","D"],
      melody: "F#4:1 F#4:1 G4:1 A4:1 | A4:1 G4:1 F#4:1 E4:1 | D4:1 D4:1 E4:1 F#4:1 | F#4:1.5 E4:.5 E4:2 | " +
              "F#4:1 F#4:1 G4:1 A4:1 | A4:1 G4:1 F#4:1 E4:1 | D4:1 D4:1 E4:1 F#4:1 | E4:1.5 D4:.5 D4:2 | " +
              "E4:1 E4:1 F#4:1 D4:1 | E4:1 F#4:.5 G4:.5 F#4:1 D4:1 | E4:1 F#4:.5 G4:.5 F#4:1 E4:1 | D4:1 E4:1 A3:2 | " +
              "F#4:1 F#4:1 G4:1 A4:1 | A4:1 G4:1 F#4:1 E4:1 | D4:1 D4:1 E4:1 F#4:1 | E4:1.5 D4:.5 D4:2",
    },
    think: {
      title: "생각하는 시간 (자작곡)", bpm: 92, tsig: 4, style: "pulse",
      chords: ["Am","F","C","G","Am","F","Dm","E"],
      melody: "A4:1 r:1 E5:1 r:1 | r:2 C5:.5 D5:.5 E5:1 | r:4 | G5:1 D5:1 B4:2 | " +
              "A4:1 r:1 C5:1 r:1 | r:2 A4:.5 G4:.5 F4:1 | F4:2 A4:2 | G#4:2 B4:2",
    },
    praise: {
      title: "기쁨의 노래 (자작곡)", bpm: 116, tsig: 4, style: "upbeat",
      chords: ["G","D","Em","C","G","D","C","D"],
      melody: "G4:1 B4:1 D5:2 | D5:1 C5:1 B4:1 A4:1 | B4:1 G4:1 E4:2 | E4:1 F#4:1 G4:2 | " +
              "G4:1 B4:1 D5:1 G5:1 | F#5:2 E5:1 D5:1 | E5:2 C5:1 E5:1 | D5:4",
    },
    run: {
      title: "달려라 (자작곡)", bpm: 132, tsig: 4, style: "drive",
      chords: ["Em","C","G","D","Em","C","G","B"],
      melody: "E5:.5 r:.5 E5:.5 G5:.5 r:1 B4:1 | C5:.5 r:.5 E5:1 G5:1 E5:1 | G5:.5 r:.5 D5:.5 B4:.5 r:1 G4:1 | A4:1 B4:1 D5:2 | " +
              "E5:.5 r:.5 E5:.5 G5:.5 r:1 B4:1 | C5:1 E5:1 G5:1 A5:1 | G5:1 D5:1 B4:2 | F#5:1 D#5:1 B4:2",
    },
  };

  /* 장면 → 재생 목록 */
  const PHASE_LIST = { lobby: ["dawn", "grace"], board: ["praise"], quiz: ["think"], game: ["run"], final: ["joy"], none: [] };

  function parseMelody(str, pickup) {
    const ev = [];
    let pos = 0;
    if (pickup) {
      const [n, b] = pickup.split(":");
      pos = -parseFloat(b);
      ev.push({ at: pos, m: midi(n), dur: parseFloat(b) });
      pos = 0;
    }
    str.split("|").forEach((bar) => {
      bar.trim().split(/\s+/).filter(Boolean).forEach((tok) => {
        const [n, b] = tok.split(":");
        const dur = parseFloat(b);
        if (n !== "r") ev.push({ at: pos, m: midi(n), dur });
        pos += dur;
      });
    });
    return ev;
  }
  function chordInfo(name) {
    const m = /^([A-G][#b]?)(m7|maj7|m|7|sus4|dim)?(?:\/([A-G][#b]?))?$/.exec(name);
    const root = NOTE[m[1]], q = m[2] || "", bass = m[3] ? NOTE[m[3]] : root;
    const iv = q === "m" ? [0,3,7] : q === "m7" ? [0,3,7,10] : q === "7" ? [0,4,7,10]
             : q === "maj7" ? [0,4,7,11] : q === "sus4" ? [0,5,7] : q === "dim" ? [0,3,6] : [0,4,7];
    return { tones: iv.map((i) => 48 + root + i), bass: 36 + bass, fifth: 36 + ((root + 7) % 12) + (root + 7 >= 12 ? 12 : 0) };
  }
  Object.values(SONGS).forEach((s) => {
    s.events = parseMelody(s.melody, s.pickup);
    s.pickupBeats = s.pickup ? parseFloat(s.pickup.split(":")[1]) : 0;
    s.totalBeats = s.chords.length * s.tsig;
  });

  /* ── 오디오 그래프 ─────────────────────────────────────── */
  let ac = null, master, bgmBus, sfxBus, reverb, noiseBuf;
  let volume = 0.8, bgmOn = true, sfxOn = true;
  let wantPhase = "none", curPhase = "none";
  let seq = null, custom = null, customSlots = null, trackCb = null;

  function init() {
    if (ac) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ac = new AC();
    master = ac.createGain(); master.gain.value = volume;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 10; comp.ratio.value = 6; comp.attack.value = .004; comp.release.value = .22;
    // 부드러운 리미터: 어떤 순간에도 소리가 찢어지지 않게
    const shaper = ac.createWaveShaper(), N = 2048, curve = new Float32Array(N);
    for (let i = 0; i < N; i++) {           // 0.7 까지는 그대로, 그 위만 부드럽게 눌러 1.0 을 넘지 않게
      const x = (i / (N - 1)) * 2 - 1, a = Math.abs(x), k = .7;
      curve[i] = a <= k ? x : Math.sign(x) * (k + (1 - k) * Math.tanh((a - k) / (1 - k)));
    }
    shaper.curve = curve; shaper.oversample = "2x";
    master.connect(comp); comp.connect(shaper); shaper.connect(ac.destination);

    reverb = ac.createConvolver(); reverb.buffer = impulse(2.6, 2.4);
    const wet = ac.createGain(); wet.gain.value = .34;
    reverb.connect(wet); wet.connect(master);

    bgmBus = ac.createGain(); bgmBus.gain.value = .40; bgmBus.connect(master); bgmBus.connect(reverb);
    sfxBus = ac.createGain(); sfxBus.gain.value = .62; sfxBus.connect(master); sfxBus.connect(reverb);

    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }
  function impulse(sec, decay) {
    const len = Math.floor(ac.sampleRate * sec), buf = ac.createBuffer(2, len, ac.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }
  const osc = (type, f) => { const o = ac.createOscillator(); o.type = type; o.frequency.value = f; return o; };

  /* ── 악기 ─────────────────────────────────────────────── */
  function piano(dest, m, t, dur, vel = .5) {
    const f = hz(m), g = ac.createGain(), lp = ac.createBiquadFilter();
    lp.type = "lowpass"; lp.Q.value = .6;
    lp.frequency.setValueAtTime(Math.min(9000, f * 7), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(300, f * 1.6), t + Math.max(.3, dur));
    const parts = [["triangle", 1, 1], ["sine", 1, .6], ["sine", 2, .32], ["sine", 3.003, .1], ["sine", 4.01, .05]];
    parts.forEach(([type, r, a]) => {
      const o = osc(type, f * r), og = ac.createGain(); og.gain.value = a;
      o.connect(og); og.connect(g); o.start(t); o.stop(t + dur + 1.4);
    });
    g.connect(lp); lp.connect(dest);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + .006);
    g.gain.exponentialRampToValueAtTime(vel * .4, t + .22);
    g.gain.exponentialRampToValueAtTime(Math.max(.0001, vel * .18), t + Math.max(.3, dur));
    g.gain.exponentialRampToValueAtTime(.0001, t + dur + 1.2);
  }
  function pad(dest, tones, t, dur, vel = .16) {
    const g = ac.createGain(), lp = ac.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 820; lp.Q.value = .8;
    const lfo = osc("sine", .18), lg = ac.createGain(); lg.gain.value = 220;
    lfo.connect(lg); lg.connect(lp.frequency); lfo.start(t); lfo.stop(t + dur + 3);
    tones.forEach((m) => {
      [-8, 0, 8].forEach((det) => {
        const o = osc("sawtooth", hz(m)); o.detune.value = det;
        const og = ac.createGain(); og.gain.value = .33 / tones.length;
        o.connect(og); og.connect(g); o.start(t); o.stop(t + dur + 3);
      });
      const o2 = osc("triangle", hz(m + 12)), og2 = ac.createGain(); og2.gain.value = .12 / tones.length;
      o2.connect(og2); og2.connect(g); o2.start(t); o2.stop(t + dur + 3);
    });
    g.connect(lp); lp.connect(dest);
    const atk = Math.min(1.4, dur * .45);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + atk);
    g.gain.setValueAtTime(vel, t + Math.max(atk, dur - .1));
    g.gain.linearRampToValueAtTime(0, t + dur + 2.2);
  }
  function bass(dest, m, t, dur, vel = .3) {
    const f = hz(m), g = ac.createGain(), lp = ac.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 340;
    const o1 = osc("triangle", f), o2 = osc("sine", f), o3 = osc("sawtooth", f); 
    const g3 = ac.createGain(); g3.gain.value = .25;
    o1.connect(g); o2.connect(g); o3.connect(g3); g3.connect(g);
    g.connect(lp); lp.connect(dest);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel, t + .015);
    g.gain.exponentialRampToValueAtTime(vel * .55, t + dur * .6);
    g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    [o1, o2, o3].forEach((o) => { o.start(t); o.stop(t + dur + .05); });
  }
  function brass(dest, m, t, dur, vel = .45) {
    const f = hz(m), g = ac.createGain(), lp = ac.createBiquadFilter();
    lp.type = "lowpass"; lp.Q.value = 1.6;
    lp.frequency.setValueAtTime(f * 1.4, t);
    lp.frequency.linearRampToValueAtTime(f * 5.5, t + .13);
    lp.frequency.setValueAtTime(f * 5.5, t + Math.max(.13, dur - .1));
    lp.frequency.linearRampToValueAtTime(f * 2, t + dur + .3);
    const vib = osc("sine", 5.6), vg = ac.createGain();
    vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(7, t + .4); vib.connect(vg);
    [-7, 6].forEach((det) => {
      const o = osc("sawtooth", f); o.detune.value = det; vg.connect(o.detune);
      const og = ac.createGain(); og.gain.value = .5; o.connect(og); og.connect(g); o.start(t); o.stop(t + dur + .4);
    });
    vib.start(t); vib.stop(t + dur + .4);
    g.connect(lp); lp.connect(dest);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel, t + .05);
    g.gain.setValueAtTime(vel, t + Math.max(.05, dur - .06));
    g.gain.linearRampToValueAtTime(0, t + dur + .28);
  }
  function bell(dest, m, t, vel = .3) {
    const f = hz(m);
    [[1, 1], [2.756, .38], [5.404, .14]].forEach(([r, a]) => {
      const o = osc("sine", f * r), g = ac.createGain();
      o.connect(g); g.connect(dest);
      g.gain.setValueAtTime(vel * a, t); g.gain.exponentialRampToValueAtTime(.0001, t + 1.8 / r);
      o.start(t); o.stop(t + 2);
    });
  }
  function noise(dest, t, dur, { type = "highpass", f = 6000, q = .8, vel = .25, atk = 0 } = {}) {
    const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    const flt = ac.createBiquadFilter(); flt.type = type; flt.frequency.value = f; flt.Q.value = q;
    const g = ac.createGain();
    if (atk > 0) { g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(vel, t + atk); }
    else g.gain.setValueAtTime(vel, t);
    g.gain.exponentialRampToValueAtTime(.0001, t + atk + dur);
    s.connect(flt); flt.connect(g); g.connect(dest); s.start(t); s.stop(t + atk + dur + .05);
  }
  function kick(dest, t, vel = .55, f0 = 150, f1 = 45, dur = .3) {
    const o = osc("sine", f0), g = ac.createGain();
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur * .9);
    g.gain.setValueAtTime(vel, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + .02);
  }
  const timpani = (dest, t, vel = .6) => { kick(dest, t, vel, 95, 62, .95); noise(dest, t, .12, { type: "lowpass", f: 900, vel: vel * .25 }); };
  const hat = (dest, t, vel = .1, open = false) => noise(dest, t, open ? .18 : .05, { type: "highpass", f: 7500, vel });
  const shaker = (dest, t, vel = .07) => noise(dest, t, .06, { type: "bandpass", f: 5200, q: 2.5, vel });
  function snare(dest, t, vel = .28) {
    noise(dest, t, .17, { type: "bandpass", f: 1900, q: .7, vel });
    kick(dest, t, vel * .5, 220, 150, .09);
  }
  const crash = (dest, t, vel = .3) => noise(dest, t, 1.9, { type: "bandpass", f: 4200, q: .45, vel });
  const swell = (dest, t, vel = .28) => noise(dest, t, 1.2, { type: "bandpass", f: 3800, q: .5, vel, atk: .9 });

  /* ── 시퀀서 ───────────────────────────────────────────── */
  function spb(song) { return 60 / song.bpm; }

  function scheduleBeat(s, t, pos) {
    const song = s.song, bpb = spb(song), dest = s.gain, tsig = song.tsig;
    // 멜로디 (픽업 포함: pos 가 음수일 수 있음)
    song.events.forEach((e) => {
      if (e.at >= pos && e.at < pos + 1) {
        const tt = t + (e.at - pos) * bpb, dur = e.dur * bpb;
        if (song.style === "hymn") { piano(dest, e.m, tt, dur, .5); piano(dest, e.m - 12, tt, dur, .16); }
        else if (song.style === "ambient") piano(dest, e.m, tt, dur, .4);
        else if (song.style === "pulse") piano(dest, e.m, tt, dur * .9, .34);
        else if (song.style === "upbeat") { piano(dest, e.m, tt, dur, .44); bell(dest, e.m + 12, tt, .05); }
        else if (song.style === "drive") { piano(dest, e.m, tt, dur * .9, .42); brass(dest, e.m, tt, dur * .8, .11); }
      }
    });
    if (pos < 0) return;

    const bar = Math.floor(pos / tsig), beat = pos % tsig;
    const ch = chordInfo(song.chords[bar % song.chords.length]);
    const barDur = tsig * bpb, half = bpb / 2;
    const up = ch.tones.map((m) => m + 12);
    const arp = [up[0], up[1], up[2 % up.length], up[0] + 12, up[2 % up.length], up[1]];
    const arpAt = (i, tt, vel) => piano(dest, arp[i % arp.length], tt, half * 1.6, vel);
    const stab = (tt, vel, dur = .45) => up.forEach((m, i) => piano(dest, m, tt + i * .012, dur, vel));

    switch (song.style) {
      case "ambient":
        if (beat === 0) { pad(dest, [...ch.tones, ch.tones[0] + 12], t, barDur, .17); bass(dest, ch.bass, t, bpb * 2.2, .26); }
        if (beat === 2) bass(dest, ch.bass, t, bpb * 1.8, .16);
        arpAt(bar * tsig * 2 + beat * 2, t, .13); arpAt(bar * tsig * 2 + beat * 2 + 1, t + half, .1);
        if (beat === 0 && bar % 4 === 0) bell(dest, ch.tones[0] + 24, t, .11);
        break;
      case "hymn":
        if (beat === 0) {
          pad(dest, [...ch.tones, ch.tones[0] + 12], t, barDur, .15);
          bass(dest, ch.bass, t, barDur * .9, .27);
          stab(t, .17, barDur * .8);
        }
        if (beat === tsig - 1) arpAt(bar + beat, t + half, .09);
        break;
      case "pulse":
        if (beat === 0) pad(dest, [...ch.tones, ch.tones[0] + 12], t, barDur, .13);
        if (beat === 0 || beat === 2) kick(dest, t, .34);
        hat(dest, t, .07); hat(dest, t + half, .1);
        bass(dest, ch.bass, t, half * .9, .24);
        bass(dest, beat % 2 ? ch.fifth : ch.bass, t + half, half * .8, .18);
        if (beat === 1 || beat === 3) stab(t, .15, .28);
        if (bar % 2 === 1 && beat === 3) shaker(dest, t + half, .06);
        break;
      case "upbeat":
        if (beat === 0) pad(dest, [...ch.tones, ch.tones[0] + 12], t, barDur, .1);
        if (beat === 0 || beat === 2) kick(dest, t, .5);
        if (beat === 1 || beat === 3) snare(dest, t, .26);
        if (beat === 3) kick(dest, t + half, .3);
        hat(dest, t, .1); hat(dest, t + half, .14, beat === 3);
        if (beat === 0) bass(dest, ch.bass, t, bpb * .9, .3);
        if (beat === 1) bass(dest, ch.bass, t + half, half * .9, .26);
        if (beat === 2) bass(dest, ch.fifth, t, bpb * .9, .27);
        if (beat === 3) bass(dest, ch.bass, t, bpb * .9, .28);
        if (beat === 0) stab(t, .16); if (beat === 1) stab(t + half, .13); if (beat === 2) stab(t + half, .13);
        if (beat === 0 && bar === 0) crash(dest, t, .12);
        break;
      case "drive":
        if (beat === 0) pad(dest, [...ch.tones, ch.tones[0] + 12], t, barDur, .09);
        kick(dest, t, .48);
        if (beat === 1 || beat === 3) snare(dest, t, .27);
        hat(dest, t, .11); hat(dest, t + half, .15, true);
        bass(dest, ch.bass, t, half * .8, .3); bass(dest, ch.bass + 12, t + half, half * .7, .2);
        if (beat === 0 || beat === 2) stab(t, .18, .3);
        if (beat === 3 && bar % 4 === 3) crash(dest, t + half, .1);
        break;
    }
  }

  function startSong(name) {
    const song = SONGS[name];
    const g = ac.createGain();
    g.gain.setValueAtTime(0, ac.currentTime);
    g.gain.linearRampToValueAtTime(1, ac.currentTime + .6);
    g.connect(bgmBus);
    seq = { name, song, gain: g, pos: -song.pickupBeats, time: ac.currentTime + .05, timer: null };
    seq.timer = setInterval(tickSeq, 110);
    tickSeq();
    trackCb && trackCb(song.title);
  }
  function tickSeq() {
    if (!seq || !ac) return;
    const s = seq, step = spb(s.song);
    while (s.time < ac.currentTime + .4) {
      scheduleBeat(s, s.time, s.pos);
      s.pos += 1; s.time += step;
      if (s.pos >= s.song.totalBeats) {
        const list = PHASE_LIST[curPhase] || [];
        if (list.length > 1) {                      // 다음 곡으로
          const i = list.indexOf(s.name), next = list[(i + 1) % list.length];
          stopSeq(1.4); startSong(next); return;
        }
        s.pos = -s.song.pickupBeats;                // 같은 곡 반복
      }
    }
  }
  function stopSeq(fade = 1.2) {
    if (!seq) return;
    const s = seq; seq = null;
    clearInterval(s.timer);
    const now = ac.currentTime;
    s.gain.gain.cancelScheduledValues(now);
    s.gain.gain.setValueAtTime(s.gain.gain.value, now);
    s.gain.gain.linearRampToValueAtTime(0, now + fade);
    setTimeout(() => { try { s.gain.disconnect(); } catch {} }, (fade + 3) * 1000);
  }

  /* ── 사용자 mp3 재생 ─────────────────────────────────────
     파일은 서버가 켜질 때 미리 내려받아 두고(pool), 장면이 바뀌면 그 자리에서 바로 튼다. */
  const pool = new Map();   // url -> { el, src, gain }
  function preload(url) {
    if (pool.has(url)) return pool.get(url);
    const el = new Audio(url); el.preload = "auto"; el.crossOrigin = "anonymous";
    try { el.load(); } catch {}
    const entry = { el, src: null, gain: null };
    pool.set(url, entry);
    return entry;
  }
  function attach(entry) {          // 오디오 그래프에 한 번만 연결
    if (entry.src || !ac) return;
    try {
      entry.src = ac.createMediaElementSource(entry.el);
      entry.gain = ac.createGain(); entry.gain.gain.value = 0;
      entry.src.connect(entry.gain); entry.gain.connect(bgmBus);
    } catch { entry.src = "fallback"; }
  }
  function startCustom(files) {
    stopCustom(.5);
    const play = (i) => {
      const url = files[i % files.length], entry = preload(url);
      attach(entry);
      const el = entry.el;
      try { el.currentTime = 0; } catch {}
      if (entry.gain) {
        const now = ac.currentTime;
        entry.gain.gain.cancelScheduledValues(now);
        entry.gain.gain.setValueAtTime(0, now);
        entry.gain.gain.linearRampToValueAtTime(1, now + .45);
      } else el.volume = volume * .8;
      el.onended = () => { if (custom && custom.entry === entry) play(i + 1); };
      el.play().catch(() => {});
      custom = { entry, el, files, idx: i % files.length };
      trackCb && trackCb(title(url));
    };
    play(0);
  }
  const title = (u) => { try { return decodeURIComponent(u.split("/").pop()).replace(/\.[^.]+$/, ""); } catch { return "내 음악"; } };
  function stopCustom(fade = .6) {
    if (!custom) return;
    const c = custom; custom = null;
    c.el.onended = null;
    if (c.entry.gain) {
      const now = ac.currentTime;
      c.entry.gain.gain.cancelScheduledValues(now);
      c.entry.gain.gain.setValueAtTime(c.entry.gain.gain.value, now);
      c.entry.gain.gain.linearRampToValueAtTime(0, now + fade);
    }
    setTimeout(() => { if (!custom || custom.entry !== c.entry) { try { c.el.pause(); } catch {} } }, fade * 1000 + 40);
  }

  /* ── 장면 전환 ─────────────────────────────────────────── */
  function applyPhase() {
    if (!ac) return;
    const p = bgmOn ? wantPhase : "none";
    if (p === curPhase) return;
    curPhase = p;
    stopSeq(.6); stopCustom(.6);
    const files = customSlots && customSlots[p];
    if (files && files.length) return startCustom(files);
    const list = PHASE_LIST[p] || [];
    if (list.length) startSong(list[0]); else trackCb && trackCb("");
  }
  function next() {
    if (!ac) return;
    if (custom) { const f = custom.files, i = custom.idx; startCustom(f.slice((i + 1) % f.length).concat(f.slice(0, (i + 1) % f.length))); return; }
    const list = PHASE_LIST[curPhase] || [];
    if (!seq || !list.length) return;
    const i = list.indexOf(seq.name), nm = list[(i + 1) % list.length];
    stopSeq(.8); startSong(nm);
  }

  /* ── 효과음 / 팡파레 ─────────────────────────────────────── */
  const PENTA = ["C5", "D5", "E5", "G5", "A5"];
  const SFX = {
    join(t) { bell(sfxBus, midi(["C6", "E6", "G6"][Math.floor(Math.random() * 3)]), t, .2); },
    submit(t) { piano(sfxBus, midi(PENTA[Math.floor(Math.random() * PENTA.length)]), t, .22, .2); },
    click(t) { piano(sfxBus, midi("E5"), t, .15, .14); },
    up(t) { piano(sfxBus, midi("G5"), t, .18, .16); bell(sfxBus, midi("D6"), t + .04, .08); },
    down(t) { piano(sfxBus, midi("D5"), t, .18, .16); },
    toggle(t) { bell(sfxBus, midi("A5"), t, .16); },
    tick(t) { noise(sfxBus, t, .03, { type: "highpass", f: 5000, vel: .08 }); },
    intro(t) {               // 다음 문제 예고: 휘익 + 드럼롤 + 반짝
      noise(sfxBus, t, .7, { type: "bandpass", f: 900, q: 1.2, vel: .22, atk: .35 });
      for (let i = 0; i < 8; i++) snare(sfxBus, t + .1 + i * .075, .07 + i * .022);
      kick(sfxBus, t + .75, .5, 120, 50, .4);
      [0, 4, 7, 12].forEach((iv, i) => bell(sfxBus, 72 + iv, t + .78 + i * .06, .13));
    },
    reveal(t) {              // 답 공개 팡파레 (G → C)
      kick(sfxBus, t, .5); crash(sfxBus, t, .16);
      [55, 59, 62].forEach((m) => brass(sfxBus, m, t, .16, .32));
      [55, 59, 62].forEach((m) => brass(sfxBus, m, t + .2, .16, .32));
      [60, 64, 67, 72].forEach((m) => brass(sfxBus, m, t + .42, 1.0, .34));
      timpani(sfxBus, t + .42, .55); crash(sfxBus, t + .42, .26);
    },
    rank(t) {                // 순위 화면
      [72, 76, 79, 84, 88].forEach((m, i) => bell(sfxBus, m, t + i * .08, .22));
      [60, 64, 67, 72].forEach((m) => brass(sfxBus, m, t + .32, .85, .3));
      snare(sfxBus, t + .32, .2); crash(sfxBus, t + .34, .22);
    },
    mini(t) {                // 미니게임 첫 완주
      [67, 71, 74, 79].forEach((m, i) => bell(sfxBus, m, t + i * .07, .24));
      brass(sfxBus, 67, t + .28, .4, .25); brass(sfxBus, 74, t + .28, .4, .2);
      crash(sfxBus, t + .28, .18);
    },
    correct(t) { bell(sfxBus, 79, t, .22); bell(sfxBus, 84, t + .09, .18); },
    final(t) {               // 최종 순위 대팡파레 (~4초)
      const roll = [0, .16, .30, .43, .55, .66, .76, .85, .93];
      roll.forEach((d, i) => timpani(sfxBus, t + d, .3 + i * .04));
      swell(sfxBus, t, .3);
      const C = [60, 64, 67], F = [65, 69, 72], G = [67, 71, 74], BIG = [60, 64, 67, 72, 76, 79];
      C.forEach((m) => brass(sfxBus, m, t + 1.0, .28, .32));
      C.forEach((m) => brass(sfxBus, m, t + 1.32, .28, .32));
      F.forEach((m) => brass(sfxBus, m, t + 1.64, .28, .34));
      G.forEach((m) => brass(sfxBus, m, t + 1.96, .62, .36));
      BIG.forEach((m) => brass(sfxBus, m, t + 2.66, 1.9, .3));
      timpani(sfxBus, t + 2.66, .7); crash(sfxBus, t + 2.66, .34); crash(sfxBus, t + 3.3, .22);
      [84, 88, 91, 96].forEach((m, i) => bell(sfxBus, m, t + 2.7 + i * .09, .2));
    },
  };
  function sfx(name) {
    if (!ac || !sfxOn || !SFX[name]) return;
    try { SFX[name](ac.currentTime + .02); } catch {}
  }

  /* ── 공개 API ─────────────────────────────────────────── */
  return {
    songs: SONGS,
    /* 사용자 클릭 뒤에 호출 — 브라우저 자동재생 정책 */
    unlock() {
      if (!init()) return false;
      if (ac.state === "suspended") ac.resume();
      applyPhase();
      return true;
    },
    get ready() { return !!ac && ac.state === "running"; },
    phase(p) { wantPhase = PHASE_LIST[p] || (customSlots && customSlots[p]) ? p : "none"; applyPhase(); },
    sfx,
    next,
    nowPlaying() { return custom ? title(custom.el.src) : seq ? seq.song.title : ""; },
    onTrack(cb) { trackCb = cb; },
    setBgm(on) { bgmOn = !!on; applyPhase(); },
    setSfx(on) { sfxOn = !!on; },
    get bgm() { return bgmOn; },
    get sfxOn() { return sfxOn; },
    setVolume(v) { volume = Math.max(0, Math.min(1, v)); if (master) master.gain.setTargetAtTime(volume, ac.currentTime, .05); if (custom && !custom.gain) custom.el.volume = volume * .8; },
    get volume() { return volume; },
    setCustom(slots) {
      customSlots = slots && Object.values(slots).some((a) => a.length) ? slots : null;
      if (customSlots) Object.values(customSlots).flat().forEach(preload);   // 지금 바로 내려받아 둔다
      curPhase = "__reset__"; applyPhase();
    },
    customCount() { return customSlots ? Object.values(customSlots).reduce((n, a) => n + a.length, 0) : 0; },
  };
})();
