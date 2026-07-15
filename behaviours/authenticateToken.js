const jwt = require('jsonwebtoken');
const User = require('../schemas/user');

const jwtExpirySeconds = 6000;
const jwtRenewSeconds = 30;

function extractToken(req) {
    if (req.cookies && req.cookies.token) {
        return { token: req.cookies.token, viaCookie: true };
    }

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return { token: authHeader.slice('Bearer '.length), viaCookie: false };
    }

    return { token: null, viaCookie: false };
}

// Devices/API clients authenticating with a Bearer header should get a plain
// 401, never an HTML redirect - only browser-style requests (an existing
// cookie, or an Accept header that prefers HTML) get the redirect-to-/login
// behaviour that box-server uses.
function reject(req, res, viaCookie) {
    if (viaCookie || req.accepts(['html', 'json']) === 'html') {
        res.redirect('/login');
        return;
    }
    res.status(401).json({ error: 'Not authenticated' });
}

async function authenticateToken(req, res, next) {
    const { token, viaCookie } = extractToken(req);

    if (!token || token === 'logged out') {
        reject(req, res, viaCookie);
        return;
    }

    let payload;

    try {
        payload = jwt.verify(token, process.env.ACTIVE_TOKEN_SECRET);
    } catch (e) {
        reject(req, res, viaCookie);
        return;
    }

    const user = await User.findOne({ _id: payload.id });

    if (user === null) {
        reject(req, res, viaCookie);
        return;
    }

    res.user = user;

    // Sliding expiry only applies to browser sessions - a header-authenticated
    // client is responsible for logging in again when its token expires.
    if (viaCookie) {
        const nowUnixSeconds = Math.round(Number(new Date()) / 1000);
        const tokenSecondsLeft = payload.exp - nowUnixSeconds;

        if (tokenSecondsLeft < jwtRenewSeconds) {
            const accessToken = jwt.sign(
                { id: user.id },
                process.env.ACTIVE_TOKEN_SECRET,
                {
                    algorithm: 'HS256',
                    expiresIn: jwtExpirySeconds,
                });

            res.cookie('token', accessToken, { maxAge: jwtExpirySeconds * 1000 });
        }
    }

    next();
}

module.exports = authenticateToken;
