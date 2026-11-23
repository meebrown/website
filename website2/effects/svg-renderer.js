(() => {
    const modules = window.GalleryEffectsModules ||= {};
    const svgNS = 'http://www.w3.org/2000/svg';
    const xlinkNS = 'http://www.w3.org/1999/xlink';
    const displacementScale = 80;

    function svgElement(name, attributes, parent) {
        const element = document.createElementNS(svgNS, name);
        for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
        parent.appendChild(element);
        return element;
    }

    // Turn field snapshots into ready SVG filters without replacing a loading map.
    modules.createSvgRenderer = ({ root, scene, wake, onError }) => {
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('width', '0');
        svg.setAttribute('height', '0');
        svg.style.position = 'absolute';
        root.prepend(svg);
        const defs = svgElement('defs', {}, svg);
        const buffers = Array.from({ length: 2 }, (_, index) => {
            const filter = svgElement('filter', {
                id: `surface-warp-buffer-${index}`, x: 0, y: 0,
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
            return { filter, image };
        });
        // This canvas only encodes displacement; it never draws page content.
        const texture = document.createElement('canvas');
        const context = texture.getContext('2d');
        let fieldRevision = 0;
        let activeBuffer = -1;
        let pendingMap = null;
        let presentedField = null;

        function cancelPending() {
            if (!pendingMap) return;
            pendingMap.decoder.onload = pendingMap.decoder.onerror = null;
            pendingMap = null;
        }

        function prepare(field) {
            if (pendingMap) return false;
            if (texture.width !== field.width) texture.width = field.width;
            if (texture.height !== field.height) texture.height = field.height;
            const pixels = context.createImageData(field.width, field.height);
            for (let index = 0; index < field.x.length; index++) {
                pixels.data[index * 4] = Math.round(128 + field.x[index] * 255 / displacementScale);
                pixels.data[index * 4 + 1] = Math.round(128 + field.y[index] * 255 / displacementScale);
                pixels.data[index * 4 + 2] = 128;
                pixels.data[index * 4 + 3] = 255;
            }
            context.putImageData(pixels, 0, 0);
            const pending = {
                buffer: buffers[activeBuffer === 0 ? 1 : 0],
                mapURL: texture.toDataURL(), decoder: new Image(), field,
                decoded: false, primed: false
            };
            pendingMap = pending;
            pending.decoder.onload = async () => {
                if (pending.decoder.decode) {
                    try { await pending.decoder.decode(); } catch (_) { /* onload already succeeded */ }
                }
                if (pendingMap !== pending) return;
                pending.decoded = true;
                wake();
            };
            pending.decoder.onerror = () => {
                if (pendingMap !== pending) return;
                pendingMap = null;
                onError();
            };
            pending.decoder.src = pending.mapURL;
            return true;
        }

        function present() {
            const pending = pendingMap;
            if (!pending || !pending.decoded) return;
            if (!pending.primed) {
                const { filter, image } = pending.buffer;
                for (const element of [filter, image]) {
                    element.setAttribute('width', pending.field.viewportWidth);
                    element.setAttribute('height', pending.field.viewportHeight);
                }
                // Refresh Safari's filter cache without changing the active buffer.
                // https://aave.com/design/building-glass-for-the-web
                filter.id = `surface-warp-${++fieldRevision}`;
                image.setAttribute('href', pending.mapURL);
                image.setAttributeNS(xlinkNS, 'xlink:href', pending.mapURL);
                pending.primed = true;
                // feImage does not reliably emit load. Allow a presentation frame
                // for the predecoded PNG in the inactive buffer before switching.
                wake();
                return;
            }
            const filterURL = `url(#${pending.buffer.filter.id})`;
            scene.style.filter = filterURL;
            scene.style.webkitFilter = filterURL;
            activeBuffer = buffers.indexOf(pending.buffer);
            presentedField = pending.field;
            pending.decoder.onload = pending.decoder.onerror = null;
            pendingMap = null;
        }

        return { prepare, present, cancelPending,
            hasPending: () => !!pendingMap, getPresentedField: () => presentedField };
    };
})();
