(() => {
    // Follow one-finger drags directly, without giving the browser a fling velocity.
    const root = document.documentElement;
    const viewer = document.getElementById('artwork-viewer');
    const about = document.getElementById('aboutoverlay');
    const page = document.getElementById('page-content');
    const contained = page.dataset.scrollMode === 'contained';
    const scrollTarget = contained ? page : window;
    const movementThreshold = 8;
    let gesture = null;
    let pinching = false;
    let blockClickUntil = 0;
    let scrollFrame = 0;
    let pendingTop = null;
    let locks = 0;

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
        const scroller = contained ? page : document.scrollingElement || root;
        return Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    }

    function readPosition() {
        if (!contained) return { x: window.scrollX, y: window.scrollY };
        return { x: Math.max(0, page.scrollLeft),
            y: Math.max(0, Math.min(maximumScroll(), page.scrollTop)) };
    }

    function applyPosition(x, top) {
        if (contained) {
            page.scrollLeft = x;
            page.scrollTop = top;
        } else {
            window.scrollTo({ left: x, top, behavior: 'auto' });
        }
    }

    function commitScroll() {
        if (scrollFrame) cancelAnimationFrame(scrollFrame);
        scrollFrame = 0;
        const requested = pendingTop;
        pendingTop = null;
        if (requested !== null && !dialogOpen() && !locks) {
            const top = Math.max(0, Math.min(maximumScroll(), requested));
            if (gesture) gesture.top = top;
            const position = readPosition();
            if (top !== position.y) applyPosition(position.x, top);
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

    function writePosition(position) {
        cancelScroll();
        const top = Math.max(0, Math.min(maximumScroll(), position.y));
        applyPosition(position.x, top);
        if (gesture) gesture.top = top;
        syncGallery();
    }

    function refreshBounds() {
        const maximum = maximumScroll();
        if (gesture) gesture.top = Math.max(0, Math.min(maximum, gesture.top));
        if (pendingTop !== null) pendingTop = Math.max(0, Math.min(maximum, pendingTop));
        syncGallery();
    }

    function lock() {
        commitScroll();
        const position = readPosition();
        locks++;
        let released = false;
        return () => {
            if (released) return;
            released = true;
            locks--;
            if (!locks) writePosition(position);
        };
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
            lastY: touch.clientY, top: readPosition().y, moved: false };
    }, { capture: true, passive: true });

    document.addEventListener('touchmove', event => {
        if (pinching || isZoomed() || event.touches.length !== 1 || !gesture) return;
        const touch = [...event.touches].find(item => item.identifier === gesture.id);
        if (!touch) return;
        if (moveGesture(touch) && event.cancelable) event.preventDefault();
    }, { capture: true, passive: false });

    function moveGesture(touch) {
        if (!gesture.moved && Math.hypot(touch.clientX - gesture.x,
            touch.clientY - gesture.y) <= movementThreshold) return false;
        const delta = (gesture.moved ? gesture.lastY : gesture.y) - touch.clientY;
        gesture.lastY = touch.clientY;
        gesture.moved = true;
        if (dialogOpen() || locks) return true;
        // Accumulate from the requested position, not a potentially stale Safari
        // scroll read. Multiple input events share one visual frame.
        const maximum = maximumScroll();
        // Safari may change the viewport or content bounds while a finger is
        // held at an edge. Rebase BEFORE applying a reversal, not afterward.
        gesture.top = Math.max(0, Math.min(maximum, gesture.top));
        gesture.top = Math.max(0, Math.min(maximum, gesture.top + delta));
        if (delta) {
            pendingTop = gesture.top;
            if (!scrollFrame) scrollFrame = requestAnimationFrame(commitScroll);
        }
        return true;
    }

    for (const type of ['touchend', 'touchcancel']) {
        document.addEventListener(type, event => {
            if (type === 'touchend') {
                // Safari can coalesce a short flick's last point into touchend.
                const touch = gesture && !pinching && !isZoomed() &&
                    [...(event.changedTouches || [])].find(item => item.identifier === gesture.id);
                if (touch) moveGesture(touch);
                commitScroll();
            } else cancelScroll();
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
    scrollTarget.addEventListener('scroll', syncGallery, { passive: true });
    document.addEventListener('visibilitychange', reset);
    window.addEventListener('resize', () => { updateZoomMode(); refreshBounds(); }, { passive: true });
    window.visualViewport?.addEventListener('resize', updateZoomMode, { passive: true });
    updateZoomMode();
    if (contained) {
        // Only this variant opts out of Safari's document scroll view. Other
        // pages keep their existing window-based scrolling and viewer lock.
        window.mobileScroll = { readPosition, writePosition, eventTarget: page, lock };
        // Preserve wheel/trackpad access when this mobile variant is opened on
        // a computer. Native pinch-zoom wheel gestures remain browser-controlled.
        page.addEventListener('wheel', event => {
            if (event.ctrlKey || isZoomed()) return;
            if (event.cancelable) event.preventDefault();
            if (dialogOpen() || locks) return;
            const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? page.clientHeight : 1;
            pendingTop = Math.max(0, Math.min(maximumScroll(),
                (pendingTop ?? readPosition().y) + event.deltaY * unit));
            if (!scrollFrame) scrollFrame = requestAnimationFrame(commitScroll);
        }, { passive: false });
        if (window.ResizeObserver) {
            const observer = new ResizeObserver(refreshBounds);
            observer.observe(page);
            observer.observe(document.getElementById('editor-section'));
        }
    }
})();
