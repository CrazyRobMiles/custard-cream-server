const words = require('../wordlist.json');
const Picture = require('../schemas/picture');

const MAX_ATTEMPTS = 10;

function randomPhrase() {
    const pick = () => words[Math.floor(Math.random() * words.length)];
    return [pick(), pick(), pick()].join('-');
}

// Generates a phrase that isn't currently in use. This is a best-effort check -
// a duplicate unique index on Picture.phrase is the real safety net against a
// race between this check and the eventual insert.
async function generateUniqueThreeWordPhrase() {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const phrase = randomPhrase();
        const existing = await Picture.findOne({ phrase });
        if (existing === null) {
            return phrase;
        }
    }

    throw new Error(`Could not find a free three-word phrase after ${MAX_ATTEMPTS} attempts`);
}

module.exports = generateUniqueThreeWordPhrase;
