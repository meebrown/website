(() => {
    const modules = window.GalleryEffectsModules ||= {};

    // Own the visual page copy and keep its DOM, hover, and animations aligned.
    modules.createSceneCopy = ({ page, overlay, allContent, mouseInput, wake,
        readPosition = () => ({ x: window.scrollX, y: window.scrollY }) }) => {
        const overlayIds = [...page.querySelectorAll('[id$="overlay"]')].map(element => element.id);
        const viewerAnimations = new Map();
        const layer = document.createElement('div');
        layer.className = 'distortion-layer';
        const root = layer.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = document.getElementById('page-styles').textContent +
            (allContent ? document.getElementById('viewer-styles').textContent : '') + `
            :host { contain: layout style; }
            .distortion-scene {
                position: absolute; inset: 0; background: white;
                pointer-events: none;
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
        const pageTargets = new Map([[page, copy]]);
        const sourceNodes = [...page.querySelectorAll('*')];
        const copiedNodes = [...copy.querySelectorAll('*')];
        sourceNodes.forEach((element, index) => pageTargets.set(element, copiedNodes[index]));
        const copies = [copy];
        if (allContent) copies.push(document.getElementById('artwork-viewer').cloneNode(true));
        for (const tree of copies) tree.querySelectorAll('*').forEach(element => {
            for (const attribute of [...element.attributes]) {
                if (attribute.name.startsWith('on')) element.removeAttribute(attribute.name);
            }
            if (element.matches('a, button')) element.tabIndex = -1;
        });
        scene.append(...copies);
        root.append(style, scene);
        overlay.appendChild(layer);

        function artworkRect(source) {
            const replica = root.getElementById(source.id);
            const rect = (replica || source).getBoundingClientRect();
            return rect.width && rect.height ? rect : source.getBoundingClientRect();
        }

        function syncViewer() {
            const original = document.getElementById('artwork-viewer');
            const replica = root.getElementById('artwork-viewer');
            replica.hidden = original.hidden;
            const nodes = [original, ...original.querySelectorAll('*')];
            const replicas = [replica, ...replica.querySelectorAll('*')];
            const targets = new Map();
            nodes.forEach((node, index) => {
                const target = replicas[index];
                targets.set(node, target);
                if (target.style.cssText !== node.style.cssText) target.style.cssText = node.style.cssText;
                for (const name of ['src', 'alt', 'aria-hidden']) {
                    if (node.hasAttribute(name) && target.getAttribute(name) !== node.getAttribute(name)) {
                        target.setAttribute(name, node.getAttribute(name));
                    }
                }
            });
            root.getElementById('viewer-caption').textContent = document.getElementById('viewer-caption').textContent;
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

        function syncScroll() {
            // The distortion stays on the glass as live content scrolls beneath it.
            const position = readPosition();
            root.getElementById('editor-section').style.transform =
                `translate(${-position.x}px, ${-position.y}px)`;
        }

        function sync({ mousePoint = null, suspended = false, freezeVisibility = false,
            sourcePoint = (x, y) => ({ x, y }) } = {}) {
            syncScroll();
            for (const id of overlayIds) {
                root.getElementById(id).style.display = document.getElementById(id).style.display;
            }
            if (!freezeVisibility) {
                for (const element of page.querySelectorAll('.mainimgs')) {
                    root.getElementById(element.id).style.visibility = element.style.visibility;
                }
            }
            if (mouseInput) {
                const point = !suspended && mousePoint && sourcePoint(mousePoint.x, mousePoint.y);
                const hovered = point && document.elementFromPoint(point.x, point.y);
                // The inert copy cannot receive CSS :hover; mirror hover at the warped
                // source position so color reveals and About match the visible controls.
                for (const element of page.querySelectorAll('.mainimgs, .dropbtn')) {
                    const replica = element.id ? root.getElementById(element.id) : root.querySelector('.dropbtn');
                    replica.toggleAttribute('data-effects-hover', !!hovered && element.contains(hovered));
                }
            }
            // Hover transitions can reorder getAnimations(). Match looping CSS
            // animations by copied element and name so moving controls never reset.
            const matched = new Set();
            for (const original of page.getAnimations({ subtree: true })) {
                if (!original.animationName || original.startTime === null) continue;
                const target = pageTargets.get(original.effect.target);
                if (!target) continue;
                const mirrored = target.getAnimations().find(animation =>
                    animation.effect.target === target &&
                    animation.animationName === original.animationName && !matched.has(animation));
                if (mirrored) {
                    mirrored.playbackRate = original.playbackRate;
                    mirrored.startTime = original.startTime;
                    matched.add(mirrored);
                }
            }
            if (allContent) syncViewer();
        }

        return { root, scene, sync, syncScroll, artworkRect };
    };
})();
