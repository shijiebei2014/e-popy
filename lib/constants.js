const STATE = {
    NOOP: 0,
    CONNECTING: 1,
    USER: 2,
    PASS: 3,
    STAT: 4,
    LIST: 5,
    RETR: 6,
    DELE: 7,
    QUIT: 8,
    RSET: 9,
    TOP: 10
}

module.exports = {STATE}
