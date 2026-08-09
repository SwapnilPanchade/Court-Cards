/* Motion.dev interaction layer.
 * The app stays build-free: Motion's hybrid engine is loaded as an ESM module
 * from the official package CDN, while the game remains fully usable if the
 * optional animation module is unavailable or reduced motion is enabled.
 */
(async () => {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;

  try {
    const { animate, hover, press, inView, stagger } = await import("https://cdn.jsdelivr.net/npm/motion@latest/+esm");
    window.__courtMotion = { animate, stagger, ready: true };
    const spring = { type: "spring", stiffness: 360, damping: 26, mass: 0.65 };
    const softSpring = { type: "spring", stiffness: 180, damping: 24, mass: 0.8 };

    const animateIn = (elements, keyframes, options = {}) => {
      const list = typeof elements === "string" ? document.querySelectorAll(elements) : elements;
      if (!list?.length) return;
      animate(list, keyframes, { ...options, delay: options.delay ?? stagger(0.055) });
    };

    const entrance = () => {
      animateIn("#home .home-copy > *, #home .join-card > *", { opacity: [0, 1], y: [20, 0] }, { duration: 0.7, ease: [0.16, 1, 0.3, 1] });
      animateIn(".game-mode-card", { opacity: [0, 1], x: [-18, 0], scale: [0.97, 1] }, { duration: 0.55, delay: stagger(0.08, { startDelay: 0.18 }) });
    };

    const addTilt = (element, strength = 5) => {
      if (element.dataset.motionTilt) return;
      element.dataset.motionTilt = "true";
      let frame = 0;
      element.addEventListener("pointermove", (event) => {
        const rect = element.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width - 0.5) * strength;
        const y = ((event.clientY - rect.top) / rect.height - 0.5) * -strength;
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => animate(element, { rotateX: y, rotateY: x, scale: 1.012 }, softSpring));
      });
      element.addEventListener("pointerleave", () => animate(element, { rotateX: 0, rotateY: 0, scale: 1 }, softSpring));
    };

    const wireSurface = (root = document) => {
      root.querySelectorAll?.(".join-card, .panel, .home-table-preview").forEach(addTilt);
      root.querySelectorAll?.(".game-mode-card, .primary, .secondary, .control-toggle, .theme-choice, .avatar-choice").forEach((element) => {
        if (element.dataset.motionHover) return;
        element.dataset.motionHover = "true";
        hover(element, () => {
          const controls = animate(element, { y: -3, scale: 1.02 }, spring);
          return () => controls.stop();
        });
        press(element, () => {
          const controls = animate(element, { scale: 0.965 }, { ...spring, stiffness: 700, damping: 34 });
          return () => animate(element, { scale: 1 }, spring) || controls.stop();
        });
      });
    };

    const revealLiveSurface = () => {
      const liveGame = document.querySelector("#game:not(.hidden)");
      if (!liveGame || liveGame.dataset.motionRevealed) return;
      liveGame.dataset.motionRevealed = "true";
      animate(".game-header, .game-meta", { opacity: [0, 1], y: [-14, 0] }, { duration: 0.55, delay: stagger(0.07) });
      animate(".table-wrap", { opacity: [0, 1], scale: [0.96, 1] }, { ...softSpring, delay: 0.12 });
      animate(".table .seat", { opacity: [0, 1], scale: [0.82, 1] }, { duration: 0.55, delay: stagger(0.08, { startDelay: 0.2 }) });
    };

    entrance();
    wireSurface();
    inView(".home-table-preview", (element) => animate(element, { rotate: [-7, -3, -7], scale: [0.98, 1.04, 0.98] }, { duration: 6, repeat: Infinity, ease: "easeInOut" }));
    revealLiveSurface();

    const observer = new MutationObserver(() => {
      wireSurface();
      revealLiveSurface();
      document.querySelectorAll(".panel:not(.hidden):not([data-motion-revealed])").forEach((panel) => {
        panel.dataset.motionRevealed = "true";
        animate(panel, { opacity: [0, 1], y: [18, 0], scale: [0.98, 1] }, softSpring);
      });
    });
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });
  } catch (error) {
    document.documentElement.dataset.motionFallback = "css";
    console.warn("Optional Motion layer unavailable; CSS interactions remain active.", error);
  }
})();
