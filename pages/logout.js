const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
    res.cookie('token', 'logged out');
    res.redirect('/login');
});

module.exports = router;
