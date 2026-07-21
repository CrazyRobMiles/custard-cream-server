const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../schemas/user');

const jwtExpirySeconds = 6000;

// Only redirect back to a same-site path after login - a bare "/..." value,
// never one starting "//" or "/\" (both of which browsers can treat as
// protocol-relative, i.e. an open redirect to another host).
function safeNextPath(value) {
    if (typeof value !== 'string') return null;
    if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null;
    return value;
}

router.get('/', (req, res) => {
    res.render('login.ejs', { next: safeNextPath(req.query.next) || '' });
});

router.post('/', async (req, res) => {
    try {
        const existingUser = await User.findOne({ email: req.body.email });

        if (existingUser == null) {
            respondInvalid(req, res);
            return;
        }

        const validPassword = await bcrypt.compare(req.body.password, existingUser.password);

        if (!validPassword) {
            respondInvalid(req, res);
            return;
        }

        const accessToken = jwt.sign(
            { id: existingUser.id },
            process.env.ACTIVE_TOKEN_SECRET,
            {
                algorithm: 'HS256',
                expiresIn: jwtExpirySeconds,
            });

        await existingUser.updateOne({ lastLoginDate: Date.now() });

        // Browsers get the token as a cookie and a redirect; API/device clients
        // (which asked for JSON) get it back in the response body instead, since
        // they have no cookie jar to rely on and need to send it as a Bearer header.
        if (req.accepts(['html', 'json']) === 'json') {
            res.status(200).json({ token: accessToken, expiresIn: jwtExpirySeconds });
            return;
        }

        res.cookie('token', accessToken, { maxAge: jwtExpirySeconds * 1000 });
        res.redirect(safeNextPath(req.body.next) || '../');
    }
    catch (err) {
        console.log(err.message);
        respondInvalid(req, res);
    }
});

function respondInvalid(req, res) {
    if (req.accepts(['html', 'json']) === 'json') {
        res.status(401).json({ error: 'Invalid email or password' });
        return;
    }
    res.cookie('token', 'logged out');
    const next = safeNextPath(req.body.next);
    res.redirect(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
}

module.exports = router;
