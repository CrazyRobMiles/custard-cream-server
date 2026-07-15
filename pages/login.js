const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../schemas/user');

const jwtExpirySeconds = 6000;

router.get('/', (req, res) => {
    res.render('login.ejs');
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
        res.redirect('../');
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
    res.redirect('/login');
}

module.exports = router;
