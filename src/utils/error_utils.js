/**
 * @module error_utils
 * @description Error formatting helpers shared by command plugins.
 */

/**
 * Convert an unknown error-like value into a readable string.
 * @param {unknown} err - Error, string, array, or arbitrary value.
 * @returns {string} Human-readable error text.
 */
function stringify_error(err) {
    if (err === undefined || err === null) {
        return '未知错误';
    }

    if (typeof err === 'string') {
        return err;
    }

    if (Array.isArray(err)) {
        const parts = err
            .map((item) => stringify_error(item))
            .filter((item) => typeof item === 'string' && item.trim());
        return parts.length > 0 ? parts.join(', ') : '未知错误';
    }

    if (typeof err === 'object') {
        if (typeof err.message === 'string' && err.message.trim()) {
            return err.message.trim();
        }
        try {
            return JSON.stringify(err);
        } catch {
            return String(err);
        }
    }

    return String(err);
}

module.exports = {
    stringify_error,
};
