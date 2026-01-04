/**
 * Input validation and rate limiting
 */

// ============ INPUT VALIDATION ============
function sanitizeName(name) {
    if (typeof name !== 'string') return '';
    return name
        .trim()
        .slice(0, 12)
        .replace(/[<>]/g, '');  // Strip HTML brackets
}

function isValidRoomCode(code) {
    return typeof code === 'string' && /^[A-Z0-9]{4,8}$/i.test(code);
}

// ============ RATE LIMITING ============
class RateLimiter {
    constructor(windowMs = 1000, maxRequests = 10) {
        this.limits = new Map();
        this.windowMs = windowMs;
        this.maxRequests = maxRequests;

        // Cleanup old entries every minute
        setInterval(() => {
            const now = Date.now();
            for (const [id, entry] of this.limits) {
                if (now > entry.resetAt + 60000) {
                    this.limits.delete(id);
                }
            }
        }, 60000);
    }

    isLimited(id) {
        const now = Date.now();
        const entry = this.limits.get(id) || { count: 0, resetAt: now + this.windowMs };

        if (now > entry.resetAt) {
            entry.count = 1;
            entry.resetAt = now + this.windowMs;
        } else {
            entry.count++;
        }

        this.limits.set(id, entry);
        return entry.count > this.maxRequests;
    }
}

module.exports = {
    sanitizeName,
    isValidRoomCode,
    RateLimiter
};
