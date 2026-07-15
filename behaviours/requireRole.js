// Must run after authenticateToken, which populates res.user.
function requireRole(...allowedRoles) {
    return function (req, res, next) {
        if (!res.user || !allowedRoles.includes(res.user.role)) {
            res.status(403).json({ error: 'Not permitted for this account role' });
            return;
        }
        next();
    };
}

module.exports = requireRole;
