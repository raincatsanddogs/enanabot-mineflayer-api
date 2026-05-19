/**
 * @module wordle_state
 * @description Shared word list helpers and scoped Wordle game state.
 */

const fs = require('fs');
const path = require('path');
const { sanitize_scope_part } = require('../../utils/bot_context');

const WORDLE_LIST_DIR = path.join(__dirname, 'wordle_list');
const TARGET_WORD_FILE = path.join(WORDLE_LIST_DIR, 'filtered-wordle-words.txt');
const GUESS_WORD_FILE = path.join(WORDLE_LIST_DIR, 'words.txt');
const MAX_ATTEMPTS = 6;
const WORD_LENGTH = 5;
const DEFAULT_SCOPE = 'default';

let target_words = [];
let guess_words = [];
let guess_word_set = new Set();

/** @type {Map<string, { game_active: boolean, target_word: string, attempts: number, wordle_status: Array }>} */
const games = new Map();

/**
 * Normalize a bot scope for the game-state map.
 * @param {string} scope - Raw bot scope.
 * @returns {string} Normalized scope.
 */
function normalize_scope(scope = DEFAULT_SCOPE) {
    return sanitize_scope_part(scope || DEFAULT_SCOPE);
}

/**
 * Create empty visible guess status rows.
 * @returns {Array} Wordle status rows.
 */
function create_empty_status() {
    return Array.from({ length: MAX_ATTEMPTS }, () => (
        Array.from({ length: WORD_LENGTH }, () => ({ letter: '', status: '' }))
    ));
}

/**
 * Get or create the game state for one bot scope.
 * @param {string} scope - Bot scope.
 * @returns {{ game_active: boolean, target_word: string, attempts: number, wordle_status: Array }}
 */
function get_game(scope = DEFAULT_SCOPE) {
    const normalized = normalize_scope(scope);
    if (!games.has(normalized)) {
        games.set(normalized, {
            game_active: false,
            target_word: '',
            attempts: 0,
            wordle_status: create_empty_status(),
        });
    }
    return games.get(normalized);
}

/**
 * Reset visible guess status rows for one bot scope.
 * @param {string} [scope='default'] - Bot scope.
 */
function reset_wordle_status(scope = DEFAULT_SCOPE) {
    get_game(scope).wordle_status = create_empty_status();
}

/**
 * Read target and valid guess word lists.
 */
function read_word_list() {
    const target_data = fs.readFileSync(TARGET_WORD_FILE, 'utf8');
    target_words = target_data
        .split('\n')
        .map((word) => word.trim().toLowerCase())
        .filter((word) => word.length === WORD_LENGTH);

    const guess_data = fs.readFileSync(GUESS_WORD_FILE, 'utf8');
    guess_words = guess_data
        .split('\n')
        .map((word) => word.trim().toLowerCase())
        .filter((word) => word.length === WORD_LENGTH);

    guess_word_set = new Set(guess_words);
}

/**
 * Ensure word lists and scoped status are initialized.
 * @param {string} [scope='default'] - Bot scope.
 */
function ensure_initialized(scope = DEFAULT_SCOPE) {
    if (target_words.length === 0 || guess_words.length === 0) {
        read_word_list();
    }
    get_game(scope);
}

/**
 * Get a random integer in [min, max).
 * @param {number} min - Inclusive min.
 * @param {number} max - Exclusive max.
 * @returns {number} Random integer.
 */
function get_random_integer(min, max) {
    return Math.floor(Math.random() * (max - min)) + min;
}

/**
 * Start a new game if none is active.
 * @param {string} [scope='default'] - Bot scope.
 * @returns {{ ok: boolean, message: string }}
 */
function start_game(scope = DEFAULT_SCOPE) {
    ensure_initialized(scope);
    const game = get_game(scope);
    if (game.game_active) {
        return {
            ok: false,
            message: '已有进行中的wordle，输入#wordle stop可结束当前游戏',
        };
    }

    game.game_active = true;
    game.target_word = target_words[get_random_integer(0, target_words.length)];
    game.attempts = 0;
    reset_wordle_status(scope);
    return {
        ok: true,
        message: 'wordle已开始，输入#guess <五字母单词>开始猜词',
    };
}

/**
 * Stop the current game.
 * @param {string} [scope='default'] - Bot scope.
 * @returns {{ ok: boolean, message: string }}
 */
function stop_game(scope = DEFAULT_SCOPE) {
    const game = get_game(scope);
    if (!game.game_active) {
        return {
            ok: false,
            message: '当前没有正在进行中的wordle',
        };
    }

    const answer = game.target_word;
    game.game_active = false;
    return {
        ok: true,
        message: `已结束当前wordle，答案是${answer}`,
    };
}

/**
 * Score a guess against the target word.
 * @param {string} guess_word - Guess word.
 * @param {string} [scope='default'] - Bot scope.
 * @returns {{ ok: boolean, messages: string[] }}
 */
function guess_word(guess_word, scope = DEFAULT_SCOPE) {
    ensure_initialized(scope);
    const game = get_game(scope);

    if (!game.game_active) {
        return {
            ok: false,
            messages: ['没有正在进行中的wordle,请输入#wordle start开始游戏'],
        };
    }

    if (game.attempts >= MAX_ATTEMPTS) {
        game.game_active = false;
        return {
            ok: false,
            messages: [`游戏结束！正确单词是${game.target_word}`],
        };
    }

    const normalized_guess = String(guess_word || '').trim().toLowerCase();
    if (!normalized_guess) {
        return {
            ok: false,
            messages: ['干什么？！'],
        };
    }
    if (normalized_guess.length !== WORD_LENGTH) {
        return {
            ok: false,
            messages: ['请输入一个五字单词'],
        };
    }
    if (!guess_word_set.has(normalized_guess)) {
        return {
            ok: false,
            messages: ['单词不在词库中，请输入一个有效的五字单词'],
        };
    }

    const guess_word_list = [...normalized_guess];
    const target_word_list = [...game.target_word];

    for (let index = 0; index < target_word_list.length; index++) {
        if (guess_word_list[index] === target_word_list[index]) {
            game.wordle_status[game.attempts][index] = {
                letter: guess_word_list[index],
                status: 'correct',
            };
            target_word_list[index] = null;
        }
    }

    for (let index = 0; index < target_word_list.length; index++) {
        if (game.wordle_status[game.attempts][index].status === 'correct') {
            continue;
        }
        const target_index = target_word_list.indexOf(guess_word_list[index]);
        if (target_index !== -1) {
            game.wordle_status[game.attempts][index] = {
                letter: guess_word_list[index],
                status: 'misplace',
            };
            target_word_list[target_index] = null;
        } else {
            game.wordle_status[game.attempts][index] = {
                letter: guess_word_list[index],
                status: 'incorrect',
            };
        }
    }

    const messages = format_status_rows(scope);
    if (normalized_guess === game.target_word) {
        messages.push(`恭喜你猜对了！正确单词是${game.target_word}`);
        game.game_active = false;
        return { ok: true, messages };
    }

    if (game.attempts >= MAX_ATTEMPTS - 1) {
        messages.push(`游戏结束！正确单词是${game.target_word}`);
        game.game_active = false;
        return { ok: true, messages };
    }

    game.attempts++;
    return { ok: true, messages };
}

/**
 * Format non-empty Wordle status rows.
 * @param {string} [scope='default'] - Bot scope.
 * @returns {string[]} Formatted rows using Minecraft color codes.
 */
function format_status_rows(scope = DEFAULT_SCOPE) {
    const game = get_game(scope);
    const messages = [];
    for (const row of game.wordle_status) {
        let turn_result = '';
        for (const cell of row) {
            if (!cell.letter) {
                continue;
            }
            if (cell.status === 'correct') {
                turn_result += `&a${cell.letter}&r`;
            } else if (cell.status === 'misplace') {
                turn_result += `&e${cell.letter}&r`;
            } else {
                turn_result += `&c${cell.letter}&r`;
            }
        }
        if (turn_result.length > 0) {
            messages.push(turn_result);
        }
    }
    return messages;
}

/**
 * Get a hint message for current game state.
 * @param {string} [scope='default'] - Bot scope.
 * @returns {string} Hint text.
 */
function get_hint(scope = DEFAULT_SCOPE) {
    const game = get_game(scope);
    if (!game.game_active) {
        return '没有正在进行中的wordle,请输入#wordle start开始游戏';
    }
    if (game.attempts === 0) {
        return '你还没有进行过猜词，无法获取提示';
    }
    return '提示功能先鸽着（';
}

module.exports = {
    MAX_ATTEMPTS,
    WORD_LENGTH,
    ensure_initialized,
    start_game,
    stop_game,
    guess_word,
    get_hint,
};
