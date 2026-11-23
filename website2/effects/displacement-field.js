(() => {
    const modules = window.GalleryEffectsModules ||= {};

    // Own the persistent displacement values and brush math, without rendering
    // or input concerns. Values are source-sampling offsets in CSS pixels.
    modules.createDisplacementField = ({ smudgeWidthScale = 1, smudgeStrengthScale = 1,
        tapRadiusScale = 1, tapStrengthScale = 1 } = {}) => {
        let fieldX, fieldY, fieldWidth = 0, fieldHeight = 0;
        let viewportWidth = 0, viewportHeight = 0;

        function resize(nextViewportWidth, nextViewportHeight) {
            const ratio = Math.min(0.5, 256 / nextViewportWidth, 512 / nextViewportHeight);
            const width = Math.max(1, Math.round(nextViewportWidth * ratio));
            const height = Math.max(1, Math.round(nextViewportHeight * ratio));
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
            viewportWidth = nextViewportWidth; viewportHeight = nextViewportHeight;
        }

        function stamp(kind, cx, cy, dx = 0, dy = 0) {
            dx = Math.max(-45, Math.min(45, dx));
            dy = Math.max(-45, Math.min(45, dy));
            const radiusX = kind === 'tap' ? 62 * tapRadiusScale : (60 + Math.abs(dx)) / 3 * smudgeWidthScale;
            const radiusY = kind === 'tap' ? 62 * tapRadiusScale : 60 + Math.abs(dy);
            const left = Math.max(0, Math.floor((cx - radiusX) * fieldWidth / viewportWidth));
            const right = Math.min(fieldWidth - 1, Math.ceil((cx + radiusX) * fieldWidth / viewportWidth));
            const top = Math.max(0, Math.floor((cy - radiusY) * fieldHeight / viewportHeight));
            const bottom = Math.min(fieldHeight - 1, Math.ceil((cy + radiusY) * fieldHeight / viewportHeight));
            const strength = kind === 'tap' ? tapStrengthScale : smudgeStrengthScale;
            for (let y = top; y <= bottom; y++) {
                for (let x = left; x <= right; x++) {
                    const localX = (x + 0.5) * viewportWidth / fieldWidth - cx;
                    const localY = (y + 0.5) * viewportHeight / fieldHeight - cy;
                    const distance = (localX / radiusX) ** 2 + (localY / radiusY) ** 2;
                    if (distance >= 1) continue;
                    const feather = (1 - distance) ** 2;
                    const offsetX = kind === 'tap' ? -localX * 0.33 : -dx * 0.48 - localX * Math.abs(dx) * 0.0036;
                    const offsetY = kind === 'tap' ? -localY * 0.33 : -dy * 0.48 - localY * Math.abs(dy) * 0.0036;
                    const index = y * fieldWidth + x;
                    fieldX[index] = Math.max(-32, Math.min(32, fieldX[index] + offsetX * strength * feather));
                    fieldY[index] = Math.max(-32, Math.min(32, fieldY[index] + offsetY * strength * feather));
                }
            }
        }

        function snapshot() {
            return { x: fieldX.slice(), y: fieldY.slice(), width: fieldWidth, height: fieldHeight,
                viewportWidth, viewportHeight };
        }

        return { resize, stamp, snapshot };
    };

    // Sample a committed snapshot so hit targets follow the map being displayed,
    // rather than newer brush values that are still waiting to render.
    modules.sampleDisplacement = (shown, clientX, clientY) => {
        if (!shown) return { x: clientX, y: clientY };
        const x = Math.max(0, Math.min(shown.width - 1, clientX * shown.width / shown.viewportWidth - 0.5));
        const y = Math.max(0, Math.min(shown.height - 1, clientY * shown.height / shown.viewportHeight - 0.5));
        const x0 = Math.floor(x), y0 = Math.floor(y);
        const x1 = Math.min(shown.width - 1, x0 + 1), y1 = Math.min(shown.height - 1, y0 + 1);
        function offset(field) {
            const top = field[y0 * shown.width + x0] * (1 - x + x0) + field[y0 * shown.width + x1] * (x - x0);
            const bottom = field[y1 * shown.width + x0] * (1 - x + x0) + field[y1 * shown.width + x1] * (x - x0);
            return top * (1 - y + y0) + bottom * (y - y0);
        }
        return { x: clientX + offset(shown.x), y: clientY + offset(shown.y) };
    };
})();
