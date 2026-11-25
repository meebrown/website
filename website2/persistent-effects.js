(() => {
    const modules = window.GalleryEffectsModules;
    const page = document.getElementById('page-content');
    const overlay = document.getElementById('interaction-overlay');
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const mouseInput = page.dataset.effectsInput === 'mouse';
    const textLinkCursor = page.dataset.cursorPolicy === 'text-links';
    const allContent = page.dataset.effectsScope === 'all';
    const scroll = window.mobileScroll;
    const field = modules.createDisplacementField({
        smudgeWidthScale: Number(page.dataset.smudgeWidthScale ?? 1),
        smudgeStrengthScale: Number(page.dataset.smudgeStrengthScale ?? 1),
        tapRadiusScale: Number(page.dataset.tapRadiusScale ?? 1),
        tapStrengthScale: Number(page.dataset.tapStrengthScale ?? 1)
    });
    let scene = null;
    let renderer = null;
    let frame = 0;
    let dirty = false;
    let input;

    // Wire responsibilities together and keep one shared animation-frame scheduler.
    const visibility = modules.createOverlayVisibility({
        overlay, allContent, reducedMotion, wake, resetInput: () => input.reset()
    });
    input = modules.createInputController({
        mouseInput, textLinkCursor, allContent, reducedMotion, sourcePoint, wake,
        captureTaps: page.dataset.effectsInput === 'touch',
        manualTouchScroll: document.documentElement.hasAttribute('data-direct-scroll'),
        readPosition: scroll?.readPosition, scrollTarget: scroll?.eventTarget,
        isSuspended: visibility.isSuspended, hasSurface: () => !!scene,
        onSmudge: (x, y, dx, dy) => stamp('smudge', x, y, dx, dy),
        onTap: (x, y) => stamp('tap', x, y)
    });

    function wake() {
        if (!frame && !document.hidden) frame = requestAnimationFrame(render);
    }

    function sourcePoint(x, y) {
        if (reducedMotion.matches) return { x, y };
        return modules.sampleDisplacement(renderer && renderer.getPresentedField(), x, y);
    }

    function ensureSurface() {
        if (scene) return;
        scene = modules.createSceneCopy({ page, overlay, allContent, mouseInput, wake,
            readPosition: scroll?.readPosition });
        renderer = modules.createSvgRenderer({
            root: scene.root, scene: scene.scene, wake, onError: () => { dirty = true; }
        });
        resizeField();
        syncScene();
    }

    function resizeField() {
        if (!renderer) return;
        renderer.cancelPending();
        field.resize(innerWidth, innerHeight);
        dirty = true;
    }

    function stamp(kind, x, y, dx = 0, dy = 0) {
        if (!input.canStamp()) return;
        ensureSurface();
        field.stamp(kind, x, y, dx, dy);
        dirty = true;
        wake();
    }

    function syncScene() {
        if (!scene) return;
        scene.sync({ mousePoint: input.getMousePoint(), suspended: visibility.isSuspended(),
            freezeVisibility: visibility.isFrozen(), sourcePoint });
    }

    function render() {
        frame = 0;
        if (renderer) renderer.present();
        syncScene();
        input.updateCursor();
        if (!dirty || !renderer || renderer.hasPending()) return;
        if (renderer.prepare(field.snapshot())) dirty = false;
    }

    // Preserve the interface used by artwork-viewer.js across every desktop variant.
    window.galleryEffects = {
        artworkRect(source) {
            return scene ? scene.artworkRect(source) : source.getBoundingClientRect();
        },
        syncArtwork() {
            if (allContent) {
                ensureSurface();
                syncScene();
            }
            wake();
        },
        syncScroll() {
            if (scene) scene.syncScroll();
        },
        suspend: visibility.suspend,
        restore: visibility.restore,
        resume: visibility.resume
    };

    window.addEventListener('resize', () => {
        input.reset();
        resizeField();
        wake();
    }, { passive: true });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            cancelAnimationFrame(frame);
            frame = 0;
        } else wake();
    });
    reducedMotion.addEventListener('change', () => { input.reset(); wake(); });
    new MutationObserver(wake).observe(page, {
        attributes: true, subtree: true, attributeFilter: ['style']
    });
})();
