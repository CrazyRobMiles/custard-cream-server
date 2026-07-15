const express = require('express');
const router = express.Router();
const Picture = require('../schemas/picture');

router.get('/', async (req, res) => {
    // Consent is given by the camera operator choosing to publish at capture
    // time, so every uploaded picture is eligible for random view - no
    // separate release/consent gate.
    const results = await Picture.aggregate([{ $sample: { size: 1 } }]);

    if (results.length === 0) {
        res.render('random.ejs', { picture: null });
        return;
    }

    // $sample returns plain objects, not hydrated documents, but the view
    // only needs the fields it already selected (phrase, filename).
    res.render('random.ejs', { picture: results[0] });
});

module.exports = router;
