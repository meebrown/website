(() => {
    const overlay = document.getElementById('interaction-overlay');
    const canvas = document.createElement('canvas');
    canvas.id = 'ink-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'display:block;width:100%;height:100%;pointer-events:none;';
    overlay.appendChild(canvas);
    const context = canvas.getContext('2d');
    const movementThreshold = 8;
    let touch = null;
    let mouse = null;
    let pinching = false;
    let tap = null;
    let scrollAnchor = null;
    let lastScrollX = scrollX;
    let lastScrollY = scrollY;

    function point(input) {
        return { x: input.clientX, y: input.clientY };
    }

    function gesture(input, id) {
        const start = point(input);
        return { id, start, last: start, drawing: false, time: performance.now(),
            scrollX, scrollY };
    }

    function line(from, to) {
        if (from.x === to.x && from.y === to.y) return;
        context.beginPath();
        context.moveTo(from.x, from.y);
        context.lineTo(to.x, to.y);
        context.stroke();
    }

    function drawGesture(active, next) {
        const moved = Math.hypot(next.x - active.start.x, next.y - active.start.y);
        if (active.drawing || moved > movementThreshold) {
            line(active.drawing ? active.last : active.start, next);
            active.drawing = true;
        }
        active.last = next;
    }

    function candidate(active, next) {
        return active && !active.drawing &&
            Math.hypot(next.x - active.start.x, next.y - active.start.y) <= movementThreshold &&
            Math.hypot(scrollX - active.scrollX, scrollY - active.scrollY) < 5 &&
            performance.now() - active.time < 650 ? { ...next, time: performance.now() } : null;
    }

    function resetInput() {
        touch = mouse = tap = scrollAnchor = null;
        lastScrollX = scrollX;
        lastScrollY = scrollY;
    }

    function resize() {
        // One raster keeps memory bounded regardless of the number of strokes.
        // Resampling retains marks in their relative viewport positions.
        const previous = document.createElement('canvas');
        previous.width = canvas.width;
        previous.height = canvas.height;
        previous.getContext('2d').drawImage(canvas, 0, 0);
        const ratio = Math.min(devicePixelRatio || 1, 2, 2048 / innerWidth, 2048 / innerHeight);
        canvas.width = Math.max(1, Math.round(innerWidth * ratio));
        canvas.height = Math.max(1, Math.round(innerHeight * ratio));
        context.drawImage(previous, 0, 0, canvas.width, canvas.height);
        context.setTransform(canvas.width / innerWidth, 0, 0, canvas.height / innerHeight, 0, 0);
        context.strokeStyle = '#000';
        context.fillStyle = '#000';
        context.lineWidth = 2;
        context.lineCap = 'round';
        context.lineJoin = 'round';
        resetInput();
    }

    document.addEventListener('touchstart', event => {
        tap = null;
        mouse = null;
        if (event.touches.length > 1) {
            pinching = true;
            touch = scrollAnchor = null;
            return;
        }
        if (pinching || event.touches.length !== 1) return;
        touch = gesture(event.touches[0], event.touches[0].identifier);
        scrollAnchor = null;
        lastScrollX = scrollX;
        lastScrollY = scrollY;
    }, { passive: true });

    document.addEventListener('touchmove', event => {
        if (pinching || event.touches.length !== 1 || !touch) return;
        const input = [...event.touches].find(item => item.identifier === touch.id);
        if (input) drawGesture(touch, point(input));
    }, { passive: true });

    document.addEventListener('touchend', event => {
        if (pinching) {
            touch = tap = scrollAnchor = null;
            if (!event.touches.length) pinching = false;
            return;
        }
        if (!touch) return;
        const input = [...event.changedTouches].find(item => item.identifier === touch.id);
        if (!input) return;
        const next = point(input);
        tap = candidate(touch, next);
        scrollAnchor = touch.drawing ? next : null;
        touch = null;
    }, { passive: true });

    document.addEventListener('touchcancel', event => {
        resetInput();
        // A canceled pinch must not turn its remaining finger into a new stroke.
        pinching = event.touches.length > 0;
    }, { passive: true });

    document.addEventListener('pointerdown', event => {
        if (event.pointerType !== 'mouse') return;
        tap = null;
        if (!event.isPrimary || event.button !== 0) { mouse = null; return; }
        mouse = gesture(event, event.pointerId);
        scrollAnchor = null;
    }, { passive: true });

    document.addEventListener('pointermove', event => {
        if (mouse && event.pointerType === 'mouse' && event.pointerId === mouse.id) {
            if (!(event.buttons & 1)) { mouse = null; return; }
            drawGesture(mouse, point(event));
        }
    }, { passive: true });

    document.addEventListener('pointerup', event => {
        if (mouse && event.pointerType === 'mouse' && event.pointerId === mouse.id) {
            tap = candidate(mouse, point(event));
            mouse = null;
        }
    }, { passive: true });

    document.addEventListener('pointercancel', event => {
        if (event.pointerType === 'mouse') { mouse = tap = null; }
    }, { passive: true });

    document.addEventListener('pointerout', event => {
        if (event.pointerType === 'mouse' && !event.relatedTarget) mouse = tap = null;
    }, { passive: true });

    document.addEventListener('click', event => {
        const pending = tap;
        tap = null;
        if (!pending || pinching || !event.detail ||
            performance.now() - pending.time > 500 ||
            Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > 24) return;
        context.beginPath();
        context.arc(event.clientX, event.clientY, 3, 0, Math.PI * 2);
        context.fill();
    }, { capture: true, passive: true });

    window.addEventListener('wheel', event => {
        scrollAnchor = event.ctrlKey ? null : point(event);
    }, { passive: true });

    window.addEventListener('scroll', () => {
        const dx = scrollX - lastScrollX;
        const dy = scrollY - lastScrollY;
        lastScrollX = scrollX;
        lastScrollY = scrollY;
        if (touch || mouse || pinching || !scrollAnchor || document.hidden) return;
        const next = {
            x: Math.max(0, Math.min(innerWidth, scrollAnchor.x - dx)),
            y: Math.max(0, Math.min(innerHeight, scrollAnchor.y - dy))
        };
        line(scrollAnchor, next);
        scrollAnchor = next;
    }, { passive: true });

    window.addEventListener('resize', resize, { passive: true });
    window.addEventListener('blur', () => {
        resetInput();
        pinching = false;
    });
    document.addEventListener('visibilitychange', () => {
        resetInput();
        pinching = false;
    });
    resize();
})();
