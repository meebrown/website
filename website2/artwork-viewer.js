(() => {
    const viewer = document.getElementById('artwork-viewer');
    const image = document.getElementById('viewer-image');
    const caption = document.getElementById('viewer-caption');
    const closeButton = document.getElementById('artwork-close');
    const backdrop = viewer.querySelector('.viewer-backdrop');
    const page = document.getElementById('page-content');
    const mobile = page.dataset.effectsInput !== 'mouse';
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const easing = 'cubic-bezier(0.22, 1, 0.36, 1)';
    const animations = new Map();
    let current = null;
    let transition = 0;

    function effect(method, duration) {
        return Promise.resolve(window.galleryEffects?.[method]?.(duration)).catch(() => {});
    }

    function targetRect(source) {
        const aspect = (source.naturalWidth || source.width || 1) /
            (source.naturalHeight || source.height || 1);
        const availableWidth = Math.max(1, innerWidth - 80);
        let top = innerWidth * 0.005;
        let availableHeight = innerHeight * 0.91;
        if (mobile) {
            // Keep the actual rendered caption and the safe-area close control
            // clear of the image, including a short landscape viewport.
            const previousTop = caption.style.top;
            const previousBottom = caption.style.bottom;
            caption.style.top = '0';
            caption.style.bottom = 'auto';
            const captionHeight = caption.getBoundingClientRect().height;
            caption.style.top = previousTop;
            caption.style.bottom = previousBottom;
            top = Math.max(16, closeButton.getBoundingClientRect().bottom + 12);
            availableHeight = Math.max(1, innerHeight - top - captionHeight - 8 - 18);
        }
        const height = Math.min(availableHeight, availableWidth / aspect);
        const width = height * aspect;
        return { x: (innerWidth - width) / 2, y: top, width, height };
    }

    function lockScroll(session) {
        if (!mobile) return;
        session.scroll = { x: window.scrollX, y: window.scrollY };
        session.scrollStyles = [document.documentElement, document.body].map(element => ({
            element, overflow: element.style.overflow,
            overscrollBehavior: element.style.overscrollBehavior,
            scrollBehavior: element.style.scrollBehavior
        }));
        for (const { element } of session.scrollStyles) {
            element.style.overflow = 'hidden';
            element.style.overscrollBehavior = 'none';
            element.style.scrollBehavior = 'auto';
        }
        // Unlike fixing <body>, this leaves scrollY and the effects copy aligned.
        window.scrollTo(session.scroll.x, session.scroll.y);
    }

    function unlockScroll(session) {
        if (!session.scrollStyles) return;
        for (const saved of session.scrollStyles) {
            saved.element.style.overflow = saved.overflow;
            saved.element.style.overscrollBehavior = saved.overscrollBehavior;
        }
        window.scrollTo(session.scroll.x, session.scroll.y);
        for (const saved of session.scrollStyles) {
            saved.element.style.scrollBehavior = saved.scrollBehavior;
        }
    }

    function transform(rect, width, height) {
        return `translate(${rect.x}px, ${rect.y}px) scale(${rect.width / width}, ${rect.height / height})`;
    }

    function cancelAnimations() {
        for (const [element, animation] of animations) {
            // Save the in-flight appearance before canceling, including a rapid close.
            const computed = getComputedStyle(element);
            if (element === image) element.style.transform = computed.transform;
            else element.style.opacity = computed.opacity;
            animation.cancel();
        }
        animations.clear();
    }

    function animate(element, property, from, to, duration) {
        element.style[property] = to;
        if (!duration) return Promise.resolve();
        const animation = element.animate(
            [{ [property]: from }, { [property]: to }],
            { duration, easing, fill: 'none' }
        );
        animations.set(element, animation);
        return animation.finished.catch(() => {}).finally(() => {
            if (animations.get(element) === animation) animations.delete(element);
        });
    }

    async function move(closing, requestedDuration) {
        if (!current) return;
        const session = current;
        const token = ++transition;
        const duration = reducedMotion.matches ? 0 : requestedDuration;
        const from = image.getBoundingClientRect();
        const opacity = new Map([backdrop, caption, closeButton].map(element =>
            [element, getComputedStyle(element).opacity]));
        cancelAnimations();
        session.phase = closing ? 'closing' : 'opening';
        const size = targetRect(session.source);
        const destination = closing ? session.source.getBoundingClientRect() : size;
        // The bitmap's aspect stays constant; only a compositor transform changes.
        image.style.width = `${size.width}px`;
        image.style.height = `${size.height}px`;
        const start = transform(from, size.width, size.height);
        const end = transform(destination, size.width, size.height);
        image.style.transform = start;
        caption.style.top = `${size.y + size.height + (mobile ? 8 : Math.max(4, innerHeight * 0.005))}px`;
        caption.style.bottom = 'auto';
        await Promise.all([
            animate(image, 'transform', start, end, duration),
            ...[backdrop, caption, closeButton].map(element =>
                animate(element, 'opacity', opacity.get(element), closing ? '0' : '1', duration)),
            closing ? session.restoring : Promise.resolve()
        ]);
        if (token !== transition || session !== current) return;
        if (!closing) {
            session.phase = 'open';
            return;
        }

        // Reveal both the real thumbnail and its effects copy before hiding the
        // returning image, so there is no frame with an empty thumbnail slot.
        session.revealed = true;
        session.source.style.visibility = session.visibility;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        if (token !== transition || session !== current) return;
        viewer.hidden = true;
        viewer.setAttribute('aria-hidden', 'true');
        unlockScroll(session);
        page.inert = session.pageInert;
        current = null;
        const focus = session.focus?.isConnected && session.focus !== document.body ?
            session.focus : session.source;
        focus.focus({ preventScroll: true });
        window.galleryEffects?.resume?.();
    }

    function closeArtwork() {
        if (!current || current.phase === 'closing') return;
        current.restoring = effect('restore', reducedMotion.matches ? 0 : 750);
        move(true, 750);
    }

    window.openArtwork = source => {
        if (current || !source) return;
        const rect = source.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        current = {
            source, visibility: source.style.visibility, pageInert: page.inert,
            focus: document.activeElement, phase: 'opening', restoring: Promise.resolve()
        };
        // Suppress input synchronously before this click reaches the effects engine.
        effect('suspend', reducedMotion.matches ? 0 : 300);
        lockScroll(current);
        image.src = source.currentSrc || source.src;
        image.alt = source.alt;
        image.style.cssText = 'position:fixed;left:0;top:0;max-width:none;max-height:none;' +
            'margin:0;transform-origin:0 0;filter:none;cursor:default;pointer-events:none;';
        image.style.width = `${rect.width}px`;
        image.style.height = `${rect.height}px`;
        image.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
        caption.textContent = source.dataset.caption || source.alt;
        for (const element of [backdrop, caption, closeButton]) element.style.opacity = '0';
        viewer.style.cursor = 'default';
        viewer.hidden = false;
        viewer.setAttribute('aria-hidden', 'false');
        source.style.visibility = 'hidden';
        page.inert = true;
        closeButton.focus({ preventScroll: true });
        move(false, 750);
    };

    closeButton.addEventListener('click', closeArtwork);
    for (const source of page.querySelectorAll('.mainimgs')) {
        source.tabIndex = 0;
        source.setAttribute('role', 'button');
        source.setAttribute('aria-haspopup', 'dialog');
        source.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                window.openArtwork(source);
            }
        });
    }
    // Clicking the noninteractive backdrop can focus <body>; Escape and Tab
    // must still work while the dialog owns the page.
    document.addEventListener('keydown', event => {
        if (!current) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closeArtwork();
        } else if (event.key === 'Tab') {
            event.preventDefault();
            closeButton.focus({ preventScroll: true });
        }
    });
    window.addEventListener('resize', () => {
        if (current && !current.revealed) move(current.phase === 'closing', 220);
    }, { passive: true });
    reducedMotion.addEventListener('change', () => {
        if (!current || current.revealed) return;
        if (current.phase === 'closing') current.restoring = effect('restore', 0);
        move(current.phase === 'closing', 0);
    });
})();
