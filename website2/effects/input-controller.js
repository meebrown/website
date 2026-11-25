(() => {
    const modules = window.GalleryEffectsModules ||= {};

    // Translate browser gestures into brush input and align interaction with
    // the displayed distortion. Field storage and rendering live elsewhere.
    modules.createInputController = ({ mouseInput, textLinkCursor, allContent,
        reducedMotion, isSuspended, sourcePoint, onSmudge, onTap, wake,
        hasSurface = () => true, captureTaps = false, manualTouchScroll = false,
        readPosition = () => ({ x: window.scrollX, y: window.scrollY }),
        scrollTarget = window }) => {
        let touch = null;
        let pinching = false;
        let gesture = null;
        let tap = null;
        let mousePoint = null;
        let cursorPoint = null;
        let lastScrollY = readPosition().y;
        let anchor = { x: innerWidth / 2, y: innerHeight / 2 };
        // Touch pages draw scroll strokes only after a real swipe or wheel input.
        let validScrollAnchor = false;

        function canStamp() {
            return !reducedMotion.matches && !document.hidden && !pinching && !isSuspended();
        }

        function smudge(x, y, dx, dy) {
            if (reducedMotion.matches || document.hidden || pinching) return;
            // Preserve every touch segment, including a turn or reversal in a swipe.
            if (dx || dy) onSmudge(x, y, dx, dy);
        }

        function trackTouch(point, drawing = false) {
            return { id: point.identifier, x: point.clientX, y: point.clientY, drawing };
        }

        function reset() {
            touch = gesture = tap = null;
            mousePoint = null;
            lastScrollY = readPosition().y;
            anchor = { x: innerWidth / 2, y: innerHeight / 2 };
            validScrollAnchor = false;
        }

        function updateCursor() {
            if (!textLinkCursor) return;
            // Cursor feedback follows the same displaced link as click targeting.
            const point = cursorPoint && (hasSurface() && !isSuspended() ?
                sourcePoint(cursorPoint.x, cursorPoint.y) : cursorPoint);
            const hit = point && document.elementFromPoint(point.x, point.y);
            const link = hit && hit.closest('a[href]');
            document.documentElement.dataset.linkCursor = String(!!link && !!link.textContent.trim());
        }

        // Passive touch tracking lets the browser retain native scrolling and pinch zoom.
        document.addEventListener('touchstart', event => {
            if (!mouseInput) validScrollAnchor = false;
            if (event.touches.length > 1) {
                reset();
                pinching = true;
            }
            touch = event.touches.length === 1 ? trackTouch(event.touches[0]) : null;
        }, { passive: true });
        document.addEventListener('touchmove', event => {
            if (pinching || event.touches.length !== 1) { touch = null; return; }
            const point = event.touches[0];
            const dx = touch ? point.clientX - touch.x : 0;
            const dy = touch ? point.clientY - touch.y : 0;
            const drawing = !!touch && (touch.drawing || dx !== 0 || dy !== 0);
            if (touch) smudge(point.clientX, point.clientY, dx, dy);
            if (!mouseInput) validScrollAnchor = true;
            touch = anchor = trackTouch(point, drawing);
        }, { passive: true });
        for (const name of ['touchend', 'touchcancel']) {
            document.addEventListener(name, event => {
                if (name === 'touchend' && !mouseInput && manualTouchScroll && !pinching && touch) {
                    const point = [...(event.changedTouches || [])].find(item => item.identifier === touch.id);
                    if (point) {
                        const dx = point.clientX - touch.x, dy = point.clientY - touch.y;
                        // Safari may omit a fast swipe's last touchmove. Continue
                        // an existing stroke, or require a drag-sized final gap.
                        if ((dx || dy) && (touch.drawing || dx * dx + dy * dy > 64)) {
                            smudge(point.clientX, point.clientY, dx, dy);
                        }
                    }
                }
                if (!mouseInput && manualTouchScroll) {
                    // Direct scrolling already stamped this movement in touchmove.
                    // Consume any scroll event queued just before the finger lifted.
                    validScrollAnchor = false;
                    lastScrollY = readPosition().y;
                }
                touch = null;
                if (name === 'touchcancel' && !mouseInput) validScrollAnchor = false;
                if (!event.touches.length) pinching = false;
            }, { passive: true });
        }
        window.addEventListener('wheel', event => {
            anchor = { x: event.clientX, y: event.clientY };
            if (!mouseInput) validScrollAnchor = !event.ctrlKey;
        }, { passive: true });
        scrollTarget.addEventListener('scroll', () => {
            const scrollY = readPosition().y;
            const delta = scrollY - lastScrollY;
            lastScrollY = scrollY;
            // touchmove already supplies the finger's direction; scroll also covers momentum.
            if (!touch && delta && (mouseInput || validScrollAnchor)) {
                smudge(anchor.x, anchor.y, 0, -delta);
            }
            wake();
        }, { passive: true });

        document.addEventListener('pointerdown', event => {
            tap = null;
            if (isSuspended()) { gesture = null; return; }
            if (!event.isPrimary || event.button !== 0) { gesture = null; return; }
            gesture = { id: event.pointerId, x: event.clientX, y: event.clientY,
                start: performance.now(), moved: false, scrollY: readPosition().y };
        }, { passive: true });
        document.addEventListener('pointermove', event => {
            if (textLinkCursor && event.pointerType === 'mouse') {
                cursorPoint = { x: event.clientX, y: event.clientY };
                wake();
            }
            if (isSuspended()) { mousePoint = null; return; }
            if (mouseInput && event.pointerType === 'mouse') {
                const previous = mousePoint;
                mousePoint = { x: event.clientX, y: event.clientY };
                if (previous) {
                    const dx = mousePoint.x - previous.x, dy = mousePoint.y - previous.y;
                    // Interpolate fast moves so the narrower brush leaves a continuous path.
                    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 12));
                    for (let step = 1; step <= steps; step++) {
                        smudge(previous.x + dx * step / steps, previous.y + dy * step / steps,
                            dx / steps, dy / steps);
                    }
                }
                wake();
            }
            if (gesture && event.pointerId === gesture.id &&
                Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 10) {
                gesture.moved = true;
            }
        }, { passive: true });
        document.addEventListener('pointerout', event => {
            if (!event.relatedTarget && textLinkCursor) { cursorPoint = null; wake(); }
            if (mouseInput) {
                if (!event.relatedTarget) mousePoint = null;
                wake();
            }
        }, { passive: true });
        document.addEventListener('pointerover', () => { if (mouseInput) wake(); }, { passive: true });
        window.addEventListener('blur', () => { mousePoint = null; reset(); wake(); });
        document.addEventListener('pointercancel', () => { gesture = tap = null; }, { passive: true });
        document.addEventListener('pointerup', event => {
            if (gesture && event.pointerId === gesture.id && !gesture.moved &&
                Math.abs(readPosition().y - gesture.scrollY) < 5 &&
                performance.now() - gesture.start < 600) {
                tap = { x: event.clientX, y: event.clientY, time: performance.now() };
            }
            gesture = null;
        }, { passive: true });
        document.addEventListener('click', event => {
            if (captureTaps && canStamp() && event.detail > 0 && tap &&
                performance.now() - tap.time < 450) {
                // Touch overlays may stop propagation before the document's
                // bubble listener. Leave a fallback that consumes only this tap.
                const pending = tap;
                queueMicrotask(() => {
                    if (tap !== pending) return;
                    tap = null;
                    onTap(pending.x, pending.y);
                });
            }
            if (isSuspended() || !hasSurface() || reducedMotion.matches || !tap || event.detail === 0) return;
            // Controls above the glass use their actual, undistorted hit targets.
            if (event.target.closest('[data-effects-clean-control]')) return;
            // Keep hit targets aligned with the permanently warped controls.
            const point = sourcePoint(event.clientX, event.clientY);
            const source = document.elementFromPoint(point.x, point.y);
            const selector = 'a, button, [onclick]';
            const target = source && source.closest(selector);
            const originalTarget = event.target.closest(selector);
            if ((target && target !== originalTarget) || (allContent && originalTarget && !target)) {
                event.preventDefault();
                event.stopImmediatePropagation();
                const point = tap;
                tap = null;
                if (target) target.click();
                onTap(point.x, point.y);
            }
        }, true);
        // Bubble after the gallery's click handlers so an opened panel is immediately mirrored.
        document.addEventListener('click', event => {
            if (!reducedMotion.matches && !pinching && event.detail > 0 && tap &&
                performance.now() - tap.time < 450) onTap(tap.x, tap.y);
            tap = null;
        });
        document.addEventListener('visibilitychange', () => {
            reset();
            pinching = false;
        });

        return { reset, getMousePoint: () => mousePoint, updateCursor, canStamp };
    };
})();
