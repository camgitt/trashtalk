// ============ CONFETTI ANIMATION ============
function triggerConfetti() {
    const canvas = document.getElementById('confetti');
    canvas.classList.remove('hidden');
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    const particles = [];
    const colors = ['#ff4757', '#2ed573', '#ffd700', '#ff6b6b', '#5352ed', '#1e90ff', '#ff9ff3', '#54a0ff'];
    
    for (let i = 0; i < 100; i++) {
        particles.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height - canvas.height,
            r: Math.random() * 5 + 2,
            color: colors[Math.floor(Math.random() * colors.length)],
            tiltAngle: Math.random() * Math.PI,
            tiltSpeed: Math.random() * 0.1 + 0.05
        });
    }
    
    let frame = 0;
    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        particles.forEach(p => {
            ctx.beginPath();
            ctx.fillStyle = p.color;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.tiltAngle);
            ctx.fillRect(-p.r/2, -p.r, p.r, p.r * 2);
            ctx.restore();
            p.y += 3;
            p.x += Math.sin(p.tiltAngle) * 2;
            p.tiltAngle += p.tiltSpeed;
        });
        frame++;
        if (frame < 120) requestAnimationFrame(draw);
        else canvas.classList.add('hidden');
    }
    draw();
}
