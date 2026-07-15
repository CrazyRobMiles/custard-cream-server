// Loaded before anything reads process.env.PORT/DATABASE_URL/etc below - in
// production the host (Heroku/Azure) injects real env vars and PORT won't be
// the local default, so this is a harmless no-op there.
if (!process.env.PORT || process.env.PORT == 3000)
    require('dotenv').config();

const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const cookieParser = require('cookie-parser');
app.use(cookieParser());

app.set('view engine', 'ejs');

const port = process.env.PORT || 3000;

const Manager = require('./manager');

const login = require('./pages/login');
const logout = require('./pages/logout');
const pictures = require('./pages/pictures');
const random = require('./pages/random');

console.log('Starting up...');

const mgr = Manager.getActiveManager();

mgr.startServices().then(() => {

    console.log('Services now running....');

    app.get('/', (req, res) => {
        res.render('index.ejs');
    });

    app.use('/public', express.static('public'));
    app.use('/assets', express.static(path.join(__dirname, 'assets')));
    app.use('/pictures', express.static(path.join(__dirname, 'public', 'pictures')));
    app.use('/login', login);
    app.use('/logout', logout);
    app.use('/pictures', pictures);
    app.use('/random', random);

    // multer (fileFilter/limits) errors, and anything else thrown synchronously
    // in a route, land here rather than Express's default HTML error page -
    // API/device clients calling /pictures need a JSON error, not HTML.
    app.use((err, req, res, next) => {
        console.log('Request error:', err.message);
        res.status(400).json({ error: err.message });
    });

    app.listen(port, () => console.log(`Server listening on: ${port}`));

}).catch((err) => {
    console.error('Failed to start services:', err.message);
    process.exit(1);
});
