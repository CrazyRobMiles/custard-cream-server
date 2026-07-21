const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const User = require('./schemas/user');
const TagCache = require('./behaviours/tagCache');

const port = process.env.PORT || 3000;

// PORT is set by the hosting platform in production; locally we fall back
// to dotenv for the .env file, same convention as box-server's manager.js.
if (port == 3000)
    require('dotenv').config();

class Manager {

    startDBPromise(dbUrl, options) {
        return new Promise((kept, broken) => {
            mongoose.connect(dbUrl, options);
            const db = mongoose.connection;
            db.once('open', () => kept(db));
            db.on('error', (error) => broken(error));
        });
    }

    async checkForCameraUser() {
        const cameraUser = await User.findOne({ email: process.env.CAMERA_ACCOUNT_EMAIL });

        if (cameraUser == null) {
            console.log('Camera account not registered, creating it');
            const hashedPassword = await bcrypt.hash(process.env.CAMERA_ACCOUNT_PASSWORD, 10);
            const user = new User({
                name: 'Custard Cream Camera',
                password: hashedPassword,
                role: 'camera',
                email: process.env.CAMERA_ACCOUNT_EMAIL
            });
            await user.save();
            console.log('Camera account created');
        }
    }

    async startServices() {
        console.log('Connecting to the database...');

        this.db = await this.startDBPromise(process.env.DATABASE_URL, {});

        console.log('Database connected');

        await this.checkForCameraUser();
        await TagCache.init();
    }

    static activeManager = null;

    static getActiveManager() {
        if (Manager.activeManager == null)
            Manager.activeManager = new Manager();

        return Manager.activeManager;
    }
}

module.exports = Manager;
