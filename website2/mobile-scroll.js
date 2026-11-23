(() => {
    // Follow one-finger drags directly, without giving the browser a fling velocity.
    const root = document.documentElement;
    const viewer = document.getElementById('artwork-viewer');
    const about = document.getElementById('aboutoverlay');
    const movementThreshold = 8;
    let gesture = null;
    let pinching = false;
    let blockClickUntil = 0;
    let scrollFrame = 0;
    let pendingTop = null;

    // Drawing input uses this mode to ignore deferred native scroll events:
    // finger movement has already supplied every stroke.
    root.setAttribute('data-direct-scroll', '');

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

    function syncGallery() {
        window.galleryEffects?.syncScroll?.();
    }

    function maximumScroll() {
        const scroller = document.scrollingElement || root;
        return Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    }

    function commitScroll() {
        if (scrollFrame) cancelAnimationFrame(scrollFrame);
        scrollFrame = 0;
        const requested = pendingTop;
        pendingTop = null;
        if (requested !== null && !dialogOpen()) {
            const top = Math.max(0, Math.min(maximumScroll(), requested));
            if (gesture) gesture.top = top;
            if (top !== window.scrollY) {
                window.scrollTo({ left: window.scrollX, top, behavior: 'auto' });
            }
        }
        // Keep the opaque filtered copy aligned in this same scroll commit,
        // instead of waiting for a later effects frame to catch up.
        syncGallery();
    }

    function cancelScroll() {
        if (scrollFrame) cancelAnimationFrame(scrollFrame);
        scrollFrame = 0;
        pendingTop = null;
        syncGallery();
    }

    function reset() {
        cancelScroll();
        gesture = null;
        pinching = false;
        blockClickUntil = 0;
    }

    document.addEventListener('touchstart', event => {
        commitScroll();
        blockClickUntil = 0;
        if (event.touches.length > 1) {
            gesture = null;
            pinching = true;
            return;
        }
        if (pinching || isZoomed() || event.touches.length !== 1) return;
        const touch = event.touches[0];
        gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY,
            lastY: touch.clientY, top: window.scrollY, moved: false };
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
        // Accumulate from the requested position, not a potentially stale Safari
        // scroll read. Multiple input events share one visual frame.
        gesture.top = Math.max(0, Math.min(maximumScroll(), gesture.top + delta));
        pendingTop = gesture.top;
        if (!scrollFrame) scrollFrame = requestAnimationFrame(commitScroll);
    }, { capture: true, passive: false });

    for (const type of ['touchend', 'touchcancel']) {
        document.addEventListener(type, event => {
            if (type === 'touchend') commitScroll();
            else cancelScroll();
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
    window.addEventListener('scroll', syncGallery, { passive: true });
    document.addEventListener('visibilitychange', reset);
    window.addEventListener('resize', updateZoomMode, { passive: true });
    window.visualViewport?.addEventListener('resize', updateZoomMode, { passive: true });
    updateZoomMode();
})();
