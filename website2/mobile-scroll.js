(() => {
    // Follow one-finger drags directly, without giving the browser a fling velocity.
    const root = document.documentElement;
    const viewer = document.getElementById('artwork-viewer');
    const about = document.getElementById('aboutoverlay');
    const movementThreshold = 8;
    let gesture = null;
    let pinching = false;
    let blockClickUntil = 0;

    function isZoomed() {
        return (window.visualViewport?.scale || 1) > 1.01;
    }

    function updateZoomMode() {
        // Keep native panning available when the user has magnified the page.
        root.toggleAttribute('data-scroll-zoomed', isZoomed());
    }

    function dialogOpen() {
        return !viewer.hidden || about.getAttribute('aria-hidden') === 'false';
    }

    function reset() {
        gesture = null;
        pinching = false;
        blockClickUntil = 0;
    }

    document.addEventListener('touchstart', event => {
        blockClickUntil = 0;
        if (event.touches.length > 1) {
            gesture = null;
            pinching = true;
            return;
        }
        if (pinching || isZoomed() || event.touches.length !== 1) return;
        const touch = event.touches[0];
        gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY,
            lastY: touch.clientY, moved: false };
    }, { capture: true, passive: true });

    document.addEventListener('touchmove', event => {
        if (pinching || isZoomed() || event.touches.length !== 1 || !gesture) return;
        const touch = [...event.touches].find(item => item.identifier === gesture.id);
        if (!touch) return;
        if (!gesture.moved && Math.hypot(touch.clientX - gesture.x,
            touch.clientY - gesture.y) <= movementThreshold) return;
        // Events still reach the ink/distortion handlers; only native panning stops.
        if (event.cancelable) event.preventDefault();
        const delta = (gesture.moved ? gesture.lastY : gesture.y) - touch.clientY;
        gesture.lastY = touch.clientY;
        gesture.moved = true;
        if (dialogOpen()) return;
        const scroller = document.scrollingElement || root;
        const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        const top = Math.max(0, Math.min(maximum, window.scrollY + delta));
        window.scrollTo({ left: window.scrollX, top, behavior: 'auto' });
    }, { capture: true, passive: false });

    for (const type of ['touchend', 'touchcancel']) {
        document.addEventListener(type, event => {
            if (gesture?.moved || pinching) blockClickUntil = performance.now() + 800;
            gesture = null;
            if (type === 'touchcancel') pinching = event.touches.length > 0;
            else if (!event.touches.length) pinching = false;
        }, { capture: true, passive: true });
    }

    // A prevented pan can still produce a compatibility click in some browsers.
    // Register before the drawing and viewer handlers so a swipe cannot open art.
    document.addEventListener('click', event => {
        if (!event.detail || performance.now() >= blockClickUntil) return;
        blockClickUntil = 0;
        event.preventDefault();
        event.stopImmediatePropagation();
    }, true);

    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', reset);
    window.addEventListener('resize', updateZoomMode, { passive: true });
    window.visualViewport?.addEventListener('resize', updateZoomMode, { passive: true });
    updateZoomMode();
})();
