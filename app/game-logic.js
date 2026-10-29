/*
 * Hangbitch - pure game logic.
 *
 * No DOM, no crypto, no storage: everything here is a deterministic function of
 * its inputs, which is what makes it testable from Node (see tests/hangbitch-tests.js).
 * Exposes `globalThis.BHLogic`.
 *
 * Byte-for-byte this file is the single source of truth for the rules:
 *   - 7 lives
 *   - correct guess  -> reveal every occurrence, no life lost
 *   - wrong guess    -> lose exactly one life, advance exactly one stage
 *   - repeated guess -> nothing happens
 *   - non-letter characters (spaces, punctuation) are always shown and never
 *     consume a life
 */
(function (root) {
  'use strict';

  var LIVES = 7;

  /**
   * Illustration stages. Index 0 is the empty gallows (no life spent); each
   * life spent reveals exactly one further stage. The 7th is the beer mug.
   * `data-part` attributes in index.html must match these names exactly.
   */
  var STAGES = ['gallows', 'head', 'body', 'left-arm', 'right-arm', 'left-leg', 'right-leg', 'beer'];

  function LogicError(code, message) {
    this.name = 'LogicError';
    this.code = code;
    this.message = message || code;
  }
  LogicError.prototype = Object.create(Error.prototype);
  LogicError.prototype.constructor = LogicError;

  /**
   * Normalise a secret before tokenising.
   *
   * Documented, deliberately conservative normalisation:
   *   - Unicode NFC composition (so "e" + combining accent becomes "é")
   *   - tabs / CR / LF collapse to a single space (multi-line paste safety)
   *   - leading and trailing whitespace trimmed
   * Nothing else is changed: inner spacing, punctuation, case and non-ASCII
   * letters are preserved verbatim.
   */
  function normalizeWord(word) {
    return String(word == null ? '' : word)
      .normalize('NFC')
      .replace(/[\t\r\n\u000b\u000c\u00a0]+/g, ' ')
      .trim();
  }

  /**
   * Fold a single character to the A-Z key it answers to, or null when the
   * character is not guessable (space, punctuation, digit, emoji, or a letter
   * with no Latin A-Z equivalent such as Cyrillic, Greek or CJK).
   *
   * Accented Latin letters fold to their base letter, so guessing `E` reveals
   * `É` as well. That is the only "flat" mapping applied, and the displayed
   * character is always the original one, so the phrase's meaning is kept.
   */
  function foldChar(char) {
    if (!char) {
      return null;
    }
    var decomposed = char.normalize('NFD').replace(/[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]/g, '');
    var upper = decomposed.toUpperCase();
    if (upper.length === 1 && upper >= 'A' && upper <= 'Z') {
      return upper;
    }
    return null;
  }

  function tokenize(word) {
    var chars = Array.from(word);
    return chars.map(function (raw) {
      return {
        raw: raw,
        key: foldChar(raw),
        // Whitespace is rendered as a gap rather than a visible glyph.
        isSpace: /\s/.test(raw)
      };
    });
  }

  /**
   * Build a fresh round.
   * @param {{word: string, hint?: string}} secret
   * @param {number} [lives]
   */
  function createRound(secret, lives) {
    var word = normalizeWord(secret && secret.word);
    var hint = String((secret && secret.hint) || '').trim();

    if (!word) {
      throw new LogicError('EMPTY_WORD', 'The secret is empty.');
    }

    var tokens = tokenize(word);
    var guessable = {};
    tokens.forEach(function (t) {
      if (t.key) {
        guessable[t.key] = true;
      }
    });

    var keys = Object.keys(guessable);
    if (keys.length === 0) {
      throw new LogicError('NO_LETTERS', 'The secret contains no guessable letters (A-Z).');
    }

    return {
      word: word,
      hint: hint,
      tokens: tokens,
      guessableKeys: keys,
      guessed: {},
      wrong: 0,
      lives: typeof lives === 'number' && lives > 0 ? lives : LIVES,
      status: 'playing',
      startedAt: null
    };
  }

  function isRevealed(round, token) {
    return !token.key || Object.prototype.hasOwnProperty.call(round.guessed, token.key);
  }

  function hasGuessed(round, key) {
    return Object.prototype.hasOwnProperty.call(round.guessed, key);
  }

  function remainingKeys(round) {
    return round.guessableKeys.filter(function (k) {
      return !hasGuessed(round, k);
    });
  }

  function isWon(round) {
    return remainingKeys(round).length === 0;
  }

  function isLost(round) {
    return round.status === 'lost';
  }

  /** Illustration stage index: 0 = gallows only, 1..7 = body parts then beer. */
  function stageIndex(round) {
    return Math.max(0, Math.min(STAGES.length - 1, round.wrong));
  }

  function stageName(round) {
    return STAGES[stageIndex(round)];
  }

  /**
   * Apply one guess.
   * @returns {{result: 'correct'|'incorrect'|'repeat'|'invalid'|'blocked',
   *            status: string, wrong: number, stage: number}}
   */
  function guess(round, letter) {
    var key = String(letter == null ? '' : letter).toUpperCase();
    var snapshot = function (result) {
      return {
        result: result,
        status: round.status,
        wrong: round.wrong,
        stage: stageIndex(round)
      };
    };

    if (!round || round.status !== 'playing') {
      return snapshot('blocked');
    }
    if (!/^[A-Z]$/.test(key)) {
      return snapshot('invalid');
    }
    if (hasGuessed(round, key)) {
      return snapshot('repeat');
    }

    round.guessed[key] = true;

    if (round.guessableKeys.indexOf(key) !== -1) {
      if (isWon(round)) {
        round.status = 'won';
      }
      return snapshot('correct');
    }

    round.wrong += 1;
    if (round.wrong >= round.lives) {
      round.status = 'lost';
    }
    return snapshot('incorrect');
  }

  /** Render the masked view. Unrevealed letters are never included. */
  function renderWord(round) {
    return round.tokens.map(function (t) {
      if (t.isSpace) {
        return { char: ' ', revealed: true, guessable: false };
      }
      var revealed = isRevealed(round, t);
      return {
        char: revealed ? t.raw : '',
        revealed: revealed,
        guessable: !!t.key
      };
    });
  }

  function answer(round) {
    return round.word;
  }

  function letterKeys() {
    var out = [];
    for (var i = 65; i <= 90; i++) {
      out.push(String.fromCharCode(i));
    }
    return out;
  }

  root.BHLogic = {
    LIVES: LIVES,
    STAGES: STAGES,
    LogicError: LogicError,
    normalizeWord: normalizeWord,
    foldChar: foldChar,
    tokenize: tokenize,
    createRound: createRound,
    guess: guess,
    isRevealed: isRevealed,
    hasGuessed: hasGuessed,
    remainingKeys: remainingKeys,
    isWon: isWon,
    isLost: isLost,
    stageIndex: stageIndex,
    stageName: stageName,
    renderWord: renderWord,
    answer: answer,
    letterKeys: letterKeys
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
