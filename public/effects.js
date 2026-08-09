(function installGameEffects(global) {
  "use strict";

  const THEME_NAMES = ["noir", "comic", "neon", "adda", "gully", "atelier"];
  const THEME_CLASSES = THEME_NAMES.map((name) => `game-effects--theme-${name}`);
  const INTENSITY_PRESETS = {
    off: 0,
    low: 0.4,
    medium: 0.7,
    high: 1,
    max: 1
  };

  const THEMES = {
    noir: {
      palette: ["#f5e7c8", "#d94b3d", "#7c1818", "#121212", "#d7b56d"],
      accent: "#d94b3d",
      card: "PLAY",
      cut: "HUKUM CUT",
      aceCut: "ACE OVERRULED",
      trick: "TRICK SECURED",
      round: "DEAL CLOSED",
      court: "COURT DECLARED",
      match: "MATCH CLOSED",
      symbols: { card: "◆", cut: "✦", trick: "♠", round: "◇", court: "♛", match: "♛" }
    },
    comic: {
      palette: ["#ffe352", "#ff4f64", "#36d7ff", "#7a5cff", "#ffffff"],
      accent: "#ffe352",
      card: "FLIP!",
      cut: "CHOP!",
      aceCut: "ACE SMASH!",
      trick: "TRICK TAKEN!",
      round: "ROUND WON!",
      court: "COURT!",
      match: "KABOOM! CHAMPIONS!",
      symbols: { card: "✦", cut: "⚡", trick: "★", round: "!", court: "♛", match: "★" }
    },
    neon: {
      palette: ["#00f5ff", "#ff3df2", "#8fff4f", "#805cff", "#f5fbff"],
      accent: "#00f5ff",
      card: "CARD PULSE",
      cut: "HUKUM OVERRIDE",
      aceCut: "ACE OVERRIDE",
      trick: "GRID CAPTURED",
      round: "SECTOR WON",
      court: "NEON COURT",
      match: "SYSTEM VICTORY",
      symbols: { card: "◇", cut: "⌁", trick: "◈", round: "△", court: "♛", match: "✦" }
    },
    adda: {
      palette: ["#ffca45", "#e95635", "#3fbf9a", "#f8eed5", "#7a2f21"],
      accent: "#ffca45",
      card: "CHALO!",
      cut: "HUKUM CUT!",
      aceCut: "EKKA KAAT DIYA!",
      trick: "BAAZI APNI!",
      round: "DEAL APNI!",
      court: "COURT LAG GAYA!",
      match: "MEHFIL JEET LI!",
      symbols: { card: "♦", cut: "✦", trick: "♠", round: "●", court: "♛", match: "★" }
    },
    gully: {
      palette: ["#ff7a18", "#18c6b4", "#f4e44d", "#ef335d", "#f7f2df"],
      accent: "#ff7a18",
      card: "CHAL!",
      cut: "SCENE PALAT!",
      aceCut: "EKKA DOWN!",
      trick: "TRICK APNA!",
      round: "ROUND APNA!",
      court: "COURT MAAR DI!",
      match: "GAME APNA!",
      symbols: { card: "✦", cut: "⚡", trick: "♠", round: "●", court: "♛", match: "★" }
    },
    atelier: {
      palette: ["#f5ead1", "#d8aa55", "#1c6a59", "#244b7a", "#171511"],
      accent: "#d8aa55",
      card: "PLAY",
      cut: "HUKUM RISES",
      aceCut: "EKKA OVERRULED",
      trick: "TRICK LOCKED",
      round: "ATELIER WON",
      court: "COURT CRAFTED",
      match: "MASTER OF THE TABLE",
      symbols: { card: "PLAY", cut: "CUT", trick: "WIN", round: "HAND", court: "COURT", match: "MATCH" }
    }
  };

  const STREAK_LEVELS = {
    1: { name: "spark", label: "SPARK / POP" },
    2: { name: "fire", label: "FIRE TRAIL" },
    3: { name: "fusion", label: "LIGHTNING FUSION" },
    4: { name: "inferno", label: "CROWN INFERNO" }
  };

  const WIN_EFFECT_TYPES = new Set(["trick-win", "round-win", "court-win", "match-win"]);
  const CELEBRATIONS = [
    {
      id: "chhapaak",
      title: "CHHAPAAK!",
      symbol: "✺",
      accent: "#48dff5",
      accent2: "#ff5c83",
      palette: ["#48dff5", "#bff8ff", "#ff5c83", "#16697a", "#ffffff"],
      tone: { type: "sine", ratio: 0.92 }
    },
    {
      id: "phaa",
      title: "PHAA!",
      symbol: "✹",
      accent: "#ffcf3d",
      accent2: "#ff5a2c",
      palette: ["#fff0a8", "#ffcf3d", "#ff8a2c", "#ff395d", "#ffffff"],
      tone: { type: "triangle", ratio: 1.08 }
    },
    {
      id: "systum",
      title: "SYSTUM!",
      symbol: "⚡",
      accent: "#9dff43",
      accent2: "#8d5cff",
      palette: ["#9dff43", "#43f5ff", "#8d5cff", "#f2ffdf", "#17122d"],
      tone: { type: "square", ratio: 0.82 }
    },
    {
      id: "kya-baat",
      title: "KYA BAAT!",
      symbol: "★",
      accent: "#ff78ce",
      accent2: "#ffd85a",
      palette: ["#ff78ce", "#ffd85a", "#8d66ff", "#fff5d5", "#4d1747"],
      tone: { type: "triangle", ratio: 1.2 }
    }
  ];

  const state = {
    initialized: false,
    themeGetter: null,
    root: null,
    stage: null,
    reducedMotionQuery: null,
    reducedMotion: false,
    intensity: 0.8,
    muted: false,
    effectSequence: 0,
    lastCelebrationId: null,
    activeEffects: new Map(),
    timers: new Set(),
    audio: {
      context: null,
      master: null,
      unlocked: false,
      active: null,
      sequence: 0
    }
  };

  function normalizeTheme(value) {
    const candidate = typeof value === "object" && value
      ? value.tableTheme || value.theme || value.name || value.id
      : value;
    const name = String(candidate || "").trim().toLowerCase();
    return THEME_NAMES.includes(name) ? name : "noir";
  }

  function currentTheme() {
    let requested;
    try {
      requested = typeof state.themeGetter === "function" ? state.themeGetter() : null;
    } catch (_) {
      requested = null;
    }
    if (!requested) {
      requested = document.body?.dataset.tableTheme
        || document.documentElement?.dataset.tableTheme
        || document.body?.dataset.theme
        || document.documentElement?.dataset.theme;
    }
    return normalizeTheme(requested);
  }

  function ensureChild(parent, className) {
    let child = parent.querySelector(`:scope > .${className}`);
    if (!child) {
      child = document.createElement("div");
      child.className = className;
      child.setAttribute("aria-hidden", "true");
      parent.appendChild(child);
    }
    return child;
  }

  function ensureRoot() {
    if (state.root?.isConnected && state.stage?.isConnected) return state.root;
    if (!document.body) return null;

    const existing = document.getElementById("game-effects-root");
    state.root = existing || document.createElement("div");
    state.root.id = "game-effects-root";
    state.root.classList.add("game-effects-root");
    state.root.setAttribute("aria-hidden", "true");
    state.root.style.position = "fixed";
    state.root.style.inset = "0";
    state.root.style.zIndex = "2147483000";
    state.root.style.pointerEvents = "none";
    state.root.style.overflow = "hidden";

    state.stage = ensureChild(state.root, "game-effects-stage");
    state.stage.style.position = "absolute";
    state.stage.style.inset = "0";
    state.stage.style.pointerEvents = "none";

    if (!existing) document.body.appendChild(state.root);
    syncRootState();
    return state.root;
  }

  function syncRootState() {
    if (!state.root) return;
    const theme = currentTheme();
    state.root.classList.remove(...THEME_CLASSES);
    state.root.classList.add(`game-effects--theme-${theme}`);
    state.root.classList.toggle("game-effects--reduced-motion", state.reducedMotion);
    state.root.classList.toggle("game-effects--muted", state.muted);
    state.root.dataset.theme = theme;
    state.root.dataset.intensity = intensityName(state.intensity);
    state.root.style.setProperty("--game-effects-intensity", String(state.intensity));
  }

  function intensityName(value) {
    if (value <= 0) return "off";
    if (value < 0.55) return "low";
    if (value < 0.85) return "medium";
    return "high";
  }

  function schedule(callback, delay) {
    const timer = global.setTimeout(() => {
      state.timers.delete(timer);
      callback();
    }, Math.max(0, delay));
    state.timers.add(timer);
    return timer;
  }

  function cancelTimer(timer) {
    if (!timer) return;
    global.clearTimeout(timer);
    state.timers.delete(timer);
  }

  function normalizeIntensity(value) {
    if (typeof value === "string" && value.toLowerCase() in INTENSITY_PRESETS) {
      return INTENSITY_PRESETS[value.toLowerCase()];
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.min(1, Math.max(0, numeric)) : state.intensity;
  }

  function normalizeTeam(team) {
    const value = String(team ?? "").trim().toLowerCase();
    if (team === 1 || team === true || value === "1" || value === "b" || value === "team b") return "b";
    return "a";
  }

  function normalizeStreak(streak) {
    const value = Math.floor(Number(streak));
    return Number.isFinite(value) && value > 0 ? value : 1;
  }

  function streakLevel(streak) {
    return Math.min(4, normalizeStreak(streak));
  }

  function celebrationTier(type) {
    if (type === "trick-win") return "small";
    if (type === "round-win" || type === "court-win") return "medium";
    if (type === "match-win") return "max";
    return null;
  }

  function normalizeCelebration(value) {
    const requested = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z]+/g, "-")
      .replace(/^-|-$/g, "");
    return CELEBRATIONS.find((celebration) => celebration.id === requested) || null;
  }

  function selectCelebration(payload = {}) {
    const requested = normalizeCelebration(payload.celebration || payload.callout);
    if (requested) {
      state.lastCelebrationId = requested.id;
      return requested;
    }

    const choices = CELEBRATIONS.filter((celebration) => celebration.id !== state.lastCelebrationId);
    const pool = choices.length ? choices : CELEBRATIONS;
    const selected = pool[Math.floor(Math.random() * pool.length)] || CELEBRATIONS[0];
    state.lastCelebrationId = selected.id;
    return selected;
  }

  function resolveOrigin(payload) {
    const source = payload?.element || payload?.cardElement || payload?.target;
    if (source?.getBoundingClientRect) {
      const rect = source.getBoundingClientRect();
      return {
        x: Math.min(1, Math.max(0, (rect.left + rect.width / 2) / Math.max(1, global.innerWidth))),
        y: Math.min(1, Math.max(0, (rect.top + rect.height / 2) / Math.max(1, global.innerHeight)))
      };
    }

    const origin = payload?.origin;
    if (origin && Number.isFinite(Number(origin.x)) && Number.isFinite(Number(origin.y))) {
      const x = Number(origin.x);
      const y = Number(origin.y);
      return {
        x: Math.min(1, Math.max(0, x > 1 ? x / Math.max(1, global.innerWidth) : x)),
        y: Math.min(1, Math.max(0, y > 1 ? y / Math.max(1, global.innerHeight) : y))
      };
    }
    return { x: 0.5, y: 0.48 };
  }

  function lightningPath(start, end, depth = 6, spread = 72) {
    let points = [start, end];
    for (let level = 0; level < depth; level += 1) {
      const next = [points[0]];
      for (let index = 0; index < points.length - 1; index += 1) {
        const a = points[index];
        const b = points[index + 1];
        const midpoint = {
          x: (a.x + b.x) / 2 + (Math.random() - 0.5) * spread,
          y: (a.y + b.y) / 2 + (Math.random() - 0.5) * spread * 0.34
        };
        next.push(midpoint, b);
      }
      points = next;
      spread *= 0.52;
    }
    return points;
  }

  function strokeLightning(context, points, color, width, blur) {
    context.save();
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = color;
    context.lineWidth = width;
    context.shadowColor = color;
    context.shadowBlur = blur;
    context.stroke();
    context.restore();
  }

  function createLightningCanvas(effect, origin, palette, force = false) {
    if (state.reducedMotion || (!force && state.intensity < 0.68)) return null;
    const canvas = document.createElement("canvas");
    const ratio = Math.min(2, global.devicePixelRatio || 1);
    const width = Math.max(1, global.innerWidth);
    const height = Math.max(1, global.innerHeight);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.className = "game-effect__lightning-canvas";
    canvas.style.left = `${-origin.x * width}px`;
    canvas.style.top = `${-origin.y * height}px`;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const context = canvas.getContext("2d");
    context.scale(ratio, ratio);
    const strike = { x: origin.x * width, y: origin.y * height };
    const starts = [
      { x: strike.x - width * 0.17, y: -18 },
      { x: strike.x + width * 0.14, y: -8 }
    ];
    starts.forEach((start, boltIndex) => {
      const main = lightningPath(start, strike, 6, Math.min(110, width * 0.16));
      strokeLightning(context, main, boltIndex ? palette[1] || "#77d6ff" : "#8ce7ff", 8, 30);
      strokeLightning(context, main, "rgba(255,255,255,.98)", 2.2, 12);
      [12, 28, 44].forEach((pointIndex, branchIndex) => {
        const from = main[Math.min(pointIndex, main.length - 2)];
        const direction = (branchIndex + boltIndex) % 2 ? -1 : 1;
        const branchEnd = {
          x: from.x + direction * (42 + Math.random() * 92),
          y: from.y + 42 + Math.random() * 72
        };
        const branch = lightningPath(from, branchEnd, 4, 34);
        strokeLightning(context, branch, "rgba(184,234,255,.9)", 1.2, 10);
      });
    });
    effect.appendChild(canvas);
    if (global.gsap?.timeline) {
      global.gsap.timeline()
        .fromTo(canvas, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.055 })
        .to(canvas, { autoAlpha: 0.12, duration: 0.055 })
        .to(canvas, { autoAlpha: 1, duration: 0.04 })
        .to(canvas, { autoAlpha: 0, duration: 0.32, ease: "power2.out" });
    } else canvas.animate([{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 0.1, offset: 0.24 }, { opacity: 1, offset: 0.34 }, { opacity: 0 }], { duration: 560, easing: "ease-out", fill: "forwards" });
    return canvas;
  }

  function createTextElement(tag, className, text) {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
  }

  function cloneAtelierCard(source, className) {
    if (!source?.isConnected) return null;
    const rect = source.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const clone = source.cloneNode(true);
    clone.removeAttribute("id");
    clone.removeAttribute("data-seat");
    clone.removeAttribute("data-owner");
    clone.classList.remove("played-card", "playable", "dealt");
    clone.classList.add("atelier-cut-card", ...String(className).split(/\s+/).filter(Boolean));
    clone.setAttribute("aria-hidden", "true");
    clone.tabIndex = -1;
    if ("disabled" in clone) clone.disabled = true;
    clone.style.width = rect.width + "px";
    clone.style.height = rect.height + "px";
    return { node: clone, rect };
  }

  function createAtelierCutScene(effect, payload, origin) {
    if (currentTheme() !== "atelier" || state.reducedMotion || !payload?.aceCut) return null;
    const aceLeft = cloneAtelierCard(payload.aceElement, "atelier-ace-fragment atelier-ace-fragment--left");
    const aceRight = cloneAtelierCard(payload.aceElement, "atelier-ace-fragment atelier-ace-fragment--right");
    const hukum = cloneAtelierCard(payload.element, "atelier-hukum-rise");
    if (!aceLeft || !aceRight || !hukum) return null;

    const anchorX = origin.x * global.innerWidth;
    const anchorY = origin.y * global.innerHeight;
    const aceX = aceLeft.rect.left + aceLeft.rect.width / 2 - anchorX;
    const aceY = aceLeft.rect.top + aceLeft.rect.height / 2 - anchorY;
    const hukumX = hukum.rect.left + hukum.rect.width / 2 - anchorX;
    const hukumY = hukum.rect.top + hukum.rect.height / 2 - anchorY;
    const scene = document.createElement("div");
    scene.className = "atelier-cut-scene";
    scene.style.setProperty("--atelier-ace-x", aceX + "px");
    scene.style.setProperty("--atelier-ace-y", aceY + "px");
    scene.style.setProperty("--atelier-hukum-x", hukumX + "px");
    scene.style.setProperty("--atelier-hukum-y", hukumY + "px");
    scene.appendChild(aceLeft.node);
    scene.appendChild(aceRight.node);
    scene.appendChild(hukum.node);

    const cutLine = document.createElement("span");
    cutLine.className = "atelier-cut-line";
    cutLine.setAttribute("aria-hidden", "true");
    scene.appendChild(cutLine);
    effect.appendChild(scene);

    const hiddenSources = [payload.aceElement, payload.element]
      .filter(Boolean)
      .map((element) => ({ element, opacity: element.style.opacity }));
    hiddenSources.forEach(({ element }) => { element.style.opacity = "0"; });
    return {
      node: scene,
      cleanup() {
        hiddenSources.forEach(({ element, opacity }) => { element.style.opacity = opacity; });
      }
    };
  }

  function createEffect(type, payload, copy, options = {}) {
    if (state.intensity <= 0 || !ensureRoot()) return null;

    syncRootState();
    pruneEffects(4);

    const themeName = currentTheme();
    const theme = THEMES[themeName];
    const streak = normalizeStreak(payload?.streak);
    const level = streakLevel(streak);
    const levelData = STREAK_LEVELS[level];
    const team = normalizeTeam(payload?.team);
    const local = payload?.isLocal !== false;
    const origin = resolveOrigin(payload);
    const celebration = options.celebration || null;
    const tier = celebrationTier(type);
    const restrainedAtelier = themeName === "atelier";
    const id = `game-effect-${++state.effectSequence}`;

    const effect = document.createElement("div");
    effect.id = id;
    effect.className = [
      "game-effect",
      `game-effect--${type}`,
      `game-effect--theme-${themeName}`,
      `game-effect--team-${team}`,
      `game-effect--level-${level}`,
      `game-effect--${levelData.name}`,
      tier ? `game-effect--celebration-${tier}` : "",
      celebration ? `game-effect--callout-${celebration.id}` : "",
      local ? "game-effect--local" : "game-effect--opponent",
      state.reducedMotion ? "game-effect--reduced-motion" : ""
    ].filter(Boolean).join(" ");
    effect.dataset.effect = type;
    effect.dataset.theme = themeName;
    effect.dataset.team = team.toUpperCase();
    effect.dataset.streak = String(streak);
    effect.dataset.streakLevel = levelData.name;
    if (tier) effect.dataset.celebrationTier = tier;
    if (celebration) effect.dataset.celebration = celebration.id;
    effect.setAttribute("aria-hidden", "true");
    effect.style.position = "absolute";
    effect.style.left = `${origin.x * 100}%`;
    effect.style.top = `${origin.y * 100}%`;
    effect.style.transform = "translate(-50%, -50%)";
    effect.style.setProperty("--game-effect-x", `${origin.x * 100}%`);
    effect.style.setProperty("--game-effect-y", `${origin.y * 100}%`);
    effect.style.setProperty("--game-effect-accent", theme.accent);
    if (celebration) {
      effect.style.setProperty("--accent", celebration.accent);
      effect.style.setProperty("--accent-2", celebration.accent2);
      effect.style.setProperty("--celebration-accent", celebration.accent);
      effect.style.setProperty("--celebration-accent-2", celebration.accent2);
    }

    if (!state.reducedMotion) {
      const flash = document.createElement("div");
      flash.className = "game-effect__screen-flash";
      flash.style.setProperty("--game-effect-flash", celebration?.accent || theme.accent);
      effect.appendChild(flash);

      if (!restrainedAtelier) {
        const burst = document.createElement("div");
        burst.className = "game-effect__burst";
        effect.appendChild(burst);

        const ring = document.createElement("div");
        ring.className = "game-effect__ring";
        effect.appendChild(ring);
      }

      if (level >= 2 && !restrainedAtelier) {
        const trail = document.createElement("div");
        trail.className = "game-effect__fire-trail";
        effect.appendChild(trail);
      }
      if ((level >= 3 && !restrainedAtelier) || payload?.forceLightning) {
        createLightningCanvas(effect, origin, theme.palette, Boolean(payload?.forceLightning));
      }
      if (level >= 4 && !restrainedAtelier) {
        const inferno = document.createElement("div");
        inferno.className = "game-effect__inferno";
        effect.appendChild(inferno);
        effect.appendChild(createTextElement("span", "game-effect__crown", "♛"));
      }

      if (celebration) {
        const signature = document.createElement("div");
        signature.className = `game-effect__signature game-effect__signature--${celebration.id}`;
        effect.appendChild(signature);
      }
    }

    const atelierScene = themeName === "atelier" && type === "trump-cut" && payload?.aceCut
      ? createAtelierCutScene(effect, payload, origin)
      : null;

    const callout = document.createElement("div");
    callout.className = "game-effect__callout";
    const eyebrow = options.compact
      ? ""
      : themeName === "atelier" && type === "trump-cut"
        ? "ATELIER MECHANISM"
        : `${levelData.label}${streak > 1 ? ` · ${streak}×` : ""}`;
    if (eyebrow) callout.appendChild(createTextElement("span", "game-effect__eyebrow", eyebrow));
    callout.appendChild(createTextElement("span", "game-effect__symbol", copy.symbol));
    callout.appendChild(createTextElement("strong", "game-effect__title", copy.title));
    if (copy.subtitle) callout.appendChild(createTextElement("span", "game-effect__subtitle", copy.subtitle));
    effect.appendChild(callout);

    const palette = celebration
      ? [...celebration.palette.slice(0, 3), ...theme.palette.slice(0, 2)]
      : theme.palette;
    createParticles(effect, palette, level, type);
    state.stage.appendChild(effect);
    state.root.classList.add("game-effects--active");

    const record = { id, node: effect, timeline: null, animation: null, timer: null, cleanup: atelierScene?.cleanup || null };
    state.activeEffects.set(id, record);
    global.requestAnimationFrame(() => effect.isConnected && effect.classList.add("is-active"));
    animateEffect(record, options.duration || effectDuration(type));
    return { id, theme: themeName, team, level, origin, palette, celebration };
  }

  function createParticles(effect, palette, level, type) {
    if (state.reducedMotion || state.intensity < 0.25 || type === "card") return;
    if (currentTheme() === "atelier" && type === "trump-cut") return;
    const typeBase = {
      "trump-cut": 5,
      "trick-win": 4,
      "round-win": 10,
      "court-win": 14,
      "match-win": 22
    }[type] || 4;
    const base = typeBase + [0, 3, 7, 12, 18][level];
    const count = Math.max(2, Math.round(base * state.intensity));
    const particles = document.createElement("div");
    particles.className = "game-effect__particles";
    for (let index = 0; index < count; index += 1) {
      const particle = document.createElement("i");
      particle.className = "game-effect__particle";
      particle.style.setProperty("--game-particle-angle", `${Math.round(Math.random() * 360)}deg`);
      particle.style.setProperty("--game-particle-distance", `${Math.round(55 + Math.random() * (70 + level * 24))}px`);
      particle.style.setProperty("--game-particle-delay", `${Math.round(Math.random() * 130)}ms`);
      particle.style.setProperty("--game-particle-size", `${Math.round(3 + Math.random() * (3 + level))}px`);
      particle.style.setProperty("--game-particle-color", palette[index % palette.length]);
      particles.appendChild(particle);
    }
    effect.appendChild(particles);
  }

  function effectDuration(type) {
    if (type === "card") return 520;
    if (type === "trump-cut") return 1250;
    if (type === "trick-win") return 1250;
    if (type === "round-win" || type === "court-win") return 2200;
    return 3200;
  }

  function animateEffect(record, duration) {
    const effect = record.node;
    const callout = effect.querySelector(".game-effect__callout");
    const flash = effect.querySelector(".game-effect__screen-flash");
    const gsap = global.gsap;

    if (state.reducedMotion) {
      effect.style.opacity = "1";
      record.timer = schedule(() => finishEffect(record.id), Math.min(900, duration));
      return;
    }

    if (gsap?.timeline) {
      try {
        const atelierAceScene = effect.dataset.theme === "atelier"
          && effect.dataset.effect === "trump-cut"
          && effect.querySelector(".atelier-cut-scene");
        let timeline;
        timeline = gsap.timeline({
          onComplete: () => {
            record.timeline = null;
            finishEffect(record.id);
          }
        });
        record.timeline = timeline;
        timeline.fromTo(effect, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.08 });
        if (flash) {
          const flashLimit = { small: 0.18, medium: 0.4, max: 0.62 }[effect.dataset.celebrationTier] || 0.32;
          timeline.fromTo(flash, { autoAlpha: 0 }, { autoAlpha: Math.min(flashLimit, 0.1 + state.intensity * 0.42), duration: 0.08 }, 0)
            .to(flash, { autoAlpha: 0, duration: 0.3 }, 0.08);
        }
        if (callout) {
          timeline.fromTo(callout,
            { autoAlpha: 0, scale: 0.7, y: 18 },
            { autoAlpha: 1, scale: 1, y: 0, duration: 0.28, ease: "back.out(2)" },
            atelierAceScene ? 0.72 : 0.02
          );
          timeline.to(callout, { autoAlpha: 0, scale: 1.06, y: -16, duration: 0.28, ease: "power2.in" }, Math.max(0.45, duration / 1000 - 0.3));
        }
        timeline.to(effect, { autoAlpha: 0, duration: 0.12 }, Math.max(0.55, duration / 1000 - 0.12));
        return;
      } catch (_) {
        record.timeline = null;
      }
    }

    if (typeof effect.animate === "function") {
      const animation = effect.animate(
        [{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 1, offset: 0.76 }, { opacity: 0 }],
        { duration, easing: "ease-out", fill: "forwards" }
      );
      record.animation = animation;
      animation.finished.then(() => finishEffect(record.id)).catch(() => finishEffect(record.id));
      return;
    }

    effect.style.opacity = "1";
    record.timer = schedule(() => finishEffect(record.id), duration);
  }

  function finishEffect(id, killAnimation = false) {
    const record = state.activeEffects.get(id);
    if (!record) return;
    state.activeEffects.delete(id);
    cancelTimer(record.timer);
    if (killAnimation) {
      try { record.timeline?.kill(); } catch (_) { /* optional dependency */ }
      try { record.animation?.cancel(); } catch (_) { /* Web Animations fallback */ }
    }
    try { record.cleanup?.(); } catch (_) { /* DOM may already be gone after a trick resolves. */ }
    record.node?.remove();
    if (state.activeEffects.size === 0) state.root?.classList.remove("game-effects--active");
  }

  function pruneEffects(maximum) {
    while (state.activeEffects.size >= maximum) {
      const oldest = state.activeEffects.keys().next().value;
      finishEffect(oldest, true);
    }
  }

  function fireConfetti(type, effect, local) {
    if (!local || state.reducedMotion || state.intensity < 0.25 || typeof global.confetti !== "function") return;
    const { origin, palette, level } = effect;
    let baseCount = 0;
    if (type === "trump-cut") baseCount = 18;
    if (type === "trick-win") baseCount = 28;
    if (type === "round-win" || type === "court-win") baseCount = 70;
    if (type === "match-win") baseCount = 115;
    const particleCount = Math.max(8, Math.round((baseCount + level * 8) * state.intensity));
    const common = {
      colors: palette,
      disableForReducedMotion: true,
      origin,
      scalar: 0.65 + state.intensity * 0.35,
      ticks: type === "match-win" ? 170 : 125,
      zIndex: 2147483001
    };

    const launch = (options) => {
      try { global.confetti(options); } catch (_) { /* optional renderer */ }
    };
    launch({
        ...common,
        particleCount,
        spread: type === "match-win" ? 100 : 62 + level * 8,
        startVelocity: 18 + level * 6,
        shapes: level >= 3 ? ["circle", "square", "star"] : ["circle", "square"]
    });
    if (type === "match-win") {
      schedule(() => launch({ ...common, particleCount: Math.round(particleCount * 0.45), angle: 60, spread: 55, origin: { x: 0.04, y: 0.75 } }), 220);
      schedule(() => launch({ ...common, particleCount: Math.round(particleCount * 0.45), angle: 120, spread: 55, origin: { x: 0.96, y: 0.75 } }), 320);
    }
  }

  function audioPattern(kind, themeName, celebration = null) {
    const themeAudio = {
      noir: { type: "triangle", ratio: 0.84 },
      comic: { type: "square", ratio: 1.12 },
      neon: { type: "sawtooth", ratio: 1.28 },
      adda: { type: "triangle", ratio: 1 },
      gully: { type: "square", ratio: 0.92 },
      atelier: { type: "triangle", ratio: 0.78 }
    }[themeName];
    const patterns = {
      card: [[0, 0.045, 520, 720, 0.035]],
      cut: [[0, 0.08, 210, 620, 0.08], [0.09, 0.09, 620, 340, 0.065]],
      ace: [[0, 0.08, 180, 720, 0.1], [0.09, 0.08, 720, 980, 0.075], [0.18, 0.11, 980, 490, 0.09]],
      trick: [[0, 0.08, 330, 440, 0.06], [0.09, 0.1, 440, 660, 0.07]],
      round: [[0, 0.1, 330, 440, 0.075], [0.11, 0.1, 440, 550, 0.08], [0.22, 0.15, 550, 880, 0.09]],
      court: [[0, 0.1, 260, 520, 0.09], [0.11, 0.1, 520, 780, 0.085], [0.22, 0.18, 780, 1040, 0.1]],
      match: [[0, 0.11, 260, 390, 0.085], [0.12, 0.11, 390, 520, 0.09], [0.24, 0.11, 520, 780, 0.095], [0.36, 0.22, 780, 1040, 0.11]],
      loss: [[0, 0.16, 360, 250, 0.045], [0.17, 0.2, 250, 180, 0.035]]
    };
    return {
      type: celebration?.tone?.type || themeAudio.type,
      notes: (patterns[kind] || patterns.card).map(([offset, duration, start, end, volume]) => ({
        offset,
        duration,
        start: start * themeAudio.ratio * (celebration?.tone?.ratio || 1),
        end: end * themeAudio.ratio * (celebration?.tone?.ratio || 1),
        volume
      }))
    };
  }

  function stopActiveAudio(fadeSeconds = 0.025) {
    const audio = state.audio;
    const active = audio.active;
    if (!active || !audio.context) return;
    const now = audio.context.currentTime;
    try {
      active.bus.gain.cancelScheduledValues(now);
      active.bus.gain.setValueAtTime(Math.max(0.0001, active.bus.gain.value), now);
      active.bus.gain.exponentialRampToValueAtTime(0.0001, now + fadeSeconds);
    } catch (_) { /* AudioContext may already be closed. */ }
    active.oscillators.forEach((oscillator) => {
      try { oscillator.stop(now + fadeSeconds + 0.01); } catch (_) { /* already stopped */ }
    });
    state.audio.active = null;
  }

  function playSting(kind, priority, celebration = null) {
    const audio = state.audio;
    if (state.muted || state.intensity <= 0 || !audio.unlocked || !audio.context || !audio.master) return false;
    if (audio.context.state !== "running") return false;

    const contextNow = audio.context.currentTime;
    let startDelay = 0;
    if (audio.active && audio.active.endTime > contextNow) {
      if (priority <= audio.active.priority) return false;
      stopActiveAudio(0.025);
      startDelay = 0.04;
    }

    const pattern = audioPattern(kind, currentTheme(), celebration);
    const now = audio.context.currentTime + startDelay;
    const bus = audio.context.createGain();
    bus.gain.setValueAtTime(1, now);
    bus.connect(audio.master);
    const oscillators = [];
    let endTime = now;

    pattern.notes.forEach((note) => {
      const startAt = now + note.offset;
      const endAt = startAt + note.duration;
      const oscillator = audio.context.createOscillator();
      const envelope = audio.context.createGain();
      oscillator.type = pattern.type;
      oscillator.frequency.setValueAtTime(Math.max(30, note.start), startAt);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, note.end), endAt);
      envelope.gain.setValueAtTime(0.0001, startAt);
      envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, note.volume), startAt + Math.min(0.018, note.duration / 3));
      envelope.gain.exponentialRampToValueAtTime(0.0001, endAt);
      oscillator.connect(envelope);
      envelope.connect(bus);
      oscillator.start(startAt);
      oscillator.stop(endAt + 0.02);
      oscillators.push(oscillator);
      endTime = Math.max(endTime, endAt + 0.02);
    });

    const token = ++audio.sequence;
    audio.active = { token, priority, bus, oscillators, endTime };
    schedule(() => {
      if (audio.active?.token === token) audio.active = null;
      try { bus.disconnect(); } catch (_) { /* already disconnected */ }
    }, Math.ceil((endTime - now) * 1000) + 40);
    return true;
  }

  async function unlockAudio() {
    const AudioContext = global.AudioContext || global.webkitAudioContext;
    if (!AudioContext) return false;
    try {
      if (!state.audio.context) {
        state.audio.context = new AudioContext();
        state.audio.master = state.audio.context.createGain();
        state.audio.master.connect(state.audio.context.destination);
      }
      if (state.audio.context.state === "suspended") await state.audio.context.resume();

      const oscillator = state.audio.context.createOscillator();
      const gain = state.audio.context.createGain();
      const now = state.audio.context.currentTime;
      gain.gain.setValueAtTime(0.0001, now);
      oscillator.connect(gain);
      gain.connect(state.audio.master);
      oscillator.start(now);
      oscillator.stop(now + 0.01);
      state.audio.unlocked = state.audio.context.state === "running";
      updateMasterVolume();
      return state.audio.unlocked;
    } catch (_) {
      state.audio.unlocked = false;
      return false;
    }
  }

  function updateMasterVolume() {
    const audio = state.audio;
    if (!audio.master || !audio.context) return;
    const value = state.muted ? 0.0001 : Math.max(0.0001, 0.42 * state.intensity);
    const now = audio.context.currentTime;
    try {
      audio.master.gain.cancelScheduledValues(now);
      audio.master.gain.setTargetAtTime(value, now, 0.015);
    } catch (_) { /* AudioContext may be closing. */ }
  }

  function effectCopy(type, payload, celebration = null) {
    const theme = THEMES[currentTheme()];
    const team = normalizeTeam(payload?.team).toUpperCase();
    const teamLabel = `TEAM ${team}`;
    if (type === "card") return { title: theme.card, subtitle: "", symbol: theme.symbols.card };
    if (type === "trump-cut") return {
      title: payload?.aceCut ? theme.aceCut : theme.cut,
      subtitle: payload?.aceCut ? "ACE CUT WITH HUKUM" : "TRUMP TAKES THE TRICK",
      symbol: theme.symbols.cut
    };
    const winCopy = (outcome, symbol) => ({
      title: celebration?.title || outcome,
      subtitle: `${teamLabel} · ${outcome}`,
      symbol: celebration?.symbol || symbol
    });
    if (type === "trick-win") return winCopy(theme.trick, theme.symbols.trick);
    if (type === "court-win") return winCopy(theme.court, theme.symbols.court);
    if (type === "round-win") return winCopy(theme.round, theme.symbols.round);
    return winCopy(theme.match, theme.symbols.match);
  }

  function runEvent(type, payload = {}, options = {}) {
    const celebration = WIN_EFFECT_TYPES.has(type) && currentTheme() !== "atelier"
      ? selectCelebration(payload)
      : null;
    const effectOptions = celebration ? { ...options, celebration } : options;
    const copy = effectCopy(type, payload, celebration);
    const effect = createEffect(type, payload, copy, effectOptions);
    if (!effect) return false;

    const local = payload.isLocal !== false;
    if (type !== "card" && !(currentTheme() === "atelier" && type === "trump-cut")) fireConfetti(type, effect, local);
    const audioKind = local ? options.audio || type : "loss";
    playSting(audioKind, options.priority ?? 1, celebration);
    return effect.id;
  }

  function init(options = {}) {
    if (typeof options.getTheme === "function") state.themeGetter = options.getTheme;
    if (!state.reducedMotionQuery && typeof global.matchMedia === "function") {
      state.reducedMotionQuery = global.matchMedia("(prefers-reduced-motion: reduce)");
      state.reducedMotion = state.reducedMotionQuery.matches;
      const handleMotionChange = (event) => {
        state.reducedMotion = event.matches;
        syncRootState();
        if (event.matches) {
          Array.from(state.activeEffects.keys()).forEach((id) => finishEffect(id, true));
          try { global.confetti?.reset?.(); } catch (_) { /* optional renderer */ }
        }
      };
      if (state.reducedMotionQuery.addEventListener) state.reducedMotionQuery.addEventListener("change", handleMotionChange);
      else state.reducedMotionQuery.addListener?.(handleMotionChange);
    }
    if (!state.initialized) {
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) reset();
      });
      state.initialized = true;
    }
    if (!ensureRoot()) document.addEventListener("DOMContentLoaded", ensureRoot, { once: true });
    syncRootState();
    return api;
  }

  function setMuted(value = true) {
    state.muted = Boolean(value);
    if (state.muted) stopActiveAudio();
    updateMasterVolume();
    syncRootState();
    return state.muted;
  }

  function setIntensity(value) {
    state.intensity = normalizeIntensity(value);
    if (state.intensity <= 0) reset();
    updateMasterVolume();
    syncRootState();
    return state.intensity;
  }

  function onCardPlay(payload = {}) {
    // Atelier already moves the live card from the player's hand/seat into the
    // physical table. A second full-screen "PLAY" burst competes with that
    // motion and makes the premium table feel cheaper.
    if (currentTheme() === "atelier") return false;
    return runEvent("card", payload, { compact: true, duration: 520, audio: "card", priority: 0 });
  }

  function onTrumpCut(payload = {}) {
    const duration = currentTheme() === "atelier" && payload.aceCut ? 1850 : 1250;
    return runEvent("trump-cut", payload, { duration, audio: payload.aceCut ? "ace" : "cut", priority: 2 });
  }

  function onTrickWin(payload = {}) {
    return runEvent("trick-win", payload, { duration: 1250, audio: "trick", priority: 2 });
  }

  function onRoundWin(payload = {}) {
    const type = payload.court ? "court-win" : "round-win";
    return runEvent(type, payload, { duration: 2200, audio: payload.court ? "court" : "round", priority: 3 });
  }

  function onMatchWin(payload = {}) {
    return runEvent("match-win", payload, { duration: 3200, audio: "match", priority: 4 });
  }

  function reset() {
    state.timers.forEach((timer) => global.clearTimeout(timer));
    state.timers.clear();
    Array.from(state.activeEffects.keys()).forEach((id) => finishEffect(id, true));
    stopActiveAudio(0.015);
    try { global.confetti?.reset?.(); } catch (_) { /* optional renderer */ }
    state.root?.classList.remove("game-effects--active");
  }

  const api = Object.freeze({
    init,
    unlockAudio,
    setMuted,
    setIntensity,
    onCardPlay,
    onTrumpCut,
    onTrickWin,
    onRoundWin,
    onMatchWin,
    reset
  });

  global.GameEffects = api;
})(window);
