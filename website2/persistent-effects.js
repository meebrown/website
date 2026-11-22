(() => {
    const page = document.getElementById('page-content');
    const overlay = document.getElementById('interaction-overlay');
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const overlayIds = [...page.querySelectorAll('[id$="overlay"]')].map(element => element.id);
    const mouseInput = page.dataset.effectsInput === 'mouse';
    const textLinkCursor = page.dataset.cursorPolicy === 'text-links';
    const allContent = page.dataset.effectsScope === 'all';
    const svgNS = 'http://www.w3.org/2000/svg';
    const displacementScale = 80;
    let surface = null;
    let fieldX, fieldY, fieldWidth = 0, fieldHeight = 0;
    let viewportWidth = innerWidth, viewportHeight = innerHeight;
    let frame = 0;
    let dirty = false;
    let lastScrollY = window.scrollY;
    let anchor = { x: innerWidth / 2, y: innerHeight / 2 };
    let touch = null;
    let pinching = false;
    let gesture = null;
    let tap = null;
    let mousePoint = null;
    let cursorPoint = null;
    let suspended = false;
    let freezeVisibility = false;
    let effectFade = null;
    let visibilityGeneration = 0;
    const viewerAnimations = new Map();

    function fadeEffects(opacity, duration) {
        const from = getComputedStyle(overlay).opacity;
        if (effectFade) effectFade.cancel();
        overlay.style.opacity = String(opacity);
        const animation = overlay.animate([{ opacity: from }, { opacity }], {
            duration: reducedMotion.matches ? 0 : duration, easing: 'ease'
        });
        effectFade = animation;
        return animation.finished.catch(() => {}).then(() => {
            if (effectFade === animation) effectFade = null;
        });
    }

    // The artwork viewer temporarily hides the glass without discarding its marks.
    window.galleryEffects = {
        artworkRect(source) {
            const copy = surface && surface.root.getElementById(source.id);
            return (copy || source).getBoundingClientRect();
        },
        syncArtwork() {
            if (allContent) {
                if (!surface) makeSurface();
                syncScene();
            }
            wake();
        },
        suspend(duration = 300) {
            if (allContent) { wake(); return Promise.resolve(); }
            const generation = ++visibilityGeneration;
            suspended = true;
            freezeVisibility = true;
            resetInput();
            return fadeEffects(0, duration).then(() => {
                if (generation === visibilityGeneration) {
                    freezeVisibility = false;
                    wake();
                }
            });
        },
        restore(duration = 750) {
            if (allContent) { wake(); return Promise.resolve(); }
            visibilityGeneration++;
            freezeVisibility = false;
            wake();
            return fadeEffects(1, duration);
        },
        resume() {
            if (allContent) { wake(); return; }
            visibilityGeneration++;
            suspended = false;
            freezeVisibility = false;
            resetInput();
            overlay.style.opacity = '1';
            wake();
        }
    };

    function svgElement(name, attributes, parent) {
        const element = document.createElementNS(svgNS, name);
        for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
        parent.appendChild(element);
        return element;
    }

    // One live page copy, one bounded displacement field. New strokes add to
    // the existing field; no mark expires or gets recycled during this visit.
    function makeSurface() {
        const layer = document.createElement('div');
        layer.className = 'distortion-layer';
        const root = layer.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = document.getElementById('page-styles').textContent +
            (allContent ? document.getElementById('viewer-styles').textContent : '') + `
            :host { contain: layout style; }
            .distortion-scene {
                position: absolute; inset: 0; background: white;
                pointer-events: none; filter: url(#surface-warp);
            }
            #editor-section {
                position: absolute; top: 0; left: 0; min-height: 100vh;
            }
            .mainimgs[data-effects-hover] { filter: grayscale(0%); -webkit-filter: grayscale(0%); }
            .dropbtn[data-effects-hover], .dropbtn[data-effects-hover] ~ .aboutword { opacity: 1; }
        `;
        const scene = document.createElement('div');
        scene.className = 'distortion-scene';
        const copy = page.cloneNode(true);
        const copies = [copy];
        if (allContent) copies.push(document.getElementById('artwork-viewer').cloneNode(true));
        for (const tree of copies) tree.querySelectorAll('*').forEach(element => {
            for (const attribute of [...element.attributes]) {
                if (attribute.name.startsWith('on')) element.removeAttribute(attribute.name);
            }
            if (element.matches('a, button')) element.tabIndex = -1;
        });
        scene.append(...copies);
        const svg = svgElement('svg', { width: 0, height: 0, style: 'position:absolute' }, root);
        const defs = svgElement('defs', {}, svg);
        const filter = svgElement('filter', {
            id: 'surface-warp', x: 0, y: 0,
            filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse',
            'color-interpolation-filters': 'sRGB'
        }, defs);
        const image = svgElement('feImage', {
            x: 0, y: 0, preserveAspectRatio: 'none', result: 'field'
        }, filter);
        // Byte 128 must map to exactly 0.5 so untouched areas do not shift.
        const normalized = svgElement('feComponentTransfer', { in: 'field', result: 'normalized' }, filter);
        for (const name of ['feFuncR', 'feFuncG']) {
            svgElement(name, { type: 'linear', slope: 1, intercept: -0.5 / 255 }, normalized);
        }
        svgElement('feDisplacementMap', {
            in: 'SourceGraphic', in2: 'normalized', scale: displacementScale,
            xChannelSelector: 'R', yChannelSelector: 'G'
        }, filter);
        root.append(style, scene);
        overlay.appendChild(layer);
        // This unattached canvas only encodes the filter's displacement texture.
        // It never draws page content, ink, or dots on the screen.
        const texture = document.createElement('canvas');
        surface = { layer, root, scene, pageCopy: copy, filter, image, texture, context: texture.getContext('2d') };
        resizeField();
        syncScene();
    }

    function syncViewer() {
        const original = document.getElementById('artwork-viewer');
        const copy = surface.root.getElementById('artwork-viewer');
        copy.hidden = original.hidden;
        const nodes = [original, ...original.querySelectorAll('*')];
        const replicas = [copy, ...copy.querySelectorAll('*')];
        const targets = new Map();
        nodes.forEach((node, index) => {
            const replica = replicas[index];
            targets.set(node, replica);
            if (replica.style.cssText !== node.style.cssText) replica.style.cssText = node.style.cssText;
            for (const name of ['src', 'alt', 'aria-hidden']) {
                if (node.hasAttribute(name) && replica.getAttribute(name) !== node.getAttribute(name)) {
                    replica.setAttribute(name, node.getAttribute(name));
                }
            }
        });
        surface.root.getElementById('viewer-caption').textContent = document.getElementById('viewer-caption').textContent;
        // Mirror compositor animations so the filtered copy moves with the real viewer.
        const live = new Set(original.getAnimations({ subtree: true }));
        for (const [animation, mirrored] of viewerAnimations) {
            if (!live.has(animation)) { mirrored.cancel(); viewerAnimations.delete(animation); }
        }
        let moving = false;
        for (const animation of live) {
            const target = targets.get(animation.effect.target);
            if (!target) continue;
            let mirrored = viewerAnimations.get(animation);
            if (!mirrored) {
                mirrored = target.animate(animation.effect.getKeyframes(), animation.effect.getTiming());
                // Pending source animations must render their first keyframe immediately.
                mirrored.pause();
                mirrored.currentTime = animation.currentTime || 0;
                viewerAnimations.set(animation, mirrored);
            }
            if (animation.playState === 'running' && animation.startTime !== null) {
                mirrored.playbackRate = animation.playbackRate;
                mirrored.startTime = animation.startTime;
            } else {
                mirrored.pause();
                mirrored.currentTime = animation.currentTime || 0;
            }
            moving ||= animation.playState === 'running' || animation.pending;
        }
        if (moving) wake();
    }

    function syncScene() {
        if (!surface) return;
        // The distortion stays on the glass as the live content scrolls beneath it.
        surface.root.getElementById('editor-section').style.transform =
            `translate(${-window.scrollX}px, ${-window.scrollY}px)`;
        for (const id of overlayIds) {
            surface.root.getElementById(id).style.display = document.getElementById(id).style.display;
        }
        if (!freezeVisibility) {
            for (const element of page.querySelectorAll('.mainimgs')) {
                surface.root.getElementById(element.id).style.visibility = element.style.visibility;
            }
        }
        if (mouseInput) {
            const point = !suspended && mousePoint && sourcePoint(mousePoint.x, mousePoint.y);
            const hovered = point && document.elementFromPoint(point.x, point.y);
            // The inert copy cannot receive CSS :hover; mirror hover at the warped
            // source position so color reveals and About still match the visible controls.
            for (const element of page.querySelectorAll('.mainimgs, .dropbtn')) {
                const copy = element.id ? surface.root.getElementById(element.id) :
                    surface.root.querySelector('.dropbtn');
                copy.toggleAttribute('data-effects-hover', !!hovered && element.contains(hovered));
            }
        }
        const originals = page.getAnimations({ subtree: true });
        surface.pageCopy.getAnimations({ subtree: true }).forEach((animation, index) => {
            if (originals[index] && originals[index].startTime !== null) {
                animation.startTime = originals[index].startTime;
            }
        });
        if (allContent) syncViewer();
    }

    function resizeField() {
        if (!surface) return;
        // Resolution is capped independently of DPR. Bilinear resampling retains
        // every mark in the same relative position after rotation/resizing.
        const ratio = Math.min(0.5, 256 / innerWidth, 512 / innerHeight);
        const width = Math.max(1, Math.round(innerWidth * ratio));
        const height = Math.max(1, Math.round(innerHeight * ratio));
        const nextX = new Float32Array(width * height);
        const nextY = new Float32Array(width * height);
        if (fieldX) {
            for (let y = 0; y < height; y++) {
                const oldY = height === 1 ? 0 : y * (fieldHeight - 1) / (height - 1);
                const y0 = Math.floor(oldY), y1 = Math.min(fieldHeight - 1, y0 + 1), fy = oldY - y0;
                for (let x = 0; x < width; x++) {
                    const oldX = width === 1 ? 0 : x * (fieldWidth - 1) / (width - 1);
                    const x0 = Math.floor(oldX), x1 = Math.min(fieldWidth - 1, x0 + 1), fx = oldX - x0;
                    for (const [previous, next] of [[fieldX, nextX], [fieldY, nextY]]) {
                        const top = previous[y0 * fieldWidth + x0] * (1 - fx) + previous[y0 * fieldWidth + x1] * fx;
                        const bottom = previous[y1 * fieldWidth + x0] * (1 - fx) + previous[y1 * fieldWidth + x1] * fx;
                        next[y * width + x] = top * (1 - fy) + bottom * fy;
                    }
                }
            }
        }
        fieldX = nextX; fieldY = nextY;
        fieldWidth = width; fieldHeight = height;
        viewportWidth = innerWidth; viewportHeight = innerHeight;
        surface.texture.width = width; surface.texture.height = height;
        for (const element of [surface.filter, surface.image]) {
            element.setAttribute('width', viewportWidth);
            element.setAttribute('height', viewportHeight);
        }
        dirty = true;
    }

    function stamp(kind, cx, cy, dx = 0, dy = 0) {
        if (reducedMotion.matches || document.hidden || pinching || suspended) return;
        if (!surface) makeSurface();
        dx = Math.max(-45, Math.min(45, dx));
        dy = Math.max(-45, Math.min(45, dy));
        const radiusX = kind === 'tap' ? 62 : (60 + Math.abs(dx)) / 3;
        const radiusY = kind === 'tap' ? 62 : 60 + Math.abs(dy);
        const left = Math.max(0, Math.floor((cx - radiusX) * fieldWidth / viewportWidth));
        const right = Math.min(fieldWidth - 1, Math.ceil((cx + radiusX) * fieldWidth / viewportWidth));
        const top = Math.max(0, Math.floor((cy - radiusY) * fieldHeight / viewportHeight));
        const bottom = Math.min(fieldHeight - 1, Math.ceil((cy + radiusY) * fieldHeight / viewportHeight));
        for (let y = top; y <= bottom; y++) {
            for (let x = left; x <= right; x++) {
                const localX = (x + 0.5) * viewportWidth / fieldWidth - cx;
                const localY = (y + 0.5) * viewportHeight / fieldHeight - cy;
                const distance = (localX / radiusX) ** 2 + (localY / radiusY) ** 2;
                if (distance >= 1) continue;
                const feather = (1 - distance) ** 2;
                // Sampling toward the center creates a lasting local expansion.
                const offsetX = kind === 'tap' ? -localX * 0.33 : -dx * 0.48 - localX * Math.abs(dx) * 0.0036;
                const offsetY = kind === 'tap' ? -localY * 0.33 : -dy * 0.48 - localY * Math.abs(dy) * 0.0036;
                const index = y * fieldWidth + x;
                // Bound the distortion strength, not the number or lifetime of marks.
                fieldX[index] = Math.max(-32, Math.min(32, fieldX[index] + offsetX * feather));
                fieldY[index] = Math.max(-32, Math.min(32, fieldY[index] + offsetY * feather));
            }
        }
        dirty = true;
        wake();
    }

    function wake() {
        if (!frame && !document.hidden) frame = requestAnimationFrame(render);
    }

    function smudge(x, y, dx, dy) {
        if (reducedMotion.matches || document.hidden || pinching) return;
        // Preserve every touch segment, including a turn or reversal in a swipe.
        if (dx || dy) stamp('smudge', x, y, dx, dy);
    }

    function render() {
        frame = 0;
        syncScene();
        if (textLinkCursor) {
            // Cursor feedback follows the same displaced link as click targeting.
            const point = cursorPoint && (surface && !suspended ?
                sourcePoint(cursorPoint.x, cursorPoint.y) : cursorPoint);
            const hit = point && document.elementFromPoint(point.x, point.y);
            const link = hit && hit.closest('a[href]');
            document.documentElement.dataset.linkCursor = String(!!link && !!link.textContent.trim());
        }
        if (!dirty || !surface) return;
        const pixels = surface.context.createImageData(fieldWidth, fieldHeight);
        for (let index = 0; index < fieldX.length; index++) {
            pixels.data[index * 4] = Math.round(128 + fieldX[index] * 255 / displacementScale);
            pixels.data[index * 4 + 1] = Math.round(128 + fieldY[index] * 255 / displacementScale);
            pixels.data[index * 4 + 2] = 128;
            pixels.data[index * 4 + 3] = 255;
        }
        surface.context.putImageData(pixels, 0, 0);
        surface.image.setAttribute('href', surface.texture.toDataURL());
        dirty = false;
        // Nothing schedules another frame while idle; the stored field stays visible.
    }

    // Passive touch tracking lets the browser retain native scrolling and pinch zoom.
    document.addEventListener('touchstart', event => {
        if (event.touches.length > 1) {
            resetInput();
            pinching = true;
        }
        touch = event.touches.length === 1 ? {
            x: event.touches[0].clientX, y: event.touches[0].clientY
        } : null;
    }, { passive: true });
    document.addEventListener('touchmove', event => {
        if (pinching || event.touches.length !== 1) { touch = null; return; }
        const point = event.touches[0];
        if (touch) smudge(point.clientX, point.clientY,
            point.clientX - touch.x, point.clientY - touch.y);
        touch = anchor = { x: point.clientX, y: point.clientY };
    }, { passive: true });
    for (const name of ['touchend', 'touchcancel']) {
        document.addEventListener(name, event => {
            touch = null;
            if (!event.touches.length) pinching = false;
        }, { passive: true });
    }
    window.addEventListener('wheel', event => {
        anchor = { x: event.clientX, y: event.clientY };
    }, { passive: true });
    window.addEventListener('scroll', () => {
        const delta = window.scrollY - lastScrollY;
        lastScrollY = window.scrollY;
        // touchmove already supplies the finger's direction; scroll also covers momentum.
        if (!touch && delta) smudge(anchor.x, anchor.y, 0, -delta);
        wake();
    }, { passive: true });

    document.addEventListener('pointerdown', event => {
        tap = null;
        if (suspended) { gesture = null; return; }
        if (!event.isPrimary || event.button !== 0) { gesture = null; return; }
        gesture = { id: event.pointerId, x: event.clientX, y: event.clientY,
            start: performance.now(), moved: false, scrollY: window.scrollY };
    }, { passive: true });
    document.addEventListener('pointermove', event => {
        if (textLinkCursor && event.pointerType === 'mouse') {
            cursorPoint = { x: event.clientX, y: event.clientY };
            wake();
        }
        if (suspended) { mousePoint = null; return; }
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
    window.addEventListener('blur', () => { mousePoint = null; resetInput(); wake(); });
    document.addEventListener('pointercancel', () => { gesture = tap = null; }, { passive: true });
    document.addEventListener('pointerup', event => {
        if (gesture && event.pointerId === gesture.id && !gesture.moved &&
            Math.abs(window.scrollY - gesture.scrollY) < 5 &&
            performance.now() - gesture.start < 600) {
            tap = { x: event.clientX, y: event.clientY, time: performance.now() };
        }
        gesture = null;
    }, { passive: true });
    function sourcePoint(clientX, clientY) {
        const x = Math.max(0, Math.min(fieldWidth - 1, clientX * fieldWidth / viewportWidth - 0.5));
        const y = Math.max(0, Math.min(fieldHeight - 1, clientY * fieldHeight / viewportHeight - 0.5));
        const x0 = Math.floor(x), y0 = Math.floor(y);
        const x1 = Math.min(fieldWidth - 1, x0 + 1), y1 = Math.min(fieldHeight - 1, y0 + 1);
        function offset(field) {
            const top = field[y0 * fieldWidth + x0] * (1 - x + x0) + field[y0 * fieldWidth + x1] * (x - x0);
            const bottom = field[y1 * fieldWidth + x0] * (1 - x + x0) + field[y1 * fieldWidth + x1] * (x - x0);
            return top * (1 - y + y0) + bottom * (y - y0);
        }
        return { x: clientX + offset(fieldX), y: clientY + offset(fieldY) };
    }
    document.addEventListener('click', event => {
        if (suspended || !surface || reducedMotion.matches || !tap || event.detail === 0) return;
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
            stamp('tap', point.x, point.y);
        }
    }, true);
    // Bubble after the gallery's click handlers so an opened panel is immediately mirrored.
    document.addEventListener('click', event => {
        if (!reducedMotion.matches && !pinching && event.detail > 0 && tap &&
            performance.now() - tap.time < 450) stamp('tap', tap.x, tap.y);
        tap = null;
    });

    function resetInput() {
        touch = gesture = tap = null;
        mousePoint = null;
        lastScrollY = window.scrollY;
        anchor = { x: innerWidth / 2, y: innerHeight / 2 };
    }
    window.addEventListener('resize', () => {
        resetInput();
        resizeField();
        wake();
    }, { passive: true });
    document.addEventListener('visibilitychange', () => {
        resetInput();
        pinching = false;
        if (document.hidden) {
            cancelAnimationFrame(frame);
            frame = 0;
        } else wake();
    });
    reducedMotion.addEventListener('change', () => { resetInput(); wake(); });
    // Keep existing marks over whichever gallery panel is currently visible.
    new MutationObserver(wake).observe(page, { attributes: true, subtree: true, attributeFilter: ['style'] });
})();
