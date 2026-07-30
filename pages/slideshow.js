const express = require('express');
const router = express.Router();

// Both pages are purely client-fetch-driven (random.js's /batch and /tags
// endpoints) - no DB access needed here.
router.get('/', (req, res) => {
    res.render('slideshowStart.ejs');
});

router.get('/view', (req, res) => {
    res.render('slideshow.ejs');
});

module.exports = router;
