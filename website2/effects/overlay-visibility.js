(() => {
    const modules = window.GalleryEffectsModules ||= {};

    // Controls the glass's visibility during artwork transitions, preserving its marks.
    modules.createOverlayVisibility = ({ overlay, allContent, reducedMotion, wake, resetInput }) => {
        let suspended = false;
        let freezeVisibility = false;
        let effectFade = null;
        let visibilityGeneration = 0;

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

        function suspend(duration = 300) {
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
        }

        function restore(duration = 750) {
            if (allContent) { wake(); return Promise.resolve(); }
            visibilityGeneration++;
            freezeVisibility = false;
            wake();
            return fadeEffects(1, duration);
        }

        function resume() {
            if (allContent) { wake(); return; }
            visibilityGeneration++;
            suspended = false;
            freezeVisibility = false;
            resetInput();
            overlay.style.opacity = '1';
            wake();
        }

        return { suspend, restore, resume,
            isSuspended: () => suspended,
            isFrozen: () => freezeVisibility };
    };
})();
