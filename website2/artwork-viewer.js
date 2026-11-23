(() => {
    const viewer = document.getElementById('artwork-viewer');
    const image = document.getElementById('viewer-image');
    const caption = document.getElementById('viewer-caption');
    const closeButton = document.getElementById('artwork-close');
    const externalClose = !viewer.contains(closeButton);
    const backdrop = viewer.querySelector('.viewer-backdrop');
    const page = document.getElementById('page-content');
    const mobile = page.dataset.effectsInput !== 'mouse';
    const zoom = page.dataset.viewerTransition === 'zoom' || viewer.dataset.viewerTransition === 'zoom';
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const duration = zoom ? 750 : 400;
    const fading = zoom ? [backdrop, caption, closeButton] : [backdrop, image, caption, closeButton];
    const animations = new Map();
    let current = null;
    let transition = 0;

    function effect(method, duration) {
        return Promise.resolve(window.galleryEffects?.[method]?.(duration)).catch(() => {});
    }

    function syncArtwork() {
        window.galleryEffects?.syncArtwork?.();
    }

    function targetRect(source) {
        const aspect = (source.naturalWidth || source.width || 1) /
            (source.naturalHeight || source.height || 1);
        const sideMargin = Number(page.dataset.viewerSideMargin ?? 40);
        const availableWidth = Math.max(1, innerWidth - sideMargin * 2);
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

    function placeImage() {
        if (!current) return;
        const size = targetRect(current.source);
        image.style.left = `${size.x}px`;
        image.style.top = `${size.y}px`;
        image.style.width = `${size.width}px`;
        image.style.height = `${size.height}px`;
        image.style.transform = 'none';
        placeCaption(size);
        syncArtwork();
    }

    function placeCaption(size) {
        caption.style.top = `${size.y + size.height + (mobile ? 8 : Math.max(4, innerHeight * 0.005))}px`;
        caption.style.bottom = 'auto';
    }

    function revealSource(session) {
        session.source.style.transform = session.transform;
        session.source.style.transition = session.transition;
        session.source.style.visibility = session.visibility;
        syncArtwork();
    }

    function cancelAnimations() {
        for (const [element, animation] of animations) {
            // Save the in-flight appearance before canceling, including a rapid close.
            const property = zoom && element === image ? 'transform' : 'opacity';
            element.style[property] = getComputedStyle(element)[property];
            animation.cancel();
        }
        animations.clear();
        syncArtwork();
    }

    function animate(element, from, to, milliseconds, property = 'opacity') {
        element.style[property] = to;
        if (!milliseconds) return Promise.resolve();
        const animation = element.animate(
            [{ [property]: from }, { [property]: to }],
            { duration: milliseconds, easing: property === 'transform' ?
                'cubic-bezier(0.22, 1, 0.36, 1)' : 'ease', fill: 'none' }
        );
        animations.set(element, animation);
        return animation.finished.catch(() => {}).finally(() => {
            if (animations.get(element) === animation) animations.delete(element);
        });
    }

    async function fade(closing, requestedDuration) {
        if (!current) return;
        const session = current;
        const token = ++transition;
        const milliseconds = reducedMotion.matches ? 0 : requestedDuration;
        const opacity = new Map(fading.map(element =>
            [element, getComputedStyle(element).opacity]));
        cancelAnimations();
        session.phase = closing ? 'closing' : 'opening';
        const pending = [
            ...fading.map(element =>
                animate(element, opacity.get(element), closing ? '0' : '1', milliseconds)),
            closing ? session.restoring : Promise.resolve()
        ];
        syncArtwork();
        await Promise.all(pending);
        await finish(session, token, closing);
    }

    async function zoomArtwork(closing, requestedDuration) {
        if (!current) return;
        const session = current;
        const token = ++transition;
        const milliseconds = reducedMotion.matches ? 0 : requestedDuration;
        const from = image.getBoundingClientRect();
        const opacity = new Map(fading.map(element =>
            [element, getComputedStyle(element).opacity]));
        cancelAnimations();
        session.phase = closing ? 'closing' : 'opening';
        const size = targetRect(session.source);
        const destination = closing ? session.source.getBoundingClientRect() : size;
        image.style.left = '0';
        image.style.top = '0';
        image.style.width = `${size.width}px`;
        image.style.height = `${size.height}px`;
        image.style.transformOrigin = '0 0';
        image.style.opacity = '1';
        const transform = rect => `translate(${rect.x}px, ${rect.y}px) ` +
            `scale(${rect.width / size.width}, ${rect.height / size.height})`;
        const start = transform(from);
        const end = transform(destination);
        image.style.transform = start;
        placeCaption(size);
        const pending = [
            animate(image, start, end, milliseconds, 'transform'),
            ...fading.map(element =>
                animate(element, opacity.get(element), closing ? '0' : '1', milliseconds)),
            closing ? session.restoring : Promise.resolve()
        ];
        syncArtwork();
        await Promise.all(pending);
        await finish(session, token, closing);
    }

    async function finish(session, token, closing) {
        if (token !== transition || session !== current) return;
        if (!closing) {
            session.phase = 'open';
            syncArtwork();
            return;
        }

        if (zoom) {
            session.revealed = true;
            revealSource(session);
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            if (token !== transition || session !== current) return;
        }
        viewer.hidden = true;
        if (externalClose) closeButton.hidden = true;
        viewer.setAttribute('aria-hidden', 'true');
        syncArtwork();
        unlockScroll(session);
        page.inert = session.pageInert;
        current = null;
        const focus = session.focus?.isConnected && session.focus !== document.body ?
            session.focus : session.source;
        focus.focus({ preventScroll: true });
        window.galleryEffects?.resume?.();
        syncArtwork();
    }

    function closeArtwork() {
        if (!current || current.phase === 'closing') return;
        // The gallery is already present beneath the fading white and image.
        // Restoring the effects also synchronizes the copied thumbnail visibility.
        if (!zoom) revealSource(current);
        current.restoring = effect('restore', reducedMotion.matches ? 0 : duration);
        if (zoom) zoomArtwork(true, duration);
        else fade(true, duration);
    }

    window.openArtwork = source => {
        if (current || !source) return;
        const rect = zoom ? window.galleryEffects?.artworkRect?.(source) || source.getBoundingClientRect() :
            source.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        current = {
            source, visibility: source.style.visibility, pageInert: page.inert,
            transform: source.style.transform, transition: source.style.transition,
            focus: document.activeElement, phase: 'opening', restoring: Promise.resolve()
        };
        // Suppress input synchronously before this click reaches the effects engine.
        effect('suspend', reducedMotion.matches ? 0 : duration);
        lockScroll(current);
        image.src = source.currentSrc || source.src;
        image.alt = source.alt;
        image.style.cssText = 'position:fixed;left:0;top:0;max-width:none;max-height:none;' +
            'margin:0;transform:none;filter:none;cursor:none;pointer-events:none;';
        if (zoom) {
            image.style.width = `${rect.width}px`;
            image.style.height = `${rect.height}px`;
            image.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
            image.style.opacity = '1';
        }
        caption.textContent = source.dataset.caption || source.alt;
        for (const element of fading) element.style.opacity = '0';
        viewer.style.cursor = 'none';
        viewer.hidden = false;
        if (externalClose) closeButton.hidden = false;
        viewer.setAttribute('aria-hidden', 'false');
        source.style.visibility = 'hidden';
        // Avoid a hidden hover transition while the fitted image fades in.
        source.style.transition = 'none';
        source.style.transform = 'none';
        page.inert = true;
        closeButton.focus({ preventScroll: true });
        syncArtwork();
        if (zoom) zoomArtwork(false, duration);
        else {
            placeImage();
            fade(false, duration);
        }
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
        if (zoom) {
            if (current && !current.revealed) zoomArtwork(current.phase === 'closing', 220);
        } else placeImage();
    }, { passive: true });
    reducedMotion.addEventListener('change', () => {
        if (!current || current.revealed) return;
        if (current.phase === 'closing') current.restoring = effect('restore', 0);
        if (zoom) zoomArtwork(current.phase === 'closing', 0);
        else fade(current.phase === 'closing', 0);
    });
})();
