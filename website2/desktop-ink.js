(() => {
    // Permanent viewport ink: mouse movement draws lines, clicks leave dots.
    const overlay = document.getElementById('interaction-overlay');
    const canvas = document.createElement('canvas');
    canvas.id = 'ink-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'display:block;width:100%;height:100%;pointer-events:none;';
    overlay.appendChild(canvas);
    const context = canvas.getContext('2d');
    let previous = null;

    function resetPointer() {
        previous = null;
    }

    function resize() {
        // Keep one bounded raster and preserve marks at relative screen positions.
        const saved = document.createElement('canvas');
        saved.width = canvas.width;
        saved.height = canvas.height;
        saved.getContext('2d').drawImage(canvas, 0, 0);
        const ratio = Math.min(devicePixelRatio || 1, 2, 2048 / innerWidth, 2048 / innerHeight);
        canvas.width = Math.max(1, Math.round(innerWidth * ratio));
        canvas.height = Math.max(1, Math.round(innerHeight * ratio));
        context.drawImage(saved, 0, 0, canvas.width, canvas.height);
        context.setTransform(canvas.width / innerWidth, 0, 0, canvas.height / innerHeight, 0, 0);
        context.strokeStyle = '#000';
        context.fillStyle = '#000';
        context.lineWidth = 3;
        context.lineCap = 'round';
        context.lineJoin = 'round';
        resetPointer();
    }

    document.addEventListener('pointermove', event => {
        if (event.pointerType !== 'mouse') return;
        const next = { x: event.clientX, y: event.clientY };
        if (previous) {
            context.beginPath();
            context.moveTo(previous.x, previous.y);
            context.lineTo(next.x, next.y);
            context.stroke();
        }
        previous = next;
    }, { passive: true });

    // Capture also covers controls whose own click handler stops propagation.
    document.addEventListener('click', event => {
        if (!event.detail || event.button !== 0) return;
        context.beginPath();
        context.arc(event.clientX, event.clientY, 3, 0, Math.PI * 2);
        context.fill();
    }, { capture: true, passive: true });

    document.addEventListener('pointerout', event => {
        if (!event.relatedTarget) resetPointer();
    }, { passive: true });
    document.addEventListener('pointercancel', resetPointer, { passive: true });
    window.addEventListener('blur', resetPointer);
    document.addEventListener('visibilitychange', resetPointer);
    window.addEventListener('resize', resize, { passive: true });
    resize();
})();
